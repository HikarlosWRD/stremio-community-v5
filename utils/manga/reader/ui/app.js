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
function errorText(node, error) {
    node.textContent = error.message;
    node.className = 'error';
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
    form.append(input, submit);
    const status = el('p', 'A busca consulta todas as fontes ativadas.', 'muted');
    status.setAttribute('role', 'status');
    const errors = el('p', '', 'error');
    const cards = el('section', '', 'grid');
    view.append(el('h1', 'Mangás, manhwas e webtoons'), form, status, errors, cards);

    function render(result) {
        status.textContent = result.searched
            ? result.rows.length + ' resultado(s) em ' + result.searched + ' fonte(s).'
            : 'Ative pelo menos uma fonte na aba Fontes.';
        errors.textContent = result.errors.join('\n');
        cards.replaceChildren();
        for (const item of result.rows) {
            const card = button('', () => chapters(item), 'card');
            const cover = el(item.cover ? 'img' : 'div', '', 'placeholder');
            if (item.cover) {
                cover.src = item.cover;
                cover.alt = '';
                cover.loading = 'lazy';
                cover.onerror = () => cover.replaceWith(el('div', '', 'placeholder'));
            }
            card.append(cover, el('strong', item.title), el('small', sourceLabel(item.source)));
            cards.append(card);
        }
    }

    if (lastResults) render(lastResults);
    form.onsubmit = async event => {
        event.preventDefault();
        lastQuery = input.value.trim();
        if (!lastQuery) return;
        submit.disabled = true;
        status.className = 'muted';
        status.textContent = 'Buscando nas fontes…';
        errors.textContent = '';
        cards.replaceChildren();
        try {
            const result = await api('search', { query: lastQuery });
            if (page === screen) {
                lastResults = result;
                render(result);
            }
        } catch (error) {
            if (page === screen) errorText(status, error);
        } finally {
            submit.disabled = false;
        }
    };
}

