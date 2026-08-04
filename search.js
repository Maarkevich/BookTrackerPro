// ─────────────────────────────────────────────
// 📦 BookTrackerPro — search.js
// 🔖 v3.6.0 | 2026-08-04
// 📝 Глобальный поиск (полная переработка)
//
//    Архитектура:
//      — Самостоятельный модуль, не зависит от глобального S
//      — Явное состояние open (фикс бага «лупа не работает»)
//      — Данные и навигация приходят через config (инверсия зависимостей)
//      — Автозакрытие при навигации — app.js вызывает closeSearch()
//
//    Скоупы: Всё / Книги / Контент / Отзывы / Цитаты /
//            Подборки / Челленджи / Серии / Теги
//
//    Клавиатура: ↑ ↓ — навигация · Enter — открыть · Esc — закрыть
//
//    Новое в 3.6.0:
//      — esc импортируется из utils.js (разрыв цикла)
//      — Обложки: referrerpolicy no-referrer + onerror-фолбэк
//        на генеративный плейсхолдер (фикс «в поиске не видно обложек»)
// ─────────────────────────────────────────────
import { esc } from './utils.js';
import { icon, contentTypeIcon } from './icons.js';

// ═══════════════════════════════════════════════
//  КОНФИГУРАЦИЯ СКОУПОВ
// ═══════════════════════════════════════════════
const SCOPES = [
{ id: 'all',         ic: 'search',   label: 'Всё' },
{ id: 'books',       ic: 'bookOpen', label: 'Книги' },
{ id: 'content',     ic: 'film',     label: 'Контент' },
{ id: 'reviews',     ic: 'pen',      label: 'Отзывы' },
{ id: 'quotes',      ic: 'quote',    label: 'Цитаты' },
{ id: 'collections', ic: 'folder',   label: 'Подборки' },
{ id: 'challenges',  ic: 'trophy',   label: 'Челленджи' },
{ id: 'series',      ic: 'layers',   label: 'Серии' },
{ id: 'tags',        ic: 'tag',      label: 'Теги' },
];

// ═══════════════════════════════════════════════
//  СОСТОЯНИЕ (приватное, не глобальное)
// ═══════════════════════════════════════════════
let cfg = null;          // config из initSearch
let D = {};              // DOM-ссылки
let open = false;        // явный флаг открытости
let query = '';
let scope = 'all';       // запоминается между сессиями поиска
let tag = null;          // выбранный книжный тег (скоуп «Книги»)
let activeIdx = -1;      // активный результат для клавиатуры
let debounceTimer = null;

// ═══════════════════════════════════════════════
//  1. ИНИЦИАЛИЗАЦИЯ
// ═══════════════════════════════════════════════
/**
* Подключает поиск. Вызывается один раз из app.js.
*
* @param {object} config
* @param {function} config.getData — () => ({ books, collections, challenges, tags, series })
* @param {function} config.onOpenBook       — (bookId) => void
* @param {function} config.onOpenContent    — (bookId, contentId) => void
* @param {function} config.onOpenCollection — (id) => void
* @param {function} config.onOpenChallenge  — (id) => void
* @param {function} config.onOpenSeries     — (name) => void
* @param {function} config.onFilterTag      — (tagName) => void
*/
export function initSearch(config) {
if (cfg) return; // защита от двойной инициализации
cfg = config;
D = {
toggle:  document.getElementById('search-toggle'),
bar:     document.getElementById('search-bar'),
input:   document.getElementById('search-input'),
close:   document.getElementById('search-close'),
scopes:  document.getElementById('search-scopes'),
tags:    document.getElementById('search-book-tags'),
results: document.getElementById('search-results'),
main:    document.getElementById('main-content'),
};
D.toggle.addEventListener('click', toggleSearch);
D.close.addEventListener('click', closeSearch);
D.input.addEventListener('input', onInput);
D.input.addEventListener('keydown', onKeydown);
}

// ═══════════════════════════════════════════════
//  2. ОТКРЫТИЕ / ЗАКРЫТИЕ
// ═══════════════════════════════════════════════
export function toggleSearch() {
open ? closeSearch() : openSearch();
}
export function isSearchOpen() {
return open;
}
export function openSearch() {
if (open) return;
open = true;
activeIdx = -1;
D.bar.classList.remove('hidden');
renderScopes();
renderTags();
run();
// Фокус с небольшой задержкой — чтобы slideDown-анимация не дёргалась
requestAnimationFrame(() => D.input.focus());
}
/**
* Закрывает поиск и сбрасывает запрос.
* app.js вызывает это при любой навигации (renderTab, переходы).
*/
export function closeSearch() {
if (!open) return;
open = false;
activeIdx = -1;
D.bar.classList.add('hidden');
D.results.classList.add('hidden');
D.main.classList.remove('hidden');
D.input.value = '';
query = '';
tag = null;
// scope намеренно НЕ сбрасываем — запоминаем выбор пользователя
}

