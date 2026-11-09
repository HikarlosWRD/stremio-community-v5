'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { detectImageType, imageHttpError } = require('./reader/image-format');

const png = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
const jpeg = Buffer.from([255,216,255,224,0,0,0,0]);
const webp = Buffer.from('RIFFxxxxWEBP', 'ascii');
const gif = Buffer.from('GIF89a1111', 'ascii');
const avif = Buffer.from('xxxxftypavifxxxx', 'ascii');

test('accept genuine image signatures even when upstream reports wrong MIME', () => {
    assert.equal(detectImageType(png), 'image/png');
    assert.equal(detectImageType(jpeg), 'image/jpeg');
    assert.equal(detectImageType(webp), 'image/webp');
    assert.equal(detectImageType(gif), 'image/gif');
    assert.equal(detectImageType(avif), 'image/avif');
    assert.equal(detectImageType(Buffer.from('<html>captcha</html>')), null);
    assert.equal(detectImageType(Buffer.from('')), null);
});

test('HTTP errors give useful source-specific diagnostics', () => {
    assert.match(imageHttpError(403).message, /bloqueou/);
    assert.match(imageHttpError(404).message, /expirou/);
    assert.match(imageHttpError(429).message, /limitou/);
    assert.match(imageHttpError(502).message, /HTTP 502/);
});

function setup(mockFetch, refresh) {
    const server = fs.readFileSync(path.join(__dirname, 'reader/server.js'), 'utf8');
    const start = server.indexOf('const chapterImageRefreshes =');
    const end = server.indexOf('const sourceMutations =', start);
    assert.ok(start > 0 && end > start);
    const sandbox = {
        Buffer, URL, Promise, Map, Date, AbortSignal, Error, String, Number,
        imageTypes: new Set(['image/jpeg']), detectImageType, imageHttpError,
        mihonStartup: Promise.resolve({
            origin: 'http://127.0.0.1:64100',
            auth: 'Basic TEST'
        }),
        fetch: mockFetch,
        chapterImages: refresh,
        kotatsu: () => { throw new Error('unexpected Kotatsu request'); }
    };
    vm.runInNewContext(server.slice(start, end) + '\nthis.readImage = readImage;', sandbox);
    return sandbox.readImage;
}
function response(status, contentType, bytes) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: key => key === 'content-type' ? contentType : null },
        body: {
            cancel: async () => {},
            async *[Symbol.asyncIterator]() { if (bytes) yield bytes; }
        }
    };
}

test('Mihon accepts an actual JPEG delivered as application/octet-stream', async () => {
    const readImage = setup(async () => response(200, 'application/octet-stream', jpeg),
        async () => { throw new Error('should not refresh'); });
    const result = await readImage({ engine: 'mihon', value: '/api/page/1' });
    assert.equal(result.type, 'image/jpeg');
    assert.deepEqual(result.bytes, jpeg);
});

test('Mihon refreshes an expired chapter image link once for multiple pages', async () => {
    let refreshCalls = 0;
    const readImage = setup(async url => url.pathname.includes('old')
        ? response(403, 'application/json')
        : response(200, 'image/png', png), async () => {
        refreshCalls++;
        return ['/api/new/0', '/api/new/1'];
    });
    const items = [0, 1].map(pageIndex => ({
        engine: 'mihon', value: '/api/old/' + pageIndex,
        chapterId: '222', pageIndex
    }));
    const results = await Promise.all(items.map(item => readImage(item)));
    assert.equal(refreshCalls, 1);
    assert.deepEqual(results.map(x => x.type), ['image/png', 'image/png']);
    assert.equal(items[0].value, '/api/new/0');
});

test('unavailable source stays an explicit error; HTML cannot masquerade as image', async () => {
    const readImage = setup(async url => url.pathname.includes('blocked')
        ? response(403, 'text/html')
        : response(200, 'text/html', Buffer.from('<html>blocked</html>')),
    async () => ['/api/blocked']);
    await assert.rejects(readImage({
        engine: 'mihon', value: '/api/blocked', chapterId: '1', pageIndex: 0
    }), /bloqueou/);
    await assert.rejects(readImage({ engine: 'mihon', value: '/api/html' }),
        /conteúdo inválido/);
});
