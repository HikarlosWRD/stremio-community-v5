import { upscaleImage, upscaleNative } from './upscale.js';
import { findChapters } from './chapter-list.mjs';
import { compareAvailability } from './coverage.mjs';

const view = document.querySelector('#view');
const ambient = document.querySelector('#ambient-art');
let trendingArt = [];
let selectedArt;
let themeTab = 'manga-home';
const themeOrder = ['manga-home', 'library', 'recommendations', 'catalog', 'sources'];
const labels = { kotatsu: 'Kotatsu', mihon: 'Mihon' };
let screen = 0;
let lastQuery = '';
let searchScope = localStorage.getItem('manga-search-scope') === 'installed' ? 'installed' : 'active';
let includeAdult = localStorage.getItem('manga-include-adult') === 'yes';
let lastResults;
let dispose = () => {};
const libraryStorageKey = 'manga-library-v1';
const lastLibraryArt = new Map();
function readLibrary() {
    try { return JSON.parse(localStorage.getItem(libraryStorageKey)) || { version: 1, works: {} }; }
    catch { return { version: 1, works: {} }; }
}
function workKey(item) { return JSON.stringify([item.source.engine, String(item.id)]); }
function saveLibrary(data) { localStorage.setItem(libraryStorageKey, JSON.stringify(data)); }
function savedWork(item) { return readLibrary().works[workKey(item)]; }
function updateWork(item, update) {
    const data = readLibrary();
    const key = workKey(item);
    const existing = data.works[key] || { item, inLibrary: false, read: {} };
    if (existing.lastChapter) existing.lastReadAt ??= existing.updatedAt;
    existing.item = { id: item.id, title: item.title, source: item.source };
    if (item.artwork) existing.item.artwork = item.artwork;
    update(existing);
    data.works[key] = existing;
    if (!existing.inLibrary && data.readingQueue)
        data.readingQueue = data.readingQueue.filter(entry => entry !== key);
    saveLibrary(data);
}

function savedCover(item) {
    return 'cover?' + new URLSearchParams({ engine: item.source.engine, id: item.id, title: item.title });
}

function library(home = false) {
    const data = readLibrary();
    const works = Object.values(data.works)
        .filter(work => work.inLibrary && (!home || work.lastChapter?.id != null));
    const activity = work => (home ? work.lastReadAt ?? work.updatedAt : work.updatedAt) || 0;
    works.sort((a, b) => activity(b) - activity(a));
    const tab = home ? 'manga-home' : 'library';
    const previous = works.findIndex(work => workKey(work.item) === lastLibraryArt.get(tab));
    const featured = works.length ? works[(previous + 1) % works.length].item : null;
    if (featured) lastLibraryArt.set(tab, workKey(featured));
    const artwork = featured ? featured.artwork || savedCover(featured) : '';
    begin(artwork, tab);
    window.scrollTo(0, 0);
    const heading = el('section', '', 'recommendation-hero collection-hero');
    if (artwork) heading.append(artImage(artwork, 'recommendation-banner'));
    heading.append(el('h1', home ? 'Home' : 'Biblioteca'));
    view.append(heading);
    if (!works.length) {
        view.append(el('p', home ? 'Comece a ler uma obra da biblioteca para vê-la aqui.' :
            'Adicione uma obra à biblioteca para encontrá-la aqui.', 'muted'));
        view.append(button('Explorar obras', catalog, 'primary'));
        return;
    }
    const grid = el('div', '', 'grid');
    const queue = home ? null : readingQueue(data);
    for (const work of works) {
        const item = { ...work.item, cover: savedCover(work.item) };
        const back = () => library(home);
        const tile = el('article', '', 'library-tile');
        tile.append(workCard(item, back));
        if (queue) queue.addBookmark(tile, item);
        if (home) {
            const progress = work.lastChapter;
            tile.append(button('▶ Continuar', () => chapters(item, back, undefined, '', progress.id, progress.page), 'primary'));
            const entries = work.chapters || [];
            const index = entries.findIndex(chapter => String(chapter.id) === String(progress.id));
            const nearby = index < 0 ? [] : entries.slice(Math.max(0, index - 2), index + 1).reverse();
            for (const chapter of nearby) {
                const read = work.read?.[String(chapter.id)];
                const shortcut = button(chapter.name || 'Capítulo ' + (chapter.number ?? 'sem número'),
                    () => chapters(item, back, undefined, '', chapter.id), 'home-chapter');
                if (read) shortcut.classList.add('home-chapter-read');
                tile.append(shortcut);
            }
        }
        grid.append(tile);
    }
    if (queue) {
        const layout = el('div', '', 'library-layout');
        layout.append(grid, queue.panel);
        view.append(layout);
    } else view.append(grid);
}

