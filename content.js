// ─────────────────────────────────────────────
// 📦 BookTrackerPro — content.js
// 🔖 v3.2.0 | 2026-07-24
// 📝 Контент-план для бук-блогера
//
//    Типы контента:
//      📦 unboxing     — Распаковка
//      📖 read_with_me — Начни читать со мной
//      💬 review       — Отзыв / Мнение
//      🎵 lipsync      — Липсинг
//      🏆 top          — Подборка / Топ
//      ✨ quote        — Цитата
//      ⚖️ comparison   — Сравнение
//      🛒 haul         — Книжный haul
//
//    Статусы:
//      💡 idea → 📅 planned → 🎥 filming → ✂️ editing → 📤 published
//
//    Площадки:
//      ▶️ YouTube | 🎵 TikTok | ✈️ Telegram
//      🔵 VK | 📰 Дзен | 📸 Instagram
// ─────────────────────────────────────────────

import { addContentToBook, updateContentInBook,
         removeContentFromBook, loadBooks } from './db.js';
import { esc, showToast } from './app.js';

// ═══════════════════════════════════════════════
//  КОНСТАНТЫ
// ═══════════════════════════════════════════════

export const CONTENT_TYPES = {
  unboxing:     { icon: '📦', label: 'Распаковка',            color: 'unboxing' },
  read_with_me: { icon: '📖', label: 'Начни читать со мной',  color: 'read_with_me' },
  review:       { icon: '💬', label: 'Отзыв / Мнение',        color: 'review' },
  lipsync:      { icon: '🎵', label: 'Липсинг',               color: 'lipsync' },
  top:          { icon: '🏆', label: 'Подборка / Топ',        color: 'top' },
  quote:        { icon: '✨', label: 'Цитата',                 color: 'quote' },
  comparison:   { icon: '⚖️', label: 'Сравнение',             color: 'comparison' },
  haul:         { icon: '🛒', label: 'Книжный haul',           color: 'haul' },
};

export const CONTENT_STATUSES = {
  idea:      { icon: '💡', label: 'Идея',           class: 'status-idea' },
  planned:   { icon: '📅', label: 'Запланировано',  class: 'status-planned' },
  filming:   { icon: '🎥', label: 'Снимаю',         class: 'status-filming' },
  editing:   { icon: '✂️', label: 'Монтаж',         class: 'status-editing' },
  published: { icon: '📤', label: 'Опубликовано',   class: 'status-published' },
};

export const PLATFORMS = {
  youtube:   { icon: '▶️', label: 'YouTube' },
  tiktok:    { icon: '🎵', label: 'TikTok' },
  telegram:  { icon: '✈️', label: 'Telegram' },
  vk:        { icon: '🔵', label: 'VK' },
  dzen:      { icon: '📰', label: 'Дзен' },
  instagram: { icon: '📸', label: 'Instagram' },
};

// ═══════════════════════════════════════════════
//  1. РЕНДЕР ВКЛАДКИ «КОНТЕНТ-ПЛАН»
// ═══════════════════════════════════════════════

