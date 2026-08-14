// 📦 BookTrackerPro — review.js
// 🔖 v3.8.1-fix | 2026-08-09
// 📝 Отзывы бук-блогера
//
//    Структура отзыва:
//      ⭐ Оценка (1–5)
//      👍 Плюсы / 👎 Минусы
//      📝 Текст отзыва
//      💬 Цитаты (страница + «использована»)
//      🎯 Рекомендация · 👥 Для кого · 🔞 Без спойлеров
//
//    Новое в 3.7.0:
//      — Сохранено из 3.6.0: точный фильтр по звёздам (5,4,3,2,1)
//      — Кастомный селект рекомендации (uikit.js)
//      — SVG-иконки из icons.js в хроме
//      — Живой рейтинг с предпросмотром при наведении
//      — Кнопка «📷 Цитата по фото» (OCR, полный оффлайн)
//      — Копирование отзыва для описания видео
// ─────────────────────────────────────────────
import { saveReviewForBook, removeReviewFromBook, loadBooks } from './db.js';
import { esc, showToast } from './app.js';
import { captureQuoteByPhoto } from './ocr.js';
import { icon } from './icons.js';
import { attachCustomSelect } from './uikit.js';

// ═══════════════════════════════════════════════
//  1. ВКЛАДКА «ОТЗЫВЫ»
// ═══════════════════════════════════════════════
export function renderReviewsTab(container, books, callbacks) {
const withReviews = books
.filter(b => b.review && (b.review.text || b.review.rating > 0))
.sort((a, b) => (b.review?.updatedAt || '').localeCompare(a.review?.updatedAt || ''));

if (!container._reviewFilter) container._reviewFilter = 'all';
const filter = container._reviewFilter;

// Точные значения рейтинга: 5, 4, 3, 2, 1
const filters = [
{ id: 'all', label: `Все (${withReviews.length})` },
{ id: 'rated5', label: '⭐ 5' },
{ id: 'rated4', label: '⭐ 4' },
{ id: 'rated3', label: '⭐ 3' },
{ id: 'rated2', label: '⭐ 2' },
{ id: 'rated1', label: '⭐ 1' },
{ id: 'withQuotes', label: `${icon('quote', 12)} С цитатами` },
];

let filtered = withReviews;
if (filter === 'rated5') filtered = withReviews.filter(b => b.review.rating === 5);
else if (filter === 'rated4') filtered = withReviews.filter(b => b.review.rating === 4);
else if (filter === 'rated3') filtered = withReviews.filter(b => b.review.rating === 3);
else if (filter === 'rated2') filtered = withReviews.filter(b => b.review.rating === 2);
else if (filter === 'rated1') filtered = withReviews.filter(b => b.review.rating === 1);
else if (filter === 'withQuotes') filtered = withReviews.filter(b => (b.review.quotes || []).length > 0);

container.innerHTML = `
<div class="filter-bar no-scrollbar">
${filters.map(f => `
<button class="filter-chip ${filter === f.id ? 'active' : ''}" data-rfilter="${f.id}">${f.label}</button>
`).join('')}
</div>
${filtered.length === 0 ? `
<div class="empty-state">
<div class="empty-icon">${icon('pen', 56)}</div>
<div class="empty-title">Нет отзывов</div>
<div class="empty-text">
Откройте книгу и нажмите «Написать отзыв» —
оценка, плюсы, минусы, цитаты
</div>
</div>
` : filtered.map(b => renderReviewCard(b)).join('')}
`;

container.querySelectorAll('[data-rfilter]').forEach(chip => {
chip.addEventListener('click', () => {
container._reviewFilter = chip.dataset.rfilter;
renderReviewsTab(container, books, callbacks);
});
});

container.querySelectorAll('.review-card').forEach(card => {
card.addEventListener('click', (e) => {
if (e.target.closest('button')) return;
callbacks.onOpenBook(card.dataset.bookId);
});
});

container.querySelectorAll('[data-edit-review]').forEach(btn => {
btn.addEventListener('click', (e) => { e.stopPropagation(); callbacks.onEdit(btn.dataset.editReview); });
});

container.querySelectorAll('[data-del-review]').forEach(btn => {
btn.addEventListener('click', (e) => { e.stopPropagation(); callbacks.onDelete(btn.dataset.delReview); });
});

container.querySelectorAll('[data-copy-review]').forEach(btn => {
btn.addEventListener('click', (e) => {
e.stopPropagation();
const book = books.find(b => b.id === btn.dataset.copyReview);
if (book) copyReviewToClipboard(book);
});
});
}

