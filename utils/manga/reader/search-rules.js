'use strict';

function normalize(text) {
    return String(text ?? '').normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '')
        .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function isAdultSource(source) {
    return source.kind === 'HENTAI' || source.warning === 'NSFW' || /hentai/i.test(source.name);
}

function rankResults(rows, query) {
    const title = normalize(query);
    if (!title) return [];
    const singleWord = !title.includes(' ');
    const compactScript = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u.test(title);
    function score(candidate) {
        if (candidate === title) return 3;
        if (candidate.startsWith(title + ' ')) return 2;
        if (compactScript && candidate.includes(title)) return 1;
        return singleWord && (' ' + candidate + ' ').includes(' ' + title + ' ') ? 1 : 0;
    }
    const ranked = new Map();
    for (const row of rows) {
        if (row.adult || /^(pack (?:de )?(?:imagens|images)|doujinshi)\b/i.test(normalize(row.title))) continue;
        const relevance = Math.max(score(normalize(row.title)), ...(row.aliases || []).map(x => score(normalize(x))));
        if (relevance > (ranked.get(row.id)?.relevance ?? 0))
            ranked.set(row.id, { ...row, relevance });
    }
    const titles = new Set();
    return [...ranked.values()].sort((a, b) => b.relevance - a.relevance).filter(row => {
        const name = normalize(row.title);
        if (titles.has(name)) return false;
        titles.add(name);
        return true;
    });
}

function searchableSources(rows, scope) {
    return rows.filter(row => row.installed && (scope === 'installed' || row.enabled) && !isAdultSource(row));
}

module.exports = { normalize, rankResults, isAdultSource, searchableSources };