function readingQueue(data) {
    const keys = [...new Set(data.readingQueue || [])].filter(key => data.works[key]?.inLibrary);
    const bookmarks = new Map();
    const panel = el('aside', '', 'reading-queue');
    const list = el('ol', '', 'reading-queue-list');
    const empty = el('p', 'Marque as obras que você quer ler para montar sua fila.', 'muted');
    panel.append(el('h2', 'Fila de leitura'), empty, list);
    function commit() {
        const current = readLibrary();
        current.readingQueue = keys;
        saveLibrary(current);
        render();
    }
    function move(key, index) {
        const previous = keys.indexOf(key);
        if (previous < 0 || previous === index || index < 0 || index >= keys.length) return;
        keys.splice(previous, 1);
        keys.splice(index, 0, key);
        commit();
    }
    function render() {
        empty.hidden = keys.length > 0;
        list.replaceChildren();
        keys.forEach((key, index) => {
            const item = data.works[key].item;
            const row = el('li', '', 'queue-entry');
            row.dataset.position = index;
            const grip = el('span', '⠿ ' + (index + 1), 'queue-position');
            grip.title = 'Arrastar para reordenar';
            let target;
            grip.onpointerdown = event => {
                if (event.button !== 0) return;
                grip.setPointerCapture(event.pointerId);
                row.classList.add('dragging');
            };
            grip.onpointermove = event => {
                if (!grip.hasPointerCapture(event.pointerId)) return;
                target?.classList.remove('drop-target');
                target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.queue-entry');
                if (target !== row) target?.classList.add('drop-target');
            };
            grip.onlostpointercapture = () => {
                row.classList.remove('dragging');
                target?.classList.remove('drop-target');
                target = undefined;
            };
            grip.onpointerup = event => {
                if (!grip.hasPointerCapture(event.pointerId)) return;
                const destination = document.elementFromPoint(event.clientX, event.clientY)?.closest('.queue-entry');
                if (destination && list.contains(destination)) move(key, Number(destination.dataset.position));
            };
            const open = button(item.title, () => chapters({ ...item, cover: savedCover(item) }, () => library()),
                'queue-work');
            const up = button('↑', () => move(key, index - 1));
            const down = button('↓', () => move(key, index + 1));
            up.setAttribute('aria-label', 'Subir ' + item.title);
            down.setAttribute('aria-label', 'Descer ' + item.title);
            up.disabled = index === 0;
            down.disabled = index === keys.length - 1;
            row.append(grip, open, up, down);
            list.append(row);
        });
        for (const [key, { mark, title }] of bookmarks) {
            const marked = keys.includes(key);
            mark.setAttribute('aria-pressed', String(marked));
            mark.setAttribute('aria-label', (marked ? 'Remover da fila: ' : 'Adicionar à fila: ') + title);
        }
    }
    render();
    return {
        panel,
        addBookmark(tile, item) {
            const key = workKey(item);
            const mark = button('', () => {
                const index = keys.indexOf(key);
                if (index < 0) keys.push(key);
                else keys.splice(index, 1);
                commit();
            }, 'queue-bookmark');
            mark.append(el('span', '', 'bookmark-icon'));
            bookmarks.set(key, { mark, title: item.title });
            const marked = keys.includes(key);
            mark.setAttribute('aria-pressed', String(marked));
            mark.setAttribute('aria-label', (marked ? 'Remover da fila: ' : 'Adicionar à fila: ') + item.title);
            tile.append(mark);
        }
    };
}

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
function begin(artwork, tab = themeTab) {
    dispose();
    dispose = () => {};
    view.replaceChildren();
    selectedArt = artwork;
    themeTab = tab;
    for (const id of themeOrder) {
        const nav = document.getElementById(id);
        if (id === tab) nav.setAttribute('aria-current', 'page');
        else nav.removeAttribute('aria-current');
    }
    refreshAmbient();
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
function workCard(item, back, open = () => chapters(item, back)) {
    const card = button('', open, 'card');
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
    if (data.failed) return 'Não foi possível verificar os capítulos';
    if (data.first == null) return data.count === 1 ? '1 capítulo' : data.count + ' capítulos';
    const range = data.first === data.last ? 'Cap. ' + data.first : 'Cap. ' + data.first + '–' + data.last;
    return range;
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
                .catch(() => ({ failed: true })).then(data => {
                    if (!controller.signal.aborted) {
                        item.coverage = data;
                        updated();
                    }
                }).finally(() => { active--; drain(); });
        }
    }
    return {
        add(item, updated) {
            if (item.coverage && !item.coverage.failed) return;
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

function catalog() { searchView(); }

function searchView(preset) {
    const artwork = preset && (preset.work.bannerImage || preset.work.coverImage?.large);
    const page = begin(artwork, preset ? 'recommendations' : 'catalog');
    const reopen = preset ? () => searchView(preset) : catalog;
    const compareResults = preset
        ? (a, b) => Number(b.relevance === 3) - Number(a.relevance === 3) || compareAvailability(a, b)
        : compareAvailability;
    const form = el('form');
    const input = field('search', 'Título do mangá, manhwa ou webtoon');
    input.required = true;
    input.maxLength = 150;
    input.value = preset?.query ?? lastQuery;
    const submit = el('button', 'Buscar', 'primary');
    submit.type = 'submit';
    const cancel = button('Parar busca', () => controller?.abort());
    cancel.hidden = true;
    const scope = el('select');
    const adultLabel = button('+18', () => {
        includeAdult = !includeAdult;
        adultLabel.setAttribute('aria-pressed', String(includeAdult));
        localStorage.setItem('manga-include-adult', includeAdult ? 'yes' : 'no');
        if (input.value.trim()) form.requestSubmit();
    }, 'adult-toggle');
    adultLabel.setAttribute('aria-label', 'Incluir fontes para maiores de 18 anos');
    adultLabel.setAttribute('aria-pressed', String(includeAdult));
    scope.setAttribute('aria-label', 'Fontes consultadas na busca');
    for (const [value, label] of [['active', 'Fontes ativadas'], ['installed', 'Todas as instaladas']]) {
        const option = el('option', label);
        option.value = value;
        scope.append(option);
    }
    scope.value = preset ? 'installed' : searchScope;
    scope.hidden = Boolean(preset);
    scope.onchange = () => {
        searchScope = scope.value;
        localStorage.setItem('manga-search-scope', searchScope);
        if (input.value.trim()) form.requestSubmit();
    };
    form.append(input, scope, submit, cancel, adultLabel);
    const status = el('p', 'Os primeiros capítulos com imagem verificada aparecem primeiro.', 'muted');
    status.setAttribute('role', 'status');
    const groups = el('div');
    if (preset) {
        view.append(recommendationHero(preset), el('h2', 'Escolha uma fonte'));
        window.scrollTo(0, 0);
        if (preset.alternate) {
            const alternate = button('Buscar como ' + preset.alternate, () => {
                [input.value, preset.alternate] = [preset.alternate, preset.query];
                alternate.textContent = 'Buscar como ' + preset.alternate;
                form.requestSubmit();
            });
            form.append(alternate);
        }
        view.append(form);
    } else {
        const heading = introHero('BUSCAR', 'Mangás, manhwas e webtoons',
            'Encontre uma obra nas suas fontes e escolha a edição para ler.');
        heading.details.append(form);
        view.append(heading.panel);
    }
    view.append(status, groups);
    let controller;
    let inspections = coverageQueue();
    const views = new Map();
    let result = preset ? preset.result : lastResults;
    let searching = false;
    dispose = () => { controller?.abort(); inspections.stop(); };

    function reorderGroups() {
        const ordered = [...views.values()].filter(group => group.first)
            .sort((a, b) => compareResults(a.first, b.first));
        ordered.forEach(({ section }, index) => {
            if (groups.children[index] !== section) groups.insertBefore(section, groups.children[index] || null);
        });
    }

    function renderGroup(group) {
        const section = el('section', '', 'result-group');
        const heading = el('div', '', 'controls');
        heading.append(el('h2', sourceLabel(group.source)),
            button('Buscar nesta fonte', () => sourceCatalog(group.source, input.value.trim(), reopen)));
        const cards = el('div', '', 'grid');
        const view = { section, first: group.rows[0] };
        views.set(group, view);
        const items = group.rows.map(item => {
            const edition = artwork && item.relevance === 3 ? { ...item, artwork } : item;
            const card = workCard(edition, reopen);
            const note = el('small', coverageLabel(item.coverage), 'chapter-coverage');
            card.append(note);
            return { item, card, note };
        });
        const more = button('Mostrar todos (' + group.rows.length + ')', () => {
            group.expanded = true;
            fill();
        });
        function fill() {
            items.sort((a, b) => compareResults(a.item, b.item));
            const available = items.filter(({ item }) => item.coverage?.count !== 0);
            view.first = available[0]?.item;
            if (!view.first) section.remove();
            const rows = group.expanded ? available : available.slice(0, 6);
            rows.forEach(({ card }, index) => {
                if (cards.children[index] !== card) cards.insertBefore(card, cards.children[index] || null);
            });
            while (cards.children.length > rows.length) cards.lastElementChild.remove();
            more.textContent = 'Mostrar todos (' + available.length + ')';
            more.hidden = group.expanded || rows.length === available.length;
            reorderGroups();
        }
        section.append(heading, cards, more);
        fill();
        for (const { item, note } of items) {
            inspections.add(item, () => {
                if (item.coverage.count !== 0) note.textContent = coverageLabel(item.coverage);
                fill();
                if (result) updateStatus(result, searching);
            });
        }
    }

    function updateStatus(result, searching) {
        const counts = result.groups.map(group => group.rows.filter(item => item.coverage?.count !== 0).length);
        const count = counts.reduce((total, size) => total + size, 0);
        const summary = count + ' título(s) em ' + counts.filter(Boolean).length + ' fonte(s).';
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

    if (result) {
        result.groups.forEach(renderGroup);
        updateStatus(result, false);
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
        if (preset) preset.query = query;
        else lastQuery = query;
        const currentResult = { groups: [], total: null, completed: 0, failed: 0, unavailable: 0 };
        result = currentResult;
        searching = true;
        if (preset) preset.result = result;
        else lastResults = result;
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
            if (controller === current && page === screen) updateStatus(currentResult, false);
        } catch {
            if (controller === current && page === screen) {
                status.textContent = current.signal.aborted
                    ? 'Busca interrompida. Os resultados já encontrados continuam abaixo.'
                    : 'A busca foi interrompida. Tente novamente.';
            }
        } finally {
            if (controller === current) {
                searching = false;
                cancel.hidden = true;
            }
        }
    };
    if (preset && (!result || result.completed < result.total || result.total === null)) form.requestSubmit();
}

function artImage(url, className) {
    const art = el('img', '', className);
    art.src = url;
    art.alt = '';
    art.setAttribute('aria-hidden', 'true');
    art.onerror = () => art.remove();
    return art;
}

function tabArtwork() { return trendingArt[themeOrder.indexOf(themeTab) % trendingArt.length]; }

function refreshAmbient() {
    const url = selectedArt ?? tabArtwork();
    if (ambient.dataset.artwork === (url || '')) return;
    ambient.dataset.artwork = url || '';
    ambient.replaceChildren();
    if (!url) return;
    const image = artImage(url, 'ambient-image');
    image.onerror = () => {
        if (!image.isConnected) return;
        image.remove();
        if (themeTab !== 'manga-home' && themeTab !== 'library' && selectedArt && tabArtwork() && tabArtwork() !== url)
            ambient.append(artImage(tabArtwork(), 'ambient-image'));
    };
    ambient.append(image);
}

function introHero(kicker, title, copy) {
    const panel = el('section', '', 'recommendation-hero screen-hero');
    panel.dataset.themeArt = themeTab;
    addThemeBanner(panel);
    const content = el('div', '', 'recommendation-info');
    const details = el('div');
    details.append(el('small', kicker, 'hero-kicker'), el('h1', title));
    if (copy) details.append(el('p', copy, 'muted'));
    content.append(details);
    panel.append(content);
    return { panel, details };
}

function addThemeBanner(panel) {
    if (!trendingArt.length || panel.querySelector('.recommendation-banner')) return;
    const artwork = trendingArt[themeOrder.indexOf(panel.dataset.themeArt) % trendingArt.length];
    if (artwork) panel.prepend(artImage(artwork, 'recommendation-banner'));
}

function recommendationHero({ work, back }) {
    const hero = el('section', '', 'recommendation-hero');
    const banner = work.bannerImage || work.coverImage?.large;
    if (banner) hero.append(artImage(banner, 'recommendation-banner'));
    const close = button('×', back, 'recommendation-close');
    close.setAttribute('aria-label', 'Voltar aos recomendados');
    hero.append(close);
    const content = el('div', '', 'recommendation-info');
    if (work.coverImage?.large) content.append(artImage(work.coverImage.large, 'work-cover'));
    const details = el('div');
    const meta = [work.startDate?.year, ...(work.genres || []).slice(0, 5)].filter(Boolean).join(' · ');
    details.append(el('small', 'EM ALTA NO ANILIST'), el('h1', work.title.english || work.title.romaji),
        el('p', meta, 'muted'));
    if (work.description) {
        const description = work.description.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').trim();
        const synopsis = el('details', '', 'work-description');
        synopsis.append(el('summary', 'Sinopse do AniList'), el('p', description));
        synopsis.open = true;
        details.append(synopsis);
    }
    content.append(details);
    hero.append(content);
    return hero;
}

function recommendations(state = { rows: [], next: 1, scroll: 0 }) {
    const page = begin(undefined, 'recommendations');
    const controller = new AbortController();
    const heading = introHero('ANILIST · TRENDING MANGA', 'Recomendados',
        'Descubra o que está em alta e encontre uma fonte para ler.');
    const dice = button('⚄', surprise, 'recommendation-dice');
    dice.setAttribute('aria-label', 'Sortear uma obra');
    dice.title = 'Sortear uma obra';
    dice.disabled = !state.rows.length;
    heading.panel.append(dice);
    const cards = el('div', '', 'grid recommendations-grid');
    const status = el('p', '', 'muted');
    status.setAttribute('role', 'status');
    const more = button('Carregar mais', load, 'load-recommendations');
    view.append(heading.panel, cards, status, more);
    const seen = new Set(state.rows.map(work => work.id));
    let loading = false;
    let failed = false;
    const observer = new IntersectionObserver(changes => {
        if (!failed && changes.some(change => change.isIntersecting)) load();
    }, { rootMargin: '500px' });
    dispose = () => { controller.abort(); observer.disconnect(); };
    const back = () => recommendations(state);
    function read(work) {
        state.scroll = window.scrollY;
        const title = work.title.english || work.title.romaji;
        const alternate = work.title.romaji && work.title.romaji !== title ? work.title.romaji.slice(0, 150) : '';
        searchView({ work, back, query: title.slice(0, 150), alternate });
    }
    function surprise() {
        const dialog = el('dialog', '', 'recommendation-preview');
        dialog.setAttribute('aria-label', 'Obra sorteada');
        const close = () => dialog.close();
        dialog.addEventListener('close', () => dialog.remove(), { once: true });
        let previous;
        function roll() {
            const candidates = state.rows.filter(work =>
                (work.title.english || work.title.romaji) && work.id !== previous);
            if (!candidates.length) return;
            const work = candidates[Math.floor(Math.random() * candidates.length)];
            previous = work.id;
            const hero = recommendationHero({ work, back: close });
            hero.querySelector('.recommendation-close').setAttribute('aria-label', 'Fechar prévia');
            const controls = el('div', '', 'controls');
            const reroll = button('⚄ Sortear outra', roll);
            reroll.disabled = state.rows.length < 2;
            controls.append(button('Começar leitura', () => { close(); read(work); }, 'primary'), reroll);
            hero.querySelector('.recommendation-info > div').append(controls);
            dialog.replaceChildren(hero);
            if (dialog.open) reroll.focus();
        }
        roll();
        view.append(dialog);
        dialog.showModal();
    }
    function add(work) {
        const title = work.title.english || work.title.romaji;
        if (!title) return;
        const card = workCard({ title, cover: work.coverImage?.large }, back, () => read(work));
        cards.append(card);
    }
    state.rows.forEach(add);
    more.hidden = state.next === null;
    window.scrollTo(0, state.scroll);
    if (!more.hidden) observer.observe(more);

    async function load() {
        if (loading || state.next === null || page !== screen) return;
        loading = true;
        failed = false;
        more.disabled = true;
        status.textContent = 'Carregando obras do AniList…';
        observer.unobserve(more);
        try {
            const data = await api('trending', { page: state.next }, controller.signal);
            if (page !== screen) return;
            for (const work of data.rows) {
                if (seen.has(work.id) || !(work.title.english || work.title.romaji)) continue;
                seen.add(work.id);
                state.rows.push(work);
                add(work);
            }
            state.next = data.more ? state.next + 1 : null;
            dice.disabled = !state.rows.length;
            more.hidden = state.next === null;
            status.textContent = state.rows.length ? '' : 'Nenhuma recomendação disponível.';
        } catch {
            if (page !== screen) return;
            failed = true;
            status.textContent = 'O AniList está indisponível agora.';
        } finally {
            if (page === screen) {
                loading = more.disabled = false;
                more.textContent = failed ? 'Tentar novamente' : 'Carregar mais';
                if (!failed && !more.hidden) observer.observe(more);
            }
        }
    }
}

function sourceCatalog(source, initialQuery = '', back = settings) {
    const page = begin(undefined, 'sources');
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
    const heading = introHero('CATÁLOGO DA FONTE', source.name, sourceLabel(source));
    heading.details.append(form);
    view.append(button('← Voltar', back), heading.panel, status, cards, more);

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
                        if (item.coverage.count === 0) card.remove();
                        else note.textContent = coverageLabel(item.coverage);
                        inspected.sort((a, b) => compareAvailability(a.item, b.item));
                        const available = inspected.filter(({ item }) => item.coverage?.count !== 0);
                        available.forEach(({ card: tile }, index) => {
                            if (cards.children[index] !== tile) cards.insertBefore(tile, cards.children[index] || null);
                        });
                        status.textContent = available.length ? available.length + ' título(s).' :
                            'Nenhum título com capítulos nesta página.';
                    });
                }
            }
            position = data.rows.length && !added ? null : data.next;
            status.textContent = cards.children.length ? cards.children.length + ' título(s).' :
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
    const page = begin(undefined, 'sources');
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
    const heading = introHero('GERENCIAR CATÁLOGOS', 'Fontes',
        'Instale e organize as fontes disponíveis para sua leitura.');
    view.append(heading.panel, tabs, filters, actions, summary, status, repoPanel, list);

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