// ═══════════════════════════════════════════════
//  2. КАРТОЧКА ОТЗЫВА
// ═══════════════════════════════════════════════
function renderReviewCard(book) {
const r = book.review || {};
const stars = Array.from({length:5}, (_,i) => `<span style="color:${i<(r.rating||0)?'#e8a33d':'var(--border)'}">${icon('star',14)}</span>`).join('');
const quotesCount = (r.quotes || []).length;
const usedQuotes = (r.quotes || []).filter(q => q.used).length;

return `
<div class="review-card" data-book-id="${book.id}">
<div class="review-header">
${book.coverUrl
? `<img class="review-cover" src="${book.coverUrl}" alt="" loading="lazy" referrerpolicy="no-referrer"/>`
: `<div class="review-cover" style="display:flex;align-items:center;justify-content:center">${icon('bookClosed', 22)}</div>`}
<div style="flex:1;min-width:0">
<div class="review-title">${esc(book.title)}</div>
<div class="review-author">${esc(book.author)}</div>
<div class="review-stars">${stars}</div>
</div>
</div>
${r.pros ? `<div class="review-pros">${icon('heart',14)} ${esc(r.pros)}</div>` : ''}
${r.cons ? `<div class="review-cons">${icon('close',14)} ${esc(r.cons)}</div>` : ''}
${r.text ? `<div class="review-text">${esc(r.text)}</div>` : ''}
${quotesCount > 0 ? `
<div class="text-small text-muted mt-8">
${icon('quote', 12)} ${quotesCount} цитат${usedQuotes > 0 ? ` · ${icon('check', 11)} ${usedQuotes} использовано` : ''}
</div>
` : ''}
${r.recommendation ? `<div class="text-small mt-8">${icon('target', 12)} ${esc(r.recommendation)}</div>` : ''}
<div class="flex gap-8 mt-8" style="flex-wrap:wrap">
<button data-edit-review="${book.id}" class="btn-secondary" style="padding:6px 12px;font-size:.78rem">${icon('edit', 13)} Изменить</button>
<button data-copy-review="${book.id}" class="btn-secondary" style="padding:6px 12px;font-size:.78rem">${icon('copy', 13)} Копировать</button>
<button data-del-review="${book.id}" class="btn-danger" style="padding:6px 12px;font-size:.78rem">${icon('trash', 13)}</button>
</div>
</div>
`;
}

// ═══════════════════════════════════════════════
//  3. ФОРМА ОТЗЫВА
// ═══════════════════════════════════════════════
export function openReviewForm(bookId) {
const overlay = document.getElementById('review-overlay');
const title = document.getElementById('review-form-title');
const body = document.getElementById('review-form-body');
if (!overlay || !body) return;

loadBooks().then(books => {
const book = books.find(b => b.id === bookId);
if (!book) { showToast('❌ Книга не найдена', 'error'); return; }
title.innerHTML = `${icon('pen', 18)} Отзыв: ${esc(book.title)}`;
renderReviewFormBody(body, book);
overlay.classList.remove('hidden');
document.body.style.overflow = 'hidden';
});
}

