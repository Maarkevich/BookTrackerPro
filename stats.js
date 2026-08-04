// ─────────────────────────────────────────────
// 📦 BookTrackerPro — stats.js
// 🔖 v3.6.0 | 2026-08-04
// 📝 Статистика + Календарь
//
//    Подвкладки:
//      📚 Книги    — статусы, жанры, издательства, время чтения
//      🎬 Контент  — типы, площадки, статусы, топ книг
//      💰 Финансы  — траты, средняя цена, по издательствам
//      🏆 Блог     — PR, конверсия, челленджи, серии, цитаты
//
//    Живая статистика: count-up чисел, анимация баров
//
//    Новое в 3.6.0:
//      — ФИКС РЕГРЕССИИ: renderStatsTab(container, books, settings, challenges)
//        принимает челленджи 4-м параметром и передаёт в renderBlogStats.
//        Убран window._challengesCache (глобал удалён в 3.5.0).
//      — SVG-иконки из icons.js в хроме (статусы, типы, площадки)
//      — referrerpolicy no-referrer на обложках
//      — Сохранено: кликабельный контент в календаре → onOpenContent
// ─────────────────────────────────────────────
import { esc } from './app.js';
import { formatPrice, convertToDefault } from './app.js';
import { BOOK_STATUSES, CURRENCIES } from './db.js';
import { CONTENT_TYPES, CONTENT_STATUSES, PLATFORMS, platformIcon } from './content.js';
import { calcChallengeProgress } from './challenges.js';
import { getSeriesList } from './series.js';
import { icon, statusIcon, contentTypeIcon, CONTENT_STATUS_ICONS } from './icons.js';

// ═══════════════════════════════════════════════
//  1. ВКЛАДКА «СТАТИСТИКА»
// ═══════════════════════════════════════════════
/**
* Рендерит вкладку статистики.
* @param {HTMLElement} container
* @param {object[]} books
* @param {object} settings
* @param {object[]} challenges — 🆕 v3.6.0: передаются из app.js
*/
export function renderStatsTab(container, books, settings, challenges = []) {
if (!container._statsSub) container._statsSub = 'books';
const sub = container._statsSub;

container.innerHTML = `
<div class="filter-bar no-scrollbar">
<button class="filter-chip ${sub === 'books' ? 'active' : ''}" data-ssub="books">${icon('bookOpen', 13)} Книги</button>
<button class="filter-chip ${sub === 'content' ? 'active' : ''}" data-ssub="content">${icon('film', 13)} Контент</button>
<button class="filter-chip ${sub === 'money' ? 'active' : ''}" data-ssub="money">${icon('coin', 13)} Финансы</button>
<button class="filter-chip ${sub === 'blog' ? 'active' : ''}" data-ssub="blog">${icon('trophy', 13)} Блог</button>
</div>
<div id="stats-body"></div>
`;

const body = container.querySelector('#stats-body');

container.querySelectorAll('[data-ssub]').forEach(btn => {
btn.addEventListener('click', () => {
container._statsSub = btn.dataset.ssub;
renderStatsTab(container, books, settings, challenges);
});
});

if (sub === 'books') renderBookStats(body, books);
else if (sub === 'content') renderContentStats(body, books);
else if (sub === 'money') renderMoneyStats(body, books, settings);
else renderBlogStats(body, books, settings, challenges);

// Запуск анимаций после вставки в DOM
requestAnimationFrame(() => {
animateBars(body);
animateNumbers(body);
});
}

