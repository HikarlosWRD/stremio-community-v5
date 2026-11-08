'use strict';
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { createInterface } = require('node:readline');
const { setMaxListeners } = require('node:events');
const { normalize, rankResults, isAdultSource } = require('./search-rules');

const [token] = process.argv.slice(2);
const port = 11680;
const host = '127.0.0.1:' + port;
const prefix = '/' + token + '/';
if (!/^[a-f0-9]{32}$/.test(token || '')) throw new Error('Invalid reader session');
const dataDir = path.resolve(__dirname, '../portable_config/manga');
fs.mkdirSync(dataDir, { recursive: true });
const selectionFile = path.join(dataDir, 'sources.json');
const diagnostics = path.join(dataDir, 'reader.log');
const java = path.join(__dirname, 'runtime', 'bin', 'java.exe');
const children = new Set();
const images = new Map();
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
if (fs.existsSync(diagnostics) && fs.statSync(diagnostics).size > 1024 * 1024)
    fs.renameSync(diagnostics, diagnostics + '.old');
function reportFailure(operation, error) {
    const message = String(error.message).replace(/[\r\n]+/g, ' ').slice(0, 500);
    fs.appendFile(diagnostics, new Date().toISOString() + ' ' + operation + ' ' + message + '\n', () => {});
}

function launch(args, pipe = false) {
    const log = fs.openSync(path.join(dataDir, 'engines.log'), 'a');
    const child = spawn(java, args, {
        cwd: dataDir, windowsHide: true, stdio: pipe ? ['pipe', 'pipe', log] : ['ignore', log, log]
    });
    fs.closeSync(log);
    children.add(child);
    child.once('error', () => children.delete(child));
    child.once('exit', () => children.delete(child));
    return child;
}

let worker;
let sequence = 0;
function kotatsu(op, args = {}, signal) {
    if (!worker) {
        const child = launch(['-Xmx384m', '-Dfile.encoding=UTF-8', '-cp',
            path.join(__dirname, 'kotatsu', 'lib', '*'), 'reader.kotatsu.MainKt'], true);
        const pending = new Map();
        const stop = () => {
            for (const finish of pending.values()) finish({ error: 'Motor Kotatsu indisponível.' });
            if (worker?.child === child) worker = undefined;
        };
        child.once('exit', stop);
        child.once('error', stop);
        child.stdin.on('error', stop);
        createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', line => {
            let reply;
            try { reply = JSON.parse(line); } catch { return; }
            pending.get(reply.request)?.(reply);
        });
        worker = { child, pending };
    }
    const { child, pending } = worker;
    return new Promise((resolve, reject) => {
        const request = String(++sequence);
        const timer = setTimeout(() => finish({ error: 'A fonte Kotatsu demorou para responder.' }), 29000);
        function finish(reply) {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            pending.delete(request);
            if (reply.error) reject(new Error(reply.error));
            else resolve(reply.data);
        }
        const abort = () => finish({ error: 'Consulta cancelada.' });
        if (signal?.aborted) { abort(); return; }
        signal?.addEventListener('abort', abort, { once: true });
        pending.set(request, finish);
        child.stdin.write(JSON.stringify({ request, op, ...args }) + '\n');
    });
}

function freePort() {
    return new Promise((resolve, reject) => {
        const socket = net.createServer();
        socket.once('error', reject);
        socket.listen(0, '127.0.0.1', () => {
            const n = socket.address().port;
            socket.close(() => resolve(n));
        });
    });
}
let mihonStartup;
async function startMihon() {
    const number = await freePort();
    const password = randomUUID();
    const origin = 'http://127.0.0.1:' + number;
    const auth = 'Basic ' + Buffer.from('reader:' + password).toString('base64');
    const opt = '-Dsuwayomi.tachidesk.config.server.';
    const child = launch(['-Xmx768m', opt + 'rootDir=' + path.join(dataDir, 'mihon'), opt + 'ip=127.0.0.1',
        opt + 'port=' + number, opt + 'authMode=BASIC_AUTH', opt + 'authUsername=reader',
        opt + 'authPassword=' + password, opt + 'webUIEnabled=false',
        opt + 'initialOpenInBrowserEnabled=false', opt + 'systemTrayEnabled=false',
        '-jar', path.join(__dirname, 'suwayomi.jar')]);
    let dead = false;
    child.once('error', () => { dead = true; });
    child.once('exit', () => { dead = true; mihonStartup = undefined; });
    for (let n = 0; n < 110 && !dead; n++) {
        try {
            await graph({ origin, auth }, '{ __typename }', {}, 1400);
            return { origin, auth };
        } catch {
            await new Promise(resolve => setTimeout(resolve, 250));
        }
    }
    if (!dead) child.kill();
    throw new Error('Motor Mihon não iniciou. Consulte engines.log.');
}
async function graph(connection, query, variables = {}, timeout = 28000, signal) {
    const r = await fetch(connection.origin + '/api/graphql', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: connection.auth },
        body: JSON.stringify({ query, variables }), signal: signal ?? AbortSignal.timeout(timeout)
    });
    if (!r.ok) throw new Error('Motor Mihon retornou HTTP ' + r.status + '.');
    const data = await r.json();
    if (data.errors?.length) throw new Error(data.errors[0].message);
    return data.data;
}
function mihon(query, variables, timeout, signal) {
    mihonStartup ??= startMihon().catch(error => { mihonStartup = undefined; throw error; });
    return mihonStartup.then(connection => graph(connection, query, variables, timeout, signal));
}

