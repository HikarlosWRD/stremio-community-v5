// Chapter-level reading history, stored in the existing library document.
// Deleting a history entry never modifies its read bookmark or the library itself.
export function historyId(item, chapterId) {
    return JSON.stringify([item.source.engine, String(item.id), String(chapterId)]);
}

function historyItem(item) {
    return {
        id: String(item.id),
        title: item.title,
        source: item.source,
        ...(item.artwork ? { artwork: item.artwork } : {})
    };
}

function pageNumber(page) {
    return Number.isInteger(page) && page >= 0 ? page : 0;
}

export function readingHistory(data) {
    return Array.isArray(data?.history) ? [...data.history]
        .filter(entry => entry?.id && entry?.item?.source?.engine && entry.chapterId != null)
        .sort((a, b) => (b.visitedAt || 0) - (a.visitedAt || 0) ||
            a.id.localeCompare(b.id)) : [];
}

export function migrateReadingHistory(data) {
    if (Array.isArray(data.history)) return false;
    data.history = [];
    for (const work of Object.values(data.works || {})) {
        const item = work?.item;
        if (!item?.source?.engine || item.id == null) continue;
        const known = new Map((work.chapters || []).map(chapter => [String(chapter.id), chapter]));
        const chapters = new Set(Object.entries(work.read || {})
            .filter(([, read]) => read).map(([id]) => String(id)));
        if (work.lastChapter?.id != null) chapters.add(String(work.lastChapter.id));
        const visitedAt = Number(work.lastReadAt || work.updatedAt) || 0;
        for (const chapterId of chapters) {
            const entry = known.get(chapterId);
            data.history.push({
                id: historyId(item, chapterId),
                item: historyItem(item),
                chapterId,
                chapterName: String(work.lastChapter?.id) === chapterId ?
                    work.lastChapter.name || entry?.name || 'Capítulo ' + (entry?.number ?? chapterId) :
                    entry?.name || 'Capítulo ' + (entry?.number ?? chapterId),
                page: String(work.lastChapter?.id) === chapterId ?
                    pageNumber(work.lastChapter.page) : 0,
                visitedAt
            });
        }
    }
    data.history = readingHistory(data);
    return true;
}

export function recordChapterVisit(data, item, chapter, page = 0, visitedAt = Date.now()) {
    data.history ||= [];
    const id = historyId(item, chapter.id);
    const entry = {
        id,
        item: historyItem(item),
        chapterId: String(chapter.id),
        chapterName: chapter.name || 'Capítulo ' + (chapter.number ?? chapter.id),
        page: pageNumber(page),
        visitedAt
    };
    data.history = data.history.filter(previous => previous.id !== id);
    data.history.unshift(entry);
    return entry;
}

export function updateHistoryPage(data, item, chapterId, page) {
    const entry = data.history?.find(value => value.id === historyId(item, chapterId));
    if (!entry) return false;
    entry.page = pageNumber(page);
    return true;
}

export function removeHistoryEntry(data, id) {
    if (!Array.isArray(data.history)) return false;
    const index = data.history.findIndex(entry => entry.id === id);
    if (index < 0) return false;
    data.history.splice(index, 1);
    return true;
}
