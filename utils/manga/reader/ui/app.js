import { upscaleImage } from './upscale.js';
import { findChapters } from './chapter-list.mjs';
import { compareAvailability } from './coverage.mjs';

const view = document.querySelector('#view');
const labels = { kotatsu: 'Kotatsu', mihon: 'Mihon' };
let screen = 0;
let lastQuery = '';
let searchScope = localStorage.getItem('manga-search-scope') === 'installed' ? 'installed' : 'active';
let includeAdult = localStorage.getItem('manga-include-adult') === 'yes';
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
async function api(op, values = {}, signal) {
    const response = await fetch('api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-reader-request': '1' },
        body: JSON.stringify({ op, ...values }), signal
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

function coverageLabel(data) {
    if (!data) return 'Verificando capítulos…';
    if (data.first == null) return 'Faixa de capítulos indisponível';
    const range = data.first === data.last ? 'Cap. ' + data.first : 'Cap. ' + data.first + '–' + data.last;
    return range + ' listados · ' + (data.verified == null
        ? 'início sem imagem confirmada' : 'cap. ' + data.verified + ' com imagem');
}

function coverageQueue() {
    const controller = new AbortController();
    const pending = [];
    let active = 0;
    function drain() {
        if (controller.signal.aborted) return;
        while (active < 4 && pending.length) {
            const { item, updated } = pending.shift();
            active++;
            api('coverage', { engine: item.source.engine, id: item.id }, controller.signal)
                .catch(() => ({})).then(data => {
                    if (!controller.signal.aborted) {
                        item.coverage = data;
                        updated();
                    }
                }).finally(() => { active--; drain(); });
        }
    }
    return {
        add(item, updated) {
            if (item.coverage) return;
            pending.push({ item, updated });
            pending.sort((a, b) => b.item.relevance - a.item.relevance);
            drain();
        },
        stop() { controller.abort(); pending.length = 0; }
    };
}

async function streamSearch(query, scope, signal, onEvent) {
    const response = await fetch('api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-reader-request': '1' },
        body: JSON.stringify({ op: 'search', query, scope, includeAdult }), signal
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
    const scope = el('select');
    const adult = el('input');
    adult.type = 'checkbox';
    adult.checked = includeAdult;
    const adultLabel = el('label', '', 'adult-flag');
    adultLabel.append(adult, document.createTextNode('Incluir fontes +18'));
    adult.onchange = () => {
        includeAdult = adult.checked;
        localStorage.setItem('manga-include-adult', includeAdult ? 'yes' : 'no');
        if (input.value.trim()) form.requestSubmit();
    };
    scope.setAttribute('aria-label', 'Fontes consultadas na busca');
    for (const [value, label] of [['active', 'Fontes ativadas'], ['installed', 'Todas as instaladas']]) {
        const option = el('option', label);
        option.value = value;
        scope.append(option);
    }
    scope.value = searchScope;
    scope.onchange = () => {
        searchScope = scope.value;
        localStorage.setItem('manga-search-scope', searchScope);
        if (input.value.trim()) form.requestSubmit();
    };
    form.append(input, scope, submit, cancel, adultLabel);
    const status = el('p', 'Os primeiros capítulos com imagem verificada aparecem primeiro.', 'muted');
    status.setAttribute('role', 'status');
    const groups = el('div');
    view.append(el('h1', 'Mangás, manhwas e webtoons'), form, status, groups);
    let controller;
    let inspections = coverageQueue();
    const views = new Map();
    dispose = () => { controller?.abort(); inspections.stop(); };

    function reorderGroups() {
        const ordered = [...views.values()].sort((a, b) => compareAvailability(a.first, b.first));
        ordered.forEach(({ section }, index) => {
            if (groups.children[index] !== section) groups.insertBefore(section, groups.children[index] || null);
        });
    }

    function renderGroup(group) {
        const section = el('section', '', 'result-group');
        const heading = el('div', '', 'controls');
        heading.append(el('h2', sourceLabel(group.source)),
            button('Buscar nesta fonte', () => sourceCatalog(group.source, lastQuery, catalog)));
        const cards = el('div', '', 'grid');
        const view = { section, first: group.rows[0] };
        views.set(group, view);
        const items = group.rows.map(item => {
            const card = workCard(item, catalog);
            const note = el('small', coverageLabel(item.coverage), 'chapter-coverage');
            card.append(note);
            return { item, card, note };
        });
        const more = button('Mostrar todos (' + group.rows.length + ')', () => {
            group.expanded = true;
            fill();
        });
        function fill() {
            items.sort((a, b) => compareAvailability(a.item, b.item));
            view.first = items[0].item;
            const rows = group.expanded ? items : items.slice(0, 6);
            rows.forEach(({ card }, index) => {
                if (cards.children[index] !== card) cards.insertBefore(card, cards.children[index] || null);
            });
            while (cards.children.length > rows.length) cards.lastElementChild.remove();
            more.hidden = group.expanded || rows.length === group.rows.length;
            reorderGroups();
        }
        section.append(heading, cards, more);
        fill();
        for (const { item, note } of items) {
            inspections.add(item, () => {
                note.textContent = coverageLabel(item.coverage);
                fill();
            });
        }
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
            status.textContent = 'Nenhuma fonte de mangás disponível neste escopo.';
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
        inspections.stop();
        inspections = coverageQueue();
        views.clear();
        const current = new AbortController();
        controller = current;
        cancel.hidden = false;
        lastQuery = query;
        const result = { groups: [], total: null, completed: 0, failed: 0, unavailable: 0 };
        lastResults = result;
        groups.replaceChildren();
        updateStatus(result, true);
        try {
            await streamSearch(query, scope.value, current.signal, event => {
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
    const inspected = [];
    let inspections = coverageQueue();
    dispose = () => inspections.stop();
    const reopen = () => sourceCatalog(source, query, back);
    async function load() {
        if (loading || position === null) return;
        loading = true;
        submit.disabled = more.disabled = true;
        status.textContent = 'Carregando catálogo…';
        try {
            const data = await api('catalog', { engine: source.engine, id: source.id, query, position, includeAdult });
            if (page !== screen) return;
            let added = 0;
            for (const item of data.rows) {
                if (seen.has(item.id)) continue;
                seen.add(item.id);
                added++;
                const card = workCard(item, reopen);
                cards.append(card);
                if (query) {
                    const note = el('small', coverageLabel(item.coverage), 'chapter-coverage');
                    card.append(note);
                    inspected.push({ item, card });
                    inspections.add(item, () => {
                        note.textContent = coverageLabel(item.coverage);
                        inspected.sort((a, b) => compareAvailability(a.item, b.item));
                        inspected.forEach(({ card: tile }, index) => {
                            if (cards.children[index] !== tile) cards.insertBefore(tile, cards.children[index] || null);
                        });
                    });
                }
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
        inspected.length = 0;
        inspections.stop();
        inspections = coverageQueue();
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
        for (const row of matching) selection().add(sourceKey(row));
        render();
    });
    const clear = button('Limpar seleção', () => { selection().clear(); render(); });
    const apply = button('Instalar selecionadas', () => {
        const rows = candidates('install').filter(row => pending.has(sourceKey(row)));
        installRows(rows);
    }, 'primary');
    const activate = button('Ativar todas do filtro', () => changeEnabled(matching, true), 'primary');
    const deactivate = button('Desativar todas do filtro', () => changeEnabled(matching, false));
    const remove = button('Desinstalar selecionadas', () =>
        confirmRemoval(candidates('installed').filter(row => removal.has(sourceKey(row)))));
    actions.append(showAll, selectAll, clear, apply, remove, activate, deactivate);
    const installTab = button('Instalar fontes', () => switchTab('install'));
    const installedTab = button('Gerenciar instaladas', () => switchTab('installed'));
    tabs.append(installTab, installedTab);
    view.append(el('h1', 'Fontes'), tabs, filters, actions, summary, status, repoPanel, list);

    let sources = [];
    let extensions = [];
    let matching = [];
    let busy = false;
    const pending = new Set();
    const removal = new Set();
    function selection() { return sourcesTab === 'installed' ? removal : pending; }

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
            (selection().size ? ' · ' + selection().size + ' selecionada(s)' : '') + '.';
        showAll.textContent = filter.showAll ? 'Mostrar menos' : 'Mostrar todas (' + matching.length + ')';
        showAll.hidden = matching.length <= 80;
        apply.hidden = managing;
        remove.hidden = !managing;
        activate.hidden = deactivate.hidden = !managing;
        selectAll.disabled = activate.disabled = deactivate.disabled = busy || !matching.length;
        clear.disabled = busy || !selection().size;
        apply.disabled = busy || !pending.size;
        remove.disabled = busy || !removal.size;
        repo.disabled = addRepo.disabled = refreshButton.disabled = busy;

        list.replaceChildren(...displayed.map(row => {
            const entry = el('div', '', 'source');
            const check = el('input');
            check.type = 'checkbox';
            check.checked = selection().has(sourceKey(row));
            check.disabled = busy;
            check.setAttribute('aria-label', 'Selecionar ' + row.name);
            check.onchange = () => {
                if (check.checked) selection().add(sourceKey(row)); else selection().delete(sourceKey(row));
                render();
            };
            const caption = managing ? button(sourceLabel(row), () => sourceCatalog(row), 'source-link') :
                el('span', sourceLabel(row));
            const rowActions = el('div', '', 'controls source-actions');
            if (managing) {
                const toggle = button(row.enabled ? 'Ativa na busca' : 'Ativar na busca', () => changeEnabled([row], !row.enabled));
                toggle.setAttribute('aria-pressed', String(row.enabled));
                const uninstall = button('Desinstalar', () => confirmRemoval([row]));
                toggle.disabled = uninstall.disabled = busy;
                rowActions.append(toggle, uninstall);
            } else {
                const install = button('Instalar', () => installRows([row]));
                install.disabled = busy;
                rowActions.append(install);
            }
            entry.append(check, caption, rowActions);
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

    function confirmRemoval(rows) {
        if (busy || !rows.length) return;
        const packages = new Set(rows.filter(row => row.packageId).map(row => row.packageId));
        const affected = sources.filter(row => packages.has(row.packageId) &&
            !rows.some(selected => sourceKey(selected) === sourceKey(row)));
        const dialog = el('dialog');
        const heading = el('h2', rows.length === 1 ? 'Desinstalar ' + rows[0].name + '?' :
            'Desinstalar ' + rows.length + ' fontes selecionadas?');
        const description = el('p', affected.length
            ? 'As extensões Mihon selecionadas também removem ' + affected.length + ' fonte(s) de outros idiomas.'
            : 'As fontes removidas voltam para Instalar fontes.', 'muted');
        const buttons = el('div', '', 'controls');
        buttons.append(button('Cancelar', () => dialog.close()), button('Desinstalar', () => {
            dialog.close();
            uninstallRows(rows);
        }, 'primary'));
        dialog.append(heading, description, buttons);
        dialog.addEventListener('close', () => dialog.remove(), { once: true });
        view.append(dialog);
        dialog.showModal();
    }

    async function uninstallRows(rows) {
        if (busy) return;
        busy = true;
        render();
        status.textContent = 'Desinstalando fontes…';
        try {
            const result = await api('uninstallSources', { keys: rows.map(sourceKey) });
            for (const key of result.removed) removal.delete(key);
            if (result.removed.length) lastResults = undefined;
            await updateLists(false);
            status.textContent = result.removed.length + ' fonte(s) removida(s).' +
                (result.failed ? ' ' + result.failed + ' não puderam ser removidas.' : '');
        } catch {
            status.textContent = 'Não foi possível desinstalar as fontes. Tente novamente.';
        } finally {
            busy = false;
            render();
        }
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

async function chapters(item, back = catalog, loaded, previousQuery = '') {
    const page = begin();
    const status = el('p', 'Carregando capítulos…', 'muted');
    const filter = field('search', 'Filtrar capítulos por número ou título');
    filter.hidden = true;
    filter.value = previousQuery;
    const list = el('div', '', 'list');
    view.append(button('← Voltar aos títulos', back), el('h1', item.title),
        el('p', sourceLabel(item.source), 'muted'), status, filter, list);
    window.scrollTo(0, 0);
    try {
        const entries = loaded ?? await api('chapters', { engine: item.source.engine, id: item.id });
        if (page !== screen) return;
        filter.hidden = !entries.length;
        function showChapters() {
            const matched = findChapters(entries, filter.value);
            status.textContent = !entries.length ? 'Nenhum capítulo disponível.' :
                matched.length + ' de ' + entries.length + ' capítulo(s).';
            list.replaceChildren();
            const fragment = document.createDocumentFragment();
            const returnToList = () => chapters(item, back, entries, filter.value);
            for (const { entry, index } of matched)
                fragment.append(button(entry.name, () => reader(item, entries, index, returnToList)));
            if (entries.length && !matched.length)
                fragment.append(el('small', 'Nenhum capítulo corresponde ao filtro.'));
            list.append(fragment);
        }
        filter.oninput = showChapters;
        showChapters();
    } catch { if (page === screen) errorText(status, 'Não foi possível carregar os capítulos. Tente novamente.'); }
}

const models = { S: 'Leve (S)', M: 'Médio (M)', L: 'Pesado (L)' };
const storedModel = localStorage.getItem('manga-upscale-model');
let upscaleModel = Object.hasOwn(models, storedModel) ? storedModel :
    (storedModel === 'off' || localStorage.getItem('manga-upscale') !== 'yes' ? 'off' : 'S');
let repetitions = localStorage.getItem('manga-upscale-repetitions') === '2' ? 2 : 1;
let refineColor = localStorage.getItem('manga-upscale-color') !== 'no';
let zoom = 100;

function readerSelect(label, choices, selected, onChange) {
    const field = el('label', label, 'reader-field');
    const select = el('select');
    for (const [value, title] of choices) {
        const option = el('option', title);
        option.value = value;
        select.append(option);
    }
    select.value = selected;
    select.onchange = () => onChange(select.value);
    field.append(select);
    return field;
}

async function reader(item, entries, index, returnToList) {
    const page = begin();
    const chapter = entries[index];
    const layout = el('section', '', 'reader');
    const navigation = el('nav', '', 'reader-rail');
    navigation.setAttribute('aria-label', 'Navegação do capítulo');
    const previous = button('Anterior', () => reader(item, entries, index + 1, returnToList));
    const next = button('Próximo', () => reader(item, entries, index - 1, returnToList));
    previous.disabled = index >= entries.length - 1;
    next.disabled = index === 0;
    navigation.append(button('← Voltar', returnToList), previous, next);

    const content = el('div', '', 'reader-content');
    const status = el('p', 'Carregando páginas…', 'muted');
    const pages = el('div', '', 'pages');
    content.append(el('h1', chapter.name), el('p', item.title + ' · ' + sourceLabel(item.source), 'muted'), status, pages);
    const adjustments = el('aside', '', 'reader-rail');
    adjustments.setAttribute('aria-label', 'Zoom e upscale');
    const smaller = button('−', () => setZoom(zoom - 25));
    smaller.setAttribute('aria-label', 'Diminuir zoom');
    const larger = button('+', () => setZoom(zoom + 25));
    larger.setAttribute('aria-label', 'Aumentar zoom');
    const zoomValue = button('', () => setZoom(100));
    zoomValue.setAttribute('aria-label', 'Restaurar zoom a 100%');
    const zoomButtons = el('div', '', 'reader-zoom');
    zoomButtons.append(smaller, zoomValue, larger);
    const model = readerSelect('Upscale', [['off', 'Desligado'], ...Object.entries(models)],
        upscaleModel, value => { upscaleModel = value; updateUpscale(); });
    const passes = readerSelect('Passagens', [['1', '1 · 2×'], ['2', '2 · 4×']],
        String(repetitions), value => { repetitions = Number(value); updateUpscale(); });
    const color = el('input');
    color.type = 'checkbox';
    color.checked = refineColor;
    color.onchange = () => { refineColor = color.checked; updateUpscale(); };
    const colorLabel = el('label', '', 'reader-field color-flag');
    colorLabel.append(color, document.createTextNode('Refinar cores'));
    const upscaleStatus = el('small', '', 'reader-upscale-status');
    upscaleStatus.setAttribute('role', 'status');
    adjustments.append(el('strong', 'Zoom'), zoomButtons, model, passes, colorLabel, upscaleStatus);
    layout.append(navigation, content, adjustments);
    view.append(layout);
    window.scrollTo(0, 0);

    const near = new Set();
    const enhancedPages = new Set();
    let generation = 0;

    function setZoom(value) {
        const width = content.clientWidth;
        const maxZoom = width ? Math.min(175, Math.floor(width / Math.min(width, 850) * 100)) : 100;
        const nextZoom = Math.max(50, Math.min(maxZoom, value));
        const middle = window.innerHeight / 2;
        const anchor = [...near].find(figure => {
            const rect = figure.getBoundingClientRect();
            return rect.top <= middle && rect.bottom > middle;
        });
        const original = anchor?.getBoundingClientRect();
        zoom = nextZoom;
        pages.style.setProperty('--reader-zoom', String(zoom / 100));
        zoomValue.textContent = zoom + '%';
        smaller.disabled = zoom === 50;
        larger.disabled = zoom >= maxZoom;
        if (anchor && original?.height) {
            const rect = anchor.getBoundingClientRect();
            const relative = (middle - original.top) / original.height;
            window.scrollBy(0, rect.top + rect.height * relative - middle);
        }
    }

    const observer = new IntersectionObserver(changes => {
        for (const change of changes) {
            if (change.isIntersecting) {
                near.add(change.target);
                change.target.loadPage();
                processPage(change.target);
            } else near.delete(change.target);
        }
    }, { rootMargin: '500px 0px' });
    const resize = new ResizeObserver(entries => {
        if (entries[0].contentRect.width !== lastContentWidth) {
            lastContentWidth = entries[0].contentRect.width;
            setZoom(zoom);
        }
    });
    let lastContentWidth;
    resize.observe(content);
    dispose = () => {
        observer.disconnect();
        resize.disconnect();
        for (const figure of enhancedPages) URL.revokeObjectURL(figure.enhanced);
    };

    function updateUpscale() {
        localStorage.setItem('manga-upscale-model', upscaleModel);
        localStorage.setItem('manga-upscale-repetitions', String(repetitions));
        localStorage.setItem('manga-upscale-color', refineColor ? 'yes' : 'no');
        passes.querySelector('select').disabled = upscaleModel === 'off';
        color.disabled = upscaleModel === 'off';
        generation++;
        upscaleStatus.textContent = '';
        for (const figure of enhancedPages) restorePage(figure);
        if (upscaleModel !== 'off') near.forEach(processPage);
    }
    function restorePage(figure) {
        figure.ready = false;
        figure.image.src = figure.original;
        URL.revokeObjectURL(figure.enhanced);
        enhancedPages.delete(figure);
        figure.enhanced = undefined;
    }
    async function processPage(figure) {
        if (upscaleModel === 'off' || !figure.ready || figure.enhanced || figure.upscaling) return;
        const current = generation;
        figure.upscaling = true;
        try {
            const result = await upscaleImage(figure.image, upscaleModel, repetitions, refineColor, () =>
                page === screen && generation === current && near.has(figure));
            if (!result || page !== screen || generation !== current || !near.has(figure)) return;
            figure.enhanced = URL.createObjectURL(result.blob);
            enhancedPages.add(figure);
            figure.image.src = figure.enhanced;
            upscaleStatus.textContent = result.width + ' × ' + result.height + ' px · ' +
                (result.passes === 2 ? '4×' : '2×') + (result.passes < repetitions ? ' (limite da página)' : '');
            if (enhancedPages.size > 12) {
                const distant = [...enhancedPages].find(value => !near.has(value));
                if (distant) restorePage(distant);
            }
        } catch (error) {
            if (page === screen && generation === current)
                upscaleStatus.textContent = error.message + ' Exibindo a página original.';
        } finally {
            figure.upscaling = false;
            if (generation !== current && page === screen && near.has(figure)) processPage(figure);
        }
    }

    setZoom(zoom);
    passes.querySelector('select').disabled = upscaleModel === 'off';
    color.disabled = upscaleModel === 'off';
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