function renderReviewFormBody(body, book) {
const r = book.review || {};
const quotes = r.quotes || [];

body.innerHTML = `
<!-- Книга -->
<div class="flex gap-8 items-center mb-16">
${book.coverUrl
? `<img src="${book.coverUrl}" referrerpolicy="no-referrer" style="width:48px;height:72px;border-radius:6px;object-fit:cover;box-shadow:2px 2px 8px rgba(0,0,0,.35)"/>`
: `<div style="width:48px;height:72px;border-radius:6px;background:var(--bg-input);display:flex;align-items:center;justify-content:center">${icon('bookClosed', 22)}</div>`}
<div>
<div style="font-weight:700;font-size:.95rem">${esc(book.title)}</div>
<div class="text-small text-muted">${esc(book.author)}</div>
</div>
</div>

<!-- Оценка -->
<div class="form-group">
<label>${icon('star', 13)} Оценка</label>
<div class="star-rating" id="rf-stars">
${[1,2,3,4,5].map(i => `<span class="star ${(r.rating || 0) >= i ? 'filled' : ''}" data-star="${i}">${icon('star',20)}</span>`).join('')}
</div>
<div class="form-hint" id="rf-rating-hint">${ratingHint(r.rating || 0)}</div>
</div>

<!-- Плюсы / Минусы -->
<div class="form-group">
<label>${icon('heart',13)} Плюсы</label>
<textarea id="rf-pros" rows="2" placeholder="Что понравилось: язык, сюжет, персонажи...">${esc(r.pros || '')}</textarea>
</div>
<div class="form-group">
<label>${icon('close',13)} Минусы</label>
<textarea id="rf-cons" rows="2" placeholder="Что не понравилось: затянуто, предсказуемо...">${esc(r.cons || '')}</textarea>
</div>

<!-- Текст -->
<div class="form-group">
<label>${icon('edit', 13)} Текст отзыва</label>
<textarea id="rf-text" rows="5" placeholder="Развёрнутый отзыв для видео или поста...">${esc(r.text || '')}</textarea>
</div>

<!-- Цитаты -->
<div class="form-section">
<h3>${icon('quote', 15)} Цитаты для контента</h3>
<div id="rf-quotes-list">
${quotes.map((q, i) => renderQuoteRow(q, i)).join('')}
</div>
<div class="flex gap-8 mt-8">
<input type="text" id="rf-quote-text" placeholder="Текст цитаты..." style="flex:1"/>
<input type="number" id="rf-quote-page" placeholder="Стр." style="width:70px" min="0"/>
<button id="rf-quote-add" class="btn-secondary" style="width:auto;flex-shrink:0">${icon('plus', 14)}</button>
</div>
<button id="rf-quote-ocr" class="btn-secondary mt-8" style="width:100%">
${icon('camera', 14)} Сфотографировать цитату (OCR)
</button>
</div>

<!-- Рекомендация -->
<div class="form-group">
<label>${icon('target', 13)} Рекомендация</label>
<select id="rf-recommendation">
<option value="" ${!r.recommendation ? 'selected' : ''}>— Не указано —</option>
<option value="Да, рекомендую" ${r.recommendation === 'Да, рекомендую' ? 'selected' : ''}>Да, рекомендую</option>
<option value="Нет, не рекомендую" ${r.recommendation === 'Нет, не рекомендую' ? 'selected' : ''}>Нет, не рекомендую</option>
<option value="С оговорками" ${r.recommendation === 'С оговорками' ? 'selected' : ''}>С оговорками</option>
</select>
</div>

<!-- Для кого -->
<div class="form-group">
<label>${icon('users', 13)} Для кого</label>
<input type="text" id="rf-audience" value="${esc(r.targetAudience || '')}" placeholder="Для любителей фэнтези, возраст 16+"/>
</div>

<!-- Без спойлеров -->
<div class="toggle-row">
<span class="toggle-label">${icon('eye',14)} Без спойлеров</span>
<div class="toggle ${r.spoilerFree !== false ? 'active' : ''}" id="rf-spoiler"></div>
</div>

<!-- Кнопки -->
<div class="btn-group mt-16">
<button id="rf-save" class="btn-primary">${icon('check', 15)} Сохранить отзыв</button>
<button id="rf-copy" class="btn-secondary">${icon('copy', 14)} Копировать</button>
</div>
<div class="btn-group">
<button id="rf-delete" class="btn-danger">${icon('trash', 14)} Удалить отзыв</button>
</div>
`;

// ── Состояние ──
let currentRating = r.rating || 0;
let currentQuotes = [...quotes];

// ── Звёзды (живой предпросмотр) ──
const starsEl = body.querySelector('#rf-stars');
const hintEl = body.querySelector('#rf-rating-hint');

function paintStars(n) {
starsEl.querySelectorAll('.star').forEach(s =>
s.classList.toggle('filled', parseInt(s.dataset.star) <= n));
}

starsEl.querySelectorAll('.star').forEach(star => {
star.addEventListener('click', () => {
currentRating = parseInt(star.dataset.star);
paintStars(currentRating);
hintEl.textContent = ratingHint(currentRating);
});
star.addEventListener('mouseenter', () => {
paintStars(parseInt(star.dataset.star));
hintEl.textContent = ratingHint(parseInt(star.dataset.star));
});
});

starsEl.addEventListener('mouseleave', () => {
paintStars(currentRating);
hintEl.textContent = ratingHint(currentRating);
});

// ── Цитаты ──
const quotesList = body.querySelector('#rf-quotes-list');

function rerenderQuotes() {
quotesList.innerHTML = currentQuotes.length === 0
? '<div class="text-small text-muted" style="padding:8px 0">Пока нет цитат</div>'
: currentQuotes.map((q, i) => renderQuoteRow(q, i)).join('');
bindQuoteEvents();
}

function bindQuoteEvents() {
quotesList.querySelectorAll('[data-quote-del]').forEach(btn => {
btn.addEventListener('click', () => {
currentQuotes.splice(parseInt(btn.dataset.quoteDel), 1);
rerenderQuotes();
});
});

quotesList.querySelectorAll('[data-quote-used]').forEach(btn => {
btn.addEventListener('click', () => {
const i = parseInt(btn.dataset.quoteUsed);
currentQuotes[i].used = !currentQuotes[i].used;
rerenderQuotes();
});
});

quotesList.querySelectorAll('[data-quote-copy]').forEach(btn => {
btn.addEventListener('click', () => {
const q = currentQuotes[parseInt(btn.dataset.quoteCopy)];
const text = `«${q.text}»${q.page ? ` (с. ${q.page})` : ''} — ${book.title}, ${book.author}`;
navigator.clipboard?.writeText(text).then(() => showToast('📋 Цитата скопирована', 'success'));
});
});
}

function addQuote(text, page) {
if (!text) { showToast('⚠️ Введите текст цитаты', 'error'); return; }
currentQuotes.push({ text, page: page || 0, used: false });
rerenderQuotes();
}

body.querySelector('#rf-quote-add').addEventListener('click', () => {
const textEl = body.querySelector('#rf-quote-text');
const pageEl = body.querySelector('#rf-quote-page');
addQuote(textEl.value.trim(), parseInt(pageEl.value) || 0);
textEl.value = ''; pageEl.value = '';
});

body.querySelector('#rf-quote-text').addEventListener('keydown', (e) => {
if (e.key === 'Enter') { e.preventDefault(); body.querySelector('#rf-quote-add').click(); }
});

// ── OCR цитата ──
body.querySelector('#rf-quote-ocr').addEventListener('click', async () => {
const text = await captureQuoteByPhoto();
if (text) {
addQuote(text, 0);
showToast('📷 Цитата распознана — проверьте текст', 'success');
}
});

bindQuoteEvents();
if (currentQuotes.length === 0) rerenderQuotes();

// ── Спойлер ──
body.querySelector('#rf-spoiler').addEventListener('click', function() {
this.classList.toggle('active');
});

// Кастомный селект рекомендации
attachCustomSelect(body.querySelector('#rf-recommendation'), {});

// ── Сохранение ──
body.querySelector('#rf-save').addEventListener('click', async () => {
const review = {
rating: currentRating,
pros: body.querySelector('#rf-pros').value.trim(),
cons: body.querySelector('#rf-cons').value.trim(),
text: body.querySelector('#rf-text').value.trim(),
quotes: currentQuotes,
recommendation: body.querySelector('#rf-recommendation').value,
targetAudience: body.querySelector('#rf-audience').value.trim(),
spoilerFree: body.querySelector('#rf-spoiler').classList.contains('active'),
createdAt: r.createdAt || new Date().toISOString(),
updatedAt: new Date().toISOString(),
};

try {
await saveReviewForBook(book.id, review);
showToast('✅ Отзыв сохранён', 'success');
closeReviewForm();
document.dispatchEvent(new CustomEvent('data-changed'));
} catch (e) {
showToast('❌ Ошибка сохранения', 'error');
console.error('[Review] Save error:', e);
}
});

// ── Копирование ──
body.querySelector('#rf-copy').addEventListener('click', () => {
copyReviewToClipboard({ ...book, review: {
rating: currentRating,
pros: body.querySelector('#rf-pros').value.trim(),
cons: body.querySelector('#rf-cons').value.trim(),
text: body.querySelector('#rf-text').value.trim(),
quotes: currentQuotes,
recommendation: body.querySelector('#rf-recommendation').value,
targetAudience: body.querySelector('#rf-audience').value.trim(),
spoilerFree: body.querySelector('#rf-spoiler').classList.contains('active'),
}});
});

// ── Удаление ──
body.querySelector('#rf-delete').addEventListener('click', async () => {
if (!confirm('Удалить отзыв?')) return;
try {
await removeReviewFromBook(book.id);
showToast('🗑️ Отзыв удалён', 'info');
closeReviewForm();
document.dispatchEvent(new CustomEvent('data-changed'));
} catch { showToast('❌ Ошибка удаления', 'error'); }
});
}

