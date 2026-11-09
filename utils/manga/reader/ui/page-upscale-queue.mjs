// Limit concurrent page jobs independently of the tiles processed inside each page.
// The Vulkan worker pool has a separate total limit to protect GPU memory.
export function nativeGpuSlots(blocks, pages) {
    const safeBlocks = Number.isInteger(blocks) ? Math.max(1, Math.min(8, blocks)) : 2;
    const safePages = Number.isInteger(pages) ? Math.max(1, Math.min(4, pages)) : 1;
    return Math.min(8, safeBlocks * safePages);
}

export function createPageUpscaleQueue({ next, run, capacity = 1, onFinish = () => {} }) {
    const active = new Map();
    let limit = capacity;
    let closed = false;

    function pump() {
        if (closed) return;
        while (active.size < limit) {
            const figure = next(active);
            if (figure == null || active.has(figure)) break;
            const job = new AbortController();
            active.set(figure, job);
            Promise.resolve().then(() => run(figure, job)).catch(() => {
                // Individual page failures are already reported by the reader.
            }).finally(() => {
                if (active.get(figure) === job) active.delete(figure);
                onFinish(figure);
                pump();
            });
        }
    }

    return {
        active,
        get limit() { return limit; },
        pump,
        setLimit(value) {
            if (!Number.isInteger(value) || value < 1 || value > 4)
                throw new Error('Quantidade de páginas simultâneas inválida.');
            limit = value;
            pump();
        },
        cancelWhere(predicate) {
            for (const [figure, job] of active) {
                if (!job.signal.aborted && predicate(figure, job)) job.abort();
            }
        },
        close() {
            closed = true;
            for (const job of active.values()) job.abort();
        }
    };
}
