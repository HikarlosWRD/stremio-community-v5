const assert = require('node:assert/strict');
const test = require('node:test');
const coverageRules = import('./reader/coverage.mjs');
const { searchableSources, rankResults } = require('./reader/search-rules');

test('chapter coverage separates listed range from the earliest readable start', async () => {
    const { inspectCoverage, compareCoverage } = await coverageRules;
    const order = [];
    const chapters = [200, 2, 0, 4, 1, 3].map(number => ({ number, id: String(number) }));
    const coverage = await inspectCoverage(chapters, async chapter => {
        order.push(chapter.number);
        return chapter.number >= 2;
    });
    assert.deepEqual(order, [0, 1, 2]);
    assert.deepEqual(coverage, { first: 0, last: 200, verified: 2, run: 3, attempted: 3 });
    assert.ok(compareCoverage({ first: 1, last: 7, verified: 1, run: 3 }, coverage) < 0);
    assert.ok(compareCoverage({ first: 0, verified: null, attempted: 4 }, coverage) > 0);
});

test('early chapter probing stops after four distinct numbers and leaves unknowns unverified', async () => {
    const { inspectCoverage } = await coverageRules;
    const chapters = [null, -1, 0, 0, 1, 2, 3, 4, 5].map((number, id) => ({ number, id }));
    let attempts = 0;
    const coverage = await inspectCoverage(chapters, async () => { attempts++; return false; });
    assert.equal(attempts, 4);
    assert.equal(coverage.verified, null);
    assert.equal(coverage.last, 5);
});

test('readable chapter zero ranks ahead of an exact match without images', async () => {
    const { compareAvailability } = await coverageRules;
    const a = { relevance: 2, coverage: { first: 0, last: 79, verified: 0, run: 80 } };
    const b = { relevance: 3, coverage: { first: 0, last: 200, verified: null, run: 0 } };
    assert.ok(compareAvailability(a, b) < 0);
});

test('adult sources and titles require explicit opt-in', () => {
    const source = { name: 'Example', warning: 'NSFW', installed: true, enabled: true };
    const row = { id: '1', title: 'Example', adult: true };
    assert.deepEqual(searchableSources([source], 'active'), []);
    assert.deepEqual(searchableSources([source], 'active', true), [source]);
    assert.deepEqual(rankResults([row], 'Example'), []);
    assert.equal(rankResults([row], 'Example', true).length, 1);
});