// ═══════════════════════════════════════════════
//  3. ВВОД И КЛАВИАТУРА
// ═══════════════════════════════════════════════
function onInput() {
clearTimeout(debounceTimer);
debounceTimer = setTimeout(() => {
query = D.input.value.trim().toLowerCase();
activeIdx = -1;
run();
}, 220);
}
function onKeydown(e) {
if (e.key === 'Escape') {
closeSearch();
return;
}
const items = [...D.results.querySelectorAll('.sr-item')];
if (!items.length) return;
if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
e.preventDefault();
activeIdx = e.key === 'ArrowDown'
? (activeIdx + 1) % items.length
: (activeIdx - 1 + items.length) % items.length;
items.forEach((el, i) => el.classList.toggle('active', i === activeIdx));
items[activeIdx]?.scrollIntoView({ block: 'nearest' });
}
if (e.key === 'Enter' && activeIdx >= 0) {
items[activeIdx]?.click();
}
}

// ═══════════════════════════════════════════════
//  4. СКОУПЫ И ТЕГИ
// ═══════════════════════════════════════════════
function renderScopes() {
D.scopes.innerHTML = SCOPES.map(s => `
<button class="scope-chip ${scope === s.id ? 'active' : ''}" data-scope="${s.id}">
${icon(s.ic, 13)} ${s.label}
</button>
`).join('');
D.scopes.querySelectorAll('[data-scope]').forEach(chip => {
chip.addEventListener('click', () => {
scope = chip.dataset.scope;
if (scope !== 'books') tag = null;
activeIdx = -1;
renderScopes();
renderTags();
run();
});
});
}
function renderTags() {
if (scope !== 'books') {
D.tags.classList.add('hidden');
D.tags.innerHTML = '';
return;
}
const tags = cfg.getData().tags || [];
D.tags.classList.remove('hidden');
if (!tags.length) {
D.tags.innerHTML = '<span class="text-small text-muted" style="padding:2px 4px">Тегов пока нет — добавьте в форме книги</span>';
return;
}
D.tags.innerHTML = tags.map(t => `
<button class="booktag-chip ${tag === t.name ? 'active' : ''}"
data-booktag="${esc(t.name)}"
style="color:${t.color || 'var(--text-secondary)'};border-color:${(t.color || '#888')}55">
${icon('tag', 11)} ${esc(t.name)}
</button>
`).join('');
D.tags.querySelectorAll('[data-booktag]').forEach(chip => {
chip.addEventListener('click', () => {
tag = tag === chip.dataset.booktag ? null : chip.dataset.booktag;
activeIdx = -1;
renderTags();
run();
});
});
}

// ═══════════════════════════════════════════════
//  5. ПОИСК (сбор результатов)
// ═══════════════════════════════════════════════
function matchesBook(b, q) {
if (!q) return true;
return b.title.toLowerCase().includes(q) ||
b.author.toLowerCase().includes(q) ||
(b.isbn || '').includes(q) ||
(b.genre || '').toLowerCase().includes(q) ||
(b.publisher || '').toLowerCase().includes(q) ||
(b.series || '').toLowerCase().includes(q) ||
(b.tags || []).some(t => t.toLowerCase().includes(q));
}
function run() {
const { books, collections, challenges, tags, series } = cfg.getData();
const hasQuery = !!query || !!tag;
const r = {
books: [], content: [], reviews: [], quotes: [],
collections: [], challenges: [], series: [], tags: [],
};
if (hasQuery) {
if (scope === 'all' || scope === 'books') {
r.books = books.filter(b => matchesBook(b, query));
if (tag) r.books = r.books.filter(b => (b.tags || []).includes(tag));
}
if (scope === 'all' || scope === 'content') {
for (const b of books) for (const c of (b.contentItems || [])) {
if (!query || (c.title || '').toLowerCase().includes(query) || b.title.toLowerCase().includes(query)) {
r.content.push({ ...c, bookId: b.id, bookTitle: b.title });
}
}
}
if (scope === 'all' || scope === 'reviews') {
r.reviews = books.filter(b => {
const rv = b.review || {};
if (!(rv.text || rv.rating > 0)) return false;
if (!query) return true;
return (rv.text || '').toLowerCase().includes(query) ||
(rv.pros || '').toLowerCase().includes(query) ||
(rv.cons || '').toLowerCase().includes(query) ||
b.title.toLowerCase().includes(query);
});
}
if (scope === 'all' || scope === 'quotes') {
for (const b of books) for (const qt of (b.review?.quotes || [])) {
if (!query || qt.text.toLowerCase().includes(query)) {
r.quotes.push({ ...qt, bookId: b.id, bookTitle: b.title });
}
}
}
if (scope === 'all' || scope === 'collections') {
r.collections = collections.filter(c => !query || c.name.toLowerCase().includes(query));
}
if (scope === 'all' || scope === 'challenges') {
r.challenges = challenges.filter(c => !query || c.name.toLowerCase().includes(query));
}
if (scope === 'all' || scope === 'series') {
r.series = series.filter(s => !query || s.name.toLowerCase().includes(query));
}
if (scope === 'all' || scope === 'tags') {
r.tags = tags.filter(t => !query || t.name.toLowerCase().includes(query));
}
}
render(r, hasQuery);
}