async function settings() {
    const page = begin();
    const enabledPanel = el('section', '', 'panel');
    const installedFilter = field('search', 'Filtrar fontes disponíveis por nome ou idioma');
    const enabledStatus = el('p', 'Carregando fontes…', 'muted');
    const enabledList = el('div', '', 'list');
    enabledPanel.append(el('h2', 'Fontes da busca'), installedFilter, enabledStatus, enabledList);
    const extensionsPanel = el('section', '', 'panel');
    const repo = field('url', 'URL HTTPS do repositório de extensões Mihon');
    repo.required = true;
    const repoForm = el('form');
    const add = el('button', 'Adicionar repositório', 'primary');
    add.type = 'submit';
    const extStatus = el('p', '', 'muted');
    const extFilter = field('search', 'Filtrar extensões por nome ou idioma');
    const extList = el('div', '', 'list');
    let extensions = [];
    let available = [];
    let loaded = false;
    const load = button('Carregar extensões', async () => {
        load.disabled = true;
        extStatus.className = 'muted';
        extStatus.textContent = 'Atualizando catálogo…';
        try {
            extensions = await api('extensions');
            loaded = true;
            renderExtensions();
        } catch (error) { errorText(extStatus, error); }
        finally { load.disabled = false; }
    });
    repoForm.append(repo, add);
    extensionsPanel.append(el('h2', 'Extensões Mihon'),
        el('p', 'Adicione um repositório de sua confiança e escolha as extensões para instalar.', 'muted'),
        repoForm, el('p'), load, extStatus, extFilter, extList);
    view.append(el('h1', 'Fontes'), enabledPanel, extensionsPanel);
    repoForm.onsubmit = async event => {
        event.preventDefault();
        add.disabled = true;
        extStatus.className = 'muted';
        extStatus.textContent = 'Adicionando repositório…';
        try {
            await api('repo', { url: repo.value });
            repo.value = '';
            load.click();
        } catch (error) { errorText(extStatus, error); }
        finally { add.disabled = false; }
    };

    function renderExtensions() {
        if (page !== screen || !loaded) return;
        const query = extFilter.value.trim().toLowerCase();
        const matched = extensions.filter(x => (x.name + ' ' + x.lang + ' ' + x.pkgName).toLowerCase().includes(query));
        extStatus.className = 'muted';
        extStatus.textContent = matched.length + ' extensão(ões)' + (matched.length > 60 ? ' · refine o filtro para ver as demais' : '');
        extList.replaceChildren();
        for (const x of matched.slice(0, 60)) {
            const row = el('div', '', 'source');
            const install = button(x.isInstalled ? 'Instalada' : 'Instalar', async () => {
                install.disabled = true;
                extStatus.textContent = 'Instalando ' + x.name + '…';
                try {
                    await api('install', { id: x.pkgName });
                    x.isInstalled = true;
                    renderExtensions();
                    await refresh();
                } catch (error) {
                    install.disabled = false;
                    errorText(extStatus, error);
                }
            });
            install.disabled = x.isInstalled;
            row.append(el('span', x.name + ' · ' + x.lang), install);
            extList.append(row);
        }
    }

    function renderSources() {
        if (page !== screen) return;
        const query = installedFilter.value.trim().toLowerCase();
        enabledList.replaceChildren();
        const filtered = available.filter(x => sourceLabel(x).toLowerCase().includes(query));
        const sorted = filtered.sort((a, b) => Number(b.enabled) - Number(a.enabled) ||
            sourceLabel(a).localeCompare(sourceLabel(b)));
        for (const x of sorted.slice(0, 80)) {
            const row = el('label', '', 'source');
            const caption = el('span');
            const check = el('input');
            check.type = 'checkbox';
            check.checked = x.enabled;
            caption.append(check, document.createTextNode(sourceLabel(x)));
            row.append(caption);
            enabledList.append(row);
            check.onchange = async () => {
                check.disabled = true;
                try {
                    await api('enable', { key: x.engine + ':' + x.id, enabled: check.checked });
                    x.enabled = check.checked;
                    lastResults = undefined;
                } catch (error) {
                    check.checked = x.enabled;
                    errorText(enabledStatus, error);
                } finally { check.disabled = false; }
            };
        }
        if (sorted.length > 80) enabledList.append(el('small', 'Refine o filtro para ver as demais fontes.'));
    }

    async function refresh() {
        try {
            const response = await api('sources');
            if (page !== screen) return;
            available = response.sources;
            enabledStatus.textContent = response.errors.join('\n') ||
                'Ative as fontes que você quer incluir na busca. Os parsers Kotatsu já vêm disponíveis.';
            enabledStatus.className = response.errors.length ? 'error' : 'muted';
            renderSources();
        } catch (error) { if (page === screen) errorText(enabledStatus, error); }
    }

    installedFilter.oninput = renderSources;
    extFilter.oninput = renderExtensions;
    await refresh();
}

async function chapters(item) {
    const page = begin();
    const status = el('p', 'Carregando capítulos…', 'muted');
    const filter = field('search', 'Filtrar capítulos');
    filter.hidden = true;
    const list = el('div', '', 'list');
    view.append(button('← Resultados', catalog), el('h1', item.title),
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
                list.append(button(entry.name, () => reader(item, entries, i)));
            if (matched.length > 80)
                list.append(el('small', 'Refine o filtro para encontrar os demais capítulos.'));
            if (entries.length && !matched.length)
                list.append(el('small', 'Nenhum capítulo corresponde ao filtro.'));
        }
        filter.oninput = showChapters;
        showChapters();
    } catch (error) { if (page === screen) errorText(status, error); }
}

let enhance = localStorage.getItem('manga-upscale') === 'yes';
async function reader(item, entries, index) {
    const page = begin();
    const chapter = entries[index];
    const controls = el('div', '', 'controls');
    const previous = button('Anterior', () => reader(item, entries, index + 1));
    const next = button('Próximo', () => reader(item, entries, index - 1));
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

    controls.append(button('← Capítulos', () => chapters(item)), previous, next, upscale);
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
    } catch (error) { if (page === screen) errorText(status, error); }
}

document.querySelector('#home').onclick = () => window.chrome?.webview?.postMessage('manga-close');
document.querySelector('#catalog').onclick = catalog;
document.querySelector('#sources').onclick = settings;
catalog();
