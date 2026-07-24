// ─────────────────────────────────────────────
// 📦 BookTrackerPro — stats.js
// 🔖 v3.2.0 | 2026-07-24
// 📝 Статистика + Календарь контент-плана
//
//    Статистика:
//      📚 Книги: прочитано, жанры, издательства, темп
//      🎬 Контент: по типам, площадкам, статусам, месяцам
//      📦 PR: от издательств, конверсия
//
//    Календарь:
//      📅 Месячный вид с точками по типам контента
//      Клик по дню → список контента на этот день
// ─────────────────────────────────────────────

import { esc } from './app.js';
import { CONTENT_TYPES, CONTENT_STATUSES, PLATFORMS } from './content.js';

// ═══════════════════════════════════════════════
//  1. ВКЛАДКА «СТАТИСТИКА»
// ═══════════════════════════════════════════════

/**
 * Рендерит вкладку статистики.
 *
 * @param {HTMLElement} container — #main-content
 * @param {object[]} books
 * @param {object} settings
 */
export function renderStatsTab(container, books, settings) {
  // Подвкладки
  if (!container._statsSub) container._statsSub = 'books';
  const sub = container._statsSub;

  container.innerHTML = `
    <div class="filter-bar no-scrollbar">
      <button class="filter-chip ${sub === 'books' ? 'active' : ''}" data-ssub="books">
        📚 Книги
      </button>
      <button class="filter-chip ${sub === 'content' ? 'active' : ''}" data-ssub="content">
        🎬 Контент
      </button>
      <button class="filter-chip ${sub === 'blog' ? 'active' : ''}" data-ssub="blog">
        📦 Блог
      </button>
    </div>
    <div id="stats-body"></div>
  `;

  const body = container.querySelector('#stats-body');

  // Подвкладки
  container.querySelectorAll('[data-ssub]').forEach(btn => {
    btn.addEventListener('click', () => {
      container._statsSub = btn.dataset.ssub;
      renderStatsTab(container, books, settings);
    });
  });

  if (sub === 'books') renderBookStats(body, books);
  else if (sub === 'content') renderContentStats(body, books);
  else renderBlogStats(body, books);
}

// ═══════════════════════════════════════════════
//  2. СТАТИСТИКА: КНИГИ
// ═══════════════════════════════════════════════