let selected = [];
let installedKotatsu = [];
if (fs.existsSync(selectionFile)) {
    try {
        const saved = JSON.parse(fs.readFileSync(selectionFile, 'utf8'));
        selected = Array.isArray(saved) ? saved : (saved.enabled || []);
        installedKotatsu = Array.isArray(saved) ? saved.filter(key => key.startsWith('kotatsu:')) : (saved.kotatsu || []);
    } catch { /* start with no sources */ }
}
function saveSources(enabled, kotatsuSources) {
    const temp = selectionFile + '.new';
    fs.writeFileSync(temp, JSON.stringify({ enabled: [...enabled], kotatsu: [...kotatsuSources] }));
    fs.renameSync(temp, selectionFile);
    selected = [...enabled];
    installedKotatsu = [...kotatsuSources];
}
function media(engine, value, op = 'image') {
    const id = randomUUID();
    images.set(id, { engine, value, op });
    if (images.size > 5000) images.delete(images.keys().next().value);
    return 'image/' + id;
}
function sourceKey(row) { return row.engine + ':' + row.id; }
let kotatsuSources;
let mihonSources;
function rawSources(engine) {
    if (engine === 'kotatsu') {
        kotatsuSources ??= kotatsu('sources').catch(error => { kotatsuSources = undefined; throw error; });
        return kotatsuSources;
    }
    mihonSources ??= mihon('{ sources { nodes { id displayName name lang extension { isInstalled pkgName contentWarning } } } }')
        .then(d => d.sources.nodes.filter(s => s.extension?.isInstalled).map(s => ({
            id: s.id, name: s.name || s.displayName, lang: s.lang,
            packageId: s.extension.pkgName, warning: s.extension.contentWarning
        }))).catch(error => { mihonSources = undefined; throw error; });
    return mihonSources;
}
async function listSources(engines = ['kotatsu', 'mihon']) {
    const settled = await Promise.allSettled(engines.map(rawSources));
    const enabled = new Set(selected);
    const installed = new Set(installedKotatsu);
    return {
        sources: settled.flatMap((r, i) => r.status === 'fulfilled'
            ? r.value.map(x => {
                const engine = engines[i];
                const key = engine + ':' + x.id;
                return { ...x, engine, enabled: enabled.has(key), installed: engine === 'mihon' || installed.has(key) };
            })
            : []),
        unavailable: settled.filter(r => r.status === 'rejected').length
    };
}
async function searchSource(source, query, position = 0, signal) {
    let rows;
    let next;
    if (source.engine === 'kotatsu') {
        rows = await kotatsu('search', { source: source.id, query, offset: position, fast: Boolean(signal) }, signal);
        next = rows.length ? position + rows.length : null;
    } else {
        const d = await mihon(
            'mutation($s:LongString!,$q:String,$p:Int!,$t:FetchSourceMangaType!){fetchSourceManga(input:{source:$s,type:$t,page:$p,query:$q}){hasNextPage mangas{id title thumbnailUrl}}}',
            { s: source.id, q: query || null, p: position + 1, t: query ? 'SEARCH' : 'POPULAR' }, 25000, signal);
        const { mangas, hasNextPage } = d.fetchSourceManga;
        rows = mangas;
        next = hasNextPage ? position + 1 : null;
    }
    const matching = query ? rankResults(rows, query) : rows;
    return {
        next,
        rows: matching.map(x => ({
            id: String(x.id), title: x.title, relevance: x.relevance, source,
            cover: x.hasCover ? media('kotatsu', x.id, 'cover') :
                x.thumbnailUrl ? media('mihon', x.thumbnailUrl) : null
        }))
    };
}
async function search(query, emit, signal) {
    const engines = ['kotatsu', 'mihon'].filter(engine => selected.some(key => key.startsWith(engine + ':')));
    const catalog = await listSources(engines);
    const sources = catalog.sources.filter(s => s.enabled && !isAdultSource(s));
    sources.sort((a, b) => (sourceHealth.get(sourceKey(b)) ?? 0) - (sourceHealth.get(sourceKey(a)) ?? 0));
    emit({ type: 'start', total: sources.length, unavailable: catalog.unavailable });
    let index = 0;
    let failed = 0;
    async function run() {
        while (index < sources.length && !signal.aborted) {
            const source = sources[index++];
            const key = sourceKey(source);
            const limit = new AbortController();
            const abort = () => limit.abort();
            signal.addEventListener('abort', abort, { once: true });
            const timer = setTimeout(abort, 11000);
            let rows = [];
            try {
                ({ rows } = await searchSource(source, query, 0, limit.signal));
                sourceHealth.set(key, rows.length ? 2 : 1);
            } catch (error) {
                if (signal.aborted) return;
                sourceHealth.set(key, -1);
                failed++;
                reportFailure('search ' + key, error);
            } finally {
                clearTimeout(timer);
                signal.removeEventListener('abort', abort);
            }
            if (!signal.aborted) emit({ type: 'source', source, rows, failed });
        }
    }
    await Promise.all(Array.from({ length: Math.min(16, sources.length) }, run));
    emit({ type: 'done' });
}
const sourceHealth = new Map();

