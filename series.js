// 📦 BookTrackerPro — series.js
// 🔖 v3.8.1 | 2026-08-09
// 📝 Серии книг
//
//    Серия — поля в книге: series, seriesNumber, seriesTotal
//    Список серий генерируется динамически из книг.
//
//    Функции:
//      — Группировка книг по сериям
//      — Экран «Все серии» (с прогрессом)
//      — Экран одной серии (книги по порядку + пустые слоты)
//      — Автодополнение названия серии в форме
//      — Прогресс серии (прочитано X из Y)
//
//    Новое в 3.7.0:
//      — Сохранены SVG-иконки из icons.js (v3.5.0)
//      — Эмодзи серий (guessSeriesEmoji) — контентная фича
//      — Обложки: referrerpolicy no-referrer + onerror-фолбэк
//
//    Сохранено из 3.5.0:
//      — UI-иконки из icons.js (SVG вместо эмодзи в хроме)
//      — Эмодзи серий подбираются по названию/жанру
// ─────────────────────────────────────────────
import { esc } from './app.js';
import { BOOK_STATUSES } from './db.js';
import { icon, statusIcon } from './icons.js';
// ═══════════════════════════════════════════════
//  1. ГРУППИРОВКА КНИГ ПО СЕРИЯМ
// ═══════════════════════════════════════════════
/**
* Собирает все серии из книг.
* @param {object[]} books
* @returns {object[]} — [{ name, books, total, read, progress, emoji }]
*/
export function getSeriesList(books) {
const map = {};
for (const book of books) {
const name = (book.series || '').trim();
if (!name) continue;
if (!map[name]) {
map[name] = {
name,
books: [],
total: 0,       // seriesTotal (максимум из всех книг серии)
read: 0,
added: 0,
};
}
map[name].books.push(book);
if (book.seriesTotal && book.seriesTotal > map[name].total) {
map[name].total = book.seriesTotal;
}
if (book.status === 'finished') map[name].read++;
}
// Сортируем книги внутри серии по номеру
const series = Object.values(map).map(s => {
s.books.sort((a, b) => (a.seriesNumber || 999) - (b.seriesNumber || 999));
s.added = s.books.length;
// Если total не указан — считаем по количеству добавленных
s.effectiveTotal = s.total || s.added;
s.progress = s.effectiveTotal > 0
? Math.round((s.read / s.effectiveTotal) * 100) : 0;
s.emoji = guessSeriesEmoji(s.name, s.books);
return s;
});
// Сортировка: серии с прогрессом сверху, затем по имени
series.sort((a, b) => {
if (a.read > 0 && b.read === 0) return -1;
if (a.read === 0 && b.read > 0) return 1;
return a.name.localeCompare(b.name, 'ru');
});
return series;
}
/**
* Пытается подобрать эмодзи для серии по названию/жанру.
* (Контентная фича — сохранена в v3.5.0+)
*/
function guessSeriesEmoji(name, books) {
const lower = name.toLowerCase();
const genres = books.map(b => (b.genre || '').toLowerCase()).join(' ');
if (/поттер|маг|волшеб|wizard|magic/.test(lower + genres)) return '🧙';
if (/кольц|кольца|lord|ring|толкин/.test(lower + genres)) return '💍';
if (/ведьмак|witcher|сапковский/.test(lower)) return '🗡️';
if (/детектив|сыщик|murder|убийств/.test(lower + genres)) return '🔍';
if (/космос|звёзд|star|space|галактик/.test(lower + genres)) return '🚀';
if (/любов|роман|love/.test(lower + genres)) return '💕';
if (/ужас|horror|страх|king/.test(lower + genres)) return '👻';
if (/фэнтези|fantasy|дракон|dragon/.test(lower + genres)) return '🐉';
if (/фантастик|sci-?fi/.test(lower + genres)) return '🤖';
if (/истор|history|войн|war/.test(lower + genres)) return '🏛️';
return '📚';
}
// ═══════════════════════════════════════════════
//  2. ЭКРАН «ВСЕ СЕРИИ»
// ═══════════════════════════════════════════════
/**
* Рендерит список всех серий.
* @param {HTMLElement} container
* @param {object[]} books
* @param {object} callbacks — { onOpenSeries }
*/
export function renderSeriesList(container, books, callbacks) {
const series = getSeriesList(books);
if (series.length === 0) {
container.innerHTML = `
<div class="empty-state">
<div class="empty-icon">${icon('library', 56)}</div>
<div class="empty-title">Нет серий</div>
<div class="empty-text">
Добавьте книгу и укажите серию в форме —
например «Гарри Поттер», № 1 из 7
</div>
</div>
`;
return;
}
// Сводка
const totalSeries = series.length;
const completedSeries = series.filter(s => s.read >= s.effectiveTotal && s.effectiveTotal > 0).length;
const inProgressSeries = series.filter(s => s.read > 0 && s.read < s.effectiveTotal).length;
container.innerHTML = `
<div class="stats-grid" style="grid-template-columns:repeat(3,1fr)">
<div class="stat-card">
<div class="stat-value">${totalSeries}</div>
<div class="stat-label">${icon('library', 13)} Всего серий</div>
</div>
<div class="stat-card">
<div class="stat-value">${inProgressSeries}</div>
<div class="stat-label">${icon('bookOpen', 13)} В процессе</div>
</div>
<div class="stat-card">
<div class="stat-value">${completedSeries}</div>
<div class="stat-label">${icon('trophy', 13)} Завершено</div>
</div>
</div>
<div class="series-list">
${series.map(s => `
<div class="series-card" data-series="${esc(s.name)}">
<div class="series-emoji">${s.emoji}</div>
<div class="series-info">
<div class="series-name">${esc(s.name)}</div>
<div class="series-meta">
${s.read} из ${s.effectiveTotal} прочитано · ${s.added} в библиотеке
</div>
<div class="series-progress-track">
<div class="series-progress-fill ${s.read >= s.effectiveTotal && s.effectiveTotal > 0 ? 'done' : ''}"
style="width:${s.progress}%"></div>
</div>
</div>
<div class="series-percent">${s.progress}%</div>
</div>
`).join('')}
</div>
`;
container.querySelectorAll('.series-card').forEach(card => {
card.addEventListener('click', () => {
callbacks.onOpenSeries(card.dataset.series);
});
});
}
// ═══════════════════════════════════════════════
//  3. ЭКРАН ОДНОЙ СЕРИИ
// ═══════════════════════════════════════════════
/**
* Рендерит экран серии: книги по порядку + пустые слоты.
* @param {HTMLElement} container
* @param {string} seriesName
* @param {object[]} books — все книги
* @param {object} callbacks — { onOpenBook, onAddBook, onBack }
*/
export function renderSeriesDetail(container, seriesName, books, callbacks) {
const seriesBooks = books
.filter(b => (b.series || '').trim() === seriesName)
.sort((a, b) => (a.seriesNumber || 999) - (b.seriesNumber || 999));
if (seriesBooks.length === 0) return;
const total = seriesBooks[0].seriesTotal || seriesBooks.length;
const read = seriesBooks.filter(b => b.status === 'finished').length;
const progress = total > 0 ? Math.round((read / total) * 100) : 0;
const emoji = guessSeriesEmoji(seriesName, seriesBooks);
// Статистика серии
const totalPages = seriesBooks.reduce((s, b) => s + (b.pageCount || 0), 0);
const readBooks = seriesBooks.filter(b => b.status === 'finished' && b.readingDays);
const avgDays = readBooks.length > 0
? Math.round(readBooks.reduce((s, b) => s + b.readingDays, 0) / readBooks.length)
: null;
// Строим слоты: добавленные книги + пустые для недостающих номеров
const slots = buildSeriesSlots(seriesBooks, total);
container.innerHTML = `
<button id="series-back" class="btn-secondary mb-16">${icon('arrowLeft', 14)} Все серии</button>
<!-- Шапка серии -->
<div class="series-hero">
<div class="series-hero-emoji">${emoji}</div>
<div class="series-hero-info">
<h2 class="series-hero-title">${esc(seriesName)}</h2>
<div class="series-hero-meta">
${read} из ${total} прочитано
${avgDays ? ` · ~${avgDays} дн. на книгу` : ''}
${totalPages ? ` · ${totalPages.toLocaleString('ru')} стр.` : ''}
</div>
<div class="series-progress-track big">
<div class="series-progress-fill ${read >= total && total > 0 ? 'done' : ''}"
style="width:${progress}%"></div>
</div>
<div class="series-percent-label">${progress}% серии прочитано</div>
</div>
</div>
<!-- Книги серии -->
<div class="series-books">
${slots.map(slot => renderSeriesSlot(slot)).join('')}
</div>
<button id="series-add" class="btn-primary mt-16">
${icon('plus', 16)} Добавить книгу в серию
</button>
`;
// События
container.querySelector('#series-back').addEventListener('click', () => callbacks.onBack());
container.querySelector('#series-add').addEventListener('click', () => {
callbacks.onAddBook(seriesName, total);
});
container.querySelectorAll('[data-series-book]').forEach(el => {
el.addEventListener('click', () => {
callbacks.onOpenBook(el.dataset.seriesBook);
});
});
}
/**
* Строит массив слотов серии: книги + пустые места.
*/
function buildSeriesSlots(seriesBooks, total) {
const slots = [];
const byNumber = {};
for (const b of seriesBooks) {
if (b.seriesNumber) byNumber[b.seriesNumber] = b;
}
// Если номера не указаны — просто список книг
const hasNumbers = seriesBooks.some(b => b.seriesNumber);
if (!hasNumbers) {
return seriesBooks.map(b => ({ type: 'book', book: b }));
}
for (let i = 1; i <= total; i++) {
if (byNumber[i]) {
slots.push({ type: 'book', book: byNumber[i], number: i });
} else {
slots.push({ type: 'empty', number: i });
}
}
// Книги без номера — в конец
for (const b of seriesBooks) {
if (!b.seriesNumber) slots.push({ type: 'book', book: b, number: null });
}
return slots;
}
/**
* Рендер одного слота серии (книга или пустое место).
*/
function renderSeriesSlot(slot) {
if (slot.type === 'empty') {
return `
<div class="series-slot empty">
<div class="series-slot-number">${slot.number}</div>
<div class="series-slot-info">
<div class="series-slot-title">Не добавлена</div>
<div class="series-slot-sub">Книга №${slot.number} ещё не в библиотеке</div>
</div>
<div class="series-slot-icon">${icon('plus', 16)}</div>
</div>
`;
}
const b = slot.book;
const st = BOOK_STATUSES[b.status] || { icon: '📕', ic: 'bookClosed', label: b.status };
const isCurrent = b.status === 'reading';
// 🆕 v3.8.1: обложка с referrerpolicy no-referrer + onerror-фолбэк
const coverHtml = b.coverUrl
? `<img class="series-slot-cover" src="${b.coverUrl}" alt="" loading="lazy"
referrerpolicy="no-referrer" onerror="this.style.display='none'"/>`
: `<div class="series-slot-cover placeholder">${icon('bookClosed', 22)}</div>`;
return `
<div class="series-slot book ${isCurrent ? 'current' : ''}"
data-series-book="${b.id}">
<div class="series-slot-number">${slot.number || '—'}</div>
${coverHtml}
<div class="series-slot-info">
<div class="series-slot-title">${esc(b.title)}</div>
<div class="series-slot-sub">
${statusIcon(b.status, 13)} ${st.label}
${b.status === 'finished' && b.readingDays ? ` · ${b.readingDays} дн.` : ''}
${b.status === 'reading' && b.pageCount ? ` · стр. ${b.currentPage || 0}/${b.pageCount}` : ''}
</div>
</div>
${isCurrent ? '<div class="series-slot-badge">вы здесь</div>' : ''}
</div>
`;
}
// ═══════════════════════════════════════════════
//  4. АВТОДОПОЛНЕНИЕ НАЗВАНИЯ СЕРИИ
// ═══════════════════════════════════════════════
/**
* Возвращает список существующих серий для автодополнения.
* @param {object[]} books
* @param {string} query — введённый текст
* @returns {string[]}
*/
export function suggestSeries(books, query) {
const names = new Set();
for (const b of books) {
const s = (b.series || '').trim();
if (s) names.add(s);
}
const q = (query || '').toLowerCase().trim();
if (!q) return [...names].sort((a, b) => a.localeCompare(b, 'ru'));
return [...names]
.filter(n => n.toLowerCase().includes(q))
.sort((a, b) => a.localeCompare(b, 'ru'))
.slice(0, 8);
}
/**
* Подключает автодополнение к input.
* Создаёт выпадающий список под полем.
* @param {HTMLInputElement} input
* @param {object[]} books
* @param {function} onSelect — колбэк (seriesName)
*/
export function attachSeriesAutocomplete(input, books, onSelect) {
// Контейнер подсказок
let dropdown = document.createElement('div');
dropdown.className = 'autocomplete-dropdown hidden';
input.parentNode.style.position = 'relative';
input.parentNode.appendChild(dropdown);
function render(query) {
const suggestions = suggestSeries(books, query);
if (suggestions.length === 0) {
dropdown.classList.add('hidden');
return;
}
dropdown.innerHTML = suggestions.map(s => `
<div class="autocomplete-item" data-value="${esc(s)}">${icon('library', 13)} ${esc(s)}</div>
`).join('');
dropdown.classList.remove('hidden');
dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
item.addEventListener('mousedown', (e) => {
e.preventDefault(); // чтобы не потерять фокус
input.value = item.dataset.value;
dropdown.classList.add('hidden');
if (onSelect) onSelect(item.dataset.value);
});
});
}
input.addEventListener('input', () => render(input.value));
input.addEventListener('focus', () => render(input.value));
input.addEventListener('blur', () => {
setTimeout(() => dropdown.classList.add('hidden'), 150);
});
}
/**
* При выборе существующей серии — подставляет seriesTotal
* из других книг этой серии.
* @param {object[]} books
* @param {string} seriesName
* @returns {number|null}
*/
export function getSeriesTotal(books, seriesName) {
for (const b of books) {
if ((b.series || '').trim() === seriesName && b.seriesTotal) {
return b.seriesTotal;
}
}
return null;
}
// ═══════════════════════════════════════════════
//  5. СТИЛИ (инжектируются один раз)
// ═══════════════════════════════════════════════
const SERIES_STYLES = `
.series-list { display:flex; flex-direction:column; gap:10px; }
.series-card {
display:flex; align-items:center; gap:14px;
padding:14px 16px;
background:var(--bg-card);
border:1px solid var(--border);
border-radius:var(--radius);
cursor:pointer;
transition:all .2s;
margin-bottom:8px;
}
.series-card:hover {
border-color:var(--accent);
background:var(--bg-card-hover);
transform:translateY(-1px);
box-shadow:var(--shadow-sm);
}
.series-emoji { font-size:1.8rem; flex-shrink:0; }
.series-info { flex:1; min-width:0; }
.series-name {
font-size:.95rem; font-weight:700;
white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
.series-meta { font-size:.78rem; color:var(--text-secondary); margin:2px 0 6px; }
.series-progress-track {
height:6px; background:var(--bg-input);
border-radius:3px; overflow:hidden;
}
.series-progress-track.big { height:10px; border-radius:5px; margin-top:8px; }
.series-progress-fill {
height:100%; border-radius:3px;
background:linear-gradient(90deg, var(--accent), var(--purple));
transition:width .5s ease;
}
.series-progress-fill.done {
background:linear-gradient(90deg, var(--green), var(--cyan));
}
.series-percent {
font-size:.9rem; font-weight:800; color:var(--accent);
flex-shrink:0; min-width:42px; text-align:right;
}
/* Шапка серии */
.series-hero {
display:flex; gap:16px; align-items:flex-start;
padding:18px;
background:linear-gradient(135deg, var(--bg-card), var(--bg-secondary));
border:1px solid var(--border);
border-radius:var(--radius-lg);
margin-bottom:16px;
}
.series-hero-emoji { font-size:3rem; line-height:1; }
.series-hero-info { flex:1; }
.series-hero-title { font-size:1.25rem; font-weight:800; line-height:1.2; }
.series-hero-meta { font-size:.85rem; color:var(--text-secondary); margin-top:4px; }
.series-percent-label { font-size:.78rem; color:var(--text-muted); margin-top:6px; text-align:right; }
/* Слоты серии */
.series-books { display:flex; flex-direction:column; gap:8px; }
.series-slot {
display:flex; align-items:center; gap:12px;
padding:10px 14px;
border-radius:var(--radius);
border:1px solid var(--border);
transition:all .2s;
}
.series-slot.book {
background:var(--bg-card);
cursor:pointer;
}
.series-slot.book:hover {
border-color:var(--accent);
background:var(--bg-card-hover);
}
.series-slot.current {
border-color:var(--green);
box-shadow:0 0 0 1px var(--green);
}
.series-slot.empty {
background:transparent;
border-style:dashed;
opacity:.55;
}
.series-slot-number {
width:30px; height:30px;
display:flex; align-items:center; justify-content:center;
border-radius:50%;
background:var(--bg-input);
font-size:.85rem; font-weight:800;
color:var(--text-secondary);
flex-shrink:0;
}
.series-slot.current .series-slot-number {
background:var(--green-dim); color:var(--green);
}
.series-slot-cover {
width:36px; height:54px;
border-radius:4px; object-fit:cover;
background:var(--bg-input);
flex-shrink:0;
}
.series-slot-cover.placeholder {
display:flex; align-items:center; justify-content:center;
color:var(--text-muted);
}
.series-slot-info { flex:1; min-width:0; }
.series-slot-title {
font-size:.9rem; font-weight:600;
white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
.series-slot.empty .series-slot-title { color:var(--text-muted); font-weight:500; }
.series-slot-sub {
font-size:.78rem; color:var(--text-secondary); margin-top:2px;
display:flex; align-items:center; gap:4px; flex-wrap:wrap;
}
.series-slot-icon {
display:flex; align-items:center; justify-content:center;
color:var(--text-muted); flex-shrink:0;
}
.series-slot-badge {
font-size:.68rem; font-weight:700;
padding:3px 9px; border-radius:10px;
background:var(--green-dim); color:var(--green);
text-transform:uppercase; letter-spacing:.5px;
flex-shrink:0;
}
/* Автодополнение */
.autocomplete-dropdown {
position:absolute; top:100%; left:0; right:0;
background:var(--bg-card);
border:1px solid var(--border);
border-radius:var(--radius-sm);
margin-top:4px;
max-height:200px; overflow-y:auto;
z-index:50;
box-shadow:var(--shadow);
}
.autocomplete-item {
display:flex; align-items:center; gap:8px;
padding:10px 14px;
font-size:.88rem;
cursor:pointer;
transition:background .15s;
}
.autocomplete-item:hover { background:var(--accent-dim); color:var(--accent); }
`;
if (!document.getElementById('series-styles')) {
const style = document.createElement('style');
style.id = 'series-styles';
style.textContent = SERIES_STYLES;
document.head.appendChild(style);
}
// ─────────────────────────────────────────────