// ═══════════════════════════════════════════════
//  6. РЕНДЕР РЕЗУЛЬТАТОВ
// ═══════════════════════════════════════════════
function render(r, hasQuery) {
D.results.classList.remove('hidden');
D.main.classList.add('hidden');
if (!hasQuery) {
D.results.innerHTML = `
<div class="search-hint">
${icon('search', 26)}
<div>Начните вводить — поиск идёт по всем разделам сразу</div>
</div>`;
return;
}
const total = Object.values(r).reduce((s, arr) => s + arr.length, 0);
if (total === 0) {
D.results.innerHTML = `
<div class="search-hint">
${icon('search', 26)}
<div>Ничего не найдено${query ? ` по «${esc(query)}»` : ''}</div>
</div>`;
return;
}
let html = '';
if (r.books.length) {
html += section('Книги', 'bookOpen', r.books.length, r.books.map(b => `
<div class="sr-item" data-sr-book="${b.id}" tabindex="0">
${b.coverUrl
? `<img class="sr-cover" src="${b.coverUrl}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML=window.__srCoverFallback(this,'${b.id}')"/>`
: `<div class="sr-cover ph">${icon('bookClosed', 18)}</div>`}
<div class="sr-info">
<div class="sr-title">${highlight(b.title, query)}</div>
<div class="sr-sub">${highlight(b.author, query)}${b.series ? ' · ' + esc(b.series) : ''}</div>
</div>
</div>`).join(''));
}
if (r.content.length) {
html += section('Контент', 'film', r.content.length, r.content.map(c => `
<div class="sr-item" data-sr-content-book="${c.bookId}" data-sr-content-id="${c.id}" tabindex="0">
<div class="sr-icon">${contentTypeIcon(c.type, 18)}</div>
<div class="sr-info">
<div class="sr-title">${highlight(c.title || c.type, query)}</div>
<div class="sr-sub">${icon('bookOpen', 11)} ${esc(c.bookTitle)}</div>
</div>
</div>`).join(''));
}
if (r.reviews.length) {
html += section('Отзывы', 'pen', r.reviews.length, r.reviews.map(b => `
<div class="sr-item" data-sr-book="${b.id}" tabindex="0">
<div class="sr-icon">${icon('pen', 18)}</div>
<div class="sr-info">
<div class="sr-title">${highlight(b.title, query)}</div>
<div class="sr-sub">${'⭐'.repeat(b.review?.rating || 0)} ${esc((b.review?.text || '').slice(0, 60))}</div>
</div>
</div>`).join(''));
}
if (r.quotes.length) {
html += section('Цитаты', 'quote', r.quotes.length, r.quotes.map(qt => `
<div class="sr-item" data-sr-book="${qt.bookId}" tabindex="0">
<div class="sr-icon">${icon('quote', 18)}</div>
<div class="sr-info">
<div class="sr-title">«${highlight(qt.text.slice(0, 70), query)}»</div>
<div class="sr-sub">${esc(qt.bookTitle)}${qt.page ? ' · с. ' + qt.page : ''}</div>
</div>
</div>`).join(''));
}
if (r.collections.length) {
html += section('Подборки', 'folder', r.collections.length, r.collections.map(c => `
<div class="sr-item" data-sr-collection="${c.id}" tabindex="0">
<div class="sr-icon">${c.emoji}</div>
<div class="sr-info">
<div class="sr-title">${highlight(c.name, query)}</div>
<div class="sr-sub">${c.bookIds.length} книг</div>
</div>
</div>`).join(''));
}
if (r.challenges.length) {
html += section('Челленджи', 'trophy', r.challenges.length, r.challenges.map(c => `
<div class="sr-item" data-sr-challenge="${c.id}" tabindex="0">
<div class="sr-icon">${c.emoji || '🏆'}</div>
<div class="sr-info">
<div class="sr-title">${highlight(c.name, query)}</div>
<div class="sr-sub">${c.status === 'active' ? 'Активен' : c.status}</div>
</div>
</div>`).join(''));
}
if (r.series.length) {
html += section('Серии', 'layers', r.series.length, r.series.map(s => `
<div class="sr-item" data-sr-series="${esc(s.name)}" tabindex="0">
<div class="sr-icon">${s.emoji}</div>
<div class="sr-info">
<div class="sr-title">${highlight(s.name, query)}</div>
<div class="sr-sub">${s.read} из ${s.effectiveTotal} прочитано</div>
</div>
</div>`).join(''));
}
if (r.tags.length) {
html += section('Теги', 'tag', r.tags.length, r.tags.map(t => `
<div class="sr-item" data-sr-tag="${esc(t.name)}" tabindex="0">
<div class="sr-icon" style="color:${t.color || 'var(--accent)'}">${icon('tag', 18)}</div>
<div class="sr-info">
<div class="sr-title" style="color:${t.color || 'var(--text-primary)'}">${highlight(t.name, query)}</div>
<div class="sr-sub">Нажмите, чтобы отфильтровать книги</div>
</div>
</div>`).join(''));
}
D.results.innerHTML = html;
bindResults();
}
function section(title, ic, count, inner) {
return `
<div class="sr-section">
<div class="sr-section-title">${icon(ic, 14)} ${title} <span class="sr-count">${count}</span></div>
${inner}
</div>`;
}

