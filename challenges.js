// 📦 BookTrackerPro — challenges.js
// 🔖 v3.8.1 | 2026-08-07
// 📝 Челленджи чтения
//
//    Типы целей:
//      📚 books   — количество книг
//      📄 pages   — количество страниц
//      🏷️ tag     — книги с тегом/жанром
//      ✍️ reviews — количество отзывов
//      🎬 content — количество контента
//
//    Статусы:
//      📅 planned → 🟢 active → 🏆 completed / 💀 failed
//
//    Прогресс считается автоматически из данных книг.
//    Книга может быть в нескольких челленджах.
//    Заметки: notes: [{ text, date }]
//
//    Новое в 3.7.0:
//      — esc / showToast из utils.js (разрыв цикла)
//      — trackOverlay / untrackOverlay для оверлеев
//        формы и выбора книг (жест «назад»)
//      — Кастомный селект статуса (uikit.js)
//      — Дата-пикеры для периода (uikit.js)
//
//    Сохранено из 3.5.0:
//      — SVG-иконки типов целей из icons.js (GOAL_ICONS)
//      — Кнопки-хром на icon() (править/удалить/добавить/назад)
//      — Пользовательские эмодзи и статусы
// ─────────────────────────────────────────────
import { loadChallenges, putChallenge, delChallenge,
         addBookToChallenge, removeBookFromChallenge } from './db.js';
import { esc, showToast } from './utils.js';
import { trackOverlay, untrackOverlay } from './app.js';
import { attachCustomSelect, attachDatePicker } from './uikit.js';
import { icon, GOAL_ICONS } from './icons.js';

// ═══════════════════════════════════════════════
//  КОНСТАНТЫ
// ═══════════════════════════════════════════════
export const GOAL_TYPES = {
books:   { icon: '📚', label: 'Количество книг',    unit: 'книг' },
pages:   { icon: '📄', label: 'Количество страниц', unit: 'стр.' },
tag:     { icon: '🏷️', label: 'Книги с тегом',      unit: 'книг' },
reviews: { icon: '✍️', label: 'Количество отзывов', unit: 'отзывов' },
content: { icon: '🎬', label: 'Количество контента', unit: 'единиц' },
};

export const CHALLENGE_STATUSES = {
planned:   { icon: '📅', label: 'Запланирован', class: 'status-planned' },
active:    { icon: '🟢', label: 'Активен',      class: 'status-active' },
completed: { icon: '🏆', label: 'Завершён',     class: 'status-completed' },
failed:    { icon: '💀', label: 'Провален',     class: 'status-failed' },
};

/**
* SVG-иконка типа цели (из icons.js).
* @param {string} goalType — books / pages / tag / reviews / content
* @param {number} size
*/
function goalIcon(goalType, size = 14) {
return icon(GOAL_ICONS[goalType] || 'target', size);
}

// ═══════════════════════════════════════════════
//  1. РАСЧЁТ ПРОГРЕССА
// ═══════════════════════════════════════════════
/**
* Считает текущий прогресс челленджа из данных книг.
* @param {object} challenge
* @param {object[]} books — все книги
* @returns {{ current, target, percent, detail }}
*/
export function calcChallengeProgress(challenge, books) {
const target = challenge.goalValue || 1;
const chBooks = books.filter(b => challenge.bookIds.includes(b.id));

// Фильтр по периоду (если задан)
const inPeriod = (dateStr) => {
if (!dateStr) return false;
if (challenge.startDate && dateStr < challenge.startDate) return false;
if (challenge.endDate && dateStr > challenge.endDate) return false;
return true;
};

let current = 0;
let detail = '';

switch (challenge.goalType) {
case 'books': {
const done = chBooks.filter(b =>
b.status === 'finished' && inPeriod(b.dateFinished)
);
current = done.length;
detail = `${current} из ${chBooks.length} книг прочитано`;
break;
}
case 'pages': {
const done = chBooks.filter(b =>
b.status === 'finished' && inPeriod(b.dateFinished)
);
current = done.reduce((s, b) => s + (b.pageCount || 0), 0);
detail = `${current.toLocaleString('ru')} из ${target.toLocaleString('ru')} страниц`;
break;
}
case 'tag': {
const tag = (challenge.goalTag || '').toLowerCase();
const done = chBooks.filter(b => {
const matchTag = (b.tags || []).some(t => t.toLowerCase() === tag)
|| (b.genre || '').toLowerCase() === tag;
return matchTag && b.status === 'finished' && inPeriod(b.dateFinished);
});
current = done.length;
detail = `${current} книг с тегом «${challenge.goalTag}»`;
break;
}
case 'reviews': {
const done = chBooks.filter(b =>
b.review && (b.review.text || b.review.rating > 0)
);
current = done.length;
detail = `${current} отзывов написано`;
break;
}
case 'content': {
let count = 0;
for (const b of chBooks) {
count += (b.contentItems || []).filter(c => c.status === 'published').length;
}
current = count;
detail = `${current} единиц контента опубликовано`;
break;
}
default:
current = 0;
}

const percent = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
return { current, target, percent, detail };
}

