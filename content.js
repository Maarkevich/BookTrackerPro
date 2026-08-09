// ─────────────────────────────────────────────
// 📦 BookTrackerPro — content.js
// 🔖 v3.7.0 | 2026-08-09
// 📝 Контент-план для бук-блогера
//
//    Типы контента:
//      📦 unboxing · 📖 read_with_me · 💬 review · 🎵 lipsync
//      🏆 top · ✨ quote · ⚖️ comparison · 🛒 haul
//
//    Статусы:
//      💡 idea → 📅 planned → 🎥 filming → ✂️ editing → 📤 published
//
//    Площадки (8):
//      ▶️ YouTube · 🎵 TikTok · ✈️ Telegram · 🔵 VK · 📰 Дзен
//      📸 Instagram · 📌 Pinterest · 🧵 Threads
//
//    Новое в 3.7.0:
//      — Отчётность издательству в форме контента:
//        toggle reportSent + дата-пикер reportDate
//      — Индикатор отчётности в карточке списка
//      — Кастомные селекты и дата-пикеры (uikit.js)
//      — SVG-иконки соцсетей (icons.js)
//      — Превью публикаций через Microlink (лениво, с кешем)
//      — esc из utils.js (разрыв цикла)
//
//    Стили .p-icon и .link-preview-* — в app.css
// ─────────────────────────────────────────────
import { addContentToBook, updateContentInBook, removeContentFromBook, loadBooks } from './db.js';
import { esc, showToast } from './utils.js';
import { fetchLinkPreview } from './microlink.js';
import { brandIcon, icon, CONTENT_TYPE_ICONS, CONTENT_STATUS_ICONS } from './icons.js';
import { attachCustomSelect, attachDatePicker } from './uikit.js';
// ═══════════════════════════════════════════════
//  КОНСТАНТЫ
// ═══════════════════════════════════════════════
export const CONTENT_TYPES = {
unboxing:     { icon: '📦', label: 'Распаковка',           color: 'unboxing' },
read_with_me: { icon: '📖', label: 'Начни читать со мной', color: 'read_with_me' },
review:       { icon: '💬', label: 'Отзыв / Мнение',       color: 'review' },
lipsync:      { icon: '🎵', label: 'Липсинг',              color: 'lipsync' },
top:          { icon: '🏆', label: 'Подборка / Топ',       color: 'top' },
quote:        { icon: '✨', label: 'Цитата',                color: 'quote' },
comparison:   { icon: '⚖️', label: 'Сравнение',            color: 'comparison' },
haul:         { icon: '🛒', label: 'Книжный haul',          color: 'haul' },
};
export const CONTENT_STATUSES = {
idea:      { icon: '💡', label: 'Идея',          class: 'status-idea' },
planned:   { icon: '📅', label: 'Запланировано', class: 'status-planned' },
filming:   { icon: '🎥', label: 'Снимаю',        class: 'status-filming' },
editing:   { icon: '✂️', label: 'Монтаж',        class: 'status-editing' },
published: { icon: '📤', label: 'Опубликовано',  class: 'status-published' },
};
// Площадки: иконка (эмодзи-фолбэк) + фирменный цвет
export const PLATFORMS = {
youtube:   { icon: '▶️', label: 'YouTube',   color: '#ff5b5b' },
tiktok:    { icon: '🎵', label: 'TikTok',    color: '#7fb8b0' },
telegram:  { icon: '✈️', label: 'Telegram',  color: '#8ab4e8' },
vk:        { icon: '🔵', label: 'VK',        color: '#7aa3e0' },
dzen:      { icon: '📰', label: 'Дзен',      color: '#e0955c' },
instagram: { icon: '📸', label: 'Instagram', color: '#d98aa8' },
pinterest: { icon: '📌', label: 'Pinterest', color: '#e06a5c' },
threads:   { icon: '🧵', label: 'Threads',   color: '#b3a48e' },
};
/**
* Фирменная SVG-иконка площадки (обёртка над brandIcon из icons.js).
* @param {string} key — youtube, tiktok, ...
* @param {number} size — размер в px
* @returns {string} HTML
*/
export function platformIcon(key, size = 16) {
const p = PLATFORMS[key];
return brandIcon(key, size, p?.color || 'currentColor');
}
const STATUS_ORDER = ['idea', 'planned', 'filming', 'editing', 'published'];
// ═══════════════════════════════════════════════
//  1. ВКЛАДКА «КОНТЕНТ-ПЛАН»
// ═══════════════════════════════════════════════
export function renderContentTab(container, books, settings, callbacks) {
// Собираем весь контент из всех книг
const allContent = [];
for (const book of books) {
for (const item of (book.contentItems || [])) {
allContent.push({
...item,
bookId: book.id,
bookTitle: book.title,
bookAuthor: book.author,
bookCover: book.coverUrl || '',
});
}
}
// Сортировка: по дате (новые сверху)
allContent.sort((a, b) => {
const da = a.plannedDate || a.publishedDate || a.createdAt || '';
const db = b.plannedDate || b.publishedDate || b.createdAt || '';
return db.localeCompare(da);
});
if (!container._contentFilter) container._contentFilter = 'all';
const currentFilter = container._contentFilter;
const filters = [
{ id: 'all',       label: `Все (${allContent.length})`, ic: '' },
{ id: 'idea',      label: 'Идеи',          ic: 'lightbulb' },
{ id: 'planned',   label: 'Запланировано', ic: 'calendar' },
{ id: 'filming',   label: 'Снимаю',        ic: 'video' },
{ id: 'editing',   label: 'Монтаж',        ic: 'scissors' },
{ id: 'published', label: 'Опубликовано',  ic: 'send' },
];
const filtered = currentFilter === 'all'
? allContent
: allContent.filter(c => c.status === currentFilter);
const groups = groupByDate(filtered);
container.innerHTML = `
<div class="filter-bar no-scrollbar">
${filters.map(f => `
<button class="filter-chip ${currentFilter === f.id ? 'active' : ''}" data-cfilter="${f.id}">
${f.ic ? icon(f.ic, 13) + ' ' : ''}${f.label}
</button>
`).join('')}
</div>
${filtered.length === 0 ? `
<div class="empty-state">
<div class="empty-icon">${icon('film', 56)}</div>
<div class="empty-title">Нет контента</div>
<div class="empty-text">
Добавьте контент-элемент к книге —
распаковку, отзыв, липсинг или подборку
</div>
<button id="content-empty-add" class="btn-primary mt-16" style="width:auto">
${icon('plus', 16)} Добавить контент
</button>
</div>
` : `
${groups.map(g => `
<div class="mb-16">
<div class="text-small text-muted mb-8" style="font-weight:800;letter-spacing:.04em">${g.label}</div>
${g.items.map(c => renderContentCard(c)).join('')}
</div>
`).join('')}
`}
<button id="content-add-btn" class="btn-primary mt-16">${icon('plus', 16)} Новый контент</button>
`;
// Фильтры
container.querySelectorAll('[data-cfilter]').forEach(chip => {
chip.addEventListener('click', () => {
container._contentFilter = chip.dataset.cfilter;
renderContentTab(container, books, settings, callbacks);
});
});
const addBtn = container.querySelector('#content-add-btn');
const emptyAdd = container.querySelector('#content-empty-add');
if (addBtn) addBtn.addEventListener('click', () => callbacks.onAdd());
if (emptyAdd) emptyAdd.addEventListener('click', () => callbacks.onAdd());
// Клик по карточке → редактирование
container.querySelectorAll('.content-card').forEach(card => {
card.addEventListener('click', (e) => {
if (e.target.closest('button') || e.target.closest('a')) return;
callbacks.onEdit(
findContentItem(books, card.dataset.bookId, card.dataset.contentId),
card.dataset.bookId
);
});
});
// Быстрая смена статуса
container.querySelectorAll('[data-status-btn]').forEach(btn => {
btn.addEventListener('click', (e) => {
e.stopPropagation();
callbacks.onStatusChange(btn.dataset.contentId, btn.dataset.bookId, btn.dataset.newStatus);
});
});
// Удаление
container.querySelectorAll('[data-delete-content]').forEach(btn => {
btn.addEventListener('click', (e) => {
e.stopPropagation();
callbacks.onDelete(btn.dataset.contentId, btn.dataset.bookId);
});
});
// Копирование ссылки
container.querySelectorAll('[data-copy-url]').forEach(btn => {
btn.addEventListener('click', (e) => {
e.stopPropagation();
navigator.clipboard?.writeText(btn.dataset.copyUrl).then(() =>
showToast('🔗 Ссылка скопирована', 'success'));
});
});
// 🆕 Ленивая загрузка превью публикаций (Microlink)
loadContentPreviews(container);
}
// ═══════════════════════════════════════════════
//  2. КАРТОЧКА КОНТЕНТА
// ═══════════════════════════════════════════════
function renderContentCard(item) {
const type = CONTENT_TYPES[item.type] || { icon: '🎬', label: item.type, color: '' };
const status = CONTENT_STATUSES[item.status] || { icon: '❓', label: item.status, class: '' };
const platform = PLATFORMS[item.platform] || { icon: '🌐', label: item.platform || '' };
// Следующий статус для быстрой кнопки
const idx = STATUS_ORDER.indexOf(item.status);
const nextStatus = idx < STATUS_ORDER.length - 1 ? STATUS_ORDER[idx + 1] : null;
const nextInfo = nextStatus ? CONTENT_STATUSES[nextStatus] : null;
const dateStr = item.publishedDate || item.plannedDate || '';
// 🆕 v3.7.0: индикатор отчётности
const reportSent = item.reportSent || false;
const reportBadge = reportSent
? `<span class="cc-report-badge sent" title="Отчёт отправлен">${icon('checkBadge', 11)} отчёт</span>`
: '';
return `
<div class="content-card" data-book-id="${item.bookId}" data-content-id="${item.id}">
<div class="content-icon ${type.color}">${icon(CONTENT_TYPE_ICONS[item.type] || 'film', 22)}</div>
<div class="content-info">
<div class="content-title">${esc(item.title || type.label)}</div>
<div class="content-book">${icon('bookClosed', 12)} ${esc(item.bookTitle)}</div>
<div class="content-meta">
<span class="content-list-status ${status.class}">${icon(CONTENT_STATUS_ICONS[item.status] || 'film', 12)} ${status.label}</span>
<span class="platform-badge">${brandIcon(item.platform, 12)} ${platform.label}</span>
${dateStr ? `<span class="content-date">${icon('calendar', 11)} ${dateStr}</span>` : ''}
${reportBadge}
</div>
${item.publishedUrl ? `
<div class="content-published" data-preview-url="${esc(item.publishedUrl)}">
<div class="content-meta mt-8">
<a href="${esc(item.publishedUrl)}" target="_blank" rel="noopener" class="text-small">${icon('external', 12)} Открыть</a>
<button data-copy-url="${esc(item.publishedUrl)}"
style="background:none;border:none;cursor:pointer;font-size:.78rem;color:var(--text-muted);display:inline-flex;align-items:center;gap:4px">
${icon('copy', 11)} Копировать ссылку
</button>
</div>
</div>
` : ''}
${item.notes ? `<div class="text-small text-muted mt-8 truncate">${esc(item.notes)}</div>` : ''}
</div>
<div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
${nextInfo ? `
<button data-status-btn
data-book-id="${item.bookId}"
data-content-id="${item.id}"
data-new-status="${nextStatus}"
class="btn-small" style="padding:6px 10px"
title="→ ${nextInfo.label}">
${icon(CONTENT_STATUS_ICONS[nextStatus] || 'film', 14)}
</button>
` : `<span style="text-align:center;color:var(--accent)">${icon('trophy', 18)}</span>`}
<button data-delete-content
data-book-id="${item.bookId}"
data-content-id="${item.id}"
class="icon-btn" style="width:32px;height:32px"
title="Удалить">
${icon('trash', 15)}
</button>
</div>
</div>
`;
}
// ═══════════════════════════════════════════════
//  2.1 ПРЕВЬЮ ПУБЛИКАЦИЙ (Microlink)
// ═══════════════════════════════════════════════
/**
* Лениво подтягивает превью для ссылок publishedUrl.
* Использует IntersectionObserver + кеш Microlink (IndexedDB).
* Повторные URL не тратят дневной лимит.
*/
function loadContentPreviews(container) {
const els = container.querySelectorAll('.content-published[data-preview-url]');
if (els.length === 0) return;
if (!('IntersectionObserver' in window)) {
els.forEach(hydratePreview);
return;
}
const observer = new IntersectionObserver((entries) => {
for (const entry of entries) {
if (!entry.isIntersecting) continue;
observer.unobserve(entry.target);
hydratePreview(entry.target);
}
}, { rootMargin: '200px' });
els.forEach(el => observer.observe(el));
}
/**
* Запрашивает превью и вставляет карточку над ссылкой.
*/
async function hydratePreview(el) {
const url = el.dataset.previewUrl;
if (!url || el.dataset.hydrated) return;
el.dataset.hydrated = '1';
const preview = await fetchLinkPreview(url);
if (!preview || (!preview.image && !preview.title)) return;
const card = document.createElement('a');
card.className = 'link-preview-card';
card.href = url;
card.target = '_blank';
card.rel = 'noopener';
card.innerHTML = `
${preview.image
? `<img class="link-preview-img" src="${preview.image}" alt="" loading="lazy"/>`
: `<div class="link-preview-img link-preview-img-empty">${platformIcon(preview.source, 18)}</div>`}
<div class="link-preview-info">
<div class="link-preview-title">${esc(preview.title || url)}</div>
<div class="link-preview-meta">
${platformIcon(preview.source, 11)}
${esc(preview.publisher || preview.source)}
</div>
</div>
`;
el.insertBefore(card, el.firstChild);
}
// ═══════════════════════════════════════════════
//  3. ФОРМА КОНТЕНТА
// ═══════════════════════════════════════════════
export function openContentForm(item, bookId) {
const overlay = document.getElementById('content-overlay');
const title = document.getElementById('content-form-title');
const body = document.getElementById('content-form-body');
if (!overlay || !body) return;
title.innerHTML = item
? `${icon('edit', 18)} Редактировать контент`
: `${icon('film', 18)} Новый контент`;
loadBooks().then(books => {
renderContentFormBody(body, books, item, bookId);
});
overlay.classList.remove('hidden');
document.body.style.overflow = 'hidden';
}
function renderContentFormBody(body, books, item, preselectedBookId) {
const c = item || {};
const defaultPlatform = 'youtube';
body.innerHTML = `
<!-- Книга -->
<div class="form-group">
<label>${icon('bookClosed', 13)} Книга *</label>
<select id="cf-book" required>
<option value="">— Выберите книгу —</option>
${books.map(b => `
<option value="${b.id}" ${(c.bookId || preselectedBookId) === b.id ? 'selected' : ''}>
${esc(b.title)} — ${esc(b.author)}
</option>
`).join('')}
</select>
</div>
<!-- Тип контента -->
<div class="form-group">
<label>${icon('film', 13)} Тип контента *</label>
<div class="content-type-grid">
${Object.entries(CONTENT_TYPES).map(([key, t]) => `
<button class="content-type-btn ${(c.type || 'unboxing') === key ? 'active' : ''}" data-type="${key}">
<span class="content-type-icon">${icon(CONTENT_TYPE_ICONS[key] || 'film', 22)}</span>
<span class="content-type-label">${t.label}</span>
</button>
`).join('')}
</div>
</div>
<!-- Название -->
<div class="form-group">
<label>${icon('edit', 13)} Название</label>
<input type="text" id="cf-title" value="${esc(c.title || '')}" placeholder="Распаковка июльской посылки ЭКСМО"/>
<div class="form-hint">Если пусто — будет использовано название типа</div>
</div>
<!-- Площадка -->
<div class="form-group">
<label>${icon('globe', 13)} Площадка</label>
<div class="platform-grid">
${Object.entries(PLATFORMS).map(([key, p]) => `
<button class="platform-btn ${(c.platform || defaultPlatform) === key ? 'active' : ''}" data-platform="${key}">
${brandIcon(key, 15)} ${p.label}
</button>
`).join('')}
</div>
</div>
<!-- Статус -->
<div class="form-group">
<label>${icon('chart', 13)} Статус</label>
<select id="cf-status">
${Object.entries(CONTENT_STATUSES).map(([key, s]) => `
<option value="${key}" ${(c.status || 'idea') === key ? 'selected' : ''}>${s.label}</option>
`).join('')}
</select>
</div>
<!-- Даты -->
<div class="form-row">
<div class="form-group"><label>${icon('calendar', 13)} Дата плана</label><input type="date" id="cf-planned" value="${c.plannedDate || ''}"/></div>
<div class="form-group"><label>${icon('send', 13)} Дата публикации</label><input type="date" id="cf-published" value="${c.publishedDate || ''}"/></div>
</div>
<!-- Ссылка -->
<div class="form-group">
<label>${icon('link', 13)} Ссылка на публикацию</label>
<input type="url" id="cf-url" value="${esc(c.publishedUrl || '')}" placeholder="https://youtube.com/watch?v=..."/>
<div class="form-hint">Превью подтянется автоматически (Microlink)</div>
</div>
<!-- Заметки -->
<div class="form-group">
<label>${icon('edit', 13)} Заметки</label>
<textarea id="cf-notes" rows="3" placeholder="Идеи для съёмки, сценарий, реквизит...">${esc(c.notes || '')}</textarea>
</div>
<!-- 🆕 v3.7.0: Отчёт издательству -->
<div class="form-section">
<h3>${icon('report', 15)} Отчёт издательству</h3>
<div class="toggle-row">
<span class="toggle-label">${icon('send', 14)} Отчёт отправлен</span>
<div class="toggle ${c.reportSent ? 'active' : ''}" id="cf-report-toggle"></div>
</div>
<div id="cf-report-fields" class="${c.reportSent ? '' : 'hidden'}">
<div class="form-group">
<label>${icon('calendar', 13)} Дата отправки</label>
<input type="date" id="cf-report-date" value="${c.reportDate || ''}"/>
</div>
</div>
<div class="form-hint">Отметьте, если отчёт о контенте отправлен издательству или автору</div>
</div>
<div class="btn-group">
<button id="cf-save" class="btn-primary">${icon('check', 15)} Сохранить</button>
${item ? `<button id="cf-delete" class="btn-danger">${icon('trash', 15)} Удалить</button>` : ''}
</div>
`;
let selectedType = c.type || 'unboxing';
let selectedPlatform = c.platform || defaultPlatform;
body.querySelectorAll('.content-type-btn').forEach(btn => {
btn.addEventListener('click', () => {
body.querySelectorAll('.content-type-btn').forEach(b => b.classList.remove('active'));
btn.classList.add('active');
selectedType = btn.dataset.type;
});
});
body.querySelectorAll('.platform-btn').forEach(btn => {
btn.addEventListener('click', () => {
body.querySelectorAll('.platform-btn').forEach(b => b.classList.remove('active'));
btn.classList.add('active');
selectedPlatform = btn.dataset.platform;
});
});
// 🆕 v3.7.0: Кастомные контролы (uikit.js)
attachCustomSelect(body.querySelector('#cf-book'), {
search: true,
searchPlaceholder: 'Название или автор...',
});
const statusRenderer = (opt) => {
const s = CONTENT_STATUSES[opt.value];
if (!s) return esc(opt.textContent);
return `<span style="display:flex;align-items:center;gap:8px">${icon(CONTENT_STATUS_ICONS[opt.value] || 'film', 15)} ${esc(s.label)}</span>`;
};
attachCustomSelect(body.querySelector('#cf-status'), {
renderOption: statusRenderer,
renderTrigger: statusRenderer,
});
attachDatePicker(body.querySelector('#cf-planned'));
attachDatePicker(body.querySelector('#cf-published'));
attachDatePicker(body.querySelector('#cf-report-date'));
// 🆕 v3.7.0: Toggle отчёта показывает/скрывает дату
body.querySelector('#cf-report-toggle').addEventListener('click', function() {
this.classList.toggle('active');
body.querySelector('#cf-report-fields').classList.toggle('hidden');
});
// Сохранение
body.querySelector('#cf-save').addEventListener('click', async () => {
const bookId = body.querySelector('#cf-book').value;
if (!bookId) { showToast('⚠️ Выберите книгу', 'error'); return; }
const isReportSent = body.querySelector('#cf-report-toggle').classList.contains('active');
const contentData = {
id: c.id || `content_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
type: selectedType,
title: body.querySelector('#cf-title').value.trim(),
platform: selectedPlatform,
status: body.querySelector('#cf-status').value,
plannedDate: body.querySelector('#cf-planned').value,
publishedDate: body.querySelector('#cf-published').value,
publishedUrl: body.querySelector('#cf-url').value.trim(),
notes: body.querySelector('#cf-notes').value.trim(),
reportSent: isReportSent,
reportDate: isReportSent ? body.querySelector('#cf-report-date').value : '',
createdAt: c.createdAt || new Date().toISOString(),
updatedAt: new Date().toISOString(),
};
try {
if (item) {
await updateContentInBook(bookId, contentData.id, contentData);
showToast('✅ Контент обновлён', 'success');
} else {
await addContentToBook(bookId, contentData);
showToast('✅ Контент добавлен', 'success');
}
closeContentForm();
document.dispatchEvent(new CustomEvent('data-changed'));
} catch (e) {
showToast('❌ Ошибка сохранения', 'error');
console.error('[Content] Save error:', e);
}
});
const delBtn = body.querySelector('#cf-delete');
if (delBtn) {
delBtn.addEventListener('click', async () => {
if (!confirm('Удалить этот контент?')) return;
try {
await removeContentFromBook(body.querySelector('#cf-book').value, c.id);
showToast('🗑️ Контент удалён', 'info');
closeContentForm();
document.dispatchEvent(new CustomEvent('data-changed'));
} catch { showToast('❌ Ошибка удаления', 'error'); }
});
}
}
function closeContentForm() {
const overlay = document.getElementById('content-overlay');
if (overlay) {
overlay.classList.add('hidden');
document.body.style.overflow = '';
}
}
// ═══════════════════════════════════════════════
//  4. ОПЕРАЦИИ (для app.js)
// ═══════════════════════════════════════════════
export async function deleteContentItem(bookId, contentId) {
await removeContentFromBook(bookId, contentId);
}
export async function updateContentStatus(bookId, contentId, newStatus) {
const updates = { status: newStatus, updatedAt: new Date().toISOString() };
// При публикации — авто-дата, если не указана
if (newStatus === 'published') {
const books = await loadBooks();
const book = books.find(b => b.id === bookId);
const item = (book?.contentItems || []).find(ct => ct.id === contentId);
if (item && !item.publishedDate) {
updates.publishedDate = new Date().toISOString().slice(0, 10);
}
}
await updateContentInBook(bookId, contentId, updates);
}
// ═══════════════════════════════════════════════
//  5. УТИЛИТЫ
// ═══════════════════════════════════════════════
function findContentItem(books, bookId, contentId) {
const book = books.find(b => b.id === bookId);
if (!book) return null;
return (book.contentItems || []).find(c => c.id === contentId) || null;
}
function groupByDate(items) {
const today = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const groups = {};
for (const item of items) {
const date = item.plannedDate || item.publishedDate || '';
let label;
if (!date) label = '📌 Без даты';
else if (date === today) label = '📅 Сегодня';
else if (date === tomorrow) label = '📅 Завтра';
else if (date === yesterday) label = '📅 Вчера';
else if (date < today) label = '⏪ Прошедшие';
else {
try {
label = '📅 ' + new Date(date + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
} catch { label = '📅 ' + date; }
}
if (!groups[label]) groups[label] = [];
groups[label].push(item);
}
const order = ['📅 Сегодня', '📅 Завтра'];
return Object.entries(groups)
.sort(([a], [b]) => {
const ai = order.indexOf(a), bi = order.indexOf(b);
if (ai >= 0 && bi >= 0) return ai - bi;
if (ai >= 0) return -1;
if (bi >= 0) return 1;
if (a === '📌 Без даты') return 1;
if (b === '📌 Без даты') return -1;
if (a.startsWith('⏪')) return 1;
if (b.startsWith('⏪')) return -1;
return a.localeCompare(b, 'ru');
})
.map(([label, items]) => ({ label, items }));
}
// ═══════════════════════════════════════════════
//  6. СТИЛИ ФОРМЫ (инжектируются один раз)
// ═══════════════════════════════════════════════
const CONTENT_FORM_STYLES = `
.content-type-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; }
.content-type-btn {
display:flex; flex-direction:column; align-items:center; gap:6px;
padding:12px 4px; border-radius:10px;
background:var(--bg-input); border:2px solid transparent;
cursor:pointer; transition:all .2s var(--ease);
font-size:.72rem; color:var(--text-secondary);
}
.content-type-btn:hover { border-color:var(--border); transform:translateY(-1px); }
.content-type-btn.active {
border-color:var(--accent); background:var(--accent-dim); color:var(--accent);
}
.content-type-icon { display:flex; align-items:center; justify-content:center; color:var(--accent); }
.content-type-label { text-align:center; line-height:1.2; }
.platform-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; }
.platform-btn {
display:flex; align-items:center; justify-content:center; gap:6px;
padding:8px 6px; border-radius:8px;
background:var(--bg-input); border:2px solid transparent;
cursor:pointer; font-size:.78rem; color:var(--text-secondary);
transition:all .2s var(--ease); text-align:center;
}
.platform-btn:hover { border-color:var(--border); transform:translateY(-1px); }
.platform-btn.active {
border-color:var(--accent); background:var(--accent-dim);
color:var(--accent); font-weight:700;
}
/* 🆕 v3.7.0: индикатор отчётности в карточке */
.cc-report-badge {
display:inline-flex; align-items:center; gap:3px;
padding:2px 8px; border-radius:10px;
font-size:.66rem; font-weight:800;
text-transform:uppercase; letter-spacing:.04em;
}
.cc-report-badge.sent { background:var(--green-dim); color:var(--green); }
@media (max-width:400px) {
.content-type-grid { grid-template-columns:repeat(2,1fr); }
.platform-grid { grid-template-columns:repeat(2,1fr); }
}
`;
if (!document.getElementById('content-form-styles')) {
const style = document.createElement('style');
style.id = 'content-form-styles';
style.textContent = CONTENT_FORM_STYLES;
document.head.appendChild(style);
}