/**
 * Рендерит вкладку контент-плана.
 *
 * @param {HTMLElement} container — #main-content
 * @param {object[]} books — все книги
 * @param {object} settings — настройки приложения
 * @param {object} callbacks — { onEdit, onDelete, onStatusChange, onAdd }
 */
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

  // Сортировка: по дате (запланированные → по дате, идеи → по созданию)
  allContent.sort((a, b) => {
    const dateA = a.plannedDate || a.publishedDate || a.createdAt || '';
    const dateB = b.plannedDate || b.publishedDate || b.createdAt || '';
    return dateB.localeCompare(dateA);
  });

  // Фильтры
  const filters = [
    { id: 'all',       label: `Все (${allContent.length})` },
    { id: 'idea',      label: '💡 Идеи' },
    { id: 'planned',   label: '📅 Запланировано' },
    { id: 'filming',   label: '🎥 Снимаю' },
    { id: 'editing',   label: '✂️ Монтаж' },
    { id: 'published', label: '📤 Опубликовано' },
  ];

  // Текущий фильтр (сохраняем между рендерами)
  if (!container._contentFilter) container._contentFilter = 'all';
  const currentFilter = container._contentFilter;

  const filtered = currentFilter === 'all'
    ? allContent
    : allContent.filter(c => c.status === currentFilter);

  // Группировка по датам для непустого списка
  const groups = groupByDate(filtered);

  container.innerHTML = `
    <div class="filter-bar no-scrollbar">
      ${filters.map(f => `
        <button class="filter-chip ${currentFilter === f.id ? 'active' : ''}"
                data-cfilter="${f.id}">${f.label}</button>
      `).join('')}
    </div>

    ${filtered.length === 0 ? `
      <div class="empty-state">
        <div class="empty-icon">🎬</div>
        <div class="empty-title">Нет контента</div>
        <div class="empty-text">
          Добавьте контент-элемент к книге —
          распаковку, отзыв, липсинг или подборку
        </div>
        <button id="content-empty-add" class="btn-primary mt-16" style="width:auto">
          ＋ Добавить контент
        </button>
      </div>
    ` : `
      ${groups.map(g => `
        <div class="mb-16">
          <div class="text-small text-muted mb-8" style="font-weight:700">
            ${g.label}
          </div>
          ${g.items.map(c => renderContentCard(c)).join('')}
        </div>
      `).join('')}
    `}

    <button id="content-add-btn" class="btn-primary mt-16">
      ＋ Новый контент
    </button>
  `;

  // ── События ──

  // Фильтры
  container.querySelectorAll('[data-cfilter]').forEach(chip => {
    chip.addEventListener('click', () => {
      container._contentFilter = chip.dataset.cfilter;
      renderContentTab(container, books, settings, callbacks);
    });
  });

  // Добавить контент
  const addBtn = container.querySelector('#content-add-btn');
  const emptyAdd = container.querySelector('#content-empty-add');
  if (addBtn) addBtn.addEventListener('click', () => callbacks.onAdd());
  if (emptyAdd) emptyAdd.addEventListener('click', () => callbacks.onAdd());

  // Клик по карточке контента → редактирование
  container.querySelectorAll('.content-card').forEach(card => {
    card.addEventListener('click', (e) => {
      // Не срабатывает при клике на кнопки внутри
      if (e.target.closest('button')) return;
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
      const { bookId, contentId, newStatus } = btn.dataset;
      callbacks.onStatusChange(contentId, bookId, newStatus);
    });
  });

  // Удаление
  container.querySelectorAll('[data-delete-content]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const { bookId, contentId } = btn.dataset;
      callbacks.onDelete(contentId, bookId);
    });
  });

  // Копирование ссылки
  container.querySelectorAll('[data-copy-url]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const url = btn.dataset.copyUrl;
      navigator.clipboard?.writeText(url).then(() => {
        showToast('🔗 Ссылка скопирована', 'success');
      });
    });
  });
}

// ═══════════════════════════════════════════════
//  2. КАРТОЧКА КОНТЕНТА
// ═══════════════════════════════════════════════