/**
* Определяет, завершён ли челлендж (для авто-проверки).
*/
export function isChallengeComplete(challenge, books) {
const { current, target } = calcChallengeProgress(challenge, books);
return current >= target;
}

/**
* Осталось дней до конца челленджа.
*/
export function daysLeft(challenge) {
if (!challenge.endDate) return null;
const end = new Date(challenge.endDate + 'T23:59:59');
const now = new Date();
return Math.max(0, Math.ceil((end - now) / 86400000));
}

// ═══════════════════════════════════════════════
//  2. СПИСОК ЧЕЛЛЕНДЖЕЙ
// ═══════════════════════════════════════════════
/**
* Рендерит вкладку челленджей.
* @param {HTMLElement} container
* @param {object[]} challenges
* @param {object[]} books
* @param {object} callbacks — { onOpen, onAdd, onEdit, onDelete }
*/
export function renderChallengesList(container, challenges, books, callbacks) {
// Сортировка: активные → запланированные → завершённые → проваленные
const order = { active: 0, planned: 1, completed: 2, failed: 3 };
const sorted = [...challenges].sort((a, b) =>
(order[a.status] ?? 9) - (order[b.status] ?? 9)
);
const active = sorted.filter(c => c.status === 'active');
const planned = sorted.filter(c => c.status === 'planned');
const done = sorted.filter(c => c.status === 'completed' || c.status === 'failed');

container.innerHTML = `
${sorted.length === 0 ? `
<div class="empty-state">
<div class="empty-icon">${icon('trophy', 56)}</div>
<div class="empty-title">Нет челленджей</div>
<div class="empty-text">
Создайте челлендж — например «Прочитать 5 книг
в жанре фэнтези за август»
</div>
<button id="ch-empty-add" class="btn-primary mt-16" style="width:auto">
${icon('plus', 16)} Создать челлендж
</button>
</div>
` : `
${active.length > 0 ? `
<div class="mb-16">
<div class="text-small text-muted mb-8" style="font-weight:700">🟢 Активные</div>
${active.map(c => renderChallengeCard(c, books)).join('')}
</div>
` : ''}
${planned.length > 0 ? `
<div class="mb-16">
<div class="text-small text-muted mb-8" style="font-weight:700">📅 Запланированные</div>
${planned.map(c => renderChallengeCard(c, books)).join('')}
</div>
` : ''}
${done.length > 0 ? `
<div class="mb-16">
<div class="text-small text-muted mb-8" style="font-weight:700">🏁 Завершённые</div>
${done.map(c => renderChallengeCard(c, books)).join('')}
</div>
` : ''}
<button id="ch-add-btn" class="btn-primary">
${icon('plus', 16)} Новый челлендж
</button>
`}
`;

// События
const addBtn = container.querySelector('#ch-add-btn');
const emptyAdd = container.querySelector('#ch-empty-add');
if (addBtn) addBtn.addEventListener('click', () => callbacks.onAdd());
if (emptyAdd) emptyAdd.addEventListener('click', () => callbacks.onAdd());

container.querySelectorAll('.challenge-card').forEach(card => {
card.addEventListener('click', (e) => {
if (e.target.closest('button')) return;
callbacks.onOpen(card.dataset.chId);
});
});
}

