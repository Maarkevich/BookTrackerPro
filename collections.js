// ─────────────────────────────────────────────
// 📦 BookTrackerPro — collections.js
// 🔖 v3.7.0 | 2026-08-07
// 📝 Подборки книг
//
//    Типы:
//      ❤️ Любимые       — предсозданная (isSystem)
//      💩 Книги-какахи  — предсозданная (isSystem)
//      🌊 Пользовательские — создаёт пользователь
//
//    Системные фильтры (не хранятся, генерируются):
//      📂 По жанрам · 📂 По авторам · 📂 По издательствам
//
//    Новое в 3.7.0:
//      — Жест «назад» (History API): trackOverlay/untrackOverlay
//        для динамических оверлеев формы, пикера и добавления книг
//      — showConfirm (uikit.js) вместо нативных confirm()
//      — SVG-иконки из icons.js в UI-хроме
//      — referrerpolicy no-referrer на обложках
//      — onerror-фолбэк обложек на плейсхолдер
//
//    Сохранено из 3.5.0:
//      — Единый список без разделения на «системные/свои»
//      — Изменение порядка подборок кнопками ↑/↓ (order)
//      — Предсозданные можно редактировать, нельзя удалить
// ─────────────────────────────────────────────
import { loadCollections, putCollection, delCollection,
         addBookToCollection, removeBookFromCollection } from './db.js';
import { esc, showToast, trackOverlay, untrackOverlay } from './app.js';
import { icon } from './icons.js';
import { showConfirm } from './uikit.js';

// ═══════════════════════════════════════════════
//  1. СПИСОК ПОДБОРОК
// ═══════════════════════════════════════════════
/**
 * Рендерит экран подборок (единый список в порядке order).
 * @param {HTMLElement} container
 * @param {object[]} books
 * @param {object[]} collections — уже отсортированы по order (db.js)
 * @param {object} callbacks — { onOpen, onAdd, onEdit, onDelete, onAddBook, onMove }
 */
export function renderCollectionsList(container, books, collections, callbacks) {
  const total = collections.length;

  container.innerHTML = `
    <div class="text-small text-muted mb-8" style="font-weight:700">
      ${icon('folder', 14)} Подборки (${total})
      <span style="font-weight:500;opacity:.7">· ↑↓ — изменить порядок</span>
    </div>
    ${total === 0 ? `
      <div class="text-center text-muted text-small" style="padding:20px">
        Пока нет подборок. Создайте первую!
      </div>
    ` : collections.map((c, idx) => renderCollectionCard(c, books, idx, total)).join('')}
    <button id="col-add-btn" class="btn-primary mt-16">
      ${icon('plus', 16)} Новая подборка
    </button>
  `;

  // Клик по карточке → открыть подборку
  container.querySelectorAll('.collection-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      callbacks.onOpen(card.dataset.colId);
    });
  });

  // Перемещение ↑ / ↓
  container.querySelectorAll('[data-col-up]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      callbacks.onMove(btn.dataset.colUp, 'up');
    });
  });
  container.querySelectorAll('[data-col-down]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      callbacks.onMove(btn.dataset.colDown, 'down');
    });
  });

  // Редактирование (в т.ч. системных)
  container.querySelectorAll('[data-col-edit]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const col = collections.find(c => c.id === btn.dataset.colEdit);
      if (col) callbacks.onEdit(col);
    });
  });

  // Удаление (только пользовательские)
  container.querySelectorAll('[data-col-del]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      callbacks.onDelete(btn.dataset.colDel);
    });
  });

  container.querySelector('#col-add-btn').addEventListener('click', () => {
    callbacks.onAdd();
  });
}

/**
 * Карточка подборки с кнопками порядка и редактирования.
 */