function renderBookStats(container, books) {
  const total = books.length;
  const finished = books.filter(b => b.status === 'finished').length;
  const reading = books.filter(b => b.status === 'reading').length;
  const tbr = books.filter(b => b.status === 'tbr').length;
  const dropped = books.filter(b => b.status === 'dropped').length;
  const paused = books.filter(b => b.status === 'paused').length;

  // Средний рейтинг
  const rated = books.filter(b => (b.review?.rating || b.rating || 0) > 0);
  const avgRating = rated.length > 0
    ? (rated.reduce((s, b) => s + (b.review?.rating || b.rating || 0), 0) / rated.length).toFixed(1)
    : '—';

  // Всего страниц
  const totalPages = books.reduce((s, b) => s + (b.pageCount || 0), 0);
  const readPages = books
    .filter(b => b.status === 'finished')
    .reduce((s, b) => s + (b.pageCount || 0), 0);

  // Жанры
  const genres = countBy(books.filter(b => b.genre), b => b.genre);
  const topGenres = Object.entries(genres)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  // Издательства
  const publishers = countBy(books.filter(b => b.publisher), b => b.publisher);
  const topPublishers = Object.entries(publishers)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  // По месяцам (прочитанные)
  const monthly = calcMonthlyBooks(books);

  const maxGenre = topGenres.length > 0 ? topGenres[0][1] : 1;
  const maxPub = topPublishers.length > 0 ? topPublishers[0][1] : 1;
  const maxMonthly = Math.max(...monthly.map(m => m.count), 1);

  const genreColors = ['#6c8cff', '#4caf82', '#e0a030', '#e05555', '#a78bfa', '#f472b6', '#22d3ee', '#f97316'];

  container.innerHTML = `
    <!-- Карточки -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${total}</div>
        <div class="stat-label">📚 Всего книг</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${finished}</div>
        <div class="stat-label">✅ Прочитано</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${reading}</div>
        <div class="stat-label">📖 Читаю</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${avgRating}</div>
        <div class="stat-label">⭐ Средний рейтинг</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${tbr}</div>
        <div class="stat-label">📋 Хочу прочитать</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${readPages.toLocaleString('ru')}</div>
        <div class="stat-label">📄 Страниц прочитано</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${dropped}</div>
        <div class="stat-label">❌ Брошено</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${paused}</div>
        <div class="stat-label">⏸️ На паузе</div>
      </div>
    </div>

    <!-- Жанры -->
    ${topGenres.length > 0 ? `
      <div class="stat-section">
        <h3>📂 Жанры</h3>
        ${topGenres.map(([name, count], i) => `
          <div class="stat-bar-row">
            <div class="stat-bar-label truncate">${esc(name)}</div>
            <div class="stat-bar-track">
              <div class="stat-bar-fill" style="width:${(count / maxGenre) * 100}%;background:${genreColors[i % genreColors.length]}"></div>
            </div>
            <div class="stat-bar-count">${count}</div>
          </div>
        `).join('')}
      </div>
    ` : ''}

    <!-- Издательства -->
    ${topPublishers.length > 0 ? `
      <div class="stat-section">
        <h3>🏢 Издательства</h3>
        ${topPublishers.map(([name, count], i) => `
          <div class="stat-bar-row">
            <div class="stat-bar-label truncate">${esc(name)}</div>
            <div class="stat-bar-track">
              <div class="stat-bar-fill" style="width:${(count / maxPub) * 100}%;background:${genreColors[(i + 3) % genreColors.length]}"></div>
            </div>
            <div class="stat-bar-count">${count}</div>
          </div>
        `).join('')}
      </div>
    ` : ''}

    <!-- Активность по месяцам -->
    ${monthly.length > 0 ? `
      <div class="stat-section">
        <h3>📅 Прочитано по месяцам</h3>
        ${monthly.map(m => `
          <div class="stat-bar-row">
            <div class="stat-bar-label">${m.label}</div>
            <div class="stat-bar-track">
              <div class="stat-bar-fill" style="width:${(m.count / maxMonthly) * 100}%;background:var(--green)"></div>
            </div>
            <div class="stat-bar-count">${m.count}</div>
          </div>
        `).join('')}
      </div>
    ` : ''}
  `;
}

// ═══════════════════════════════════════════════
//  3. СТАТИСТИКА: КОНТЕНТ
// ═══════════════════════════════════════════════

