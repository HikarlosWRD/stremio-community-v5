'use strict';
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { createInterface } = require('node:readline');

const [token] = process.argv.slice(2);
const port = 11680;
const host = '127.0.0.1:' + port;
const prefix = '/' + token + '/';
if (!/^[a-f0-9]{32}$/.test(token || '')) throw new Error('Invalid reader session');
const dataDir = path.resolve(__dirname, '../portable_config/manga');
fs.mkdirSync(dataDir, { recursive: true });
const selectionFile = path.join(dataDir, 'sources.json');
const java = path.join(__dirname, 'runtime', 'bin', 'java.exe');
const children = new Set();
const images = new Map();
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

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
function kotatsu(op, args = {}) {
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
            pending.delete(request);
            if (reply.error) reject(new Error(reply.error));
            else resolve(reply.data);
        }
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
async function graph(connection, query, variables = {}, timeout = 28000) {
    const r = await fetch(connection.origin + '/api/graphql', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: connection.auth },
        body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(timeout)
    });
    if (!r.ok) throw new Error('Motor Mihon retornou HTTP ' + r.status + '.');
    const data = await r.json();
    if (data.errors?.length) throw new Error(data.errors[0].message);
    return data.data;
}
function mihon(query, variables, timeout) {
    mihonStartup ??= startMihon().catch(error => { mihonStartup = undefined; throw error; });
    return mihonStartup.then(connection => graph(connection, query, variables, timeout));
}

let selected = [];
if (fs.existsSync(selectionFile)) {
    try { selected = JSON.parse(fs.readFileSync(selectionFile, 'utf8')); } catch { /* start with no sources */ }
    if (!Array.isArray(selected)) selected = [];
}
function media(engine, value, op = 'image') {
    const id = randomUUID();
    images.set(id, { engine, value, op });
    if (images.size > 5000) images.delete(images.keys().next().value);
    return 'image/' + id;
}
function sourceKey(row) { return row.engine + ':' + row.id; }
async function listSources() {
    const settled = await Promise.allSettled([
        kotatsu('sources'),
        mihon('{ sources { nodes { id displayName name lang extension { isInstalled } } } }')
            .then(d => d.sources.nodes.filter(s => s.extension?.isInstalled)
                .map(s => ({ id: s.id, name: s.name || s.displayName, lang: s.lang })))
    ]);
    const engines = ['kotatsu', 'mihon'];
    return {
        sources: settled.flatMap((r, i) => r.status === 'fulfilled'
            ? r.value.map(x => ({ ...x, engine: engines[i], enabled: selected.includes(engines[i] + ':' + x.id) }))
            : []),
        errors: settled.flatMap((r, i) => r.status === 'rejected' ? [engines[i] + ': ' + r.reason.message] : [])
    };
}
async function searchSource(source, query) {
    if (source.engine === 'kotatsu') {
        const rows = await kotatsu('search', { source: source.id, query });
        return rows.map(x => ({ ...x, cover: x.hasCover ? media('kotatsu', x.id, 'cover') : null }));
    }
    const d = await mihon(
        'mutation($s:LongString!,$q:String!){fetchSourceManga(input:{source:$s,type:SEARCH,page:1,query:$q}){mangas{id title thumbnailUrl}}}',
        { s: source.id, q: query });
    return d.fetchSourceManga.mangas.slice(0, 30)
        .map(x => ({ id: String(x.id), title: x.title, cover: x.thumbnailUrl ? media('mihon', x.thumbnailUrl) : null }));
}
async function search(query) {
    if (typeof query !== 'string' || !query.trim() || query.length > 150) throw new Error('Digite um título válido.');
    const catalog = await listSources();
    const sources = catalog.sources.filter(s => s.enabled);
    if (!sources.length) return { rows: [], errors: catalog.errors, searched: 0 };
    const bySource = new Array(sources.length);
    const errors = [...catalog.errors];
    let index = 0;
    async function run() {
        while (index < sources.length) {
            const i = index++;
            const source = sources[i];
            try { bySource[i] = await searchSource(source, query.trim()); }
            catch (error) { errors.push(source.name + ': ' + error.message); }
        }
    }
    await Promise.all(Array.from({ length: Math.min(6, sources.length) }, run));
    const rows = [];
    for (let rank = 0; rank < 30; rank++) {
        for (let i = 0; i < sources.length; i++) {
            const item = bySource[i]?.[rank];
            if (item) rows.push({ ...item, source: sources[i] });
        }
    }
    return { rows, errors, searched: sources.length };
}

function idNumber(id) {
    if (typeof id !== 'string' || !/^\d{1,10}$/.test(id) || Number(id) > 2147483647)
        throw new Error('Item inválido.');
    return Number(id);
}
async function command(body) {
    switch (body.op) {
        case 'sources': return listSources();
        case 'enable': {
            if (typeof body.enabled !== 'boolean') throw new Error('Seleção inválida.');
            const c = await listSources();
            const source = c.sources.find(s => sourceKey(s) === body.key);
            if (!source) throw new Error('Fonte indisponível.');
            const next = new Set(selected);
            if (body.enabled) next.add(body.key); else next.delete(body.key);
            const temp = selectionFile + '.new';
            fs.writeFileSync(temp, JSON.stringify([...next]));
            fs.renameSync(temp, selectionFile);
            selected = [...next];
            return true;
        }
        case 'search': return search(body.query);
        case 'repo': {
            const u = new URL(body.url);
            if (u.protocol !== 'https:' || u.username || u.password) throw new Error('Use um repositório HTTPS.');
            return mihon('mutation($u:String!){addExtensionStore(input:{indexUrl:$u}){extensionStore{name indexUrl}}}', { u: u.href }, 55000);
        }
        case 'extensions': {
            await mihon('mutation { fetchExtensions(input:{}) { clientMutationId } }', {}, 55000);
            const r = await mihon('{ extensions { nodes { pkgName name lang isInstalled isObsolete } } }');
            return r.extensions.nodes.filter(e => !e.isObsolete);
        }
        case 'install': {
            if (typeof body.id !== 'string' || !/^[a-zA-Z0-9_.-]{1,240}$/.test(body.id)) throw new Error('Extensão inválida.');
            const r = await mihon(
                'mutation($id:String!){updateExtension(input:{id:$id,patch:{install:true}}){extension{pkgName isInstalled}}}',
                { id: body.id }, 60000);
            if (!r.updateExtension?.extension?.isInstalled) throw new Error('A extensão não ficou instalada.');
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
                if (raw.length > 10000) { res.writeHead(413).end(); return; }
            }
            const data = await command(JSON.parse(raw));
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(data));
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
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
            .end(JSON.stringify({ error: error.message }));
    }
}).listen(port, '127.0.0.1');

process.on('exit', () => { for (const child of children) child.kill(); });
