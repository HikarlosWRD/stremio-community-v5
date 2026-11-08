'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const models = Object.freeze({
    realcugan: { scale: 2, args: ['-m', 'models-se', '-n', '1'] },
    realesrgan: { scale: 4, args: ['-m', 'models', '-n', 'realesrgan-x4plus-anime'] }
});
const maxInputBytes = 25 * 1024 * 1024;
const maxPixels = 24000000;
const pngSignature = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
let parallelJobs = 2;
const maximumParallelJobs = 8;
const pendingJobs = [];
let runningJobs = 0;
let queued = 0;

function dispatchJobs() {
    while (runningJobs < parallelJobs && pendingJobs.length) {
        const task = pendingJobs.shift();
        task.signal.removeEventListener('abort', task.cancel);
        if (task.signal.aborted) {
            task.reject(task.signal.reason);
            continue;
        }
        runningJobs++;
        Promise.resolve().then(() => processImage(task.png, task.modelName, task.signal))
            .then(task.resolve, task.reject)
            .finally(() => {
                runningJobs--;
                dispatchJobs();
            });
    }
}

function configureNativeConcurrency(value) {
    if (!Number.isInteger(value) || value < 1 || value > maximumParallelJobs)
        throw new Error('Quantidade de blocos simultâneos inválida.');
    parallelJobs = value;
    dispatchJobs();
    return { parallelJobs };
}

function scheduleNative(png, modelName, signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const task = { png, modelName, signal, resolve, reject };
        task.cancel = () => {
            const index = pendingJobs.indexOf(task);
            if (index < 0) return;
            pendingJobs.splice(index, 1);
            reject(signal.reason);
            dispatchJobs();
        };
        signal.addEventListener('abort', task.cancel, { once: true });
        pendingJobs.push(task);
        dispatchJobs();
    });
}

function validateImage(png, scale) {
    if (png.length < 24 || !png.subarray(0, 16).equals(pngSignature))
        throw new Error('Formato PNG inválido.');
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    if (!width || !height || width * scale > 16384 || height * scale > 16384 ||
        width * height * scale * scale > maxPixels)
        throw new Error('A página excede o limite de resolução deste modelo.');
    return { width, height };
}

async function readInput(req) {
    if (req.headers['content-type'] !== 'image/png') throw new Error('Formato PNG inválido.');
    const size = Number(req.headers['content-length']);
    if (!Number.isSafeInteger(size) || size < 24 || size > maxInputBytes)
        throw new Error('A página excede o limite de entrada.');
    const chunks = [];
    let received = 0;
    for await (const chunk of req) {
        received += chunk.length;
        if (received > size) throw new Error('Tamanho de entrada inválido.');
        chunks.push(chunk);
    }
    if (received !== size) throw new Error('Entrada incompleta.');
    return Buffer.concat(chunks, size);
}

function execute(executable, cwd, args, signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const child = spawn(executable, args, { cwd, windowsHide: true, stdio: 'ignore' });
        let timedOut = false;
        const abort = () => child.kill();
        const timer = setTimeout(() => { timedOut = true; abort(); }, 45000);
        signal.addEventListener('abort', abort, { once: true });
        child.once('error', reject);
        child.once('close', code => {
            clearTimeout(timer);
            signal.removeEventListener('abort', abort);
            if (signal.aborted) reject(signal.reason);
            else if (timedOut) reject(new Error('O modelo excedeu o tempo de processamento.'));
            else if (code !== 0) reject(new Error('O modelo Vulkan não conseguiu processar a página (código ' + code + ').'));
            else resolve();
        });
    });
}

async function processImage(png, modelName, signal) {
    signal.throwIfAborted();
    const model = models[modelName];
    const { width, height } = validateImage(png, model.scale);
    const cwd = path.join(__dirname, 'models', modelName);
    const executable = path.join(cwd, modelName + '-ncnn-vulkan.exe');
    try { await fs.access(executable); }
    catch { throw new Error('O pacote Vulkan deste modelo não está disponível.'); }
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'stremio-reader-sr-'));
    const input = path.join(temp, 'input.png');
    const output = path.join(temp, 'output.png');
    try {
        await fs.writeFile(input, png);
        await execute(executable, cwd, ['-i', input, '-o', output, '-s', String(model.scale),
            '-t', '256', '-j', '1:1:1', ...model.args], signal);
        if ((await fs.stat(output)).size > maxPixels * 4 + 1048576) throw new Error('Saída excede o limite.');
        const result = await fs.readFile(output);
        const dimensions = validateImage(result, 1);
        if (dimensions.width !== width * model.scale || dimensions.height !== height * model.scale)
            throw new Error('O modelo retornou uma resolução inesperada.');
        return result;
    } finally {
        await Promise.allSettled([fs.unlink(input), fs.unlink(output)]);
        await fs.rmdir(temp).catch(() => {});
    }
}

async function restore(req, modelName, signal) {
    if (!Object.hasOwn(models, modelName)) throw new Error('Modelo inválido.');
    if (queued >= maximumParallelJobs * 2) throw new Error('A fila de upscale está ocupada.');
    queued++;
    try {
        const png = await readInput(req);
        return await scheduleNative(png, modelName, signal);
    } finally {
        queued--;
    }
}

module.exports = { models, restore, validateImage, configureNativeConcurrency };
