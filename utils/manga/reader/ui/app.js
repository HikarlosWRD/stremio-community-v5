import { upscaleImage } from './upscale.js';

const view = document.querySelector('#view');
const labels = { kotatsu: 'Kotatsu', mihon: 'Mihon' };
let screen = 0;
let lastQuery = '';
let lastResults;
let dispose = () => {};

function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
}
function button(label, action, className) {
    const node = el('button', label, className);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
}
function field(type, placeholder) {
    const node = el('input');
    node.type = type;
    node.placeholder = placeholder;
    node.setAttribute('aria-label', placeholder);
    return node;
}
function begin() {
    dispose();
    dispose = () => {};
    view.replaceChildren();
    return ++screen;
}
async function api(op, values = {}) {
    const response = await fetch('api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-reader-request': '1' },
        body: JSON.stringify({ op, ...values })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'O leitor retornou um erro.');
    return body;
}
function sourceLabel(source) {
    return source.name + ' · ' + labels[source.engine] + ' · ' + source.lang;
}
function errorText(node, message) {
    node.textContent = message;
}
function workCard(item, back) {
    const card = button('', () => chapters(item, back), 'card');
    const cover = el(item.cover ? 'img' : 'div', '', 'placeholder');
    if (item.cover) {
        cover.src = item.cover;
        cover.alt = '';
        cover.loading = 'lazy';
        cover.onerror = () => cover.replaceWith(el('div', '', 'placeholder'));
    }
    card.append(cover, el('strong', item.title));
    return card;
}

async function streamSearch(query, signal, onEvent) {
    const response = await fetch('api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-reader-request': '1' },
        body: JSON.stringify({ op: 'search', query }), signal
    });
    if (!response.ok) throw new Error();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let complete = false;
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n')) !== -1) {
            const event = JSON.parse(buffer.slice(0, end));
            buffer = buffer.slice(end + 1);
            if (event.type === 'done') complete = true;
            onEvent(event);
        }
    }
    if (!complete) throw new Error();
}

function catalog() {
    const page = begin();
    const form = el('form');
    const input = field('search', 'Título do mangá, manhwa ou webtoon');
    input.required = true;
    input.maxLength = 150;
    input.value = lastQuery;
    const submit = el('button', 'Buscar', 'primary');
    submit.type = 'submit';
    const cancel = button('Parar busca', () => controller?.abort());
    cancel.hidden = true;
    form.append(input, submit, cancel);
    const status = el('p', 'A busca consulta as fontes ativadas.', 'muted');
    status.setAttribute('role', 'status');
    const groups = el('div');
    view.append(el('h1', 'Mangás, manhwas e webtoons'), form, status, groups);
    let controller;
    dispose = () => controller?.abort();

    function renderGroup(group) {
        const section = el('section', '', 'result-group');
        const heading = el('div', '', 'controls');
        heading.append(el('h2', sourceLabel(group.source)),
            button('Buscar nesta fonte', () => sourceCatalog(group.source, lastQuery, catalog)));
        const cards = el('div', '', 'grid');
        const more = button('Mostrar todos (' + group.rows.length + ')', () => {
            group.expanded = true;
            fill();
        });
        function fill() {
            const rows = group.expanded ? group.rows : group.rows.slice(0, 6);
            cards.replaceChildren(...rows.map(item => workCard(item, catalog)));
            more.hidden = group.expanded || rows.length === group.rows.length;
        }
        fill();
        section.append(heading, cards, more);
        const rank = group.rows[0].relevance;
        section.dataset.rank = String(rank);
        const before = Array.from(groups.children).find(child => Number(child.dataset.rank) < rank);
        groups.insertBefore(section, before || null);
    }

    function updateStatus(result, searching) {
        const count = result.groups.reduce((total, group) => total + group.rows.length, 0);
        const summary = count + ' título(s) em ' + result.groups.length + ' fonte(s).';
        if (searching) {
            status.textContent = result.total === null ? 'Preparando a busca…' :
                summary + ' Consultadas ' + result.completed + ' de ' + result.total + ' fontes.';
        } else if (result.unavailable) {
            status.textContent = (count ? summary + ' ' : '') + 'Parte das fontes está indisponível. Tente novamente.';
        } else if (!result.total) {
            status.textContent = 'Ative pelo menos uma fonte em Fontes para buscar.';
        } else {
            status.textContent = (count ? summary : 'Nenhum título correspondente nas fontes consultadas.') +
                (result.failed ? ' ' + result.failed + ' fonte(s) indisponível(is).' : '');
        }
    }

    if (lastResults) {
        lastResults.groups.forEach(renderGroup);
        updateStatus(lastResults, false);
    }
    form.onsubmit = async event => {
        event.preventDefault();
        const query = input.value.trim();
        if (!query) return;
        controller?.abort();
        const current = new AbortController();
        controller = current;
        cancel.hidden = false;
        lastQuery = query;
        const result = { groups: [], total: null, completed: 0, failed: 0, unavailable: 0 };
        lastResults = result;
        groups.replaceChildren();
        updateStatus(result, true);
        try {
            await streamSearch(query, current.signal, event => {
                if (controller !== current || page !== screen) return;
                if (event.type === 'start') {
                    result.total = event.total;
                    result.unavailable = event.unavailable;
                } else if (event.type === 'source') {
                    result.completed++;
                    result.failed = event.failed;
                    if (event.rows.length) {
                        result.groups.push(event);
                        renderGroup(event);
                    }
                }
                updateStatus(result, true);
            });
            if (controller === current && page === screen) updateStatus(result, false);
        } catch {
            if (controller === current && page === screen) {
                status.textContent = current.signal.aborted
                    ? 'Busca interrompida. Os resultados já encontrados continuam abaixo.'
                    : 'A busca foi interrompida. Tente novamente.';
            }
        } finally {
            if (controller === current) cancel.hidden = true;
        }
    };
}

