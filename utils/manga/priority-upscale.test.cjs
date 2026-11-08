'use strict';
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const base = join(__dirname, 'reader');
test('native queue limits GPU work to two and removes canceled waiting jobs', async () => {
    const source = readFileSync(join(base, 'native-upscale.js'), 'utf8');
    const code = source.slice(source.indexOf('let parallelJobs'), source.indexOf('function validateImage'));
    let running = 0, peak = 0;
    const started = [], finish = new Map();
    const context = { Promise, processImage: (input, _model, signal) => new Promise((resolve, reject) => {
        started.push(input.id);
        peak = Math.max(peak, ++running);
        const done = () => { signal.removeEventListener('abort', aborted); running--; resolve(input.id); };
        const aborted = () => { signal.removeEventListener('abort', aborted); running--; reject(signal.reason); };
        signal.addEventListener('abort', aborted, { once: true });
        finish.set(input.id, done);
    }) };
    vm.runInNewContext(code + '\nthis.schedule = scheduleNative; this.configure = configureNativeConcurrency;', context);
    const controllers = Array.from({ length: 4 }, () => new AbortController());
    const jobs = controllers.map((controller, i) =>
        context.schedule({ id: i }, 'realcugan', controller.signal)
            .then(value => ({ value }), error => ({ error })));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(started, [0, 1]);
    assert.equal(peak, 2);
    controllers[2].abort(new Error('skipped'));
    assert.match((await jobs[2]).error.message, /skipped/);
    finish.get(0)();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(started, [0, 1, 3]);
    assert.equal(peak, 2);
    controllers[1].abort(new Error('no longer visible'));
    assert.match((await jobs[1]).error.message, /no longer visible/);
    finish.get(3)();
    assert.equal((await jobs[0]).value, 0);
    assert.equal((await jobs[3]).value, 3);
    assert.equal(running, 0);
});

test('reader preempts old or prefetched upscale when focus changes', () => {
    const source = readFileSync(join(base, 'ui/app.js'), 'utf8');
    const start = source.indexOf('function shouldPreemptUpscale');
    const code = source.slice(start, source.indexOf('async function reader', start));
    const context = {};
    vm.runInNewContext(code + '\nthis.shouldPreempt = shouldPreemptUpscale;', context);
    const previous = { original: 'old', ready: true };
    const focused = { original: 'new', ready: true };
    const prefetched = { original: 'prefetch', ready: true };
    const cache = new Map();
    const job = new AbortController();
    job.figure = previous;
    assert.equal(context.shouldPreempt(job, focused, [focused, prefetched],
        'realcugan', 0), true);
    job.figure = prefetched;
    assert.equal(context.shouldPreempt(job, focused, [focused, prefetched],
        'realcugan', 0), true);
    focused.displayed = 'new:realcugan';
    assert.equal(context.shouldPreempt(job, focused, [focused, prefetched],
        'realcugan', 0), false);
    focused.displayed = undefined;
    cache.set('new:realcugan', {});
    assert.equal(context.shouldPreempt(job, focused, [focused, prefetched],
        'realcugan', 0), true);
    cache.clear();
    job.figure = focused;
    assert.equal(context.shouldPreempt(job, focused, [focused, prefetched],
        'realcugan', 0), false);
    job.abort();
    assert.equal(context.shouldPreempt(job, focused, [focused, prefetched],
        'realcugan', 0), false);
});
test('server raises and lowers live Vulkan concurrency without losing queued jobs', async () => {
    const source = readFileSync(join(base, 'native-upscale.js'), 'utf8');
    const code = source.slice(source.indexOf('let parallelJobs'), source.indexOf('function validateImage'));
    let active = 0, peak = 0;
    const started = [], complete = new Map();
    const context = { Promise, processImage: input => new Promise(resolve => {
        active++;
        peak = Math.max(peak, active);
        started.push(input.id);
        complete.set(input.id, () => { active--; resolve(input.id); });
    }) };
    vm.runInNewContext(code +
        '\nthis.schedule = scheduleNative; this.configure = configureNativeConcurrency;', context);
    const controllers = Array.from({ length: 5 }, () => new AbortController());
    const jobs = controllers.map((ctl, i) => context.schedule({ id: i }, 'realcugan', ctl.signal));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(started, [0, 1]);
    context.configure(4);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(started, [0, 1, 2, 3]);
    assert.equal(peak, 4);
    context.configure(1);
    complete.get(0)();
    complete.get(1)();
    complete.get(2)();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(started, [0, 1, 2, 3]);
    complete.get(3)();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(started, [0, 1, 2, 3, 4]);
    complete.get(4)();
    assert.deepEqual(await Promise.all(jobs), [0, 1, 2, 3, 4]);
    assert.equal(active, 0);
    assert.throws(() => context.configure(0));
    assert.throws(() => context.configure(9));
});