function renderChallengeCard(ch, books) {
const st = CHALLENGE_STATUSES[ch.status] || CHALLENGE_STATUSES.planned;
const gt = GOAL_TYPES[ch.goalType] || GOAL_TYPES.books;
const prog = calcChallengeProgress(ch, books);
const left = daysLeft(ch);

return `
<div class="challenge-card" data-ch-id="${ch.id}">
<div class="challenge-emoji">${ch.emoji || '🏆'}</div>
<div class="challenge-info">
<div class="challenge-name">${esc(ch.name)}</div>
<div class="challenge-meta">
${goalIcon(ch.goalType, 13)} ${prog.current} / ${prog.target} ${gt.unit}
${ch.startDate && ch.endDate
? ` · ${formatShort(ch.startDate)} — ${formatShort(ch.endDate)}`
: ''}
${left !== null && ch.status === 'active'
? ` · ⏳ ${left} дн.` : ''}
</div>
<div class="challenge-progress-track">
<div class="challenge-progress-fill ${ch.status}"
style="width:${prog.percent}%"></div>
</div>
</div>
<div class="challenge-side">
<span class="challenge-percent">${prog.percent}%</span>
<span class="challenge-status ${st.class}">${st.icon} ${st.label}</span>
</div>
</div>
`;
}

// ═══════════════════════════════════════════════
//  3. ЭКРАН ЧЕЛЛЕНДЖА
// ═══════════════════════════════════════════════
/**
* Рендерит экран одного челленджа.
* @param {HTMLElement} container
* @param {object} challenge
* @param {object[]} books
* @param {object} callbacks — { onBack, onEdit, onDelete, onOpenBook,
*                              onAddBook, onStatusChange, onAddNote, onDelNote }
*/
export function renderChallengeDetail(container, challenge, books, callbacks) {
const st = CHALLENGE_STATUSES[challenge.status] || CHALLENGE_STATUSES.planned;
const gt = GOAL_TYPES[challenge.goalType] || GOAL_TYPES.books;
const prog = calcChallengeProgress(challenge, books);
const left = daysLeft(challenge);
const chBooks = books.filter(b => challenge.bookIds.includes(b.id));
const notes = challenge.notes || [];

container.innerHTML = `
<button id="chd-back" class="btn-secondary mb-16">${icon('arrowLeft', 14)} Челленджи</button>

<!-- Шапка -->
<div class="challenge-hero ${challenge.status}">
<div class="challenge-hero-emoji">${challenge.emoji || '🏆'}</div>
<div class="challenge-hero-info">
<h2>${esc(challenge.name)}</h2>
${challenge.description
? `<div class="challenge-hero-desc">${esc(challenge.description)}</div>`
: ''}
<div class="challenge-hero-meta">
<span class="challenge-status ${st.class}">${st.icon} ${st.label}</span>
${challenge.startDate && challenge.endDate
? `<span>📅 ${formatShort(challenge.startDate)} — ${formatShort(challenge.endDate)}</span>`
: '<span>♾️ Без ограничения</span>'}
${left !== null && challenge.status === 'active'
? `<span>⏳ Осталось ${left} дн.</span>` : ''}
</div>
</div>
<div class="challenge-hero-actions">
<button id="chd-edit" class="btn-secondary" style="padding:8px 12px" title="Редактировать">${icon('edit', 15)}</button>
<button id="chd-del" class="btn-danger" style="padding:8px 12px" title="Удалить">${icon('trash', 15)}</button>
</div>
</div>

<!-- Прогресс -->
<div class="challenge-progress-hero">
<div class="challenge-progress-numbers">
<span class="challenge-big-num">${prog.current}</span>
<span class="challenge-of">из ${prog.target} ${gt.unit}</span>
</div>
<div class="challenge-progress-track big">
<div class="challenge-progress-fill ${challenge.status}"
style="width:${prog.percent}%"></div>
</div>
<div class="challenge-progress-detail">
${goalIcon(challenge.goalType, 13)} ${prog.detail} · ${prog.percent}%
</div>
</div>

<!-- Управление статусом -->
${challenge.status === 'planned' ? `
<button id="chd-start" class="btn-primary mt-16">
🟢 Начать челлендж
</button>
` : ''}
${challenge.status === 'active' && prog.percent >= 100 ? `
<button id="chd-complete" class="btn-primary mt-16" style="background:var(--green)">
🏆 Завершить челлендж
</button>
` : ''}

<!-- Книги челленджа -->
<div class="detail-section">
<h3>📚 Книги (${chBooks.length})</h3>
${chBooks.length === 0
? '<div class="text-muted text-small">Добавьте книги в челлендж</div>'
: chBooks.map(b => renderChallengeBook(b)).join('')}
<button id="chd-add-book" class="btn-secondary mt-8" style="width:100%">
${icon('plus', 14)} Добавить книгу
</button>
</div>

<!-- Заметки -->
<div class="detail-section">
<h3>📝 Заметки (${notes.length})</h3>
<div id="chd-notes">
${notes.length === 0
? '<div class="text-muted text-small">Пока нет заметок</div>'
: notes.map((n, i) => `
<div class="challenge-note">
<div class="challenge-note-date">${formatShort(n.date)}</div>
<div class="challenge-note-text">${esc(n.text)}</div>
<button data-note-del="${i}" class="icon-btn"
style="width:28px;height:28px;flex-shrink:0" title="Удалить заметку">${icon('trash', 13)}</button>
</div>
`).join('')}
</div>
<div class="flex gap-8 mt-8">
<input type="text" id="chd-note-input" placeholder="Новая заметка..."
style="flex:1" autocomplete="off"/>
<button id="chd-note-add" class="btn-secondary" style="width:auto;flex-shrink:0">${icon('plus', 14)}</button>
</div>
</div>
`;

// ── События ──
container.querySelector('#chd-back').addEventListener('click', () => callbacks.onBack());
container.querySelector('#chd-edit').addEventListener('click', () => callbacks.onEdit(challenge));
container.querySelector('#chd-del').addEventListener('click', () => callbacks.onDelete(challenge.id));

const startBtn = container.querySelector('#chd-start');
if (startBtn) startBtn.addEventListener('click', () => callbacks.onStatusChange(challenge.id, 'active'));

const completeBtn = container.querySelector('#chd-complete');
if (completeBtn) completeBtn.addEventListener('click', () => callbacks.onStatusChange(challenge.id, 'completed'));

container.querySelector('#chd-add-book').addEventListener('click', () => callbacks.onAddBook(challenge.id));

container.querySelectorAll('[data-chd-book]').forEach(el => {
el.addEventListener('click', (e) => {
if (e.target.closest('[data-chd-book-del]')) return;
callbacks.onOpenBook(el.dataset.chdBook);
});
});

container.querySelectorAll('[data-chd-book-del]').forEach(btn => {
btn.addEventListener('click', (e) => {
e.stopPropagation();
removeBookFromChallenge(challenge.id, btn.dataset.chdBookDel).then(() => {
showToast('Книга убрана из челленджа', 'info');
document.dispatchEvent(new CustomEvent('data-changed'));
});
});
});

// Заметки
const addNote = () => {
const input = container.querySelector('#chd-note-input');
const text = input.value.trim();
if (!text) return;
callbacks.onAddNote(challenge.id, text);
input.value = '';
};
container.querySelector('#chd-note-add').addEventListener('click', addNote);
container.querySelector('#chd-note-input').addEventListener('keydown', (e) => {
if (e.key === 'Enter') addNote();
});

container.querySelectorAll('[data-note-del]').forEach(btn => {
btn.addEventListener('click', () => callbacks.onDelNote(challenge.id, parseInt(btn.dataset.noteDel)));
});
}