function sourceCatalog(source, initialQuery = '', back = settings) {
    const page = begin();
    const form = el('form');
    const input = field('search', 'Buscar nesta fonte');
    input.value = initialQuery;
    input.maxLength = 150;
    const submit = el('button', 'Buscar', 'primary');
    submit.type = 'submit';
    form.append(input, submit);
    const status = el('p', '', 'muted');
    status.setAttribute('role', 'status');
    const cards = el('div', '', 'grid');
    const more = button('Carregar mais', load);
    more.hidden = true;
    view.append(button('← Voltar', back), el('h1', source.name),
        el('p', sourceLabel(source), 'muted'), form, status, cards, more);

    let query = initialQuery;
    let position = 0;
    let loading = false;
    const seen = new Set();
    const reopen = () => sourceCatalog(source, query, back);
    async function load() {
        if (loading || position === null) return;
        loading = true;
        submit.disabled = more.disabled = true;
        status.textContent = 'Carregando catálogo…';
        try {
            const data = await api('catalog', { engine: source.engine, id: source.id, query, position });
            if (page !== screen) return;
            let added = 0;
            for (const item of data.rows) {
                if (seen.has(item.id)) continue;
                seen.add(item.id);
                added++;
                cards.append(workCard(item, reopen));
            }
            position = data.rows.length && !added ? null : data.next;
            status.textContent = seen.size ? seen.size + ' título(s).' :
                (position === null ? 'Nenhum título encontrado.' : 'Nenhuma correspondência nesta página.');
        } catch {
            status.textContent = 'O catálogo desta fonte está indisponível. Tente novamente.';
        } finally {
            loading = submit.disabled = more.disabled = false;
            more.hidden = position === null;
        }
    }
    form.onsubmit = event => {
        event.preventDefault();
        query = input.value.trim();
        position = 0;
        seen.clear();
        cards.replaceChildren();
        load();
    };
    load();
}

const languageNames = new Intl.DisplayNames(['pt-BR'], { type: 'language' });
function languageCode(value) {
    const raw = (value || 'all').replace('_', '-').toLowerCase();
    return raw === 'pt-br' ? 'pt' : raw;
}
function languageLabel(value) {
    if (value === 'all') return 'Vários idiomas';
    try { return languageNames.of(value) || value; }
    catch { return value; }
}
function folded(value) {
    return value.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '');
}
const sourceFilters = {
    install: { name: '', language: '', excluded: '', engine: '', showAll: false },
    installed: { name: '', language: '', excluded: '', engine: '', showAll: false }
};
let sourcesTab = 'install';

