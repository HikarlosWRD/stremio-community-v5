import test from 'node:test';
import assert from 'node:assert/strict';
import { createPageUpscaleQueue, nativeGpuSlots } from './reader/ui/page-upscale-queue.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));

function harness(capacity = 2) {
    let waiting = [0, 1, 2, 3, 4, 5];
    const completed = new Set();
    const requests = new Map();
    const started = [];
    let running = 0;
    let peak = 0;
    let finished = 0;
    const queue = createPageUpscaleQueue({
        capacity,
        next: active => waiting.find(page => !active.has(page) && !completed.has(page)),
        run: (page, job) => new Promise((resolve, reject) => {
            started.push(page);
            running++;
            peak = Math.max(peak, running);
            const abort = () => {
                requests.delete(page);
                running--;
                reject(job.signal.reason);
            };
            job.signal.addEventListener('abort', abort, { once: true });
            requests.set(page, () => {
                job.signal.removeEventListener('abort', abort);
                requests.delete(page);
                completed.add(page);
                running--;
                resolve();
            });
        }),
        onFinish: () => finished++
    });
    return {
        queue, started, completed, requests,
        get running() { return running; },
        get peak() { return peak; },
        get finished() { return finished; },
        setWaiting: next => { waiting = next; },
        finish: page => {
            assert.ok(requests.has(page), 'Page ' + page + ' is not active');
            requests.get(page)();
        }
    };
}

test('page selector and tile selector share at most eight Vulkan processes', () => {
    assert.equal(nativeGpuSlots(1, 1), 1);
    assert.equal(nativeGpuSlots(1, 4), 4);
    assert.equal(nativeGpuSlots(2, 2), 4);
    assert.equal(nativeGpuSlots(8, 4), 8);
    assert.equal(nativeGpuSlots(8, 1), 8);
    assert.equal(nativeGpuSlots(5, 2), 8);
});

test('two manga pages run simultaneously; next page begins when either finishes', async () => {
    const h = harness();
    h.queue.pump();
    await tick();
    assert.deepEqual(h.started, [0, 1]);
    assert.equal(h.running, 2);
    h.finish(1);
    await tick();
    assert.deepEqual(h.started, [0, 1, 2]);
    assert.equal(h.peak, 2);
    h.queue.close();
    await tick();
});

test('raising page count adds in-flight pages; lowering does not restart or cancel', async () => {
    const h = harness(1);
    h.queue.pump();
    await tick();
    assert.deepEqual(h.started, [0]);
    h.queue.setLimit(4);
    await tick();
    assert.deepEqual(h.started, [0, 1, 2, 3]);
    assert.equal(h.peak, 4);
    h.queue.setLimit(1);
    h.finish(0);
    h.finish(1);
    h.finish(2);
    await tick();
    assert.deepEqual(h.started, [0, 1, 2, 3]);
    h.finish(3);
    await tick();
    assert.deepEqual(h.started, [0, 1, 2, 3, 4]);
    h.queue.close();
    await tick();
});

test('jumping forward cancels stale manga pages and prioritizes the new visible page', async () => {
    const h = harness(2);
    h.queue.pump();
    await tick();
    assert.deepEqual(h.started, [0, 1]);
    h.setWaiting([20, 21, 22]);
    h.queue.cancelWhere(page => page < 20);
    await tick();
    assert.deepEqual(h.started, [0, 1, 20, 21]);
    assert.deepEqual([...h.queue.active.keys()], [20, 21]);
    h.queue.close();
    await tick();
});

test('closing the reader cancels every running page and blocks new starts', async () => {
    const h = harness(4);
    h.queue.pump();
    await tick();
    assert.equal(h.started.length, 4);
    h.queue.close();
    await tick();
    h.queue.pump();
    await tick();
    assert.equal(h.started.length, 4);
    assert.equal(h.running, 0);
    assert.equal(h.finished, 4);
    assert.throws(() => h.queue.setLimit(0));
    assert.throws(() => h.queue.setLimit(5));
});