function renderContentStats(container, books) {
  // Собираем весь контент
  const allContent = books.flatMap(b =>
    (b.contentItems || []).map(c => ({ ...c, bookTitle: b.title }))
  );

  const total = allContent.length;
  const published = allContent.filter(c => c.status === 'published').length;
  const inProgress = allContent.filter(c =>
    ['planned', 'filming', 'editing'].includes(c.status)
  ).length;
  const ideas = allContent.filter(c => c.status === 'idea').length;

  // По типам
  const byType = countBy(allContent, c => c.type);
  const typeEntries = Object.entries(byType).sort((a, b) => b[1] - a[1]);
  const maxType = typeEntries.length > 0 ? typeEntries[0][1] : 1;

  // По площадкам
  const byPlatform = countBy(
    allContent.filter(c => c.platform),
    c => c.platform
  );
  const platformEntries = Object.entries(byPlatform).sort((a, b) => b[1] - a[1]);
  const maxPlatform = platformEntries.length > 0 ? platformEntries[0][1] : 1;

  // По статусам
  const byStatus = countBy(allContent, c => c.status);

  // По месяцам (опубликованные)
  const monthly = calcMonthlyContent(allContent);
  const maxMonthly = Math.max(...monthly.map(m => m.count), 1);

  // Топ книг по количеству контента
  const bookContentCount = {};
  for (const c of allContent) {
    bookContentCount[c.bookTitle] = (bookContentCount[c.bookTitle] || 0) + 1;
  }
  const topBooks = Object.entries(bookContentCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const typeColors = {
    unboxing: '#e0a030', read_with_me: '#4caf82', review: '#a78bfa',
    lipsync: '#f472b6', top: '#22d3ee', quote: '#6c8cff',
    comparison: '#e05555', haul: '#f97316'
  };

  const platformColors = {
    youtube: '#e05555', tiktok: '#22d3ee', telegram: '#6c8cff',
    vk: '#4caf82', dzen: '#e0a030', instagram: '#f472b6'
  };

  container.innerHTML = `
    <!-- Карточки -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${total}</div>
        <div class="stat-label">🎬 Всего контента</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${published}</div>
        <div class="stat-label">📤 Опубликовано</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${inProgress}</div>
        <div class="stat-label">🎥 В работе</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${ideas}</div>
        <div class="stat-label">💡 Идеи</div>
      </div>
    </div>

    <!-- По типам -->
    ${typeEntries.length > 0 ? `
      <div class="stat-section">
        <h3>🎬 Контент по типам</h3>
        ${typeEntries.map(([type, count]) => {
          const t = CONTENT_TYPES[type] || { icon: '🎬', label: type };
          return `
            <div class="stat-bar-row">
              <div class="stat-bar-label">${t.icon} ${t.label}</div>
              <div class="stat-bar-track">
                <div class="stat-bar-fill" style="width:${(count / maxType) * 100}%;background:${typeColors[type] || '#6c8cff'}"></div>
              </div>
              <div class="stat-bar-count">${count}</div>
            </div>
          `;
        }).join('')}
      </div>
    ` : ''}

    <!-- По площадкам -->
    ${platformEntries.length > 0 ? `
      <div class="stat-section">
        <h3>📱 По площадкам</h3>
        ${platformEntries.map(([platform, count]) => {
          const p = PLATFORMS[platform] || { icon: '🌐', label: platform };
          return `
            <div class="stat-bar-row">
              <div class="stat-bar-label">${p.icon} ${p.label}</div>
              <div class="stat-bar-track">
                <div class="stat-bar-fill" style="width:${(count / maxPlatform) * 100}%;background:${platformColors[platform] || '#6c8cff'}"></div>
              </div>
              <div class="stat-bar-count">${count}</div>
            </div>
          `;
        }).join('')}
      </div>
    ` : ''}

    <!-- По статусам -->
    <div class="stat-section">
      <h3>📊 По статусам</h3>
      <div class="flex gap-8" style="flex-wrap:wrap">
        ${Object.entries(CONTENT_STATUSES).map(([key, s]) => {
          const count = byStatus[key] || 0;
          return `
            <div class="stat-card" style="flex:1;min-width:100px;padding:10px">
              <div class="stat-value" style="font-size:1.3rem">${count}</div>
              <div class="stat-label">${s.icon} ${s.label}</div>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <!-- Топ книг по контенту -->
    ${topBooks.length > 0 ? `
      <div class="stat-section">
        <h3>🏆 Топ книг по контенту</h3>
        ${topBooks.map(([title, count], i) => `
          <div class="stat-bar-row">
            <div class="stat-bar-label truncate">${i + 1}. ${esc(title)}</div>
            <div class="stat-bar-track">
              <div class="stat-bar-fill" style="width:${(count / topBooks[0][1]) * 100}%;background:var(--accent)"></div>
            </div>
            <div class="stat-bar-count">${count}</div>
          </div>
        `).join('')}
      </div>
    ` : ''}

    <!-- Активность по месяцам -->
    ${monthly.length > 0 ? `
      <div class="stat-section">
        <h3>📅 Публикации по месяцам</h3>
        ${monthly.map(m => `
          <div class="stat-bar-row">
            <div class="stat-bar-label">${m.label}</div>
            <div class="stat-bar-track">
              <div class="stat-bar-fill" style="width:${(m.count / maxMonthly) * 100}%;background:var(--green)"></div>
            </div>
            <div class="stat-bar-count">${m.count}</div>
          </div>
        `).join('')}
      </div>
    ` : ''}
  `;
}

// ═══════════════════════════════════════════════
//  4. СТАТИСТИКА: БЛОГ (PR, конверсия)
// ═══════════════════════════════════════════════

function renderBlogStats(container, books) {
  const prBooks = books.filter(b => b.isPR);
  const totalPR = prBooks.length;

  // По издательствам (PR)
  const prByPublisher = countBy(
    prBooks.filter(b => b.receivedFrom),
    b => b.receivedFrom
  );
  const prPubEntries = Object.entries(prByPublisher).sort((a, b) => b[1] - a[1]);
  const maxPR = prPubEntries.length > 0 ? prPubEntries[0][1] : 1;

  // Конверсия: получена → контент снят → опубликовано
  const withContent = prBooks.filter(b => (b.contentItems || []).length > 0);
  const withPublished = prBooks.filter(b =>
    (b.contentItems || []).some(c => c.status === 'published')
  );
  const withReview = prBooks.filter(b => b.review?.text || b.review?.rating > 0);

  const convContent = totalPR > 0 ? Math.round(withContent.length / totalPR * 100) : 0;
  const convPublished = totalPR > 0 ? Math.round(withPublished.length / totalPR * 100) : 0;
  const convReview = totalPR > 0 ? Math.round(withReview.length / totalPR * 100) : 0;

  // Отзывы
  const totalReviews = books.filter(b => b.review?.text || b.review?.rating > 0).length;
  const totalQuotes = books.reduce((s, b) => s + (b.review?.quotes || []).length, 0);
  const usedQuotes = books.reduce((s, b) =>
    s + (b.review?.quotes || []).filter(q => q.used).length, 0
  );

  // Средний рейтинг отзывов
  const reviewed = books.filter(b => (b.review?.rating || 0) > 0);
  const avgReview = reviewed.length > 0
    ? (reviewed.reduce((s, b) => s + b.review.rating, 0) / reviewed.length).toFixed(1)
    : '—';

  const pubColors = ['#6c8cff', '#4caf82', '#e0a030', '#e05555', '#a78bfa', '#f472b6'];

  container.innerHTML = `
    <!-- Карточки -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${totalPR}</div>
        <div class="stat-label">📦 PR-книг</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${totalReviews}</div>
        <div class="stat-label">✍️ Отзывов</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${totalQuotes}</div>
        <div class="stat-label">💬 Цитат</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${avgReview}</div>
        <div class="stat-label">⭐ Средний рейтинг</div>
      </div>
    </div>

    <!-- Конверсия PR -->
    <div class="stat-section">
      <h3>📈 Конверсия PR-книг</h3>
      <div class="hint text-small text-muted mb-8">
        Получена → Контент → Опубликовано → Отзыв
      </div>

      <div class="stat-bar-row">
        <div class="stat-bar-label">📦 Получено</div>
        <div class="stat-bar-track">
          <div class="stat-bar-fill" style="width:100%;background:var(--pink)"></div>
        </div>
        <div class="stat-bar-count">${totalPR}</div>
      </div>
      <div class="stat-bar-row">
        <div class="stat-bar-label">🎬 С контентом</div>
        <div class="stat-bar-track">
          <div class="stat-bar-fill" style="width:${convContent}%;background:var(--cyan)"></div>
        </div>
        <div class="stat-bar-count">${convContent}%</div>
      </div>
      <div class="stat-bar-row">
        <div class="stat-bar-label">📤 Опубликовано</div>
        <div class="stat-bar-track">
          <div class="stat-bar-fill" style="width:${convPublished}%;background:var(--green)"></div>
        </div>
        <div class="stat-bar-count">${convPublished}%</div>
      </div>
      <div class="stat-bar-row">
        <div class="stat-bar-label">✍️ С отзывом</div>
        <div class="stat-bar-track">
          <div class="stat-bar-fill" style="width:${convReview}%;background:var(--purple)"></div>
        </div>
        <div class="stat-bar-count">${convReview}%</div>
      </div>
    </div>

    <!-- PR по издательствам -->
    ${prPubEntries.length > 0 ? `
      <div class="stat-section">
        <h3>🏢 PR по издательствам</h3>
        ${prPubEntries.map(([name, count], i) => `
          <div class="stat-bar-row">
            <div class="stat-bar-label truncate">${esc(name)}</div>
            <div class="stat-bar-track">
              <div class="stat-bar-fill" style="width:${(count / maxPR) * 100}%;background:${pubColors[i % pubColors.length]}"></div>
            </div>
            <div class="stat-bar-count">${count}</div>
          </div>
        `).join('')}
      </div>
    ` : ''}

    <!-- Цитаты -->
    <div class="stat-section">
      <h3>💬 Цитаты</h3>
      <div class="stats-grid" style="grid-template-columns:1fr 1fr">
        <div class="stat-card">
          <div class="stat-value">${totalQuotes}</div>
          <div class="stat-label">Всего цитат</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${usedQuotes}</div>
          <div class="stat-label">✅ Использовано</div>
        </div>
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════
//  5. ВКЛАДКА «КАЛЕНДАРЬ»
// ═══════════════════════════════════════════════

/**
 * Рендерит вкладку календаря.
 *
 * @param {HTMLElement} container — #main-content
 * @param {object[]} books
 * @param {object} callbacks — { onDayClick, onAdd }
 */
export function renderCalendarTab(container, books, callbacks) {
  // Текущий месяц (сохраняем между рендерами)
  if (!container._calYear) {
    const now = new Date();
    container._calYear = now.getFullYear();
    container._calMonth = now.getMonth();
  }

  const year = container._calYear;
  const month = container._calMonth;

  const monthNames = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
  ];
  const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  // Собираем контент по датам
  const contentByDate = {};
  for (const book of books) {
    for (const c of (book.contentItems || [])) {
      const date = c.plannedDate || c.publishedDate;
      if (!date) continue;
      if (!contentByDate[date]) contentByDate[date] = [];
      contentByDate[date].push({ ...c, bookTitle: book.title });
    }
  }

  // Строим сетку календаря
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();

  // Понедельник = 0 (JS: getDay() → 0=Вс, 1=Пн, ...)
  let startDow = firstDay.getDay() - 1;
  if (startDow < 0) startDow = 6;

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  // Ячейки: пустые (предыдущий месяц) + дни + пустые (следующий)
  const cells = [];

  // Пустые ячейки в начале
  const prevMonthLast = new Date(year, month, 0).getDate();
  for (let i = startDow - 1; i >= 0; i--) {
    cells.push({ day: prevMonthLast - i, other: true, dateStr: null });
  }

  // Дни текущего месяца
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({
      day: d,
      other: false,
      dateStr,
      isToday: dateStr === todayStr,
      content: contentByDate[dateStr] || []
    });
  }

  // Пустые ячейки в конце (до 42 = 6 строк)
  const remaining = 42 - cells.length;
  for (let i = 1; i <= remaining; i++) {
    cells.push({ day: i, other: true, dateStr: null });
  }

  container.innerHTML = `
    <div class="calendar">
      <div class="calendar-header">
        <h3>${monthNames[month]} ${year}</h3>
        <div class="calendar-nav">
          <button id="cal-prev" aria-label="Предыдущий месяц">◀</button>
          <button id="cal-today" class="btn-small" style="font-size:0.75rem">Сегодня</button>
          <button id="cal-next" aria-label="Следующий месяц">▶</button>
        </div>
      </div>

      <div class="calendar-grid">
        ${dayNames.map(d => `<div class="calendar-day-name">${d}</div>`).join('')}
        ${cells.map(cell => {
          if (cell.other) {
            return `<div class="calendar-day other-month"><span class="day-num">${cell.day}</span></div>`;
          }

          const dots = cell.content.slice(0, 4).map(c => {
            const type = c.type || 'review';
            return `<span class="calendar-dot ${type}"></span>`;
          }).join('');

          return `
            <div class="calendar-day ${cell.isToday ? 'today' : ''}"
                 data-date="${cell.dateStr}"
                 ${cell.content.length > 0 ? 'style="cursor:pointer"' : ''}>
              <span class="day-num">${cell.day}</span>
              ${dots ? `<div class="calendar-dots">${dots}</div>` : ''}
            </div>
          `;
        }).join('')}
      </div>

      <!-- Легенда -->
      <div class="calendar-legend">
        ${Object.entries(CONTENT_TYPES).map(([key, t]) => `
          <div class="legend-item">
            <span class="legend-dot" style="background:${getTypeColor(key)}"></span>
            ${t.icon} ${t.label}
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Контент на выбранный день -->
    <div id="cal-day-content" class="mt-16"></div>

    <button id="cal-add" class="btn-primary mt-16">
      ＋ Запланировать контент
    </button>
  `;

  // ── События ──

  // Навигация по месяцам
  container.querySelector('#cal-prev').addEventListener('click', () => {
    container._calMonth--;
    if (container._calMonth < 0) {
      container._calMonth = 11;
      container._calYear--;
    }
    renderCalendarTab(container, books, callbacks);
  });

  container.querySelector('#cal-next').addEventListener('click', () => {
    container._calMonth++;
    if (container._calMonth > 11) {
      container._calMonth = 0;
      container._calYear++;
    }
    renderCalendarTab(container, books, callbacks);
  });

  container.querySelector('#cal-today').addEventListener('click', () => {
    const now = new Date();
    container._calYear = now.getFullYear();
    container._calMonth = now.getMonth();
    renderCalendarTab(container, books, callbacks);
  });

  // Клик по дню
  container.querySelectorAll('.calendar-day[data-date]').forEach(day => {
    day.addEventListener('click', () => {
      const dateStr = day.dataset.date;
      const dayContent = contentByDate[dateStr] || [];

      const dayEl = container.querySelector('#cal-day-content');

      if (dayContent.length === 0) {
        dayEl.innerHTML = `
          <div class="text-center text-muted text-small" style="padding:20px">
            📅 ${formatDateRu(dateStr)}: нет запланированного контента
          </div>
        `;
        return;
      }

      dayEl.innerHTML = `
        <div class="text-small text-muted mb-8" style="font-weight:700">
          📅 ${formatDateRu(dateStr)}
        </div>
        ${dayContent.map(c => {
          const t = CONTENT_TYPES[c.type] || { icon: '🎬', label: c.type };
          const s = CONTENT_STATUSES[c.status] || { icon: '❓', label: c.status, class: '' };
          const p = PLATFORMS[c.platform] || { icon: '🌐', label: c.platform || '' };
          return `
            <div class="content-card" style="cursor:default">
              <div class="content-icon ${t.color || ''}">${t.icon}</div>
              <div class="content-info">
                <div class="content-title">${esc(c.title || t.label)}</div>
                <div class="content-book">📕 ${esc(c.bookTitle)}</div>
                <div class="content-meta">
                  <span class="content-list-status ${s.class}">${s.icon} ${s.label}</span>
                  <span class="platform-badge">${p.icon} ${p.label}</span>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      `;
    });
  });

  // Добавить контент
  container.querySelector('#cal-add').addEventListener('click', () => {
    callbacks.onAdd();
  });
}

