import test from 'node:test';
import assert from 'node:assert/strict';
import {
    historyId, migrateReadingHistory, readingHistory, recordChapterVisit,
    updateHistoryPage, removeHistoryEntry
} from './reader/ui/reading-history.mjs';

const blue = { id: '23', title: 'Blue Lock', source: { engine: 'mihon', name: 'Example' } };
const solo = { id: '7', title: 'Solo Leveling', source: { engine: 'kotatsu', name: 'Example' } };

test('old library entries migrate chapters already marked read and last progress without losing state', () => {
    const data = { version: 1, works: {
        a: { item: blue, inLibrary: true, read: { 101: true, 102: true, 103: false },
            lastChapter: { id: '102', name: 'Capítulo 102', page: 4 },
            chapters: [{ id: '101', name: 'Capítulo 101' },
                { id: '102', name: 'Capítulo 102' }], lastReadAt: 1700000000000 },
        b: { item: solo, inLibrary: false, read: { 0: true },
            chapters: [{ id: '0', name: 'Capítulo 0' }], lastReadAt: 1700000000001 }
    }};
    assert.equal(migrateReadingHistory(data), true);
    const entries = readingHistory(data);
    assert.equal(entries.length, 3);
    assert.deepEqual(entries.map(entry => entry.chapterName),
        ['Capítulo 0', 'Capítulo 101', 'Capítulo 102']);
    assert.equal(entries.find(entry => entry.chapterId === '102').page, 4);
    assert.equal(data.works.a.read['103'], false);
    assert.equal(data.works.b.inLibrary, false);
    assert.equal(migrateReadingHistory(data), false);
    assert.equal(readingHistory(data).length, 3);
});

test('new chapters from different works persist in recency order and reopening updates existing entry', () => {
    const data = { version: 1, works: {}, history: [] };
    recordChapterVisit(data, blue, { id: 1, name: 'Capítulo 1' }, 0, 1000);
    recordChapterVisit(data, solo, { id: 1, name: 'Capítulo 1' }, 0, 2000);
    recordChapterVisit(data, blue, { id: 2, name: 'Capítulo 2' }, 0, 3000);
    recordChapterVisit(data, blue, { id: 1, name: 'Capítulo 1' }, 5, 4000);
    assert.equal(readingHistory(data).length, 3);
    assert.deepEqual(readingHistory(data).map(entry => entry.item.title),
        ['Blue Lock', 'Blue Lock', 'Solo Leveling']);
    assert.deepEqual(readingHistory(data).map(entry => entry.chapterId), ['1', '2', '1']);
    assert.equal(readingHistory(data)[0].page, 5);
    const restored = JSON.parse(JSON.stringify(data));
    assert.equal(readingHistory(restored).length, 3);
    assert.equal(readingHistory(restored)[0].chapterName, 'Capítulo 1');
});

test('progress changes save page without changing order of the chapter history', () => {
    const data = { works: {}, history: [] };
    recordChapterVisit(data, blue, { id: '0', name: 'Prólogo' }, 0, 1000);
    recordChapterVisit(data, solo, { id: '1', name: 'Capítulo 1' }, 0, 2000);
    assert.equal(updateHistoryPage(data, blue, '0', 19), true);
    assert.equal(readingHistory(data)[1].page, 19);
    assert.equal(readingHistory(data)[0].item.title, 'Solo Leveling');
    assert.equal(updateHistoryPage(data, blue, '999', 1), false);
});

test('removing one chapter deletes only its record, not reading flags or other chapters', () => {
    const data = { works: { a: { read: { 1: true, 2: true } } }, history: [] };
    recordChapterVisit(data, blue, { id: '1', name: 'Capítulo 1' }, 0, 100);
    recordChapterVisit(data, blue, { id: '2', name: 'Capítulo 2' }, 0, 200);
    assert.equal(removeHistoryEntry(data, historyId(blue, '1')), true);
    assert.equal(readingHistory(data).length, 1);
    assert.equal(readingHistory(data)[0].chapterId, '2');
    assert.deepEqual(data.works.a.read, { 1: true, 2: true });
    assert.equal(removeHistoryEntry(data, historyId(blue, '1')), false);
    assert.equal(migrateReadingHistory(data), false);
    assert.equal(readingHistory(data).length, 1);
});

test('history keeps all chapters without a display-count limit and distinguishes chapter zero', () => {
    const data = { history: [], works: {} };
    for (let chapter = 0; chapter < 150; chapter++)
        recordChapterVisit(data, blue, { id: chapter, name: 'Capítulo ' + chapter }, 0, chapter + 1);
    assert.equal(readingHistory(data).length, 150);
    assert.equal(readingHistory(data)[0].chapterName, 'Capítulo 149');
    assert.equal(readingHistory(data).at(-1).chapterName, 'Capítulo 0');
    assert.notEqual(historyId(blue, 0), historyId(solo, 0));
});
