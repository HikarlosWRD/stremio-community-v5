import test from 'node:test';
import assert from 'node:assert/strict';
import { compareCoverageRange, inspectCoverage } from './reader/coverage.mjs';
import { searchProgressState } from './reader/ui/search-progress.mjs';

test('search ranges sort by highest ending chapter, then earliest starting chapter', () => {
    const works = [
        { name: '1-191', first: 1, last: 191 },
        { name: '1-222', first: 1, last: 222 },
        { name: '0-191', first: 0, last: 191 },
        { name: '0-222', first: 0, last: 222 }
    ];
    works.sort(compareCoverageRange);
    assert.deepEqual(works.map(work => work.name),
        ['0-222', '1-222', '0-191', '1-191']);
});

test('unverified or unknown endings come last and zero is a valid first chapter', async () => {
    const works = [{ last: null }, { first: 0, last: 1 },
        { first: 1, last: 1 }, { first: 0, last: 3 },
        { last: undefined }, { first: 2, last: 3 }];
    works.sort(compareCoverageRange);
    assert.deepEqual(works.slice(0, 4).map(work => [work.first, work.last]),
        [[0, 3], [2, 3], [0, 1], [1, 1]]);
    const coverage = await inspectCoverage(
        [{ name: 'Capítulo 0', number: 0 }, { name: 'Capítulo 1', number: 1 },
            { name: 'Capítulo 222', number: 222 }],
        async () => true);
    assert.equal(coverage.first, 0);
    assert.equal(coverage.last, 222);
});
test('search progress tracks completed sources, including failed source attempts', () => {
    const start = searchProgressState({ total: null, completed: 0 }, true);
    assert.equal(start.determinate, false);
    const running = searchProgressState({ total: 4, completed: 2, failed: 1 }, true);
    assert.deepEqual([running.max, running.value, running.counter],
        [4, 2, '2 de 4 fontes · 50%']);
    const done = searchProgressState({ total: 4, completed: 4, failed: 1 }, false);
    assert.equal(done.label, 'Busca concluída');
    assert.equal(done.value, 4);
    const canceled = searchProgressState({ total: 4, completed: 1 }, false);
    assert.equal(canceled.label, 'Busca interrompida');
    assert.equal(canceled.value, 1);
});

test('progress stays within bounds for zero or duplicated source events', () => {
    const none = searchProgressState({ total: 0, completed: 0 }, false);
    assert.deepEqual([none.max, none.value, none.counter], [1, 1, '0 de 0 fontes · 100%']);
    const over = searchProgressState({ total: 3, completed: 9 }, true);
    assert.deepEqual([over.max, over.value], [3, 3]);
    const under = searchProgressState({ total: 3, completed: -1 }, true);
    assert.equal(under.value, 0);
});
