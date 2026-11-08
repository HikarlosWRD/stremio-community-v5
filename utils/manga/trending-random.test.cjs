'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('random trending samples pages beyond visible cards and avoids immediate repetition', async () => {
    const source = fs.readFileSync(path.join(__dirname, 'reader/server.js'), 'utf8');
    const start = source.indexOf('const trendingCache =');
    const end = source.indexOf('const [token]');
    assert.ok(start >= 0 && end > start);
    const fetchedPages = [];
    const sandbox = {
        Map, Date, Math, Number, JSON, Error, String,
        AbortSignal: { timeout: () => undefined },
        randomInt: (min, max) => max === undefined ? min - 1 : max - 1,
        fetch: async (_url, options) => {
            const page = JSON.parse(options.body).variables.page;
            fetchedPages.push(page);
            return { ok: true, json: async () => ({ data: { Page: {
                pageInfo: { hasNextPage: true, lastPage: 166 },
                media: [1, 2].map(id => ({ id: page * 1000 + id,
                    title: { romaji: 'Manga ' + page + '-' + id } }))
            } } }) };
        }
    };
    vm.runInNewContext(source.slice(start, end) +
        '\nthis.trendingApi = { trendingManga, randomTrendingManga };', sandbox);
    const first = await sandbox.trendingApi.trendingManga(1);
    assert.equal(first.pageCount, 166);
    const firstDraw = await sandbox.trendingApi.randomTrendingManga();
    assert.equal(firstDraw.id, 166002);
    const secondDraw = await sandbox.trendingApi.randomTrendingManga(firstDraw.id);
    assert.equal(secondDraw.id, 166001);
    assert.ok(!first.rows.some(work => work.id === firstDraw.id));
    assert.deepEqual(fetchedPages, [1, 166]); // Cached first and random pages
});
