// ─────────────────────────────────────────────
// 📦 BookTrackerPro — search.js
// 🔖 v3.7.0 | 2026-08-04
// 📝 Глобальный поиск (полная переработка)
//
//    Архитектура:
//      — Самостоятельный модуль, не зависит от глобального S
//      — Явное состояние open (фикс бага «лупа не работает»)
//      — Данные и навигация приходят через config (инверсия зависимостей)
//      — Автозакрытие при навигации — app.js вызывает closeSearch()
//
//    Скоупы: Всё / Книги / Контент / Отзывы / Цитаты /
//            Подборки / Челленджи / Серии / Теги / Тропы (новое)
//
//    Клавиатура: ↑ ↓ — навигация · Enter — открыть · Esc — закрыть
//
//    Новое в 3.7.0:
//      — Скоуп «Тропы» (поиск по тропам книг)
//      — matchesBook учитывает поле tropes
//      — Обложки: referrerpolicy + onerror fallback
//
//    Сохранено из 3.6.0:
//      — esc из utils.js (разрыв цикла)
//      — SVG-иконки из icons.js
//      — Безопасная подсветка <mark>
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
{ id: 'tropes',      ic: 'heartHands', label: 'Тропы' },   // 🆕 v3.7.0
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
* @param {function} config.getData — () => ({ books, collections, challenges, tags, series, tropes })
* @param {function} config.onOpenBook       — (bookId) => void
* @param {function} config.onOpenContent    — (bookId, contentId) => void
* @param {function} config.onOpenCollection — (id) => void
* @param {function} config.onOpenChallenge  — (id) => void
* @param {function} config.onOpenSeries     — (name) => void
* @param {function} config.onFilterTag      — (tagName) => void
* @param {function} config.onFilterTrope    — (tropeName) => void   // 🆕 v3.7.0
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
renderSearchBookTags();
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
renderScopes();
renderSearchBookTags();
run();
});
});
}
function renderSearchBookTags() {
if (scope !== 'books') {
D.tags.classList.add('hidden');
D.tags.innerHTML = '';
return;
}
D.tags.classList.remove('hidden');
const tags = cfg.getData().tags || [];
if (tags.length === 0) {
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
renderSearchBookTags();
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
(b.tags || []).some(t => t.toLowerCase().includes(q)) ||
(b.tropes || []).some(t => t.toLowerCase().includes(q));   // 🆕 v3.7.0
}
function run() {
const data = cfg.getData();
const books = data.books || [];
const collections = data.collections || [];
const challenges = data.challenges || [];
const tags = data.tags || [];
const series = data.series || [];
const tropes = data.tropes || [];   // 🆕 v3.7.0
const q = query;
const hasQuery = !!q || !!tag;
const results = {
books: [], content: [], reviews: [], quotes: [],
collections: [], challenges: [], series: [], tags: [], tropes: [],
};
if (hasQuery) {
if (scope === 'all' || scope === 'books') {
results.books = books.filter(b => matchesBook(b, q));
if (tag) results.books = results.books.filter(b => (b.tags || []).includes(tag));
}
if (scope === 'all' || scope === 'content') {
for (const b of books) for (const c of (b.contentItems || [])) {
if (!q || (c.title || '').toLowerCase().includes(q) || b.title.toLowerCase().includes(q)) {
results.content.push({ ...c, bookId: b.id, bookTitle: b.title });
}
}
}
if (scope === 'all' || scope === 'reviews') {
results.reviews = books.filter(b => {
const r = b.review || {};
if (!(r.text || r.rating > 0)) return false;
if (!q) return true;
return (r.text || '').toLowerCase().includes(q) ||
(r.pros || '').toLowerCase().includes(q) ||
(r.cons || '').toLowerCase().includes(q) ||
b.title.toLowerCase().includes(q);
});
}
if (scope === 'all' || scope === 'quotes') {
for (const b of books) for (const qt of (b.review?.quotes || [])) {
if (!q || qt.text.toLowerCase().includes(q)) {
results.quotes.push({ ...qt, bookId: b.id, bookTitle: b.title });
}
}
}
if (scope === 'all' || scope === 'collections') {
results.collections = collections.filter(c => !q || c.name.toLowerCase().includes(q));
}
if (scope === 'all' || scope === 'challenges') {
results.challenges = challenges.filter(c => !q || c.name.toLowerCase().includes(q));
}
if (scope === 'all' || scope === 'series') {
results.series = series.filter(s => !q || s.name.toLowerCase().includes(q));
}
if (scope === 'all' || scope === 'tags') {
results.tags = tags.filter(t => !q || t.name.toLowerCase().includes(q));
}
// 🆕 v3.7.0: скоуп «Тропы»
if (scope === 'all' || scope === 'tropes') {
results.tropes = tropes.filter(t => !q || t.toLowerCase().includes(q));
}
}
renderSearchResults(results, hasQuery);
}
// ═══════════════════════════════════════════════
//  6. РЕНДЕР РЕЗУЛЬТАТОВ
// ═══════════════════════════════════════════════
function renderSearchResults(results, hasQuery) {
const el = D.results;
el.classList.remove('hidden');
D.main.classList.add('hidden');
if (!hasQuery) {
el.innerHTML = `
<div class="search-hint">
${icon('search', 26)}
<div>Начните вводить — поиск идёт по всем разделам сразу</div>
</div>`;
return;
}
const total = Object.values(results).reduce((s, arr) => s + arr.length, 0);
if (total === 0) {
el.innerHTML = `
<div class="search-hint">
${icon('search', 26)}
<div>Ничего не найдено${query ? ` по «${esc(query)}»` : ''}</div>
</div>`;
return;
}
let html = '';
if (results.books.length) {
html += section('Книги', 'bookOpen', results.books.length, results.books.map(b => `
<div class="sr-item" data-sr-book="${b.id}" tabindex="0">
${b.coverUrl
? `<img class="sr-cover" src="${b.coverUrl}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML=window.__srCoverFallback(this,'${b.id}')"/>`
: `<div class="sr-cover ph">${icon('bookClosed', 18)}</div>`}
<div class="sr-info">
<div class="sr-title">${esc(b.title)}</div>
<div class="sr-sub">${esc(b.author)}${b.series ? ' · ' + esc(b.series) : ''}</div>
</div>
</div>`).join(''));
}
if (results.content.length) {
html += section('Контент', 'film', results.content.length, results.content.map(c => `
<div class="sr-item" data-sr-content-book="${c.bookId}" data-sr-content-id="${c.id}" tabindex="0">
<div class="sr-icon">${contentTypeIcon(c.type, 18)}</div>
<div class="sr-info">
<div class="sr-title">${esc(c.title || c.type)}</div>
<div class="sr-sub">${icon('bookOpen', 11)} ${esc(c.bookTitle)}</div>
</div>
</div>`).join(''));
}
if (results.reviews.length) {
html += section('Отзывы', 'pen', results.reviews.length, results.reviews.map(b => `
<div class="sr-item" data-sr-book="${b.id}" tabindex="0">
<div class="sr-icon">${icon('pen', 18)}</div>
<div class="sr-info">
<div class="sr-title">${esc(b.title)}</div>
<div class="sr-sub">${'⭐'.repeat(b.review?.rating || 0)} ${esc((b.review?.text || '').slice(0, 60))}</div>
</div>
</div>`).join(''));
}
if (results.quotes.length) {
html += section('Цитаты', 'quote', results.quotes.length, results.quotes.map(qt => `
<div class="sr-item" data-sr-book="${qt.bookId}" tabindex="0">
<div class="sr-icon">${icon('quote', 18)}</div>
<div class="sr-info">
<div class="sr-title">«${esc(qt.text.slice(0, 70))}»</div>
<div class="sr-sub">${esc(qt.bookTitle)}${qt.page ? ' · с. ' + qt.page : ''}</div>
</div>
</div>`).join(''));
}
if (results.collections.length) {
html += section('Подборки', 'folder', results.collections.length, results.collections.map(c => `
<div class="sr-item" data-sr-collection="${c.id}" tabindex="0">
<div class="sr-icon">${c.emoji}</div>
<div class="sr-info">
<div class="sr-title">${esc(c.name)}</div>
<div class="sr-sub">${c.bookIds.length} книг</div>
</div>
</div>`).join(''));
}
if (results.challenges.length) {
html += section('Челленджи', 'trophy', results.challenges.length, results.challenges.map(c => `
<div class="sr-item" data-sr-challenge="${c.id}" tabindex="0">
<div class="sr-icon">${c.emoji || '🏆'}</div>
<div class="sr-info">
<div class="sr-title">${esc(c.name)}</div>
<div class="sr-sub">${c.status === 'active' ? 'Активен' : c.status}</div>
</div>
</div>`).join(''));
}
if (results.series.length) {
html += section('Серии', 'layers', results.series.length, results.series.map(s => `
<div class="sr-item" data-sr-series="${esc(s.name)}" tabindex="0">
<div class="sr-icon">${s.emoji}</div>
<div class="sr-info">
<div class="sr-title">${esc(s.name)}</div>
<div class="sr-sub">${s.read} из ${s.effectiveTotal} прочитано</div>
</div>
</div>`).join(''));
}
if (results.tags.length) {
html += section('Теги', 'tag', results.tags.length, results.tags.map(t => `
<div class="sr-item" data-sr-tag="${esc(t.name)}" tabindex="0">
<div class="sr-icon" style="color:${t.color || 'var(--accent)'}">${icon('tag', 18)}</div>
<div class="sr-info">
<div class="sr-title" style="color:${t.color || 'var(--text-primary)'}">${esc(t.name)}</div>
<div class="sr-sub">Нажмите, чтобы отфильтровать книги</div>
</div>
</div>`).join(''));
}
// 🆕 v3.7.0: секция «Тропы»
if (results.tropes.length) {
html += section('Тропы', 'heartHands', results.tropes.length, results.tropes.map(t => `
<div class="sr-item" data-sr-trope="${esc(t)}" tabindex="0">
<div class="sr-icon" style="color:var(--pink)">${icon('heartHands', 18)}</div>
<div class="sr-info">
<div class="sr-title" style="color:var(--pink)">${esc(t)}</div>
<div class="sr-sub">Нажмите, чтобы найти книги с этим тропом</div>
</div>
</div>`).join(''));
}
el.innerHTML = html;
bindSearchResultEvents(el);
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
function bindSearchResultEvents(el) {
const go = (fn) => { closeSearch(); fn(); };
el.querySelectorAll('[data-sr-book]').forEach(item => {
item.addEventListener('click', () => go(() => cfg.onOpenBook(item.dataset.srBook)));
});
el.querySelectorAll('[data-sr-content-book]').forEach(item => {
item.addEventListener('click', () => {
const bookId = item.dataset.srContentBook;
const contentId = item.dataset.srContentId;
go(() => cfg.onOpenContent(bookId, contentId));
});
});
el.querySelectorAll('[data-sr-collection]').forEach(item => {
item.addEventListener('click', () => go(() => cfg.onOpenCollection(item.dataset.srCollection)));
});
el.querySelectorAll('[data-sr-challenge]').forEach(item => {
item.addEventListener('click', () => go(() => cfg.onOpenChallenge(item.dataset.srChallenge)));
});
el.querySelectorAll('[data-sr-series]').forEach(item => {
item.addEventListener('click', () => go(() => cfg.onOpenSeries(item.dataset.srSeries)));
});
el.querySelectorAll('[data-sr-tag]').forEach(item => {
item.addEventListener('click', () => go(() => cfg.onFilterTag(item.dataset.srTag)));
});
// 🆕 v3.7.0: фильтр по тропу
el.querySelectorAll('[data-sr-trope]').forEach(item => {
item.addEventListener('click', () => go(() => {
if (cfg.onFilterTrope) cfg.onFilterTrope(item.dataset.srTrope);
}));
});
}