// ═══════════════════════════════════════════════
//  4. СТРОКА ЦИТАТЫ
// ═══════════════════════════════════════════════
function renderQuoteRow(quote, index) {
return `
<div class="quote-item" style="align-items:center">
<div style="flex:1;min-width:0">
<div>«${esc(quote.text)}»</div>
<div class="flex gap-8 mt-8" style="align-items:center">
${quote.page ? `<span class="quote-page">с. ${quote.page}</span>` : ''}
${quote.used
? `<span class="quote-used">${icon('check', 11)} Использована</span>`
: '<span class="text-small text-muted">Не использована</span>'}
</div>
</div>
<div class="flex gap-8" style="flex-shrink:0">
<button data-quote-used="${index}" class="icon-btn" style="width:28px;height:28px"
title="${quote.used ? 'Снять пометку' : 'Пометить как использованную'}">
${quote.used ? icon('refresh', 13) : icon('check', 13)}
</button>
<button data-quote-copy="${index}" class="icon-btn" style="width:28px;height:28px" title="Копировать цитату">${icon('copy', 13)}</button>
<button data-quote-del="${index}" class="icon-btn" style="width:28px;height:28px" title="Удалить цитату">${icon('trash', 13)}</button>
</div>
</div>
`;
}

// ═══════════════════════════════════════════════
//  5. ПОДСКАЗКА К ОЦЕНКЕ
// ═══════════════════════════════════════════════
function ratingHint(n) {
const hints = {
0: 'Нажмите на звезду, чтобы оценить',
1: '💩 Совсем не зашло',
2: '😕 Слабо',
3: '😐 Нормально, но не более',
4: '😊 Хорошо',
5: '🤩 Шедевр!',
};
return hints[n] || hints[0];
}