function renderCollectionCard(col, books, idx, total) {
  const count = col.bookIds.length;
  const isSystem = col.isSystem;
  const isFirst = idx === 0;
  const isLast = idx === total - 1;

  return `
    <div class="collection-card" data-col-id="${col.id}">
      <div class="collection-emoji">${col.emoji}</div>
      <div class="collection-info">
        <div class="collection-name">
          ${esc(col.name)}
          ${isSystem ? '<span class="col-system-badge">системная</span>' : ''}
        </div>
        <div class="collection-count">${count} ${pluralize(count, 'книга', 'книги', 'книг')}</div>
      </div>
      <div class="collection-actions">
        <button data-col-up="${col.id}" class="col-move-btn"
                ${isFirst ? 'disabled' : ''} title="Выше">${icon('chevronUp', 14)}</button>
        <button data-col-down="${col.id}" class="col-move-btn"
                ${isLast ? 'disabled' : ''} title="Ниже">${icon('chevronDown', 14)}</button>
        <button data-col-edit="${col.id}" class="icon-btn col-icon-btn" title="Редактировать">
          ${icon('edit', 15)}
        </button>
        ${!isSystem ? `
        <button data-col-del="${col.id}" class="icon-btn col-icon-btn col-del-btn" title="Удалить">
          ${icon('trash', 15)}
        </button>
        ` : ''}
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════
//  2. ЭКРАН ПОДБОРКИ (книги внутри)
// ═══════════════════════════════════════════════
/**
 * Рендерит экран подборки: список книг.
 * @param {HTMLElement} container
 * @param {object} collection
 * @param {object[]} books — все книги
 * @param {object} callbacks — { onOpenBook, onRemoveBook, onAddBook, onBack, onEdit }
 */
export function renderCollectionDetail(container, collection, books, callbacks) {
  const colBooks = books.filter(b => collection.bookIds.includes(b.id));
  // Сортировка: по порядку добавления в подборку (порядок bookIds)
  colBooks.sort((a, b) => {
    const ai = collection.bookIds.indexOf(a.id);
    const bi = collection.bookIds.indexOf(b.id);
    return ai - bi;
  });

  container.innerHTML = `
    <button id="col-back" class="btn-secondary mb-16">${icon('arrowLeft', 14)} Подборки</button>
    <div class="collection-hero">
      <div class="collection-hero-emoji">${collection.emoji}</div>
      <div class="collection-hero-info">
        <h2>${esc(collection.name)}</h2>
        ${collection.description
          ? `<div class="text-small text-muted mt-8">${esc(collection.description)}</div>`
          : ''}
        <div class="text-small text-muted mt-8">
          ${colBooks.length} ${pluralize(colBooks.length, 'книга', 'книги', 'книг')}
          ${collection.isSystem ? ' · системная' : ''}
        </div>
      </div>
      <button id="col-edit-hero" class="btn-secondary" style="flex-shrink:0" title="Редактировать">
        ${icon('edit', 14)}
      </button>
    </div>
    ${colBooks.length === 0 ? `
      <div class="empty-state">
        <div class="empty-icon">${collection.emoji}</div>
        <div class="empty-title">Подборка пуста</div>
        <div class="empty-text">Добавьте книги в эту подборку</div>
      </div>
    ` : `
      <div class="book-list">
        ${colBooks.map(b => `
          <div class="book-card" data-book-id="${b.id}">
            ${b.coverUrl
              ? `<img class="book-cover" src="${b.coverUrl}" alt="" loading="lazy"
                      referrerpolicy="no-referrer"
                      onerror="this.style.display='none'"/>`
              : `<div class="book-cover-placeholder">${icon('bookClosed', 24)}</div>`}
            <div class="book-info">
              <div class="book-title">${esc(b.title)}</div>
              <div class="book-author">${esc(b.author)}</div>
            </div>
            <button data-col-remove="${b.id}" class="icon-btn col-icon-btn"
                    style="flex-shrink:0" title="Убрать из подборки">${icon('close', 14)}</button>
          </div>
        `).join('')}
      </div>
    `}
    <button id="col-add-book" class="btn-primary mt-16">
      ${icon('plus', 16)} Добавить книгу в подборку
    </button>
  `;

  // События
  container.querySelector('#col-back').addEventListener('click', () => callbacks.onBack());
  const editHero = container.querySelector('#col-edit-hero');
  if (editHero) editHero.addEventListener('click', () => callbacks.onEdit(collection));

  container.querySelectorAll('.book-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-col-remove]')) return;
      callbacks.onOpenBook(card.dataset.bookId);
    });
  });

  container.querySelectorAll('[data-col-remove]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      callbacks.onRemoveBook(collection.id, btn.dataset.colRemove);
    });
  });

  container.querySelector('#col-add-book').addEventListener('click', () => {
    callbacks.onAddBook(collection.id);
  });
}

// ═══════════════════════════════════════════════
//  3. ФОРМА ПОДБОРКИ (создание / редактирование)
// ═══════════════════════════════════════════════
/**
 * Открывает форму создания/редактирования подборки.
 * Работает и для системных (isSystem сохраняется).
 * @param {object|null} collection — null для новой
 * @param {function} onSave — (data) => void
 */
export function openCollectionForm(collection, onSave) {
  const c = collection || {};
  const isEdit = !!collection;

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="overlay-panel" style="max-height:70dvh">
      <div class="overlay-header">
        <h2>${isEdit ? `${icon('edit', 18)} Редактировать подборку` : `${icon('folder', 18)} Новая подборка`}</h2>
        <button class="icon-btn col-form-close">${icon('close', 16)}</button>
      </div>
      <div class="overlay-body">
        ${c.isSystem ? `
          <div class="text-small" style="padding:8px 12px;background:var(--accent-dim);
               border-radius:var(--radius-sm);color:var(--accent);margin-bottom:14px">
            ${icon('bookmark', 13)} Это предсозданная подборка — можно изменить название,
            эмодзи и описание, но нельзя удалить.
          </div>
        ` : ''}
        <div class="form-group">
          <label>Эмодзи</label>
          <input type="text" id="col-f-emoji" value="${esc(c.emoji || '📂')}"
                 maxlength="4" style="width:60px;text-align:center;font-size:1.5rem"/>
        </div>
        <div class="form-group">
          <label>Название *</label>
          <input type="text" id="col-f-name" value="${esc(c.name || '')}"
                 placeholder="Летнее чтение" required/>
        </div>
        <div class="form-group">
          <label>Описание</label>
          <textarea id="col-f-desc" rows="2"
                    placeholder="Книги для отпуска на море...">${esc(c.description || '')}</textarea>
        </div>
        <button id="col-f-save" class="btn-primary">${icon('check', 15)} Сохранить</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  trackOverlay(overlay); // 🆕 v3.7.0: жест «назад»

  const close = () => {
    overlay.remove();
    untrackOverlay(overlay);
    document.body.style.overflow = '';
  };

  overlay.querySelector('.col-form-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  overlay.querySelector('#col-f-save').addEventListener('click', () => {
    const name = overlay.querySelector('#col-f-name').value.trim();
    if (!name) {
      showToast('⚠️ Введите название', 'error');
      return;
    }
    const data = {
      id: c.id || `col_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      emoji: overlay.querySelector('#col-f-emoji').value.trim() || '📂',
      description: overlay.querySelector('#col-f-desc').value.trim(),
      bookIds: c.bookIds || [],
      isSystem: c.isSystem || false,
      order: typeof c.order === 'number' ? c.order : undefined,
      createdAt: c.createdAt || new Date().toISOString(),
    };
    onSave(data);
    close();
  });
}