async function settings() {
    const page = begin();
    const tabs = el('div', '', 'controls');
    const filters = el('div', '', 'source-filters');
    const repoPanel = el('section', '', 'panel');
    const repoForm = el('form');
    const repo = field('url', 'URL HTTPS do repositório Mihon');
    repo.required = true;
    const addRepo = el('button', 'Adicionar repositório');
    addRepo.type = 'submit';
    repoForm.append(repo, addRepo);
    const refreshButton = button('Atualizar extensões Mihon', () => load(true));
    repoPanel.append(el('h2', 'Repositórios Mihon'), repoForm, refreshButton);

    const name = field('search', 'Filtrar pelo nome');
    const excluded = field('search', 'Excluir palavras do nome, separadas por vírgula ou espaço');
    const language = el('select');
    language.setAttribute('aria-label', 'Idioma');
    const engine = el('select');
    engine.setAttribute('aria-label', 'Motor');
    function option(label, value) {
        const node = el('option', label);
        node.value = value;
        return node;
    }
    engine.append(option('Todos os motores', ''), option('Kotatsu', 'kotatsu'), option('Mihon', 'mihon'));
    filters.append(name, language, engine, excluded);

    const actions = el('div', '', 'controls');
    const status = el('p', 'Carregando fontes…', 'muted');
    status.setAttribute('role', 'status');
    const summary = el('p', '', 'muted');
    const list = el('div', '', 'list');
    const showAll = button('Mostrar todas', () => {
        sourceFilters[sourcesTab].showAll = !sourceFilters[sourcesTab].showAll;
        render();
    });
    const selectAll = button('Selecionar todas do filtro', () => {
        for (const row of matching) pending.add(sourceKey(row));
        render();
    });
    const clear = button('Limpar seleção', () => { pending.clear(); render(); });
    const apply = button('Instalar selecionadas', () => {
        const rows = candidates('install').filter(row => pending.has(sourceKey(row)));
        installRows(rows);
    }, 'primary');
    const activate = button('Ativar todas do filtro', () => changeEnabled(matching, true), 'primary');
    const deactivate = button('Desativar todas do filtro', () => changeEnabled(matching, false));
    actions.append(showAll, selectAll, clear, apply, activate, deactivate);
    const installTab = button('Instalar fontes', () => switchTab('install'));
    const installedTab = button('Gerenciar instaladas', () => switchTab('installed'));
    tabs.append(installTab, installedTab);
    view.append(el('h1', 'Fontes'), tabs, filters, actions, summary, status, repoPanel, list);

    let sources = [];
    let extensions = [];
    let matching = [];
    let busy = false;
    const pending = new Set();

    function sourceKey(row) { return row.engine + ':' + row.id; }
    function candidates(tab) {
        if (tab === 'installed') return sources.filter(source => source.installed);
        return sources.filter(source => !source.installed && source.engine === 'kotatsu').concat(extensions);
    }
    function switchTab(tab) {
        sourcesTab = tab;
        const filter = sourceFilters[tab];
        name.value = filter.name;
        excluded.value = filter.excluded;
        engine.value = filter.engine;
        render();
    }
    function render() {
        if (page !== screen) return;
        const managing = sourcesTab === 'installed';
        const filter = sourceFilters[sourcesTab];
        const available = candidates(sourcesTab);
        const languages = Array.from(new Set(available.map(row => languageCode(row.lang))));
        language.replaceChildren(option('Todos os idiomas', ''), ...languages
            .sort((a, b) => languageLabel(a).localeCompare(languageLabel(b), 'pt-BR'))
            .map(code => option(languageLabel(code), code)));
        if (filter.language && !languages.includes(filter.language))
            language.append(option(languageLabel(filter.language), filter.language));
        language.value = filter.language;
        installTab.setAttribute('aria-pressed', String(!managing));
        installedTab.setAttribute('aria-pressed', String(managing));
        repoPanel.hidden = managing;
        const query = folded(filter.name.trim());
        const exclusions = folded(filter.excluded).split(/[\s,;]+/).filter(Boolean);
        matching = available.filter(row => {
            const title = folded(row.name);
            return (!filter.engine || row.engine === filter.engine) &&
                (!filter.language || languageCode(row.lang) === filter.language) &&
                title.includes(query) && !exclusions.some(term => title.includes(term));
        }).sort((a, b) => (managing ? Number(b.enabled) - Number(a.enabled) : 0) ||
            a.name.localeCompare(b.name, 'pt-BR'));
        const displayed = filter.showAll ? matching : matching.slice(0, 80);
        summary.textContent = displayed.length + ' de ' + matching.length + ' fonte(s) do filtro' +
            (!managing && pending.size ? ' · ' + pending.size + ' selecionada(s)' : '') + '.';
        showAll.textContent = filter.showAll ? 'Mostrar menos' : 'Mostrar todas (' + matching.length + ')';
        showAll.hidden = matching.length <= 80;
        selectAll.hidden = clear.hidden = apply.hidden = managing;
        activate.hidden = deactivate.hidden = !managing;
        selectAll.disabled = activate.disabled = deactivate.disabled = busy || !matching.length;
        clear.disabled = apply.disabled = busy || !pending.size;
        repo.disabled = addRepo.disabled = refreshButton.disabled = busy;

        list.replaceChildren(...displayed.map(row => {
            const entry = el('div', '', 'source');
            const check = el('input');
            check.type = 'checkbox';
            check.checked = managing ? row.enabled : pending.has(sourceKey(row));
            check.disabled = busy;
            check.setAttribute('aria-label', (managing ? 'Ativar ' : 'Selecionar ') + row.name);
            check.onchange = () => {
                if (managing) changeEnabled([row], check.checked);
                else {
                    if (check.checked) pending.add(sourceKey(row)); else pending.delete(sourceKey(row));
                    render();
                }
            };
            const caption = managing ? button(sourceLabel(row), () => sourceCatalog(row), 'source-link') :
                el('span', sourceLabel(row));
            const action = managing ? button('Ver catálogo', () => sourceCatalog(row)) :
                button('Instalar', () => installRows([row]));
            action.disabled = busy;
            entry.append(check, caption, action);
            return entry;
        }));
    }

    async function updateLists(refreshExtensions) {
        const [available, remote] = await Promise.allSettled([
            api('sources'), api('extensions', { refresh: refreshExtensions })
        ]);
        if (available.status === 'fulfilled') sources = available.value.sources;
        if (remote.status === 'fulfilled') extensions = remote.value.filter(row => !row.isInstalled)
            .map(row => ({ ...row, id: row.pkgName, engine: 'mihon' }));
        return available.status === 'rejected' || available.value.unavailable ||
            remote.status === 'rejected';
    }

    async function load(refreshExtensions = false) {
        busy = true;
        render();
        status.textContent = 'Carregando fontes…';
        const unavailable = await updateLists(refreshExtensions);
        busy = false;
        status.textContent = unavailable ? 'Parte do catálogo está indisponível. Tente atualizar.' : '';
        render();
    }

    async function installRows(rows) {
        if (busy || !rows.length) return;
        busy = true;
        render();
        let installed = 0;
        let failed = 0;
        const bundled = rows.filter(row => row.engine === 'kotatsu');
        status.textContent = 'Instalando ' + rows.length + ' fonte(s)…';
        if (bundled.length) {
            try {
                await api('installKotatsu', { keys: bundled.map(sourceKey) });
                installed += bundled.length;
                for (const row of bundled) pending.delete(sourceKey(row));
            } catch { failed += bundled.length; }
        }
        for (const row of rows.filter(row => row.engine === 'mihon')) {
            if (page !== screen) break;
            status.textContent = 'Instalando fontes… ' + (installed + failed) + ' de ' + rows.length + '.';
            try {
                await api('install', { id: row.id });
                installed++;
                pending.delete(sourceKey(row));
            } catch { failed++; }
        }
        if (installed) lastResults = undefined;
        await updateLists(false);
        busy = false;
        status.textContent = installed + ' fonte(s) adicionada(s) em Gerenciar instaladas.' +
            (failed ? ' ' + failed + ' não puderam ser instaladas.' : '');
        render();
    }

    async function changeEnabled(rows, enabled) {
        if (busy || !rows.length) return;
        busy = true;
        render();
        try {
            await api('enable', { keys: rows.map(sourceKey), enabled });
            for (const row of rows) row.enabled = enabled;
            lastResults = undefined;
            status.textContent = rows.length + (enabled ? ' fonte(s) ativada(s).' : ' fonte(s) desativada(s).');
        } catch { status.textContent = 'Não foi possível salvar a seleção. Tente novamente.'; }
        finally { busy = false; render(); }
    }

    repoForm.onsubmit = async event => {
        event.preventDefault();
        if (busy) return;
        busy = true;
        render();
        status.textContent = 'Adicionando repositório…';
        try {
            await api('repo', { url: repo.value });
            repo.value = '';
            await load(true);
        } catch {
            busy = false;
            status.textContent = 'Não foi possível adicionar o repositório. Confira a URL HTTPS.';
            render();
        }
    };
    name.oninput = () => { sourceFilters[sourcesTab].name = name.value; render(); };
    excluded.oninput = () => { sourceFilters[sourcesTab].excluded = excluded.value; render(); };
    language.onchange = () => { sourceFilters[sourcesTab].language = language.value; render(); };
    engine.onchange = () => { sourceFilters[sourcesTab].engine = engine.value; render(); };
    switchTab(sourcesTab);
    await load();
}