function validateQuery(query, allowEmpty = false) {
    if (typeof query !== 'string' || query.length > 150 || (!allowEmpty && !normalize(query)))
        throw new Error('Digite um título válido.');
    return query.trim();
}
function idNumber(id) {
    if (typeof id !== 'string' || !/^\d{1,10}$/.test(id) || Number(id) > 2147483647)
        throw new Error('Item inválido.');
    return Number(id);
}
async function command(body) {
    switch (body.op) {
        case 'sources': return listSources();
        case 'enable':
        case 'installKotatsu': {
            const installing = body.op === 'installKotatsu';
            const keys = body.keys ?? [body.key];
            const enabled = installing || body.enabled;
            if (!Array.isArray(keys) || keys.length > 5000 || typeof enabled !== 'boolean' ||
                keys.some(key => typeof key !== 'string' || !/^(kotatsu|mihon):[\w-]+$/.test(key)))
                throw new Error('Seleção inválida.');
            const engines = [...new Set(keys.map(key => key.split(':')[0]))];
            const c = await listSources(engines);
            const valid = new Set(c.sources.filter(s => installing ? s.engine === 'kotatsu' : s.installed).map(sourceKey));
            if (keys.some(key => !valid.has(key))) throw new Error('Fonte indisponível.');
            const nextEnabled = new Set(selected);
            const nextInstalled = new Set(installedKotatsu);
            for (const key of keys) {
                if (installing) nextInstalled.add(key);
                if (enabled) nextEnabled.add(key); else nextEnabled.delete(key);
            }
            saveSources(nextEnabled, nextInstalled);
            return true;
        }
        case 'catalog': {
            if (!['kotatsu', 'mihon'].includes(body.engine) || !Number.isInteger(body.position) ||
                body.position < 0 || body.position > 100000) throw new Error('Catálogo indisponível.');
            const c = await listSources([body.engine]);
            const source = c.sources.find(s => s.id === body.id && s.installed);
            if (!source) throw new Error('Fonte indisponível.');
            return searchSource(source, validateQuery(body.query ?? '', true), body.position);
        }
        case 'repo': {
            const u = new URL(body.url);
            if (u.protocol !== 'https:' || u.username || u.password) throw new Error('Use um repositório HTTPS.');
            return mihon('mutation($u:String!){addExtensionStore(input:{indexUrl:$u}){extensionStore{name indexUrl}}}', { u: u.href }, 55000);
        }
        case 'extensions': {
            if (body.refresh) await mihon('mutation { fetchExtensions(input:{}) { clientMutationId } }', {}, 55000);
            const r = await mihon('{ extensions { nodes { pkgName name lang isInstalled isObsolete contentWarning } } }');
            return r.extensions.nodes.filter(e => !e.isObsolete);
        }
        case 'install': {
            if (typeof body.id !== 'string' || !/^[a-zA-Z0-9_.-]{1,240}$/.test(body.id)) throw new Error('Extensão inválida.');
            const r = await mihon(
                'mutation($id:String!){updateExtension(input:{id:$id,patch:{install:true}}){extension{pkgName isInstalled}}}',
                { id: body.id }, 60000);
            if (!r.updateExtension?.extension?.isInstalled) throw new Error('A extensão não ficou instalada.');
            mihonSources = undefined;
            return true;
        }
        case 'chapters':
            if (body.engine === 'kotatsu') return kotatsu('chapters', { id: body.id });
            if (body.engine !== 'mihon') throw new Error('Motor inválido.');
            return mihon(
                'mutation($id:Int!){fetchMangaAndChapters(input:{id:$id,fetchManga:true,fetchChapters:true}){chapters{id name sourceOrder}}}',
                { id: idNumber(body.id) }).then(d => d.fetchMangaAndChapters.chapters
                    .sort((a, b) => b.sourceOrder - a.sourceOrder)
                    .map(c => ({ id: String(c.id), name: c.name })));
        case 'pages':
            if (body.engine === 'kotatsu') return (await kotatsu('pages', { id: body.id })).map(p => media('kotatsu', p));
            if (body.engine !== 'mihon') throw new Error('Motor inválido.');
            return mihon('mutation($id:Int!){fetchChapterPages(input:{chapterId:$id}){pages}}',
                { id: idNumber(body.id) }).then(d => d.fetchChapterPages.pages.map(p => media('mihon', p)));
        default: throw new Error('Operação inválida.');
    }
}
async function readImage(entry) {
    if (!entry) throw new Error('Imagem expirou.');
    if (entry.engine === 'kotatsu') {
        const { type, bytes } = await kotatsu(entry.op, { id: entry.value });
        if (!imageTypes.has(type)) throw new Error('Formato indisponível.');
        return { type, bytes: Buffer.from(bytes, 'base64') };
    }
    const connection = await mihonStartup;
    const uri = new URL(entry.value, connection.origin);
    if (uri.origin !== connection.origin || !uri.pathname.startsWith('/api/')) throw new Error('Rota de imagem inválida.');
    const r = await fetch(uri, { headers: { authorization: connection.auth }, redirect: 'error', signal: AbortSignal.timeout(23000) });
    const type = r.headers.get('content-type')?.split(';')[0];
    if (!r.ok || !imageTypes.has(type)) throw new Error('Imagem indisponível.');
    const chunks = [];
    let size = 0;
    for await (const chunk of r.body) {
        size += chunk.length;
        if (size > 16 * 1024 * 1024) throw new Error('Imagem excede 16 MiB.');
        chunks.push(chunk);
    }
    return { type, bytes: Buffer.concat(chunks, size) };
}