// ═══════════════════════════════════════════════
//  4. ВЫБОР ПОДБОРОК ДЛЯ КНИГИ (чекбоксы)
// ═══════════════════════════════════════════════
/**
 * Открывает оверлей с чекбоксами: добавить книгу в подборки.
 * @param {string} bookId
 * @param {object[]} books
 * @param {object[]} collections
 * @param {function} onDone
 */
export function openBookCollectionsPicker(bookId, books, collections, onDone) {
  const book = books.find(b => b.id === bookId);
  if (!book) return;

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="overlay-panel" style="max-height:75dvh">
      <div class="overlay-header">
        <h2>${icon('folder', 18)} Подборки</h2>
        <button class="icon-btn picker-close">${icon('close', 16)}</button>
      </div>
      <div class="overlay-body">
        <div class="text-small text-muted mb-16">
          ${icon('bookClosed', 14)} ${esc(book.title)}
        </div>
        <div id="picker-list">
          ${collections.map(col => {
            const checked = col.bookIds.includes(bookId);
            return `
              <label class="picker-row">
                <input type="checkbox" data-col-id="${col.id}"
                       ${checked ? 'checked' : ''}/>
                <span class="picker-emoji">${col.emoji}</span>
                <span class="picker-name">${esc(col.name)}</span>
                <span class="picker-count">(${col.bookIds.length})</span>
              </label>
            `;
          }).join('')}
        </div>
        <button id="picker-save" class="btn-primary mt-16">${icon('check', 15)} Готово</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  trackOverlay(overlay); // 🆕 v3.7.0

  const close = () => {
    overlay.remove();
    untrackOverlay(overlay);
    document.body.style.overflow = '';
  };

  overlay.querySelector('.picker-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  overlay.querySelector('#picker-save').addEventListener('click', async () => {
    const checkboxes = overlay.querySelectorAll('#picker-list input[type="checkbox"]');
    for (const cb of checkboxes) {
      const colId = cb.dataset.colId;
      if (cb.checked) {
        await addBookToCollection(colId, bookId);
      } else {
        await removeBookFromCollection(colId, bookId);
      }
    }
    showToast('✅ Подборки обновлены', 'success');
    close();
    if (onDone) onDone();
  });
}