async function chapters(item, back = catalog) {
    const page = begin();
    const status = el('p', 'Carregando capítulos…', 'muted');
    const filter = field('search', 'Filtrar capítulos');
    filter.hidden = true;
    const list = el('div', '', 'list');
    view.append(button('← Voltar aos títulos', back), el('h1', item.title),
        el('p', sourceLabel(item.source), 'muted'), status, filter, list);
    try {
        const entries = await api('chapters', { engine: item.source.engine, id: item.id });
        if (page !== screen) return;
        status.textContent = entries.length ? entries.length + ' capítulo(s)' : 'Nenhum capítulo disponível.';
        filter.hidden = entries.length < 10;
        function showChapters() {
            const query = filter.value.trim().toLowerCase();
            const matched = entries.map((entry, i) => ({ entry, i }))
                .filter(({ entry }) => entry.name.toLowerCase().includes(query));
            list.replaceChildren();
            for (const { entry, i } of matched.slice(0, 80))
                list.append(button(entry.name, () => reader(item, entries, i, back)));
            if (matched.length > 80)
                list.append(el('small', 'Refine o filtro para encontrar os demais capítulos.'));
            if (entries.length && !matched.length)
                list.append(el('small', 'Nenhum capítulo corresponde ao filtro.'));
        }
        filter.oninput = showChapters;
        showChapters();
    } catch { if (page === screen) errorText(status, 'Não foi possível carregar os capítulos. Tente novamente.'); }
}