// ═══════════════════════════════════════════════
//  6. КОПИРОВАНИЕ ОТЗЫВА
// ═══════════════════════════════════════════════
export function copyReviewToClipboard(book) {
const r = book.review || {};
const lines = [];

lines.push('📕 ' + book.title + ' — ' + book.author);
lines.push('');

if (r.rating > 0) {
lines.push('⭐'.repeat(r.rating) + '☆'.repeat(5 - r.rating) + ' ' + r.rating + '/5');
lines.push('');
}

if (r.pros) lines.push('👍 Плюсы: ' + r.pros);
if (r.cons) lines.push('👎 Минусы: ' + r.cons);
if (r.pros || r.cons) lines.push('');

if (r.text) { lines.push(r.text); lines.push(''); }

const quotes = r.quotes || [];
if (quotes.length > 0) {
lines.push('💬 Цитаты:');
for (const q of quotes) lines.push('  «' + q.text + '»' + (q.page ? ' (с. ' + q.page + ')' : ''));
lines.push('');
}

if (r.recommendation) lines.push('🎯 Рекомендация: ' + r.recommendation);
if (r.targetAudience) lines.push('👥 Для: ' + r.targetAudience);
if (r.spoilerFree !== false) lines.push('🔞 Без спойлеров');

// ИСПРАВЛЕНО: \n записано двумя символами, без реального переноса
const text = lines.join('\n');

navigator.clipboard?.writeText(text).then(() => {
showToast('📋 Отзыв скопирован! Вставьте в описание видео', 'success');
}).catch(() => {
prompt('Скопируйте отзыв:', text);
});
}

// ═══════════════════════════════════════════════
//  7. УДАЛЕНИЕ И ЗАКРЫТИЕ
// ═══════════════════════════════════════════════
export async function deleteReview(bookId) {
await removeReviewFromBook(bookId);
}

function closeReviewForm() {
const overlay = document.getElementById('review-overlay');
if (overlay) {
overlay.classList.add('hidden');
document.body.style.overflow = '';
}
}
// ─────────────────────────────────────────────