async function chapters(item, back = catalog, loaded, previousQuery = '', openId, openPage) {
    const artwork = item.artwork || item.cover || savedCover(item);
    const page = begin(artwork);
    const status = el('p', 'Carregando capítulos…', 'muted');
    const filter = field('search', 'Filtrar capítulos por número ou título');
    filter.value = previousQuery;
    let ascending = localStorage.getItem('manga-chapter-order') === 'ascending';
    const order = button('', () => {
        ascending = !ascending;
        localStorage.setItem('manga-chapter-order', ascending ? 'ascending' : 'descending');
        refreshOrder();
        filter.dispatchEvent(new Event('input'));
    }, 'chapter-order');
    function refreshOrder() {
        order.textContent = ascending ? '↑' : '↓';
        const label = ascending ? 'Ordem crescente. Mudar para decrescente' : 'Ordem decrescente. Mudar para crescente';
        order.title = label;
        order.setAttribute('aria-label', label);
    }
    refreshOrder();
    const filters = el('div', '', 'chapter-filters');
    filters.hidden = true;
    filters.append(filter, order);
    const list = el('div', '', 'list');
    const hero = el('section', '', 'work-hero recommendation-hero');
    hero.append(artImage(artwork, 'recommendation-banner work-banner'));
    const cover = el('img', '', 'work-cover');
    cover.src = item.cover || savedCover(item);
    cover.alt = 'Capa de ' + item.title;
    cover.onerror = () => cover.replaceWith(el('div', '', 'work-cover'));
    const info = el('div', '', 'work-info');
    let details = loaded;
    const favorite = button('', () => {
        updateWork(item, work => {
            work.inLibrary = !work.inLibrary;
            if (details) work.chapters = details.chapters;
            work.updatedAt = Date.now();
        });
        refreshFavorite();
    }, 'primary');
    function refreshFavorite() {
        const active = !!savedWork(item)?.inLibrary;
        favorite.textContent = active ? '♥ Na biblioteca' : '♡ Adicionar à biblioteca';
        favorite.setAttribute('aria-pressed', String(active));
    }
    refreshFavorite();
    info.append(el('h1', item.title), el('p', sourceLabel(item.source), 'muted'), favorite);
    hero.append(cover, info);
    view.append(button('← Voltar aos títulos', back), hero, el('h2', 'Capítulos'), status, filters, list);
    window.scrollTo(0, 0);
    try {
        details ??= await api('work', { engine: item.source.engine, id: item.id, title: item.title });
        if (page !== screen) return;
        const entries = details.chapters;
        if (savedWork(item)) updateWork(item, work => { work.chapters = entries; });
        if (details.author) info.append(el('p', details.author, 'work-author'));
        if (details.description?.trim()) {
            const synopsis = el('details', '', 'work-description');
            synopsis.append(el('summary', 'Sinopse'), el('p', details.description.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')));
            synopsis.open = true;
            info.append(synopsis);
        }
        if (details.genres?.length) {
            const tags = el('div', '', 'work-tags');
            for (const genre of details.genres) tags.append(el('span', genre));
            info.append(tags);
        }
        filters.hidden = !entries.length;
        const returnToList = () => chapters(item, back, details, filter.value);
        const openIndex = openId == null ? -1 : entries.findIndex(entry => String(entry.id) === String(openId));
        if (openIndex >= 0) { reader(item, entries, openIndex, returnToList, openPage); return; }
        const progress = savedWork(item)?.lastChapter;
        const resumeIndex = progress ? entries.findIndex(entry => String(entry.id) === String(progress.id)) : -1;
        if (resumeIndex >= 0) {
            const label = '▶ Continuar · ' + (progress.name || 'Capítulo') + ' · Página ' + ((progress.page ?? 0) + 1);
            favorite.after(button(label, () => reader(item, entries, resumeIndex, returnToList, progress.page), 'resume-reading'));
        }
        function showChapters() {
            const matched = findChapters(entries, filter.value);
            if (ascending) matched.reverse();
            const marks = savedWork(item)?.read || {};
            status.textContent = !entries.length ? 'Nenhum capítulo disponível.' :
                matched.length + ' de ' + entries.length + ' capítulo(s).';
            list.replaceChildren();
            const fragment = document.createDocumentFragment();
            for (const { entry, index } of matched) {
                const row = el('div', '', 'chapter-row');
                const isRead = !!marks[String(entry.id)];
                if (isRead) row.classList.add('chapter-read');
                const open = button(entry.name, () => reader(item, entries, index, returnToList), 'chapter-open');
                const mark = button('', () => {
                    updateWork(item, work => {
                        work.read ||= {};
                        work.read[String(entry.id)] = !isRead;
                        work.updatedAt = Date.now();
                    });
                    showChapters();
                }, 'chapter-mark');
                mark.append(el('span', '', 'bookmark-icon'));
                mark.setAttribute('aria-label', isRead ? 'Marcar ' + entry.name + ' como não lido' : 'Marcar ' + entry.name + ' como lido');
                mark.setAttribute('aria-pressed', String(isRead));
                row.append(open, mark);
                fragment.append(row);
            }
            if (entries.length && !matched.length)
                fragment.append(el('small', 'Nenhum capítulo corresponde ao filtro.'));
            list.append(fragment);
        }
        filter.oninput = showChapters;
        showChapters();
    } catch { if (page === screen) errorText(status, 'Não foi possível carregar os capítulos. Tente novamente.'); }
}

const models = {
    realcugan: 'Real-CUGAN 2×',
    realesrgan: 'Real-ESRGAN Anime 4×',
    S: 'Anime4K Leve (S)',
    M: 'Anime4K Médio (M)',
    L: 'Anime4K Pesado (L)'
};
const nativeScales = { realcugan: 2, realesrgan: 4 };
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

async function reader(item, entries, index, returnToList, resumePage = 0) {
    const page = begin(item.artwork || item.cover || savedCover(item));
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
    const heading = el('div', '', 'reader-heading');
    heading.append(el('h1', chapter.name), el('p', item.title + ' · ' + sourceLabel(item.source), 'muted'), status);
    content.append(heading, pages);
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
    const model = readerSelect('Modelo de upscale', [['off', 'Desligado'], ...Object.entries(models)],
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
    const figures = [];
    let upcoming = [];
    let lastPage;
    let restoring = false;
    let trackingFrame = 0;
    const cache = new Map();
    let cacheBytes = 0;
    let generation = 0;
    let activeJob;
    let scheduled = false;

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
            } else near.delete(change.target);
        }
        scheduleTracking();
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
        window.removeEventListener('scroll', scheduleTracking);
        window.removeEventListener('resize', scheduleTracking);
        cancelAnimationFrame(trackingFrame);
        activeJob?.abort();
        for (const { url } of cache.values()) URL.revokeObjectURL(url);
    };
    window.addEventListener('scroll', scheduleTracking, { passive: true });
    window.addEventListener('resize', scheduleTracking);

    function scheduleTracking() {
        if (trackingFrame || page !== screen) return;
        trackingFrame = requestAnimationFrame(() => {
            trackingFrame = 0;
            trackPage();
        });
    }
    function trackPage() {
        if (restoring || page !== screen) return;
        const top = document.querySelector('header').getBoundingClientRect().bottom;
        const bottom = window.innerHeight;
        const center = (top + bottom) / 2;
        let visible;
        let best = Infinity;
        for (const figure of near) {
            const rect = figure.getBoundingClientRect();
            if (rect.bottom <= top || rect.top >= bottom) continue;
            if (Math.min(rect.bottom, bottom) - Math.max(rect.top, top) >= 32) figure.loadPage();
            const distance = Math.max(rect.top - center, center - rect.bottom, 0);
            if (distance < best) {
                best = distance;
                visible = figure;
            }
        }
        if (!visible) return;
        visible.loadPage();
        const number = visible.pageNumber;
        if (visible.ready && number !== lastPage) {
            lastPage = number;
            status.textContent = 'Página ' + (number + 1) + ' de ' + figures.length;
            updateWork(item, work => {
                work.lastChapter = { id: String(chapter.id), name: chapter.name, page: number };
                work.chapters = entries;
                work.lastReadAt = work.updatedAt = Date.now();
            });
        }
        upcoming = figures.slice(number, number + 4);
        if (upscaleModel !== 'off') {
            for (const figure of upcoming) figure.loadPage();
            scheduleUpscale();
        }
    }

    function updateControls() {
        const anime4k = upscaleModel !== 'off' && !nativeScales[upscaleModel];
        passes.hidden = colorLabel.hidden = !anime4k;
    }
    function updateUpscale() {
        localStorage.setItem('manga-upscale-model', upscaleModel);
        localStorage.setItem('manga-upscale-repetitions', String(repetitions));
        localStorage.setItem('manga-upscale-color', refineColor ? 'yes' : 'no');
        updateControls();
        generation++;
        activeJob?.abort();
        upscaleStatus.textContent = '';
        if (upscaleModel === 'off') {
            for (const figure of figures) showOriginal(figure);
        } else {
            scheduleTracking();
        }
    }
    function showOriginal(figure) {
        figure.enhancedImage?.remove();
        figure.enhancedImage = undefined;
        figure.displayed = undefined;
        figure.image.hidden = !figure.ready;
    }
    function scheduleUpscale() {
        if (scheduled || activeJob || page !== screen || upscaleModel === 'off') return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            processNext();
        });
    }
    function trimCache() {
        for (const [key, value] of cache) {
            if (cacheBytes <= 96 * 1024 * 1024 && cache.size <= 24) break;
            if (value.figure.displayed === key) {
                if (near.has(value.figure) || upcoming.includes(value.figure)) continue;
                showOriginal(value.figure);
            }
            cache.delete(key);
            cacheBytes -= value.bytes;
            URL.revokeObjectURL(value.url);
        }
    }
    async function processNext() {
        if (page !== screen || activeJob || upscaleModel === 'off') return;
        const modelName = upscaleModel;
        const scale = nativeScales[modelName];
        const variant = scale ? modelName : [modelName, repetitions, refineColor].join(':');
        const keyFor = figure => figure.original + ':' + variant;
        const figure = upcoming.find(figure => !figure.loadFailed &&
            figure.displayed !== keyFor(figure) && figure.failedGeneration !== generation);
        if (!figure?.ready) return;
        const key = keyFor(figure);
        const current = generation;
        const job = new AbortController();
        activeJob = job;
        const stillNeeded = () => page === screen && generation === current && !job.signal.aborted;
        try {
            let output = cache.get(key);
            if (output) cache.delete(key);
            else {
                upscaleStatus.textContent = 'Processando página ' + (figure.pageNumber + 1) + ' · ' + models[modelName] + '…';
                const result = scale ? await upscaleNative(figure.image, modelName, scale, job.signal) :
                    await upscaleImage(figure.image, modelName, repetitions, refineColor, stillNeeded);
                if (!result || !stillNeeded()) return;
                output = { figure, url: URL.createObjectURL(result.blob), bytes: result.blob.size,
                    text: result.width + ' × ' + result.height + ' px · ' + models[modelName] +
                        (!scale && result.passes < repetitions ? ' (limite da página)' : '') };
                cacheBytes += output.bytes;
            }
            cache.set(key, output);
            const enhanced = el('img');
            enhanced.alt = figure.image.alt;
            enhanced.src = output.url;
            await enhanced.decode();
            if (!stillNeeded() || !upcoming.includes(figure)) return;
            figure.image.hidden = true;
            figure.enhancedImage?.remove();
            figure.enhancedImage = enhanced;
            figure.displayed = key;
            figure.prepend(enhanced);
            upscaleStatus.textContent = 'Página ' + (figure.pageNumber + 1) + ' · ' + output.text;
        } catch (error) {
            if (stillNeeded()) {
                figure.failedGeneration = current;
                upscaleStatus.textContent = error.message;
            }
        } finally {
            trimCache();
            activeJob = undefined;
            scheduleUpscale();
        }
    }

    setZoom(zoom);
    updateControls();
    try {
        const urls = await api('pages', { engine: item.source.engine, id: chapter.id });
        if (page !== screen) return;
        const completion = new IntersectionObserver(changes => {
            if (page !== screen || !changes.some(change => change.isIntersecting)) return;
            updateWork(item, work => { work.read[String(chapter.id)] = true; work.updatedAt = Date.now(); });
            completion.disconnect();
        });
        const release = dispose;
        dispose = () => { completion.disconnect(); release(); };
        const resumeIndex = Math.max(0, Math.min(urls.length - 1, Number.isInteger(resumePage) ? resumePage : 0));
        restoring = resumeIndex > 0;
        const end = el('div', 'Fim do capítulo', 'chapter-end');
        end.hidden = true;
        status.textContent = urls.length ? urls.length + ' página(s)' : 'Nenhuma página disponível.';
        urls.forEach((url, i) => {
            const figure = el('figure', '', 'page pending-page');
            figure.pageNumber = i;
            figures.push(figure);
            const image = el('img');
            image.alt = 'Página ' + (i + 1);
            image.hidden = true;
            const retry = button('Tentar carregar a página ' + (i + 1), () => {
                figure.started = false;
                figure.loadFailed = false;
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
                figure.classList.remove('pending-page');
                if (restoring && i === resumeIndex && page === screen) {
                    figure.scrollIntoView({ block: 'start' });
                    restoring = false;
                }
                if (page === screen && i === urls.length - 1) {
                    end.hidden = false;
                    completion.observe(end);
                }
                scheduleTracking();
            };
            image.onerror = () => {
                figure.ready = false;
                figure.loadFailed = true;
                figure.classList.remove('pending-page');
                image.hidden = true;
                retry.hidden = false;
                if (i === resumeIndex) restoring = false;
                scheduleTracking();
            };
            figure.append(image, retry);
            pages.append(figure);
            observer.observe(figure);
        });
        if (urls.length) pages.append(end);
        if (restoring) {
            const target = figures[resumeIndex];
            target.scrollIntoView({ block: 'start' });
            target.loadPage();
        }
        scheduleTracking();
    } catch { if (page === screen) errorText(status, 'Não foi possível carregar as páginas. Tente novamente.'); }
}

document.querySelector('#home').onclick = () => window.chrome?.webview?.postMessage('manga-close');
document.querySelector('#catalog').onclick = catalog;
document.querySelector('#manga-home').onclick = () => library(true);
document.querySelector('#library').onclick = () => library(false);
document.querySelector('#recommendations').onclick = () => recommendations();
document.querySelector('#sources').onclick = settings;
library(true);
api('trending', { page: 1 }).then(({ rows }) => {
    trendingArt = rows.map(work => work.bannerImage).filter(Boolean).slice(0, themeOrder.length);
    if (!trendingArt.length) trendingArt = rows.map(work => work.coverImage?.large).filter(Boolean).slice(0, themeOrder.length);
    refreshAmbient();
    view.querySelectorAll('[data-theme-art]').forEach(addThemeBanner);
}).catch(() => {});