// ═══════════════════════════════════════════════
//  6. УТИЛИТЫ
// ═══════════════════════════════════════════════

/**
 * Подсчёт по ключу.
 * @returns {Object<string, number>}
 */
function countBy(arr, keyFn) {
  const result = {};
  for (const item of arr) {
    const key = keyFn(item);
    if (key) result[key] = (result[key] || 0) + 1;
  }
  return result;
}

/**
 * Прочитанные книги по месяцам (за последние 12).
 */
function calcMonthlyBooks(books) {
  const now = new Date();
  const months = [];

  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' });

    const count = books.filter(b => {
      if (b.status !== 'finished') return false;
      const date = b.dateFinished || b.updatedAt || '';
      return date.startsWith(key);
    }).length;

    months.push({ key, label, count });
  }

  // Убираем пустые месяцы в начале
  while (months.length > 0 && months[0].count === 0) months.shift();
  return months;
}

/**
 * Опубликованный контент по месяцам (за последние 12).
 */
function calcMonthlyContent(allContent) {
  const now = new Date();
  const months = [];

  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' });

    const count = allContent.filter(c => {
      if (c.status !== 'published') return false;
      const date = c.publishedDate || '';
      return date.startsWith(key);
    }).length;

    months.push({ key, label, count });
  }

  while (months.length > 0 && months[0].count === 0) months.shift();
  return months;
}

/**
 * Цвет для типа контента (для точек календаря).
 */
function getTypeColor(type) {
  const colors = {
    unboxing: '#e0a030', read_with_me: '#4caf82', review: '#a78bfa',
    lipsync: '#f472b6', top: '#22d3ee', quote: '#6c8cff',
    comparison: '#e05555', haul: '#f97316'
  };
  return colors[type] || '#6c8cff';
}

/**
 * Форматирование даты: "25 июля 2026"
 */
function formatDateRu(dateStr) {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('ru-RU', {
      day: 'numeric', month: 'long', year: 'numeric'
    });
  } catch {
    return dateStr;
  }
}