let enhance = localStorage.getItem('manga-upscale') === 'yes';
async function reader(item, entries, index, back) {
    const page = begin();
    const chapter = entries[index];
    const controls = el('div', '', 'controls');
    const previous = button('Anterior', () => reader(item, entries, index + 1, back));
    const next = button('Próximo', () => reader(item, entries, index - 1, back));
    previous.disabled = index >= entries.length - 1;
    next.disabled = index === 0;
    const upscale = button('', toggle, 'primary');
    const status = el('p', 'Carregando páginas…', 'muted');
    const upscaleStatus = el('p', '', 'muted');
    upscaleStatus.setAttribute('role', 'status');
    const pages = el('div', '', 'pages');
    const near = new Set();
    const enhancedPages = new Set();
    let generation = 0;

    controls.append(button('← Capítulos', () => chapters(item, back)), previous, next, upscale);
    view.append(el('section', '', 'reader'));
    view.firstChild.append(el('h1', chapter.name), el('p', item.title + ' · ' + sourceLabel(item.source), 'muted'),
        controls, status, upscaleStatus, pages);
    window.scrollTo(0, 0);

    const observer = new IntersectionObserver(changes => {
        for (const change of changes) {
            if (change.isIntersecting) {
                near.add(change.target);
                change.target.loadPage();
                processPage(change.target);
            } else near.delete(change.target);
        }
    }, { rootMargin: '500px 0px' });
    dispose = () => {
        observer.disconnect();
        for (const figure of enhancedPages) URL.revokeObjectURL(figure.enhanced);
    };

    function updateButton() {
        upscale.textContent = 'Anime4K 2× ' + (enhance ? 'ligado' : 'desligado');
        upscale.setAttribute('aria-pressed', String(enhance));
    }
    function toggle() {
        enhance = !enhance;
        localStorage.setItem('manga-upscale', enhance ? 'yes' : 'no');
        generation++;
        upscaleStatus.textContent = '';
        updateButton();
        if (enhance) {
            near.forEach(processPage);
        } else {
            for (const figure of enhancedPages) restorePage(figure);
        }
    }
    function restorePage(figure) {
        figure.ready = false;
        figure.image.src = figure.original;
        URL.revokeObjectURL(figure.enhanced);
        enhancedPages.delete(figure);
        figure.enhanced = undefined;
    }
    async function processPage(figure) {
        if (!enhance || !figure.ready || figure.enhanced || figure.upscaling) return;
        const current = generation;
        figure.upscaling = true;
        try {
            const blob = await upscaleImage(figure.image, () =>
                page === screen && generation === current && near.has(figure));
            if (!blob || page !== screen || generation !== current) return;
            const { naturalWidth, naturalHeight } = figure.image;
            figure.enhanced = URL.createObjectURL(blob);
            enhancedPages.add(figure);
            figure.image.src = figure.enhanced;
            upscaleStatus.textContent = 'Anime4K · ' + naturalWidth + '×' + naturalHeight +
                ' → ' + naturalWidth * 2 + '×' + naturalHeight * 2 + ' px';
            if (enhancedPages.size > 12) {
                const distant = Array.from(enhancedPages).find(value => !near.has(value));
                if (distant) restorePage(distant);
            }
        } catch (error) {
            if (page === screen && generation === current)
                upscaleStatus.textContent = error.message + ' A página original continua disponível.';
        } finally {
            figure.upscaling = false;
            if (generation !== current && page === screen && near.has(figure)) processPage(figure);
        }
    }

    updateButton();
    try {
        const urls = await api('pages', { engine: item.source.engine, id: chapter.id });
        if (page !== screen) return;
        status.textContent = urls.length ? urls.length + ' página(s)' : 'Nenhuma página disponível.';
        urls.forEach((url, i) => {
            const figure = el('figure', '', 'page');
            const image = el('img');
            image.alt = 'Página ' + (i + 1);
            image.hidden = true;
            const retry = button('Tentar carregar a página ' + (i + 1), () => {
                figure.started = false;
                figure.loadPage();
            });
            retry.hidden = true;
            figure.original = url;
            figure.image = image;
            figure.loadPage = () => {
                if (figure.started) return;
                figure.started = true;
                retry.hidden = true;
                image.src = url;
            };
            image.onload = () => {
                image.hidden = false;
                figure.ready = true;
                if (near.has(figure)) processPage(figure);
            };
            image.onerror = () => {
                figure.ready = false;
                image.hidden = true;
                retry.hidden = false;
            };
            figure.append(image, retry);
            pages.append(figure);
            observer.observe(figure);
        });
    } catch { if (page === screen) errorText(status, 'Não foi possível carregar as páginas. Tente novamente.'); }
}

document.querySelector('#home').onclick = () => window.chrome?.webview?.postMessage('manga-close');
document.querySelector('#catalog').onclick = catalog;
document.querySelector('#sources').onclick = settings;
catalog();