// ═══════════════════════════════════════════════
//  2. АНИМАЦИИ (count-up + бары)
// ═══════════════════════════════════════════════
function animateNumbers(container) {
container.querySelectorAll('[data-countup]').forEach(el => {
const target = parseFloat(el.dataset.countup);
const decimals = parseInt(el.dataset.decimals || 0);
const suffix = el.dataset.suffix || '';
if (isNaN(target)) return;
const duration = 900;
const start = performance.now();
function tick(now) {
const p = Math.min(1, (now - start) / duration);
const eased = 1 - Math.pow(1 - p, 3);
const val = target * eased;
el.textContent = (decimals > 0 ? val.toFixed(decimals) : Math.round(val).toLocaleString('ru')) + suffix;
if (p < 1) requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
});
}

function animateBars(container) {
container.querySelectorAll('.stat-bar-fill[data-w]').forEach(el => {
el.style.width = el.dataset.w + '%';
});
}

// ═══════════════════════════════════════════════
//  3. СТАТИСТИКА: КНИГИ
// ═══════════════════════════════════════════════
function renderBookStats(container, books) {
const total = books.length;
const byStatus = {};
for (const b of books) byStatus[b.status] = (byStatus[b.status] || 0) + 1;
const finished = byStatus.finished || 0;
const rated = books.filter(b => (b.review?.rating || b.rating || 0) > 0);
const avgRating = rated.length > 0
? (rated.reduce((s, b) => s + (b.review?.rating || b.rating || 0), 0) / rated.length)
: 0;
const readPages = books.filter(b => b.status === 'finished').reduce((s, b) => s + (b.pageCount || 0), 0);

// Время чтения
const withDays = books.filter(b => b.readingDays > 0);
const avgDays = withDays.length > 0
? Math.round(withDays.reduce((s, b) => s + b.readingDays, 0) / withDays.length) : 0;
const fastest = withDays.length > 0 ? withDays.reduce((a, b) => a.readingDays < b.readingDays ? a : b) : null;
const slowest = withDays.length > 0 ? withDays.reduce((a, b) => a.readingDays > b.readingDays ? a : b) : null;

const genres = topEntries(countBy(books.filter(b => b.genre), b => b.genre), 8);
const publishers = topEntries(countBy(books.filter(b => b.publisher), b => b.publisher), 8);
const monthly = calcMonthlyBooks(books);

const maxGenre = genres[0]?.[1] || 1;
const maxPub = publishers[0]?.[1] || 1;
const maxMonthly = Math.max(...monthly.map(m => m.count), 1);
const palette = ['#e8a33d','#94b878','#d98aa8','#7fb8b0','#b092d6','#8aa3c9','#e0955c','#d97b6c'];

container.innerHTML = `
<div class="stats-grid">
${statCard(total, `${icon('library', 14)} Всего книг`, true)}
${statCard(finished, `${icon('checkCircle', 14)} Прочитано`, true)}
${statCard(avgRating, `${icon('star', 14)} Средний рейтинг`, true, 1)}
${statCard(readPages, `${icon('bookClosed', 14)} Страниц прочитано`, true)}
</div>

<!-- По статусам -->
<div class="stat-section">
<h3>${icon('chart', 14)} По статусам</h3>
<div class="stats-grid" style="grid-template-columns:repeat(3,1fr)">
${Object.entries(BOOK_STATUSES).map(([key, st]) => `
<div class="stat-card" style="padding:12px 8px">
<div class="stat-value" style="font-size:1.3rem" data-countup="${byStatus[key] || 0}">0</div>
<div class="stat-label">${statusIcon(key, 13)} ${st.label}</div>
</div>
`).join('')}
</div>
</div>

<!-- Время чтения -->
${withDays.length > 0 ? `
<div class="stat-section">
<h3>${icon('clock', 14)} Время чтения</h3>
<div class="stats-grid" style="grid-template-columns:repeat(3,1fr)">
<div class="stat-card"><div class="stat-value" data-countup="${avgDays}">0</div><div class="stat-label">дн. в среднем</div></div>
<div class="stat-card"><div class="stat-value" data-countup="${fastest.readingDays}">0</div><div class="stat-label">${icon('fire', 12)} быстрее всего</div></div>
<div class="stat-card"><div class="stat-value" data-countup="${slowest.readingDays}">0</div><div class="stat-label">${icon('clock', 12)} дольше всего</div></div>
</div>
<div class="text-small text-muted">
${icon('fire', 11)} «${esc(fastest.title)}» — ${fastest.readingDays} дн. ·
${icon('clock', 11)} «${esc(slowest.title)}» — ${slowest.readingDays} дн.
</div>
</div>
` : ''}

${barSection(`${icon('folder', 14)} Жанры`, genres, maxGenre, palette)}
${barSection(`${icon('library', 14)} Издательства`, publishers, maxPub, palette, 3)}

${monthly.length > 0 ? `
<div class="stat-section">
<h3>${icon('calendar', 14)} Прочитано по месяцам</h3>
${monthly.map(m => barRow(m.label, m.count, maxMonthly, 'var(--green)')).join('')}
</div>
` : ''}
`;
}

// ═══════════════════════════════════════════════
//  4. СТАТИСТИКА: КОНТЕНТ
// ═══════════════════════════════════════════════
function renderContentStats(container, books) {
const allContent = books.flatMap(b => (b.contentItems || []).map(c => ({ ...c, bookTitle: b.title })));
const total = allContent.length;
const published = allContent.filter(c => c.status === 'published').length;
const inProgress = allContent.filter(c => ['planned','filming','editing'].includes(c.status)).length;
const ideas = allContent.filter(c => c.status === 'idea').length;

const byType = topEntries(countBy(allContent, c => c.type), 10);
const byPlatform = topEntries(countBy(allContent.filter(c => c.platform), c => c.platform), 10);
const byStatus = countBy(allContent, c => c.status);

const bookContent = {};
for (const c of allContent) bookContent[c.bookTitle] = (bookContent[c.bookTitle] || 0) + 1;
const topBooks = topEntries(bookContent, 5);
const monthly = calcMonthlyContent(allContent);

const maxType = byType[0]?.[1] || 1;
const maxPlatform = byPlatform[0]?.[1] || 1;
const maxMonthly = Math.max(...monthly.map(m => m.count), 1);

const typeColors = {
unboxing:'#e0955c', read_with_me:'#94b878', review:'#b092d6', lipsync:'#d98aa8',
top:'#7fb8b0', quote:'#e8a33d', comparison:'#d97b6c', haul:'#e0955c'
};
const platformColors = {
youtube:'#d97b6c', tiktok:'#7fb8b0', telegram:'#8aa3c9',
vk:'#94b878', dzen:'#e0955c', instagram:'#d98aa8',
pinterest:'#e06a5c', threads:'#b3a48e'
};

container.innerHTML = `
<div class="stats-grid">
${statCard(total, `${icon('film', 14)} Всего контента`, true)}
${statCard(published, `${icon('send', 14)} Опубликовано`, true)}
${statCard(inProgress, `${icon('video', 14)} В работе`, true)}
${statCard(ideas, `${icon('lightbulb', 14)} Идеи`, true)}
</div>

${byType.length > 0 ? `
<div class="stat-section">
<h3>${icon('film', 14)} По типам</h3>
${byType.map(([type, count]) => {
const t = CONTENT_TYPES[type] || { label: type };
return barRow(`${contentTypeIcon(type, 13)} ${t.label}`, count, maxType, typeColors[type] || '#e8a33d');
}).join('')}
</div>
` : ''}

${byPlatform.length > 0 ? `
<div class="stat-section">
<h3>${icon('globe', 14)} По площадкам</h3>
${byPlatform.map(([p, count]) => {
const pl = PLATFORMS[p] || { label: p };
return barRow(`${platformIcon(p, 12)} ${pl.label}`, count, maxPlatform, platformColors[p] || '#e8a33d');
}).join('')}
</div>
` : ''}

<div class="stat-section">
<h3>${icon('chart', 14)} По статусам</h3>
<div class="stats-grid" style="grid-template-columns:repeat(3,1fr)">
${Object.entries(CONTENT_STATUSES).map(([key, s]) => `
<div class="stat-card" style="padding:12px 8px">
<div class="stat-value" style="font-size:1.3rem" data-countup="${byStatus[key] || 0}">0</div>
<div class="stat-label">${icon(CONTENT_STATUS_ICONS[key] || 'film', 13)} ${s.label}</div>
</div>
`).join('')}
</div>
</div>

${topBooks.length > 0 ? `
<div class="stat-section">
<h3>${icon('trophy', 14)} Топ книг по контенту</h3>
${topBooks.map(([title, count], i) => barRow(`${i + 1}. ${title}`, count, topBooks[0][1], 'var(--accent)')).join('')}
</div>
` : ''}

${monthly.length > 0 ? `
<div class="stat-section">
<h3>${icon('calendar', 14)} Публикации по месяцам</h3>
${monthly.map(m => barRow(m.label, m.count, maxMonthly, 'var(--green)')).join('')}
</div>
` : ''}
`;
}

// ═══════════════════════════════════════════════
//  5. СТАТИСТИКА: ФИНАНСЫ
// ═══════════════════════════════════════════════
function renderMoneyStats(container, books, settings) {
if (!settings.showPriceInStats) {
container.innerHTML = `
<div class="empty-state">
<div class="empty-icon">${icon('coin', 56)}</div>
<div class="empty-title">Финансы скрыты</div>
<div class="empty-text">Включите «Показывать цену в статистике» в Настройках</div>
</div>
`;
return;
}

const priced = books.filter(b => b.price?.amount > 0);
if (priced.length === 0) {
container.innerHTML = `
<div class="empty-state">
<div class="empty-icon">${icon('coin', 56)}</div>
<div class="empty-title">Нет данных о ценах</div>
<div class="empty-text">Добавьте цену книге в форме редактирования</div>
</div>
`;
return;
}

const def = settings.defaultCurrency;
const defSym = (CURRENCIES[def] || CURRENCIES.RUB).symbol;

const converted = priced.map(b => ({
book: b,
amount: convertToDefault(b.price, settings).amount,
original: b.price,
}));

const total = converted.reduce((s, c) => s + c.amount, 0);
const avg = Math.round(total / converted.length);
const mostExpensive = converted.reduce((a, b) => a.amount > b.amount ? a : b);

const nowKey = new Date().toISOString().slice(0, 7);
const thisMonth = converted
.filter(c => (c.book.dateAdded || '').startsWith(nowKey))
.reduce((s, c) => s + c.amount, 0);

const byPub = {};
for (const c of converted) {
const p = c.book.publisher || 'Без издательства';
if (!byPub[p]) byPub[p] = { sum: 0, count: 0 };
byPub[p].sum += c.amount;
byPub[p].count++;
}
const pubEntries = Object.entries(byPub).sort((a, b) => b[1].sum - a[1].sum).slice(0, 8);
const maxPub = pubEntries[0]?.[1].sum || 1;

const byMonth = {};
for (const c of converted) {
const m = (c.book.dateAdded || '').slice(0, 7);
if (!m) continue;
byMonth[m] = (byMonth[m] || 0) + c.amount;
}
const monthEntries = Object.entries(byMonth).sort((a, b) => a[0].localeCompare(b[0])).slice(-12);
const maxMonth = Math.max(...monthEntries.map(([, v]) => v), 1);

const byCurrency = {};
for (const c of converted) {
const cur = c.original.currency;
if (!byCurrency[cur]) byCurrency[cur] = { sum: 0, count: 0 };
byCurrency[cur].sum += c.original.amount;
byCurrency[cur].count++;
}

const palette = ['#e8a33d','#94b878','#d98aa8','#7fb8b0','#b092d6','#8aa3c9','#e0955c','#d97b6c'];

container.innerHTML = `
<div class="stats-grid">
<div class="stat-card">
<div class="stat-value" data-countup="${total}">0</div>
<div class="stat-label">${icon('coin', 13)} Всего потрачено (${defSym})</div>
</div>
<div class="stat-card">
<div class="stat-value" data-countup="${thisMonth}">0</div>
<div class="stat-label">${icon('calendar', 13)} В этом месяце</div>
</div>
<div class="stat-card">
<div class="stat-value" data-countup="${avg}">0</div>
<div class="stat-label">${icon('target', 13)} Средняя цена</div>
</div>
<div class="stat-card">
<div class="stat-value" data-countup="${priced.length}">0</div>
<div class="stat-label">${icon('bookClosed', 13)} Книг с ценой</div>
</div>
</div>

<!-- Самая дорогая -->
<div class="stat-section">
<h3>${icon('trophy', 14)} Самая дорогая книга</h3>
<div class="content-card" style="cursor:default">
${mostExpensive.book.coverUrl
? `<img src="${mostExpensive.book.coverUrl}" referrerpolicy="no-referrer" style="width:44px;height:66px;border-radius:6px;object-fit:cover"/>`
: `<div style="width:44px;height:66px;border-radius:6px;background:var(--bg-input);display:flex;align-items:center;justify-content:center">${icon('bookClosed', 22)}</div>`}
<div class="content-info">
<div class="content-title">${esc(mostExpensive.book.title)}</div>
<div class="content-book">${esc(mostExpensive.book.author)}</div>
<div class="content-meta">
<span class="book-badge badge-price">${icon('coin', 11)} ${formatPrice(mostExpensive.original)}</span>
${mostExpensive.original.currency !== def
? `<span class="text-small text-muted">≈ ${mostExpensive.amount.toLocaleString('ru')} ${defSym}</span>` : ''}
</div>
</div>
</div>
</div>

<!-- По издательствам -->
${pubEntries.length > 0 ? `
<div class="stat-section">
<h3>${icon('library', 14)} Траты по издательствам</h3>
${pubEntries.map(([name, d], i) => `
<div class="stat-bar-row">
<div class="stat-bar-label truncate">${esc(name)}</div>
<div class="stat-bar-track">
<div class="stat-bar-fill" data-w="${(d.sum / maxPub) * 100}" style="width:0%;background:${palette[i % palette.length]}"></div>
</div>
<div class="stat-bar-count">${d.sum.toLocaleString('ru')} ${defSym}</div>
</div>
<div class="text-small text-muted" style="margin:-4px 0 8px 114px">${d.count} книг</div>
`).join('')}
</div>
` : ''}

<!-- По месяцам -->
${monthEntries.length > 0 ? `
<div class="stat-section">
<h3>${icon('calendar', 14)} Траты по месяцам</h3>
${monthEntries.map(([m, v]) => barRow(formatMonth(m), v, maxMonth, 'var(--accent)', ' ' + defSym)).join('')}
</div>
` : ''}

<!-- Разбивка по валютам -->
${Object.keys(byCurrency).length > 1 ? `
<div class="stat-section">
<h3>${icon('coin', 14)} По валютам (оригинал)</h3>
<div class="stats-grid" style="grid-template-columns:repeat(3,1fr)">
${Object.entries(byCurrency).map(([cur, d]) => `
<div class="stat-card" style="padding:12px 8px">
<div class="stat-value" style="font-size:1.1rem">${d.sum.toLocaleString('ru')} ${(CURRENCIES[cur] || {}).symbol || cur}</div>
<div class="stat-label">${d.count} книг</div>
</div>
`).join('')}
</div>
</div>
` : ''}
`;
}

// ═══════════════════════════════════════════════
//  6. СТАТИСТИКА: БЛОГ
// ═══════════════════════════════════════════════
/**
* Рендерит подвкладку «Блог».
* @param {HTMLElement} container
* @param {object[]} books
* @param {object} settings
* @param {object[]} challenges — 🆕 v3.6.0: передаются явно, без глобала
*/
function renderBlogStats(container, books, settings, challenges = []) {
const prBooks = books.filter(b => b.isPR);
const totalPR = prBooks.length;
const prByPub = topEntries(countBy(prBooks.filter(b => b.receivedFrom), b => b.receivedFrom), 8);
const maxPR = prByPub[0]?.[1] || 1;

const withContent = prBooks.filter(b => (b.contentItems || []).length > 0).length;
const withPublished = prBooks.filter(b => (b.contentItems || []).some(c => c.status === 'published')).length;
const withReview = prBooks.filter(b => b.review?.text || b.review?.rating > 0).length;
const conv = (n) => totalPR > 0 ? Math.round(n / totalPR * 100) : 0;

const totalReviews = books.filter(b => b.review?.text || b.review?.rating > 0).length;
const totalQuotes = books.reduce((s, b) => s + (b.review?.quotes || []).length, 0);
const usedQuotes = books.reduce((s, b) => s + (b.review?.quotes || []).filter(q => q.used).length, 0);

// Челленджи — берутся из параметра, не из window
const activeCh = challenges.filter(c => c.status === 'active');
const doneCh = challenges.filter(c => c.status === 'completed');

// Серии
const series = getSeriesList(books);
const completedSeries = series.filter(s => s.read >= s.effectiveTotal && s.effectiveTotal > 0);

const palette = ['#e8a33d','#94b878','#d98aa8','#7fb8b0','#b092d6','#8aa3c9','#e0955c','#d97b6c'];

container.innerHTML = `
<div class="stats-grid">
${statCard(totalPR, `${icon('box', 14)} PR-книг`, true)}
${statCard(totalReviews, `${icon('pen', 14)} Отзывов`, true)}
${statCard(totalQuotes, `${icon('quote', 14)} Цитат`, true)}
${statCard(doneCh.length, `${icon('trophy', 14)} Челленджей завершено`, true)}
</div>

<!-- Конверсия PR -->
<div class="stat-section">
<h3>${icon('chart', 14)} Конверсия PR-книг</h3>
<div class="text-small text-muted mb-8">Получена → Контент → Опубликовано → Отзыв</div>
${convBar(`${icon('box', 12)} Получено`, totalPR, totalPR, 'var(--pink)')}
${convBar(`${icon('film', 12)} С контентом`, withContent, totalPR, 'var(--cyan)')}
${convBar(`${icon('send', 12)} Опубликовано`, withPublished, totalPR, 'var(--green)')}
${convBar(`${icon('pen', 12)} С отзывом`, withReview, totalPR, 'var(--purple)')}
</div>

${prByPub.length > 0 ? `
<div class="stat-section">
<h3>${icon('library', 14)} PR по издательствам</h3>
${prByPub.map(([name, count], i) => barRow(name, count, maxPR, palette[i % palette.length])).join('')}
</div>
` : ''}

<!-- Активные челленджи -->
${activeCh.length > 0 ? `
<div class="stat-section">
<h3>${icon('trophy', 14)} Активные челленджи</h3>
${activeCh.map(ch => {
const prog = calcChallengeProgress(ch, books);
return `
<div class="content-card" style="cursor:default">
<div class="content-icon" style="background:var(--accent-dim)">${ch.emoji || '🏆'}</div>
<div class="content-info">
<div class="content-title">${esc(ch.name)}</div>
<div class="content-meta">
<span class="text-small">${prog.current} / ${prog.target} · ${prog.percent}%</span>
</div>
<div class="series-progress-track mt-8" style="height:6px;background:var(--bg-input);border-radius:3px;overflow:hidden">
<div class="stat-bar-fill" data-w="${prog.percent}" style="width:0%;background:linear-gradient(90deg,var(--green),var(--cyan));height:100%"></div>
</div>
</div>
</div>
`;
}).join('')}
</div>
` : ''}

<!-- Серии -->
${series.length > 0 ? `
<div class="stat-section">
<h3>${icon('layers', 14)} Серии</h3>
<div class="stats-grid" style="grid-template-columns:repeat(3,1fr)">
<div class="stat-card"><div class="stat-value" data-countup="${series.length}">0</div><div class="stat-label">всего серий</div></div>
<div class="stat-card"><div class="stat-value" data-countup="${series.filter(s => s.read > 0 && s.read < s.effectiveTotal).length}">0</div><div class="stat-label">в процессе</div></div>
<div class="stat-card"><div class="stat-value" data-countup="${completedSeries.length}">0</div><div class="stat-label">${icon('trophy', 12)} завершено</div></div>
</div>
</div>
` : ''}

<!-- Цитаты -->
<div class="stat-section">
<h3>${icon('quote', 14)} Цитаты</h3>
<div class="stats-grid" style="grid-template-columns:1fr 1fr">
<div class="stat-card"><div class="stat-value" data-countup="${totalQuotes}">0</div><div class="stat-label">всего цитат</div></div>
<div class="stat-card"><div class="stat-value" data-countup="${usedQuotes}">0</div><div class="stat-label">${icon('check', 12)} использовано</div></div>
</div>
</div>
`;
}

function convBar(label, value, total, color) {
const pct = total > 0 ? Math.round(value / total * 100) : 0;
return `
<div class="stat-bar-row">
<div class="stat-bar-label">${label}</div>
<div class="stat-bar-track">
<div class="stat-bar-fill" data-w="${pct}" style="width:0%;background:${color}"></div>
</div>
<div class="stat-bar-count">${pct}%</div>
</div>
`;
}

// ═══════════════════════════════════════════════
//  7. ВКЛАДКА «КАЛЕНДАРЬ»
// ═══════════════════════════════════════════════
export function renderCalendarTab(container, books, callbacks) {
if (!container._calYear) {
const now = new Date();
container._calYear = now.getFullYear();
container._calMonth = now.getMonth();
}
const year = container._calYear;
const month = container._calMonth;
const monthNames = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const dayNames = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

// 🆕 v3.5.0+: добавляем bookId — нужен для открытия карточки контента
const contentByDate = {};
for (const book of books) {
for (const c of (book.contentItems || [])) {
const date = c.plannedDate || c.publishedDate;
if (!date) continue;
if (!contentByDate[date]) contentByDate[date] = [];
contentByDate[date].push({ ...c, bookId: book.id, bookTitle: book.title });
}
}

const firstDay = new Date(year, month, 1);
const daysInMonth = new Date(year, month + 1, 0).getDate();
let startDow = firstDay.getDay() - 1;
if (startDow < 0) startDow = 6;
const todayStr = new Date().toISOString().slice(0, 10);

const cells = [];
const prevLast = new Date(year, month, 0).getDate();
for (let i = startDow - 1; i >= 0; i--) cells.push({ day: prevLast - i, other: true });
for (let d = 1; d <= daysInMonth; d++) {
const dateStr = `${year}-${String(month + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
cells.push({ day: d, other: false, dateStr, isToday: dateStr === todayStr, content: contentByDate[dateStr] || [] });
}
const rem = 42 - cells.length;
for (let i = 1; i <= rem; i++) cells.push({ day: i, other: true });

container.innerHTML = `
<div class="calendar">
<div class="calendar-header">
<h3>${monthNames[month]} ${year}</h3>
<div class="calendar-nav">
<button id="cal-prev">${icon('chevronLeft', 14)}</button>
<button id="cal-today" class="btn-small" style="font-size:.72rem;width:auto">Сегодня</button>
<button id="cal-next">${icon('chevronRight', 14)}</button>
</div>
</div>
<div class="calendar-grid">
${dayNames.map(d => `<div class="calendar-day-name">${d}</div>`).join('')}
${cells.map(cell => {
if (cell.other) return `<div class="calendar-day other-month"><span class="day-num">${cell.day}</span></div>`;
const dots = cell.content.slice(0, 4).map(c => `<span class="calendar-dot ${c.type || 'review'}"></span>`).join('');
return `
<div class="calendar-day ${cell.isToday ? 'today' : ''}" data-date="${cell.dateStr}"
${cell.content.length > 0 ? 'style="cursor:pointer"' : ''}>
<span class="day-num">${cell.day}</span>
${dots ? `<div class="calendar-dots">${dots}</div>` : ''}
</div>
`;
}).join('')}
</div>
<div class="calendar-legend">
${Object.entries(CONTENT_TYPES).map(([key, t]) => `
<div class="legend-item"><span class="legend-dot" style="background:${getTypeColor(key)}"></span>${contentTypeIcon(key, 12)} ${t.label}</div>
`).join('')}
</div>
</div>
<div id="cal-day-content" class="mt-16"></div>
<button id="cal-add" class="btn-primary mt-16">${icon('plus', 16)} Запланировать контент</button>
`;

container.querySelector('#cal-prev').addEventListener('click', () => {
container._calMonth--;
if (container._calMonth < 0) { container._calMonth = 11; container._calYear--; }
renderCalendarTab(container, books, callbacks);
});
container.querySelector('#cal-next').addEventListener('click', () => {
container._calMonth++;
if (container._calMonth > 11) { container._calMonth = 0; container._calYear++; }
renderCalendarTab(container, books, callbacks);
});
container.querySelector('#cal-today').addEventListener('click', () => {
const now = new Date();
container._calYear = now.getFullYear();
container._calMonth = now.getMonth();
renderCalendarTab(container, books, callbacks);
});

container.querySelectorAll('.calendar-day[data-date]').forEach(day => {
day.addEventListener('click', () => {
const dateStr = day.dataset.date;
const dayContent = contentByDate[dateStr] || [];
const dayEl = container.querySelector('#cal-day-content');
if (dayContent.length === 0) {
dayEl.innerHTML = `<div class="text-center text-muted text-small" style="padding:20px">${icon('calendar', 14)} ${formatDateRu(dateStr)}: нет контента</div>`;
return;
}
// 🆕 v3.5.0+: кликабельные карточки → read-only карточка контента
dayEl.innerHTML = `
<div class="text-small text-muted mb-8" style="font-weight:700">${icon('calendar', 13)} ${formatDateRu(dateStr)}</div>
${dayContent.map(c => {
const t = CONTENT_TYPES[c.type] || { label: c.type };
const s = CONTENT_STATUSES[c.status] || { label: c.status, class: '' };
const p = PLATFORMS[c.platform] || { label: c.platform || '' };
return `
<div class="content-card cal-content-item"
data-cal-book="${c.bookId}" data-cal-content="${c.id}"
style="cursor:pointer" title="Открыть карточку контента">
<div class="content-icon ${t.color || ''}">${contentTypeIcon(c.type, 20)}</div>
<div class="content-info">
<div class="content-title">${esc(c.title || t.label)}</div>
<div class="content-book">${icon('bookClosed', 12)} ${esc(c.bookTitle)}</div>
<div class="content-meta">
<span class="content-list-status ${s.class}">${icon(CONTENT_STATUS_ICONS[c.status] || 'film', 12)} ${s.label}</span>
<span class="platform-badge">${platformIcon(c.platform, 12)} ${p.label}</span>
</div>
</div>
<span class="cal-content-arrow">›</span>
</div>
`;
}).join('')}
`;
// Привязка кликов → карточка контента
dayEl.querySelectorAll('.cal-content-item').forEach(el => {
el.addEventListener('click', () => {
const book = books.find(b => b.id === el.dataset.calBook);
const item = (book?.contentItems || []).find(c => c.id === el.dataset.calContent);
if (item && callbacks.onOpenContent) callbacks.onOpenContent(item, el.dataset.calBook);
});
});
});
});

container.querySelector('#cal-add').addEventListener('click', () => callbacks.onAdd());
}

// ═══════════════════════════════════════════════
//  8. УТИЛИТЫ
// ═══════════════════════════════════════════════
function countBy(arr, keyFn) {
const r = {};
for (const item of arr) {
const k = keyFn(item);
if (k) r[k] = (r[k] || 0) + 1;
}
return r;
}

function topEntries(obj, n) {
return Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
}

function statCard(value, label, countup, decimals = 0) {
return `
<div class="stat-card">
<div class="stat-value" ${countup ? `data-countup="${value}" data-decimals="${decimals}"` : ''}>${countup ? '0' : value}</div>
<div class="stat-label">${label}</div>
</div>
`;
}

function barSection(title, entries, max, palette, offset = 0) {
if (entries.length === 0) return '';
return `
<div class="stat-section">
<h3>${title}</h3>
${entries.map(([name, count], i) => barRow(name, count, max, palette[(i + offset) % palette.length])).join('')}
</div>
`;
}

function barRow(label, count, max, color, suffix = '') {
return `
<div class="stat-bar-row">
<div class="stat-bar-label truncate">${label}</div>
<div class="stat-bar-track">
<div class="stat-bar-fill" data-w="${(count / max) * 100}" style="width:0%;background:${color}"></div>
</div>
<div class="stat-bar-count">${count}${suffix}</div>
</div>
`;
}

function calcMonthlyBooks(books) {
const now = new Date();
const months = [];
for (let i = 11; i >= 0; i--) {
const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}`;
const label = d.toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' });
const count = books.filter(b => b.status === 'finished' && (b.dateFinished || '').startsWith(key)).length;
months.push({ key, label, count });
}
while (months.length > 0 && months[0].count === 0) months.shift();
return months;
}

function calcMonthlyContent(allContent) {
const now = new Date();
const months = [];
for (let i = 11; i >= 0; i--) {
const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}`;
const label = d.toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' });
const count = allContent.filter(c => c.status === 'published' && (c.publishedDate || '').startsWith(key)).length;
months.push({ key, label, count });
}
while (months.length > 0 && months[0].count === 0) months.shift();
return months;
}

function formatMonth(key) {
try {
const d = new Date(key + '-01T00:00:00');
return d.toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' });
} catch { return key; }
}

function getTypeColor(type) {
const colors = {
unboxing:'#e0955c', read_with_me:'#94b878', review:'#b092d6', lipsync:'#d98aa8',
top:'#7fb8b0', quote:'#e8a33d', comparison:'#d97b6c', haul:'#e0955c'
};
return colors[type] || '#e8a33d';
}

function formatDateRu(dateStr) {
try {
return new Date(dateStr + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
} catch { return dateStr; }
}

// ═══════════════════════════════════════════════
//  9. СТИЛИ (инжектируются один раз)
// ═══════════════════════════════════════════════
const STATS_STYLES = `
/* v3.5.0+: кликабельный контент в календаре */
.cal-content-item { position: relative; }
.cal-content-arrow {
font-size:1.3rem; font-weight:700; color:var(--text-muted);
flex-shrink:0; margin-left:auto;
transition:transform .18s var(--ease), color .18s var(--ease);
}
.cal-content-item:hover .cal-content-arrow {
transform:translateX(4px); color:var(--accent);
}
.cal-content-item:hover {
border-color:var(--accent);
background:var(--bg-card-hover);
}
`;
if (!document.getElementById('stats-styles')) {
const style = document.createElement('style');
style.id = 'stats-styles';
style.textContent = STATS_STYLES;
document.head.appendChild(style);
}