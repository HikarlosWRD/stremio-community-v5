function fold(text) {
    return text.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '').trim();
}

export function findChapters(entries, input) {
    const query = fold(input);
    const numeric = query.match(/^(?:(?:capitulo|chapter|ch|ep|episodio|episode)\.?\s*|#\s*)?(\d+(?:[.,]\d+)?)$/);
    const wanted = numeric && Number(numeric[1].replace(',', '.'));
    return entries.flatMap((entry, index) => {
        const title = fold(entry.name);
        if (numeric) {
            const numbers = title.match(/\d+(?:[.,]\d+)?/g) || [];
            const named = numbers.some(number => Number(number.replace(',', '.')) === wanted);
            const matches = wanted === entry.number || (entry.number == null && named) ||
                (entry.number <= 0 && named);
            return matches ? [{ entry, index }] : [];
        }
        return title.includes(query) ? [{ entry, index }] : [];
    });
}
