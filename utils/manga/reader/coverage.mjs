function chapterNumber(chapter) {
    if (Number.isFinite(chapter.number) && chapter.number > 0) return chapter.number;
    const name = (chapter.name || '').normalize('NFKD').replace(/\p{M}/gu, '');
    const named = [...name.matchAll(/(?:capitulo|chapter|ch|episodio|episode|ep|#)\.?\s*(\d+(?:[.,]\d+)?)/gi)].at(-1);
    if (named) return Number(named[1].replace(',', '.'));
    if (chapter.number === 0 && (!name || /prolog/i.test(name))) return 0;
    return null;
}

export async function inspectCoverage(chapters, hasImage, signal) {
    const byNumber = new Map();
    for (const chapter of chapters) {
        const number = chapterNumber(chapter);
        if (number !== null && !byNumber.has(number)) byNumber.set(number, chapter);
    }
    const numbers = [...byNumber.keys()].sort((a, b) => a - b);
    let verified = null;
    let attempted = 0;
    for (const number of numbers.slice(0, 4)) {
        if (signal?.aborted) break;
        attempted++;
        if (await hasImage(byNumber.get(number))) {
            verified = number;
            break;
        }
    }
    let run = 0;
    if (verified !== null) {
        while (byNumber.has(verified + run)) run++;
    }
    return { count: chapters.length, first: numbers[0] ?? null, last: numbers.at(-1) ?? null, verified, run, attempted };
}

export function compareCoverage(a, b) {
    if (a?.verified != null && b?.verified != null)
        return a.verified - b.verified || b.run - a.run;
    if (a?.verified != null) return -1;
    if (b?.verified != null) return 1;
    return (a?.first ?? Number.MAX_VALUE) - (b?.first ?? Number.MAX_VALUE);
}

export function compareAvailability(a, b) {
    if (a.coverage?.verified != null || b.coverage?.verified != null)
        return compareCoverage(a.coverage, b.coverage) || b.relevance - a.relevance;
    return b.relevance - a.relevance || compareCoverage(a.coverage, b.coverage);
}