// ═══════════════════════════════════════════════
//  5. ВЫБОР КНИГ ДЛЯ ДОБАВЛЕНИЯ В ПОДБОРКУ
// ═══════════════════════════════════════════════
/**
 * Открывает оверлей: выбрать книги для добавления в подборку.
 * @param {string} collectionId
 * @param {object[]} books
 * @param {object} collection
 * @param {function} onDone
 */
export function openAddBooksToCollection(collectionId, books, collection, onDone) {
  const inCol = new Set(collection.bookIds);
  const available = books.filter(b => !inCol.has(b.id));

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="overlay-panel" style="max-height:80dvh">
      <div class="overlay-header">
        <h2>${collection.emoji} ${esc(collection.name)}</h2>
        <button class="icon-btn add-books-close">${icon('close', 16)}</button>
      </div>
      <div class="overlay-body">
        ${available.length === 0 ? `
          <div class="text-center text-muted" style="padding:30px">
            Все книги уже в подборке
          </div>
        ` : `
          <div class="form-group">
            <input type="text" id="add-books-search"
                   placeholder="${icon('search', 13)} Поиск по названию или автору..."
                   autocomplete="off"/>
          </div>
          <div id="add-books-list">
            ${available.map(b => `
              <label class="picker-row" data-search="${(b.title + ' ' + b.author).toLowerCase()}">
                <input type="checkbox" data-book-id="${b.id}"/>
                ${b.coverUrl
                  ? `<img src="${b.coverUrl}" referrerpolicy="no-referrer"
                          onerror="this.style.display='none'"
                          style="width:32px;height:48px;border-radius:4px;object-fit:cover"/>`
                  : `<span style="width:32px;height:48px;display:flex;align-items:center;justify-content:center;background:var(--bg-input);border-radius:4px;color:var(--text-muted)">${icon('bookClosed', 18)}</span>`}
                <span class="picker-name" style="flex:1">${esc(b.title)}</span>
              </label>
            `).join('')}
          </div>
          <button id="add-books-save" class="btn-primary mt-16">
            ${icon('check', 15)} Добавить выбранные
          </button>
        `}
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  trackOverlay(overlay); // 🆕 v3.7.0

  const close = () => {
    overlay.remove();
    untrackOverlay(overlay);
    document.body.style.overflow = '';
  };

  overlay.querySelector('.add-books-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  // Поиск
  const searchInput = overlay.querySelector('#add-books-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.toLowerCase().trim();
      overlay.querySelectorAll('#add-books-list .picker-row').forEach(row => {
        row.style.display = row.dataset.search.includes(q) ? '' : 'none';
      });
    });
  }

  // Сохранение
  const saveBtn = overlay.querySelector('#add-books-save');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const checked = overlay.querySelectorAll('#add-books-list input:checked');
      for (const cb of checked) {
        await addBookToCollection(collectionId, cb.dataset.bookId);
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
export async function createCollection(data) {
  await putCollection(data);
}
export async function updateCollection(data) {
  await putCollection(data);
}
export async function deleteCollection(id) {
  await delCollection(id);
}
export async function removeBookFromCol(collectionId, bookId) {
  await removeBookFromCollection(collectionId, bookId);
}

// ═══════════════════════════════════════════════
//  7. СИСТЕМНЫЕ ФИЛЬТРЫ (для drawer)
// ═══════════════════════════════════════════════
/**
 * Генерирует данные для системных фильтров в drawer.
 * @param {object[]} books
 * @returns {{ genres, authors, publishers }}
 */
export function getSystemFilters(books) {
  const genres = {};
  const authors = {};
  const publishers = {};

  for (const b of books) {
    if (b.genre) genres[b.genre] = (genres[b.genre] || 0) + 1;
    if (b.author) authors[b.author] = (authors[b.author] || 0) + 1;
    if (b.publisher) publishers[b.publisher] = (publishers[b.publisher] || 0) + 1;
  }

  const sort = (obj) => Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  return {
    genres: sort(genres),
    authors: sort(authors),
    publishers: sort(publishers),
  };
}

/**
 * Рендерит HTML для аккордеонов системных фильтров в drawer.
 * @param {object[]} books
 * @returns {string}
 */
export function renderDrawerFilters(books) {
  const { genres, authors, publishers } = getSystemFilters(books);

  const section = (title, iconName, items, filterType) => {
    if (items.length === 0) return '';
    return `
      <div class="drawer-filter-group">
        <button class="drawer-filter-toggle" data-ftoggle="${filterType}">
          <span>${icon(iconName, 14)} ${title}</span>
          <span class="drawer-filter-arrow">${icon('chevronRight', 11)}</span>
        </button>
        <div class="drawer-filter-items hidden" data-fitems="${filterType}">
          ${items.map(item => `
            <button class="drawer-filter-item"
                    data-filter-type="${filterType}"
                    data-filter-value="${esc(item.name)}">
              ${esc(item.name)}
              <span class="drawer-filter-count">(${item.count})</span>
            </button>
          `).join('')}
        </div>
      </div>
    `;
  };

  return `
    ${section('По жанрам', 'folder', genres, 'genre')}
    ${section('По авторам', 'users', authors, 'author')}
    ${section('По издательствам', 'library', publishers, 'publisher')}
  `;
}

// ═══════════════════════════════════════════════
//  8. УТИЛИТЫ
// ═══════════════════════════════════════════════
function pluralize(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

// ═══════════════════════════════════════════════
//  9. СТИЛИ (инжектируются один раз)
// ═══════════════════════════════════════════════
const COLLECTION_STYLES = `
.collection-card {
  display:flex; align-items:center; gap:12px;
  padding:12px 14px;
  background:var(--bg-card);
  border:1px solid var(--border);
  border-radius:var(--radius);
  cursor:pointer;
  transition:all .2s var(--ease);
  margin-bottom:8px;
}
.collection-card:hover {
  border-color:var(--accent);
  background:var(--bg-card-hover);
}
.collection-emoji { font-size:1.5rem; flex-shrink:0; }
.collection-info { flex:1; min-width:0; }
.collection-name {
  font-size:.92rem; font-weight:600;
  display:flex; align-items:center; gap:7px;
}
.collection-count { font-size:.78rem; color:var(--text-secondary); }
.col-system-badge {
  font-size:.6rem; font-weight:800;
  padding:2px 7px; border-radius:8px;
  background:var(--accent-dim); color:var(--accent);
  text-transform:uppercase; letter-spacing:.05em;
  flex-shrink:0;
}
.collection-actions {
  display:flex; align-items:center; gap:4px;
  flex-shrink:0;
}
.col-move-btn {
  width:28px; height:28px;
  display:flex; align-items:center; justify-content:center;
  border-radius:8px;
  background:var(--bg-input);
  border:1px solid var(--border-soft);
  color:var(--text-secondary);
  cursor:pointer;
  transition:all .15s var(--ease);
}
.col-move-btn:hover:not(:disabled) {
  border-color:var(--accent); color:var(--accent);
  transform:translateY(-1px);
}
.col-move-btn:active:not(:disabled) { transform:scale(.9); }
.col-move-btn:disabled { opacity:.25; cursor:not-allowed; }
.col-icon-btn {
  width:32px; height:32px;
  display:inline-flex; align-items:center; justify-content:center;
  border-radius:8px;
  color:var(--text-secondary);
  transition:all .15s var(--ease);
}
.col-icon-btn:hover { background:var(--accent-dim); color:var(--accent); transform:translateY(-1px); }
.col-del-btn:hover { background:var(--red-dim); color:var(--red); }
.collection-hero {
  display:flex; align-items:center; gap:14px;
  padding:18px;
  background:linear-gradient(135deg, var(--bg-card), var(--bg-secondary));
  border:1px solid var(--border);
  border-radius:var(--radius-lg);
  margin-bottom:16px;
}
.collection-hero-emoji { font-size:2.5rem; }
.collection-hero-info { flex:1; }
.collection-hero-info h2 { font-size:1.15rem; font-weight:800; }
.picker-row {
  display:flex; align-items:center; gap:10px;
  padding:10px 12px;
  border-radius:var(--radius-sm);
  cursor:pointer;
  transition:background .15s var(--ease);
}
.picker-row:hover { background:var(--bg-card); }
.picker-row input[type="checkbox"] {
  width:18px; height:18px;
  accent-color:var(--accent);
  flex-shrink:0;
}
.picker-emoji { font-size:1.1rem; }
.picker-name { font-size:.9rem; font-weight:500; }
.picker-count { font-size:.78rem; color:var(--text-muted); }
.drawer-filter-group { border-bottom:1px solid var(--border); }
.drawer-filter-toggle {
  display:flex; align-items:center; justify-content:space-between;
  width:100%; padding:10px 16px;
  font-size:.88rem; font-weight:600;
  color:var(--text-secondary);
  transition:color .2s var(--ease);
}
.drawer-filter-toggle:hover { color:var(--text-primary); }
.drawer-filter-toggle > span:first-child {
  display:inline-flex; align-items:center; gap:8px;
}
.drawer-filter-arrow {
  display:inline-flex; align-items:center;
  color:var(--text-muted);
  transition:transform .2s var(--ease);
}
.drawer-filter-toggle.open .drawer-filter-arrow { transform:rotate(90deg); }
.drawer-filter-items { padding:0 8px 8px; }
.drawer-filter-item {
  display:flex; align-items:center; justify-content:space-between;
  width:100%; padding:8px 12px;
  font-size:.85rem; color:var(--text-secondary);
  border-radius:6px;
  transition:all .15s var(--ease);
}
.drawer-filter-item:hover {
  background:var(--accent-dim);
  color:var(--accent);
}
.drawer-filter-count { font-size:.75rem; color:var(--text-muted); }
`;
if (!document.getElementById('collection-styles')) {
  const style = document.createElement('style');
  style.id = 'collection-styles';
  style.textContent = COLLECTION_STYLES;
  document.head.appendChild(style);
}