import test from 'node:test';
import assert from 'node:assert/strict';
import { findChapters } from './reader/ui/chapter-list.mjs';
import rules from './reader/search-rules.js';

const entries = Array.from({length: 201}, (_, index) => ({
    name: 'Capítulo ' + (200 - index), number: 200 - index
}));

test('all 201 chapters remain visible and chapter 1 opens at the original index', () => {
    assert.equal(findChapters(entries, '').length, 201);
    for (const query of ['1', '001', 'capitulo 1', 'CAPÍTULO 01']) {
        assert.deepEqual(findChapters(entries, query).map(x => x.index), [199]);
    }
});

test('chapter search tolerates accents, number formats and descriptive titles', () => {
    const items = [{ name: 'Prólogo', number: 0 }, { name: 'Mission 1.5' }];
    assert.equal(findChapters(items, 'prologo')[0].index, 0);
    assert.equal(findChapters(items, '1,5')[0].index, 1);
});

test('search scopes include installed sources only and preserve the adult filter', () => {
    const available = [
        { id: '1', engine: 'kotatsu', installed: true, enabled: true },
        { id: '2', engine: 'mihon', installed: true, enabled: false },
        { id: '3', engine: 'kotatsu', installed: false, enabled: true },
        { id: '4', engine: 'mihon', installed: true, enabled: true, warning: 'NSFW' }
    ];
    assert.deepEqual(rules.searchableSources(available, 'active').map(x => x.id), ['1']);
    assert.deepEqual(rules.searchableSources(available, 'installed').map(x => x.id), ['1', '2']);
});