// ═══════════════════════════════════════════════
//  7. НАВИГАЦИЯ ПО РЕЗУЛЬТАТАМ
// ═══════════════════════════════════════════════
function bindResults() {
// Любой переход сначала закрывает поиск
const go = (fn) => { closeSearch(); fn(); };
D.results.querySelectorAll('[data-sr-book]').forEach(el => {
el.addEventListener('click', () => go(() => cfg.onOpenBook(el.dataset.srBook)));
});
D.results.querySelectorAll('[data-sr-content-book]').forEach(el => {
el.addEventListener('click', () => go(() => cfg.onOpenContent(el.dataset.srContentBook, el.dataset.srContentId)));
});
D.results.querySelectorAll('[data-sr-collection]').forEach(el => {
el.addEventListener('click', () => go(() => cfg.onOpenCollection(el.dataset.srCollection)));
});
D.results.querySelectorAll('[data-sr-challenge]').forEach(el => {
el.addEventListener('click', () => go(() => cfg.onOpenChallenge(el.dataset.srChallenge)));
});
D.results.querySelectorAll('[data-sr-series]').forEach(el => {
el.addEventListener('click', () => go(() => cfg.onOpenSeries(el.dataset.srSeries)));
});
D.results.querySelectorAll('[data-sr-tag]').forEach(el => {
el.addEventListener('click', () => go(() => cfg.onFilterTag(el.dataset.srTag)));
});
}

// ═══════════════════════════════════════════════
//  8. ПОДСВЕТКА СОВПАДЕНИЙ
// ═══════════════════════════════════════════════
/**
* Безопасная подсветка: сначала находит совпадения в сыром тексте,
* затем экранирует каждый сегмент по отдельности.
* @param {string} text
* @param {string} q — запрос (в нижнем регистре)
* @returns {string} HTML с <mark>
*/
function highlight(text, q) {
if (!q || !text) return esc(text || '');
const lower = String(text).toLowerCase();
let idx = 0, pos, out = '';
while ((pos = lower.indexOf(q, idx)) !== -1) {
out += esc(text.slice(idx, pos));
out += '<mark>' + esc(text.slice(pos, pos + q.length)) + '</mark>';
idx = pos + q.length;
}
out += esc(text.slice(idx));
return out;
}