function renderContentCard(item) {
  const type = CONTENT_TYPES[item.type] || { icon: '🎬', label: item.type, color: '' };
  const status = CONTENT_STATUSES[item.status] || { icon: '❓', label: item.status, class: '' };
  const platform = PLATFORMS[item.platform] || { icon: '🌐', label: item.platform || '' };

  // Следующий статус для быстрой кнопки
  const statusOrder = ['idea', 'planned', 'filming', 'editing', 'published'];
  const currentIdx = statusOrder.indexOf(item.status);
  const nextStatus = currentIdx < statusOrder.length - 1
    ? statusOrder[currentIdx + 1] : null;
  const nextInfo = nextStatus ? CONTENT_STATUSES[nextStatus] : null;

  const dateStr = item.publishedDate || item.plannedDate || '';

  return `
    <div class="content-card" data-book-id="${item.bookId}" data-content-id="${item.id}">
      <div class="content-icon ${type.color}">${type.icon}</div>
      <div class="content-info">
        <div class="content-title">${esc(item.title || type.label)}</div>
        <div class="content-book">📕 ${esc(item.bookTitle)}</div>
        <div class="content-meta">
          <span class="content-list-status ${status.class}">
            ${status.icon} ${status.label}
          </span>
          <span class="platform-badge">${platform.icon} ${platform.label}</span>
          ${dateStr ? `<span class="content-date">📅 ${dateStr}</span>` : ''}
        </div>
        ${item.publishedUrl ? `
          <div class="content-meta mt-8">
            <a href="${esc(item.publishedUrl)}" target="_blank" rel="noopener"
               class="text-small" onclick="event.stopPropagation()">
              🔗 Открыть
            </a>
            <button data-copy-url="${esc(item.publishedUrl)}"
                    class="text-small text-muted"
                    style="background:none;border:none;cursor:pointer">
              📋 Копировать ссылку
            </button>
          </div>
        ` : ''}
        ${item.notes ? `
          <div class="text-small text-muted mt-8 truncate">${esc(item.notes)}</div>
        ` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
        ${nextInfo ? `
          <button data-status-btn
                  data-book-id="${item.bookId}"
                  data-content-id="${item.id}"
                  data-new-status="${nextStatus}"
                  class="btn-small"
                  title="→ ${nextInfo.label}">
            ${nextInfo.icon}
          </button>
        ` : ''}
        <button data-delete-content
                data-book-id="${item.bookId}"
                data-content-id="${item.id}"
                class="icon-btn"
                style="width:32px;height:32px;font-size:0.9rem"
                title="Удалить">
          🗑️
        </button>
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════
//  3. ФОРМА КОНТЕНТА (добавление / редактирование)
// ═══════════════════════════════════════════════

/**
 * Открывает форму создания/редактирования контента.
 *
 * @param {object|null} item — существующий контент или null (новый)
 * @param {string|null} bookId — ID книги (предвыбранная)
 */
export function openContentForm(item, bookId) {
  const overlay = document.getElementById('content-overlay');
  const title = document.getElementById('content-form-title');
  const body = document.getElementById('content-form-body');

  if (!overlay || !body) return;

  title.textContent = item ? '✏️ Редактировать контент' : '🎬 Новый контент';

  // Загружаем книги для выпадающего списка
  loadBooks().then(books => {
    renderContentFormBody(body, books, item, bookId);
  });

  overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function renderContentFormBody(body, books, item, preselectedBookId) {
  const c = item || {};
  const defaultPlatform = 'youtube'; // можно брать из settings

  body.innerHTML = `
    <!-- Книга -->
    <div class="form-group">
      <label>📕 Книга *</label>
      <select id="cf-book" required>
        <option value="">— Выберите книгу —</option>
        ${books.map(b => `
          <option value="${b.id}"
                  ${(c.bookId || preselectedBookId) === b.id ? 'selected' : ''}>
            ${esc(b.title)} — ${esc(b.author)}
          </option>
        `).join('')}
      </select>
    </div>

    <!-- Тип контента -->
    <div class="form-group">
      <label>🎬 Тип контента *</label>
      <div class="content-type-grid">
        ${Object.entries(CONTENT_TYPES).map(([key, t]) => `
          <button class="content-type-btn ${(c.type || 'unboxing') === key ? 'active' : ''}"
                  data-type="${key}">
            <span class="content-type-icon">${t.icon}</span>
            <span class="content-type-label">${t.label}</span>
          </button>
        `).join('')}
      </div>
    </div>

    <!-- Название -->
    <div class="form-group">
      <label>📝 Название</label>
      <input type="text" id="cf-title" value="${esc(c.title || '')}"
             placeholder="Распаковка июльской посылки ЭКСМО"/>
      <div class="form-hint">Если пусто — будет использовано название типа</div>
    </div>

    <!-- Площадка -->
    <div class="form-group">
      <label>📱 Площадка</label>
      <div class="platform-grid">
        ${Object.entries(PLATFORMS).map(([key, p]) => `
          <button class="platform-btn ${(c.platform || defaultPlatform) === key ? 'active' : ''}"
                  data-platform="${key}">
            ${p.icon} ${p.label}
          </button>
        `).join('')}
      </div>
    </div>

    <!-- Статус -->
    <div class="form-group">
      <label>📊 Статус</label>
      <select id="cf-status">
        ${Object.entries(CONTENT_STATUSES).map(([key, s]) => `
          <option value="${key}" ${(c.status || 'idea') === key ? 'selected' : ''}>
            ${s.icon} ${s.label}
          </option>
        `).join('')}
      </select>
    </div>

    <!-- Даты -->
    <div class="form-row">
      <div class="form-group">
        <label>📅 Дата плана</label>
        <input type="date" id="cf-planned" value="${c.plannedDate || ''}"/>
      </div>
      <div class="form-group">
        <label>📤 Дата публикации</label>
        <input type="date" id="cf-published" value="${c.publishedDate || ''}"/>
      </div>
    </div>

    <!-- Ссылка -->
    <div class="form-group">
      <label>🔗 Ссылка на публикацию</label>
      <input type="url" id="cf-url" value="${esc(c.publishedUrl || '')}"
             placeholder="https://youtube.com/watch?v=..."/>
    </div>

    <!-- Заметки -->
    <div class="form-group">
      <label>📝 Заметки</label>
      <textarea id="cf-notes" rows="3"
                placeholder="Идеи для съёмки, сценарий, реквизит...">${esc(c.notes || '')}</textarea>
    </div>

    <!-- Кнопки -->
    <div class="btn-group">
      <button id="cf-save" class="btn-primary">💾 Сохранить</button>
      ${item ? `<button id="cf-delete" class="btn-danger">🗑️ Удалить</button>` : ''}
    </div>
  `;

  // ── Состояние формы ──
  let selectedType = c.type || 'unboxing';
  let selectedPlatform = c.platform || defaultPlatform;

  // ── События ──

  // Тип контента
  body.querySelectorAll('.content-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      body.querySelectorAll('.content-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedType = btn.dataset.type;
    });
  });

  // Площадка
  body.querySelectorAll('.platform-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      body.querySelectorAll('.platform-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedPlatform = btn.dataset.platform;
    });
  });

  // Сохранение
  body.querySelector('#cf-save').addEventListener('click', async () => {
    const bookId = body.querySelector('#cf-book').value;
    if (!bookId) {
      showToast('⚠️ Выберите книгу', 'error');
      return;
    }

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
      createdAt: c.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      if (item) {
        // Обновление
        await updateContentInBook(bookId, contentData.id, contentData);
        showToast('✅ Контент обновлён', 'success');
      } else {
        // Создание
        await addContentToBook(bookId, contentData);
        showToast('✅ Контент добавлен', 'success');
      }

      closeContentForm();

      // Перерисовываем текущую вкладку
      const event = new CustomEvent('data-changed');
      document.dispatchEvent(event);
    } catch (e) {
      showToast('❌ Ошибка сохранения', 'error');
      console.error('[Content] Save error:', e);
    }
  });

  // Удаление
  const delBtn = body.querySelector('#cf-delete');
  if (delBtn) {
    delBtn.addEventListener('click', async () => {
      if (!confirm('Удалить этот контент?')) return;
      try {
        await removeContentFromBook(
          body.querySelector('#cf-book').value,
          c.id
        );
        showToast('🗑️ Контент удалён', 'info');
        closeContentForm();
        document.dispatchEvent(new CustomEvent('data-changed'));
      } catch (e) {
        showToast('❌ Ошибка удаления', 'error');
      }
    });
  }
}

/**
 * Закрывает форму контента.
 */
function closeContentForm() {
  const overlay = document.getElementById('content-overlay');
  if (overlay) {
    overlay.classList.add('hidden');
    document.body.style.overflow = '';
  }
}

// ═══════════════════════════════════════════════
//  4. ОПЕРАЦИИ С КОНТЕНТОМ (для app.js)
// ═══════════════════════════════════════════════

/**
 * Удаляет контент-элемент.
 * @param {string} bookId
 * @param {string} contentId
 */
export async function deleteContentItem(bookId, contentId) {
  await removeContentFromBook(bookId, contentId);
}

/**
 * Обновляет статус контент-элемента.
 * @param {string} bookId
 * @param {string} contentId
 * @param {string} newStatus
 */
export async function updateContentStatus(bookId, contentId, newStatus) {
  const updates = { status: newStatus, updatedAt: new Date().toISOString() };

  // При публикации ставим дату если не указана
  if (newStatus === 'published') {
    const books = await loadBooks();
    const book = books.find(b => b.id === bookId);
    const item = (book?.contentItems || []).find(c => c.id === contentId);
    if (item && !item.publishedDate) {
      updates.publishedDate = new Date().toISOString().slice(0, 10);
    }
  }

  await updateContentInBook(bookId, contentId, updates);
}

// ═══════════════════════════════════════════════
//  5. УТИЛИТЫ
// ═══════════════════════════════════════════════

/**
 * Находит контент-элемент в массиве книг.
 */
function findContentItem(books, bookId, contentId) {
  const book = books.find(b => b.id === bookId);
  if (!book) return null;
  return (book.contentItems || []).find(c => c.id === contentId) || null;
}

/**
 * Группирует контент по датам для отображения.
 * @param {object[]} items
 * @returns {Array<{label: string, items: object[]}>}
 */
function groupByDate(items) {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  const groups = {};

  for (const item of items) {
    const date = item.plannedDate || item.publishedDate || '';
    let label;

    if (!date) {
      label = '📌 Без даты';
    } else if (date === today) {
      label = '📅 Сегодня';
    } else if (date === tomorrow) {
      label = '📅 Завтра';
    } else if (date === yesterday) {
      label = '📅 Вчера';
    } else if (date < today) {
      label = '⏪ Прошедшие';
    } else {
      // Форматируем дату: "25 июля 2026"
      try {
        const d = new Date(date + 'T00:00:00');
        label = '📅 ' + d.toLocaleDateString('ru-RU', {
          day: 'numeric', month: 'long', year: 'numeric'
        });
      } catch {
        label = '📅 ' + date;
      }
    }

    if (!groups[label]) groups[label] = [];
    groups[label].push(item);
  }

  // Сортировка групп: сегодня → завтра → будущие → прошедшие → без даты
  const order = ['📅 Сегодня', '📅 Завтра'];
  return Object.entries(groups)
    .sort(([a], [b]) => {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
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
//  6. СТИЛИ ДЛЯ ФОРМЫ КОНТЕНТА
//     (инжектируются один раз)
// ═══════════════════════════════════════════════

const CONTENT_FORM_STYLES = `
  .content-type-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }
  .content-type-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 10px 4px;
    border-radius: 10px;
    background: var(--bg-input);
    border: 2px solid transparent;
    cursor: pointer;
    transition: all 0.2s;
    font-size: 0.72rem;
    color: var(--text-secondary);
  }
  .content-type-btn:hover { border-color: var(--border); }
  .content-type-btn.active {
    border-color: var(--accent);
    background: var(--accent-dim);
    color: var(--accent);
  }
  .content-type-icon { font-size: 1.4rem; }
  .content-type-label { text-align: center; line-height: 1.2; }

  .platform-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }
  .platform-btn {
    padding: 8px 12px;
    border-radius: 8px;
    background: var(--bg-input);
    border: 2px solid transparent;
    cursor: pointer;
    font-size: 0.82rem;
    color: var(--text-secondary);
    transition: all 0.2s;
    text-align: center;
  }
  .platform-btn:hover { border-color: var(--border); }
  .platform-btn.active {
    border-color: var(--accent);
    background: var(--accent-dim);
    color: var(--accent);
    font-weight: 600;
  }

  @media (max-width: 400px) {
    .content-type-grid { grid-template-columns: repeat(2, 1fr); }
    .platform-grid { grid-template-columns: repeat(2, 1fr); }
  }
`;

// Инжектируем стили один раз
if (!document.getElementById('content-form-styles')) {
  const style = document.createElement('style');
  style.id = 'content-form-styles';
  style.textContent = CONTENT_FORM_STYLES;
  document.head.appendChild(style);
}