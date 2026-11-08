'use strict';
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const source = readFileSync(join(__dirname, 'reader/ui/upscale.js'), 'utf8');
const code = source.slice(source.indexOf('function nativeTilePlan'))
    .replace('export async function upscaleNative', 'async function upscaleNative');
const sandbox = {
    document: { createElement: () => {
        const canvas = { width: 1, height: 1,
            getContext: () => ({ drawImage: () => {} }),
            toBlob: done => done({ width: canvas.width, height: canvas.height, size: 123 })
        };
        return canvas;
    } },
    createImageBitmap: async blob => ({ width: blob.width, height: blob.height, close() {} }),
    fetch: async (_url, options) => ({
        ok: true, blob: async () => ({ width: options.body.width * 2,
            height: options.body.height * 2, size: 567 })
    }),
    Error, Math, Promise, Number, AbortController
};
vm.runInNewContext(code + '\nthis.tiles = { nativeTilePlan, nativeWholeFits, upscaleNative };', sandbox);
test('tile plans cover long pages completely and never exceed native limits', () => {
    for (const [width, height, scale, side] of [[1400, 6500, 2, 1024], [12000, 1100, 4, 640], [720, 30000, 2, 1024]]) {
        const rows = sandbox.tiles.nativeTilePlan(width, height, side);
        let y = 0, totalArea = 0;
        for (const row of rows) {
            let x = 0;
            for (const p of row) {
                assert.equal(p.x, x);
                assert.equal(p.y, y);
                assert.ok(p.left <= p.x && p.top <= p.y);
                assert.ok(p.left + p.inputWidth >= p.x + p.coreWidth);
                assert.ok(p.top + p.inputHeight >= p.y + p.coreHeight);
                assert.ok(p.inputWidth * p.inputHeight * scale * scale < 24000000);
                assert.ok(p.inputWidth * scale <= 16384 && p.inputHeight * scale <= 16384);
                x += p.coreWidth;
                totalArea += p.coreWidth * p.coreHeight;
            }
            assert.equal(x, width);
            y += row[0].coreHeight;
        }
        assert.equal(y, height);
        assert.equal(totalArea, width * height);
    }
});
test('native upscaler assembles oversized pages in pieces and reports progress', async () => {
    const progress = [];
    const sourceImage = { naturalWidth: 1400, naturalHeight: 6500 };
    const result = await sandbox.tiles.upscaleNative(sourceImage, 'realcugan', 2,
        new AbortController().signal, (done, total) => progress.push([done, total]));
    assert.equal(result.tiled, true);
    assert.equal(result.width, 2800);
    assert.equal(result.height, 13000);
    const tiles = result.rows.flat();
    assert.ok(tiles.length > 1);
    assert.equal(tiles.reduce((sum, p) => sum + p.width, 0), 2800 * result.rows.length);
    assert.deepEqual(progress.at(-1), [tiles.length, tiles.length]);
    assert.equal(sandbox.tiles.nativeWholeFits(sourceImage.naturalWidth, sourceImage.naturalHeight, 2), false);
});
test('native upscaler retries with smaller blocks when Vulkan rejects a large tile', async () => {
    const originalFetch = sandbox.fetch;
    let rejected = 0;
    sandbox.fetch = async (url, options) => {
        if (options.body.width > 700) {
            rejected++;
            return { ok: false, json: async () => ({
                error: 'O modelo Vulkan não conseguiu processar esta página.'
            }) };
        }
        return originalFetch(url, options);
    };
    try {
        const result = await sandbox.tiles.upscaleNative(
            { naturalWidth: 1300, naturalHeight: 2500 }, 'realcugan', 2,
            new AbortController().signal);
        assert.ok(result.tiled);
        assert.ok(rejected > 0);
        assert.equal(result.width, 2600);
        assert.equal(result.height, 5000);
    } finally {
        sandbox.fetch = originalFetch;
    }
});test('tiled upscale runs two image requests concurrently, never three', async () => {
    const originalFetch = sandbox.fetch;
    let active = 0, peak = 0, issued = 0;
    sandbox.fetch = async (url, options) => {
        issued++;
        peak = Math.max(peak, ++active);
        await new Promise(resolve => setTimeout(resolve, 4));
        active--;
        return originalFetch(url, options);
    };
    try {
        const image = { naturalWidth: 1400, naturalHeight: 6500 };
        const result = await sandbox.tiles.upscaleNative(image, 'realcugan', 2,
            new AbortController().signal);
        assert.equal(result.tiled, true);
        assert.ok(issued > 2);
        assert.equal(peak, 2);
    } finally { sandbox.fetch = originalFetch; }
});
test('jumping away aborts the two active tiles and never starts old tiles', async () => {
    const originalFetch = sandbox.fetch;
    let launched = 0;
    const controller = new AbortController();
    sandbox.fetch = (_url, options) => {
        launched++;
        return new Promise((resolve, reject) => {
            if (options.signal.aborted) return reject(options.signal.reason);
            options.signal.addEventListener('abort', () => reject(options.signal.reason),
                { once: true });
        });
    };
    try {
        const pending = sandbox.tiles.upscaleNative(
            { naturalWidth: 1400, naturalHeight: 6500 }, 'realcugan', 2, controller.signal);
        await new Promise(resolve => setTimeout(resolve, 12));
        assert.equal(launched, 2);
        controller.abort(new Error('page changed'));
        await assert.rejects(pending, /page changed/);
        assert.equal(launched, 2);
    } finally { sandbox.fetch = originalFetch; }
});