function renderChallengeBook(b) {
const st = {
wishlist: { icon: '🌟', label: 'Wishlist' },
added:    { icon: '📦', label: 'Добавлено' },
reading:  { icon: '📖', label: 'Читаю' },
paused:   { icon: '⏸️', label: 'Пауза' },
finished: { icon: '✅', label: 'Прочитано' },
dropped:  { icon: '❌', label: 'Брошено' },
}[b.status] || { icon: '📕', label: b.status };

return `
<div class="content-list-item" data-chd-book="${b.id}" style="cursor:pointer">
${b.coverUrl
? `<img src="${b.coverUrl}" referrerpolicy="no-referrer" style="width:32px;height:48px;border-radius:4px;object-fit:cover"/>`
: `<span style="font-size:1.2rem">📕</span>`}
<div class="content-list-info">
<div class="content-list-title">${esc(b.title)}</div>
<div class="content-list-sub">
${st.icon} ${st.label}
${b.status === 'finished' && b.readingDays ? ` · ${b.readingDays} дн.` : ''}
${b.pageCount ? ` · ${b.pageCount} стр.` : ''}
</div>
</div>
<button data-chd-book-del="${b.id}" class="icon-btn"
style="width:28px;height:28px;flex-shrink:0"
title="Убрать из челленджа">${icon('close', 13)}</button>
</div>
`;
}

