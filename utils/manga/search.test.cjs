const assert = require('node:assert/strict');
const test = require('node:test');
const { rankResults, isAdultSource } = require('./reader/search-rules');

test('Solo Leveling ignores fallback catalogs and ranks exact titles first', () => {
    const rows = [
        { id: '1', title: 'Leveling with a new party' },
        { id: '2', title: 'Solo Leveling: Ragnarok' },
        { id: '3', title: 'Solo-Leveling' },
        { id: '4', title: 'Pack de imagens (Solo Leveling)', adult: true },
        { id: '5', title: 'Only I Level Up', aliases: ['Solo Leveling'] },
        { id: '6', title: 'Walmart Solo Leveling' },
        { id: '7', title: 'Leveling Up My S-Rank Necromancy Solo' },
        { id: '8', title: 'Dhaka Ascension inspired by Solo Leveling' },
        { id: '9', title: 'Solo leveling' },
        { id: '3', title: 'Solo Leveling' }
    ];
    assert.deepEqual(rankResults(rows, 'solo leveling').map(x => x.id), ['3', '5', '2']);
});

test('search recognizes accented aliases and rejects partial-word matches', () => {
    const rows = [
        { id: '1', title: 'Cidade', aliases: ['Coração de Aço'] },
        { id: '2', title: 'Coracao de açoite' }
    ];
    assert.deepEqual(rankResults(rows, 'coracao de aco').map(x => x.id), ['1']);
});

test('global search skips sources explicitly flagged 18+', () => {
    assert.equal(isAdultSource({ name: 'Example', kind: 'HENTAI' }), true);
    assert.equal(isAdultSource({ name: 'Example', warning: 'NSFW' }), true);
    assert.equal(isAdultSource({ name: 'MundoHentaiOficial' }), true);
    assert.equal(isAdultSource({ name: 'Example', warning: 'MIXED' }), false);
});