const files = new Map([
    ['', ['ui/index.html', 'text/html; charset=utf-8']],
    ['app.js', ['ui/app.js', 'text/javascript; charset=utf-8']],
    ['style.css', ['ui/style.css', 'text/css; charset=utf-8']],
    ['upscale.js', ['ui/upscale.js', 'text/javascript; charset=utf-8']],
    ['anime4k.glsl', ['../portable_config/shaders/Anime4K_Upscale_CNN_x2_S.glsl', 'text/plain; charset=utf-8']],
]);
http.createServer(async (req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    try {
        if (req.headers.host !== host || !req.url.startsWith(prefix)) { res.writeHead(404).end(); return; }
        const route = req.url.slice(prefix.length);
        if (route === 'health' && (req.method === 'HEAD' || req.method === 'GET')) { res.writeHead(204).end(); return; }
        if (route === 'api' && req.method === 'POST') {
            if (req.headers.origin !== 'http://' + host || req.headers['x-reader-request'] !== '1') {
                res.writeHead(403).end(); return;
            }
            let raw = '';
            for await (const chunk of req) {
                raw += chunk;
            if (raw.length > 200000) { res.writeHead(413).end(); return; }
            }
            const body = JSON.parse(raw);
            if (body.op === 'search') {
                const query = validateQuery(body.query);
                const client = new AbortController();
                setMaxListeners(0, client.signal);
                res.once('close', () => client.abort());
                res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' });
                res.flushHeaders();
                const emit = event => {
                    if (!client.signal.aborted) res.write(JSON.stringify(event) + '\n');
                };
                try { await search(query, emit, client.signal); }
                catch (error) {
                    reportFailure('search', error);
                    emit({ type: 'unavailable' });
                }
                res.end();
            } else {
                const data = await command(body);
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(data));
            }
        } else if (req.method === 'GET' && route.startsWith('image/')) {
            const { type, bytes } = await readImage(images.get(route.slice(6)));
            res.writeHead(200, { 'Content-Type': type }).end(bytes);
        } else if (req.method === 'GET' && files.has(route)) {
            const [filename, type] = files.get(route);
            const data = fs.readFileSync(path.join(__dirname, filename));
            res.writeHead(200, { 'Content-Type': type }).end(data);
        } else {
            res.writeHead(404).end();
        }
    } catch (error) {
        reportFailure('request', error);
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
            .end(JSON.stringify({ error: error.message }));
    }
}).listen(port, '127.0.0.1');

process.on('exit', () => { for (const child of children) child.kill(); });