// ═══════════════════════════════════════════════
//  4. ФОРМА ЧЕЛЛЕНДЖА
// ═══════════════════════════════════════════════
/**
* Открывает форму создания/редактирования челленджа.
* @param {object|null} challenge — null для нового
* @param {object[]} books — для подсказок тегов
* @param {function} onSave — (data) => void
*/
export function openChallengeForm(challenge, books, onSave) {
const c = challenge || {};
const isEdit = !!challenge;

// Собираем все теги и жанры для подсказки
const allTags = new Set();
for (const b of books) {
(b.tags || []).forEach(t => allTags.add(t));
if (b.genre) allTags.add(b.genre);
}

const overlay = document.createElement('div');
overlay.className = 'overlay';
overlay.innerHTML = `
<div class="overlay-panel" style="max-height:88dvh">
<div class="overlay-header">
<h2>${isEdit ? `${icon('edit', 18)} Редактировать челлендж` : `${icon('trophy', 18)} Новый челлендж`}</h2>
<button class="icon-btn ch-form-close">${icon('close', 16)}</button>
</div>
<div class="overlay-body">
<div class="form-row">
<div class="form-group">
<label>Эмодзи</label>
<input type="text" id="ch-f-emoji" value="${esc(c.emoji || '🏆')}"
maxlength="4" style="text-align:center;font-size:1.5rem"/>
</div>
<div class="form-group">
<label>Название *</label>
<input type="text" id="ch-f-name" value="${esc(c.name || '')}"
placeholder="Фэнтези-марафон" required/>
</div>
</div>
<div class="form-group">
<label>Описание</label>
<textarea id="ch-f-desc" rows="2"
placeholder="Прочитать 5 книг в жанре фэнтези за август...">${esc(c.description || '')}</textarea>
</div>

<!-- Тип цели -->
<div class="form-group">
<label>Тип цели</label>
<div class="goal-type-grid">
${Object.entries(GOAL_TYPES).map(([key, gt]) => `
<button class="goal-type-btn ${(c.goalType || 'books') === key ? 'active' : ''}"
data-goal="${key}">
<span class="goal-type-icon">${goalIcon(key, 22)}</span>
<span class="goal-type-label">${gt.label}</span>
</button>
`).join('')}
</div>
</div>

<!-- Значение цели -->
<div class="form-row">
<div class="form-group">
<label id="ch-f-value-label">Цель (книг)</label>
<input type="number" id="ch-f-value" value="${c.goalValue || 5}" min="1"/>
</div>
<div class="form-group" id="ch-f-tag-group"
style="${(c.goalType || 'books') === 'tag' ? '' : 'display:none'}">
<label>Тег / жанр</label>
<input type="text" id="ch-f-tag" value="${esc(c.goalTag || '')}"
placeholder="фэнтези" list="ch-tag-suggestions"/>
<datalist id="ch-tag-suggestions">
${[...allTags].map(t => `<option value="${esc(t)}"/>`).join('')}
</datalist>
</div>
</div>

<!-- Период -->
<div class="form-group">
<label>Период</label>
<div class="toggle-row" style="padding:4px 0">
<span class="toggle-label text-small">📅 Ограничить датами</span>
<div class="toggle ${c.startDate ? 'active' : ''}" id="ch-f-hasdates"></div>
</div>
<div id="ch-f-dates" class="form-row" style="${c.startDate ? '' : 'display:none'}">
<div class="form-group">
<label>Начало</label>
<input type="date" id="ch-f-start" value="${c.startDate || ''}"/>
</div>
<div class="form-group">
<label>Конец</label>
<input type="date" id="ch-f-end" value="${c.endDate || ''}"/>
</div>
</div>
</div>

<!-- Статус -->
<div class="form-group">
<label>Статус</label>
<select id="ch-f-status">
<option value="planned" ${(c.status || 'planned') === 'planned' ? 'selected' : ''}>
📅 Запланирован
</option>
<option value="active" ${c.status === 'active' ? 'selected' : ''}>
🟢 Активен
</option>
</select>
</div>

<button id="ch-f-save" class="btn-primary">${icon('check', 15)} Сохранить</button>
</div>
</div>
`;

document.body.appendChild(overlay);
document.body.style.overflow = 'hidden';
trackOverlay(overlay); // 🆕 v3.8.1: жест «назад»

let goalType = c.goalType || 'books';

const close = () => {
overlay.remove();
untrackOverlay(overlay); // 🆕 v3.8.1
document.body.style.overflow = '';
};

overlay.querySelector('.ch-form-close').addEventListener('click', close);
overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

// 🆕 v3.8.1: кастомный селект статуса + дата-пикеры
attachCustomSelect(overlay.querySelector('#ch-f-status'), {});
attachDatePicker(overlay.querySelector('#ch-f-start'));
attachDatePicker(overlay.querySelector('#ch-f-end'));

// Тип цели
overlay.querySelectorAll('.goal-type-btn').forEach(btn => {
btn.addEventListener('click', () => {
overlay.querySelectorAll('.goal-type-btn').forEach(b => b.classList.remove('active'));
btn.classList.add('active');
goalType = btn.dataset.goal;
const tagGroup = overlay.querySelector('#ch-f-tag-group');
tagGroup.style.display = goalType === 'tag' ? '' : 'none';
const valueLabel = overlay.querySelector('#ch-f-value-label');
valueLabel.textContent = `Цель (${GOAL_TYPES[goalType].unit})`;
});
});

// Период
overlay.querySelector('#ch-f-hasdates').addEventListener('click', function() {
this.classList.toggle('active');
overlay.querySelector('#ch-f-dates').style.display =
this.classList.contains('active') ? '' : 'none';
});

// Сохранение
overlay.querySelector('#ch-f-save').addEventListener('click', () => {
const name = overlay.querySelector('#ch-f-name').value.trim();
if (!name) {
showToast('⚠️ Введите название', 'error');
return;
}
const hasDates = overlay.querySelector('#ch-f-hasdates').classList.contains('active');
const data = {
id: c.id || `ch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
name,
emoji: overlay.querySelector('#ch-f-emoji').value.trim() || '🏆',
description: overlay.querySelector('#ch-f-desc').value.trim(),
goalType,
goalValue: parseInt(overlay.querySelector('#ch-f-value').value) || 1,
goalTag: goalType === 'tag' ? overlay.querySelector('#ch-f-tag').value.trim() : '',
startDate: hasDates ? overlay.querySelector('#ch-f-start').value : '',
endDate: hasDates ? overlay.querySelector('#ch-f-end').value : '',
status: overlay.querySelector('#ch-f-status').value,
bookIds: c.bookIds || [],
notes: c.notes || [],
createdAt: c.createdAt || new Date().toISOString(),
};
onSave(data);
close();
});
}

// ═══════════════════════════════════════════════
//  5. ВЫБОР КНИГ ДЛЯ ЧЕЛЛЕНДЖА
// ═══════════════════════════════════════════════
/**
* Открывает оверлей: выбрать книги для челленджа.
* @param {string} challengeId
* @param {object} challenge
* @param {object[]} books
* @param {function} onDone
*/
export function openAddBooksToChallenge(challengeId, challenge, books, onDone) {
const inCh = new Set(challenge.bookIds);
const available = books.filter(b => !inCh.has(b.id));

const overlay = document.createElement('div');
overlay.className = 'overlay';
overlay.innerHTML = `
<div class="overlay-panel" style="max-height:80dvh">
<div class="overlay-header">
<h2>${challenge.emoji || '🏆'} ${esc(challenge.name)}</h2>
<button class="icon-btn ch-books-close">${icon('close', 16)}</button>
</div>
<div class="overlay-body">
${available.length === 0 ? `
<div class="text-center text-muted" style="padding:30px">
Все книги уже в челлендже
</div>
` : `
<div class="form-group">
<input type="text" id="ch-books-search"
placeholder="${icon('search', 13)} Поиск по названию или автору..."
autocomplete="off"/>
</div>
<div id="ch-books-list">
${available.map(b => `
<label class="picker-row" data-search="${(b.title + ' ' + b.author).toLowerCase()}">
<input type="checkbox" data-book-id="${b.id}"/>
${b.coverUrl
? `<img src="${b.coverUrl}" referrerpolicy="no-referrer" style="width:32px;height:48px;border-radius:4px;object-fit:cover"/>`
: `<span style="width:32px;height:48px;display:flex;align-items:center;justify-content:center;background:var(--bg-input);border-radius:4px">📕</span>`}
<span class="picker-name" style="flex:1">${esc(b.title)}</span>
</label>
`).join('')}
</div>
<button id="ch-books-save" class="btn-primary mt-16">
${icon('check', 15)} Добавить выбранные
</button>
`}
</div>
</div>
`;

document.body.appendChild(overlay);
document.body.style.overflow = 'hidden';
trackOverlay(overlay); // 🆕 v3.8.1: жест «назад»

const close = () => {
overlay.remove();
untrackOverlay(overlay); // 🆕 v3.8.1
document.body.style.overflow = '';
};

overlay.querySelector('.ch-books-close').addEventListener('click', close);
overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

const searchInput = overlay.querySelector('#ch-books-search');
if (searchInput) {
searchInput.addEventListener('input', () => {
const q = searchInput.value.toLowerCase().trim();
overlay.querySelectorAll('#ch-books-list .picker-row').forEach(row => {
row.style.display = row.dataset.search.includes(q) ? '' : 'none';
});
});
}

const saveBtn = overlay.querySelector('#ch-books-save');
if (saveBtn) {
saveBtn.addEventListener('click', async () => {
const checked = overlay.querySelectorAll('#ch-books-list input:checked');
for (const cb of checked) {
await addBookToChallenge(challengeId, cb.dataset.bookId);
}
showToast(`✅ Добавлено: ${checked.length}`, 'success');
close();
if (onDone) onDone();
});
}
}

// ═══════════════════════════════════════════════
//  6. ОПЕРАЦИИ (для app.js)
// ═══════════════════════════════════════════════
export async function createChallenge(data) {
await putChallenge(data);
}

export async function updateChallenge(data) {
await putChallenge(data);
}

export async function deleteChallengeById(id) {
await delChallenge(id);
}

export async function addChallengeNote(challengeId, text) {
const challenges = await loadChallenges();
const ch = challenges.find(c => c.id === challengeId);
if (!ch) return;
if (!ch.notes) ch.notes = [];
ch.notes.unshift({ text, date: new Date().toISOString().slice(0, 10) });
await putChallenge(ch);
}

export async function removeChallengeNote(challengeId, index) {
const challenges = await loadChallenges();
const ch = challenges.find(c => c.id === challengeId);
if (!ch || !ch.notes) return;
ch.notes.splice(index, 1);
await putChallenge(ch);
}

// ═══════════════════════════════════════════════
//  7. УТИЛИТЫ
// ═══════════════════════════════════════════════
function formatShort(dateStr) {
if (!dateStr) return '';
try {
const d = new Date(dateStr + 'T00:00:00');
return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
} catch {
return dateStr;
}
}

// ═══════════════════════════════════════════════
//  8. СТИЛИ (инжектируются один раз)
// ═══════════════════════════════════════════════
const CHALLENGE_STYLES = `
.challenge-card {
display:flex; align-items:center; gap:14px;
padding:14px 16px;
background:var(--bg-card);
border:1px solid var(--border);
border-radius:var(--radius);
cursor:pointer;
transition:all .2s;
margin-bottom:8px;
}
.challenge-card:hover {
border-color:var(--accent);
background:var(--bg-card-hover);
transform:translateY(-1px);
box-shadow:var(--shadow-sm);
}
.challenge-emoji { font-size:1.8rem; flex-shrink:0; }
.challenge-info { flex:1; min-width:0; }
.challenge-name { font-size:.95rem; font-weight:700; }
.challenge-meta {
font-size:.78rem; color:var(--text-secondary); margin:2px 0 6px;
display:flex; align-items:center; gap:4px; flex-wrap:wrap;
}
.challenge-progress-track {
height:6px; background:var(--bg-input);
border-radius:3px; overflow:hidden;
}
.challenge-progress-track.big { height:12px; border-radius:6px; margin-top:10px; }
.challenge-progress-fill {
height:100%; border-radius:3px;
background:linear-gradient(90deg, var(--accent), var(--purple));
transition:width .6s cubic-bezier(.4,0,.2,1);
}
.challenge-progress-fill.active {
background:linear-gradient(90deg, var(--green), var(--cyan));
}
.challenge-progress-fill.completed {
background:linear-gradient(90deg, var(--orange), var(--pink));
}
.challenge-progress-fill.failed {
background:var(--red);
}
.challenge-side {
display:flex; flex-direction:column; align-items:flex-end; gap:4px;
flex-shrink:0;
}
.challenge-percent { font-size:1rem; font-weight:800; color:var(--accent); }
.challenge-status {
font-size:.7rem; font-weight:700;
padding:2px 8px; border-radius:10px;
white-space:nowrap;
}
.challenge-status.status-planned { background:var(--accent-dim); color:var(--accent); }
.challenge-status.status-active { background:var(--green-dim); color:var(--green); }
.challenge-status.status-completed { background:var(--orange-dim); color:var(--orange); }
.challenge-status.status-failed { background:var(--red-dim); color:var(--red); }
/* Шапка челленджа */
.challenge-hero {
display:flex; gap:16px; align-items:flex-start;
padding:18px;
border:1px solid var(--border);
border-radius:var(--radius-lg);
margin-bottom:16px;
background:linear-gradient(135deg, var(--bg-card), var(--bg-secondary));
}
.challenge-hero.active {
border-color:var(--green);
background:linear-gradient(135deg, var(--green-dim), var(--bg-secondary));
}
.challenge-hero.completed {
border-color:var(--orange);
background:linear-gradient(135deg, var(--orange-dim), var(--bg-secondary));
}
.challenge-hero-emoji { font-size:3rem; line-height:1; }
.challenge-hero-info { flex:1; min-width:0; }
.challenge-hero-info h2 { font-size:1.2rem; font-weight:800; line-height:1.2; }
.challenge-hero-desc { font-size:.85rem; color:var(--text-secondary); margin-top:4px; }
.challenge-hero-meta {
display:flex; flex-wrap:wrap; gap:10px; align-items:center;
margin-top:8px; font-size:.8rem; color:var(--text-secondary);
}
.challenge-hero-actions { display:flex; gap:6px; flex-shrink:0; }
/* Прогресс в шапке */
.challenge-progress-hero {
padding:16px 18px;
background:var(--bg-card);
border:1px solid var(--border);
border-radius:var(--radius);
}
.challenge-progress-numbers {
display:flex; align-items:baseline; gap:8px;
}
.challenge-big-num {
font-size:2.2rem; font-weight:900; color:var(--accent);
line-height:1;
}
.challenge-of { font-size:.9rem; color:var(--text-secondary); }
.challenge-progress-detail {
font-size:.8rem; color:var(--text-muted); margin-top:8px; text-align:right;
display:flex; align-items:center; gap:5px; justify-content:flex-end;
}
/* Заметки */
.challenge-note {
display:flex; align-items:flex-start; gap:10px;
padding:10px 12px;
background:var(--bg-input);
border-radius:var(--radius-sm);
border-left:3px solid var(--accent);
margin-bottom:8px;
}
.challenge-note-date {
font-size:.72rem; color:var(--text-muted);
white-space:nowrap; padding-top:2px;
min-width:48px;
}
.challenge-note-text { flex:1; font-size:.88rem; }
/* Форма: тип цели */
.goal-type-grid {
display:grid; grid-template-columns:repeat(3,1fr); gap:8px;
}
.goal-type-btn {
display:flex; flex-direction:column; align-items:center; gap:6px;
padding:12px 4px;
border-radius:10px;
background:var(--bg-input);
border:2px solid transparent;
cursor:pointer;
transition:all .2s;
font-size:.72rem;
color:var(--text-secondary);
}
.goal-type-btn:hover { border-color:var(--border); transform:translateY(-1px); }
.goal-type-btn.active {
border-color:var(--accent);
background:var(--accent-dim);
color:var(--accent);
}
.goal-type-icon {
display:flex; align-items:center; justify-content:center;
color:var(--accent);
}
.goal-type-label { text-align:center; line-height:1.2; }
@media (max-width:400px) {
.goal-type-grid { grid-template-columns:repeat(2,1fr); }
}
`;

if (!document.getElementById('challenge-styles')) {
const style = document.createElement('style');
style.id = 'challenge-styles';
style.textContent = CHALLENGE_STYLES;
document.head.appendChild(style);
}
// ─────────────────────────────────────────────