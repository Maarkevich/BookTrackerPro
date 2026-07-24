// ─────────────────────────────────────────────
// 📦 BookTrackerPro — app.js
// 🔖 v3.2.0 | 2026-07-24
// 📝 Точка входа: навигация, рендеринг, события
//
// ⚠️ ТЕСТОВЫЕ КЛЮЧИ ЛИТРЕС (замените на свои!):
//    Catalit:  анонимный доступ (login: Anonymous, pwd: 0)
//    Partner:  partner_id=16, secret=93w4jfhs8imksGo-oa3s85d6Akmkkbnsi9
//    Инструкция по замене — в README.md, раздел «ЛитРес API»
// ─────────────────────────────────────────────

import { openDB, loadBooks, putBook, delBook, loadSettings, saveSettings,
         saveCover, getCover, deleteCover } from './db.js';
import { validateISBN, cleanISBN, fetchBookByIsbn, searchBooks,
         isRussianISBN } from './isbn.js';
import { startScanner, stopScanner } from './scanner.js';
import { renderContentTab, openContentForm, deleteContentItem,
         updateContentStatus } from './content.js';
import { renderReviewsTab, openReviewForm, deleteReview } from './review.js';
import { renderStatsTab, renderCalendarTab } from './stats.js';
import { registerSW } from './sw-register.js';

// ═══════════════════════════════════════════════
//  СОСТОЯНИЕ ПРИЛОЖЕНИЯ
// ═══════════════════════════════════════════════

const S = {
  books: [],
  settings: {
    // ─── ТЕСТОВЫЕ КЛЮЧИ ЛИТРЕС ───
    // Catalit API: анонимный доступ для тестирования
    // Когда получите свои ключи на partners@litres.ru,
    // замените lrAppId и lrSecret в настройках приложения
    lrAppId: '',          // ← ваш App ID от ЛитРес
    lrSecret: '',         // ← ваш Secret Key от ЛитРес

    // Partner API: тестовые ключи из документации
    // docs.litres.ru/public/205502033.html
    // Замените на свои после заключения договора
    lrPartnerId: '16',    // ← ТЕСТОВЫЙ, замените на свой
    lrPartnerSecret: '93w4jfhs8imksGo-oa3s85d6Akmkkbnsi9', // ← ТЕСТОВЫЙ

    // Настройки приложения
    confetti: true,
    sound: true,
    defaultPlatform: 'youtube',
    bloggerMode: true,    // режим бук-блогера
  },
  currentTab: 'books',
  bookFilter: 'all',
  contentFilter: 'all',
  searchQuery: '',
  editingBookId: null,
};

// ═══════════════════════════════════════════════
//  DOM-ЭЛЕМЕНТЫ
// ═══════════════════════════════════════════════

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const DOM = {};

function cacheDom() {
  DOM.backdrop = $('#backdrop');
  DOM.drawer = $('#drawer');
  DOM.drawerClose = $('#drawer-close');
  DOM.menuBtn = $('#menu-btn');
  DOM.pageTitle = $('#page-title');
  DOM.mainContent = $('#main-content');
  DOM.searchToggle = $('#search-toggle');
  DOM.searchBar = $('#search-bar');
  DOM.searchInput = $('#search-input');
  DOM.searchClose = $('#search-close');
  DOM.addBtn = $('#add-btn');
  DOM.formOverlay = $('#form-overlay');
  DOM.formTitle = $('#form-title');
  DOM.formClose = $('#form-close');
  DOM.formBody = $('#form-body');
  DOM.detailOverlay = $('#detail-overlay');
  DOM.detailTitle = $('#detail-title');
  DOM.detailClose = $('#detail-close');
  DOM.detailBody = $('#detail-body');
  DOM.scannerOverlay = $('#scanner-overlay');
  DOM.scannerVideo = $('#scanner-video');
  DOM.scannerStatus = $('#scanner-status');
  DOM.scannerClose = $('#scanner-close');
  DOM.scannerManualInput = $('#scanner-manual-input');
  DOM.scannerManualBtn = $('#scanner-manual-btn');
  DOM.contentOverlay = $('#content-overlay');
  DOM.contentFormTitle = $('#content-form-title');
  DOM.contentFormClose = $('#content-form-close');
  DOM.contentFormBody = $('#content-form-body');
  DOM.reviewOverlay = $('#review-overlay');
  DOM.reviewFormTitle = $('#review-form-title');
  DOM.reviewFormClose = $('#review-form-close');
  DOM.reviewFormBody = $('#review-form-body');
  DOM.toast = $('#toast-el');
  DOM.confettiCanvas = $('#confetti-canvas');
  DOM.updateBanner = $('#update-banner');
  DOM.installBanner = $('#install-banner');
  DOM.drawerVersion = $('#drawer-version');
}

// ═══════════════════════════════════════════════
//  ИНИЦИАЛИЗАЦИЯ
// ═══════════════════════════════════════════════

async function init() {
  cacheDom();
  bindEvents();

  // Загрузка данных
  await openDB();
  S.books = await loadBooks();
  const saved = await loadSettings();
  if (saved) Object.assign(S.settings, saved);

  // Версия в drawer
  try {
    const vRes = await fetch('version.json');
    const vData = await vRes.json();
    DOM.drawerVersion.textContent = `v${vData.version}`;
  } catch { /* offline */ }

  // Регистрация Service Worker
  registerSW();

  // PWA install prompt
  setupInstallPrompt();

  // Первый рендер
  renderTab('books');
}

// ═══════════════════════════════════════════════
//  СОБЫТИЯ
// ═══════════════════════════════════════════════

function bindEvents() {
  // Drawer
  DOM.menuBtn.addEventListener('click', () => toggleDrawer(true));
  DOM.backdrop.addEventListener('click', () => toggleDrawer(false));
  DOM.drawerClose.addEventListener('click', () => toggleDrawer(false));

  // Навигация
  $$('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      renderTab(tab);
      toggleDrawer(false);
    });
  });

  // Поиск
  DOM.searchToggle.addEventListener('click', () => {
    DOM.searchBar.classList.toggle('hidden');
    if (!DOM.searchBar.classList.contains('hidden')) {
      DOM.searchInput.focus();
    }
  });
  DOM.searchClose.addEventListener('click', () => {
    DOM.searchBar.classList.add('hidden');
    DOM.searchInput.value = '';
    S.searchQuery = '';
    renderTab(S.currentTab);
  });
  DOM.searchInput.addEventListener('input', debounce(() => {
    S.searchQuery = DOM.searchInput.value.trim().toLowerCase();
    renderTab(S.currentTab);
  }, 300));

  // Добавление книги
  DOM.addBtn.addEventListener('click', () => openBookForm());

  // Закрытие оверлеев
  DOM.formClose.addEventListener('click', () => closeOverlay(DOM.formOverlay));
  DOM.detailClose.addEventListener('click', () => closeOverlay(DOM.detailOverlay));
  DOM.scannerClose.addEventListener('click', () => closeScanner());
  DOM.contentFormClose.addEventListener('click', () => closeOverlay(DOM.contentOverlay));
  DOM.reviewFormClose.addEventListener('click', () => closeOverlay(DOM.reviewOverlay));

  // Закрытие по клику на фон оверлея
  [DOM.formOverlay, DOM.detailOverlay, DOM.scannerOverlay,
   DOM.contentOverlay, DOM.reviewOverlay].forEach(ov => {
    ov.addEventListener('click', (e) => {
      if (e.target === ov) {
        if (ov === DOM.scannerOverlay) closeScanner();
        else closeOverlay(ov);
      }
    });
  });

  // Сканер: ручной ввод
  DOM.scannerManualBtn.addEventListener('click', () => {
    const val = DOM.scannerManualInput.value.trim();
    if (val) handleIsbnLookup(val);
  });
  DOM.scannerManualInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = DOM.scannerManualInput.value.trim();
      if (val) handleIsbnLookup(val);
    }
  });

  // Обновление PWA
  $('#update-apply')?.addEventListener('click', () => {
    navigator.serviceWorker?.getRegistration().then(reg => {
      reg?.waiting?.postMessage('SKIP_WAITING');
    });
    DOM.updateBanner.classList.add('hidden');
  });
  $('#update-dismiss')?.addEventListener('click', () => {
    DOM.updateBanner.classList.add('hidden');
  });

  // Установка PWA
  $('#install-apply')?.addEventListener('click', () => {
    if (S.deferredPrompt) {
      S.deferredPrompt.prompt();
      S.deferredPrompt = null;
      DOM.installBanner.classList.add('hidden');
    }
  });
  $('#install-dismiss')?.addEventListener('click', () => {
    DOM.installBanner.classList.add('hidden');
  });

  // Клавиша Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!DOM.scannerOverlay.classList.contains('hidden')) closeScanner();
      else if (!DOM.formOverlay.classList.contains('hidden')) closeOverlay(DOM.formOverlay);
      else if (!DOM.detailOverlay.classList.contains('hidden')) closeOverlay(DOM.detailOverlay);
      else if (!DOM.contentOverlay.classList.contains('hidden')) closeOverlay(DOM.contentOverlay);
      else if (!DOM.reviewOverlay.classList.contains('hidden')) closeOverlay(DOM.reviewOverlay);
      else if (DOM.drawer.classList.contains('open')) toggleDrawer(false);
    }
  });
}

// ═══════════════════════════════════════════════
//  НАВИГАЦИЯ / ТАБЫ
// ═══════════════════════════════════════════════

const TAB_TITLES = {
  books: '📚 Мои книги',
  content: '🎬 Контент-план',
  reviews: '✍️ Отзывы',
  calendar: '📅 Календарь',
  stats: '📊 Статистика',
  settings: '⚙️ Настройки',
};

function renderTab(tab) {
  S.currentTab = tab;
  DOM.pageTitle.textContent = TAB_TITLES[tab] || tab;

  // Активная навигация
  $$('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  // Рендер контента
  switch (tab) {
    case 'books': renderBooksTab(); break;
    case 'content': renderContentTab(DOM.mainContent, S.books, S.settings, {
      onEdit: (item, bookId) => openContentForm(item, bookId),
      onDelete: (itemId, bookId) => handleDeleteContent(itemId, bookId),
      onStatusChange: (itemId, bookId, status) => handleContentStatus(itemId, bookId, status),
      onAdd: () => openContentForm(null, null),
    }); break;
    case 'reviews': renderReviewsTab(DOM.mainContent, S.books, {
      onEdit: (bookId) => openReviewForm(bookId),
      onDelete: (bookId) => handleDeleteReview(bookId),
      onOpenBook: (bookId) => openBookDetail(bookId),
    }); break;
    case 'calendar': renderCalendarTab(DOM.mainContent, S.books, {
      onDayClick: (date) => showDayContent(date),
      onAdd: () => openContentForm(null, null),
    }); break;
    case 'stats': renderStatsTab(DOM.mainContent, S.books, S.settings); break;
    case 'settings': renderSettingsTab(); break;
  }
}

// ═══════════════════════════════════════════════
//  ВКЛАДКА: КНИГИ
// ═══════════════════════════════════════════════

function renderBooksTab() {
  const container = DOM.mainContent;
  let books = [...S.books];

  // Фильтр
  const filters = [
    { id: 'all', label: 'Все' },
    { id: 'tbr', label: '📋 Хочу прочитать' },
    { id: 'reading', label: '📖 Читаю' },
    { id: 'finished', label: '✅ Прочитано' },
    { id: 'paused', label: '⏸️ Пауза' },
    { id: 'dropped', label: '❌ Брошено' },
    { id: 'pr', label: '📦 PR / Издательства' },
    { id: 'content', label: '🎬 С контентом' },
  ];

  // Поиск
  if (S.searchQuery) {
    books = books.filter(b =>
      b.title.toLowerCase().includes(S.searchQuery) ||
      b.author.toLowerCase().includes(S.searchQuery) ||
      (b.isbn || '').includes(S.searchQuery) ||
      (b.genre || '').toLowerCase().includes(S.searchQuery) ||
      (b.publisher || '').toLowerCase().includes(S.searchQuery)
    );
  }

  // Фильтр по статусу
  if (S.bookFilter === 'pr') {
    books = books.filter(b => b.isPR);
  } else if (S.bookFilter === 'content') {
    books = books.filter(b => (b.contentItems || []).length > 0);
  } else if (S.bookFilter !== 'all') {
    books = books.filter(b => b.status === S.bookFilter);
  }

  // Сортировка: по дате добавления (новые сверху)
  books.sort((a, b) => (b.dateAdded || '').localeCompare(a.dateAdded || ''));

  container.innerHTML = `
    <div class="filter-bar no-scrollbar">
      ${filters.map(f => `
        <button class="filter-chip ${S.bookFilter === f.id ? 'active' : ''}"
                data-filter="${f.id}">${f.label}</button>
      `).join('')}
    </div>
    <div class="book-list" id="book-list">
      ${books.length === 0 ? renderEmptyBooks() : books.map(renderBookCard).join('')}
    </div>
  `;

  // Фильтры
  container.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      S.bookFilter = chip.dataset.filter;
      renderBooksTab();
    });
  });

  // Клик по карточке
  container.querySelectorAll('.book-card').forEach(card => {
    card.addEventListener('click', () => openBookDetail(card.dataset.id));
  });
}

function renderEmptyBooks() {
  return `
    <div class="empty-state">
      <div class="empty-icon">📚</div>
      <div class="empty-title">Пока нет книг</div>
      <div class="empty-text">
        Нажмите ＋ чтобы добавить книгу вручную,
        или 📷 чтобы отсканировать ISBN
      </div>
    </div>
  `;
}

function renderBookCard(book) {
  const statusLabels = {
    tbr: '📋 Хочу прочитать', reading: '📖 Читаю',
    finished: '✅ Прочитано', paused: '⏸️ Пауза', dropped: '❌ Брошено'
  };
  const statusClass = {
    tbr: 'badge-status', reading: 'badge-reading',
    finished: 'badge-finished', paused: 'badge-paused', dropped: 'badge-dropped'
  };

  const contentCount = (book.contentItems || []).length;
  const publishedCount = (book.contentItems || [])
    .filter(c => c.status === 'published').length;
  const progress = book.pageCount > 0
    ? Math.round((book.currentPage / book.pageCount) * 100) : 0;

  const coverHtml = book.coverUrl
    ? `<img class="book-cover" src="${book.coverUrl}" alt="" loading="lazy"/>`
    : `<div class="book-cover-placeholder">📕</div>`;

  return `
    <div class="book-card" data-id="${book.id}">
      ${coverHtml}
      <div class="book-info">
        <div class="book-title">${esc(book.title)}</div>
        <div class="book-author">${esc(book.author)}</div>
        <div class="book-meta">
          <span class="book-badge ${statusClass[book.status] || 'badge-status'}">
            ${statusLabels[book.status] || book.status}
          </span>
          ${book.isPR ? '<span class="book-badge badge-pr">📦 PR</span>' : ''}
          ${contentCount > 0
            ? `<span class="book-badge badge-content">🎬 ${contentCount}${publishedCount > 0 ? ` · 📤 ${publishedCount}` : ''}</span>`
            : ''}
          ${book.review?.rating > 0
            ? `<span class="book-badge badge-rating">${'⭐'.repeat(book.review.rating)}</span>`
            : ''}
        </div>
        ${book.status === 'reading' && book.pageCount > 0 ? `
          <div class="book-progress">
            <div class="book-progress-fill" style="width:${progress}%"></div>
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════
//  ФОРМА КНИГИ (добавление / редактирование)
// ═══════════════════════════════════════════════

function openBookForm(book = null) {
  S.editingBookId = book?.id || null;
  DOM.formTitle.textContent = book ? '✏️ Редактировать книгу' : '📚 Новая книга';

  const b = book || {};

  DOM.formBody.innerHTML = `
    <!-- ISBN поиск -->
    <div class="form-group">
      <label>🔍 Найти по ISBN</label>
      <div class="flex gap-8">
        <input type="text" id="bf-isbn" value="${esc(b.isbn || '')}"
               placeholder="978-5-17-098765-8" inputmode="numeric"/>
        <button id="bf-scan" class="btn-secondary" style="width:auto;flex-shrink:0">📷</button>
        <button id="bf-find" class="btn-secondary" style="width:auto;flex-shrink:0">Найти</button>
      </div>
      <div class="form-hint">Отсканируйте штрихкод или введите ISBN вручную</div>
    </div>

    <div class="divider"></div>

    <!-- Основные поля -->
    <div class="form-group">
      <label>Название *</label>
      <input type="text" id="bf-title" value="${esc(b.title || '')}"
             placeholder="Мастер и Маргарита" required/>
    </div>

    <div class="form-group">
      <label>Автор</label>
      <input type="text" id="bf-author" value="${esc(b.author || '')}"
             placeholder="Михаил Булгаков"/>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label>Жанр</label>
        <input type="text" id="bf-genre" value="${esc(b.genre || '')}"
               placeholder="Классика"/>
      </div>
      <div class="form-group">
        <label>Издательство</label>
        <input type="text" id="bf-publisher" value="${esc(b.publisher || '')}"
               placeholder="АСТ"/>
      </div>
    </div>

    <div class="form-row-3">
      <div class="form-group">
        <label>Год</label>
        <input type="text" id="bf-year" value="${esc(b.publishedDate || '')}"
               placeholder="2024"/>
      </div>
      <div class="form-group">
        <label>Страниц</label>
        <input type="number" id="bf-pages" value="${b.pageCount || ''}"
               placeholder="480" min="0"/>
      </div>
      <div class="form-group">
        <label>Возраст</label>
        <input type="text" id="bf-age" value="${esc(b.ageRating || '')}"
               placeholder="16+"/>
      </div>
    </div>

    <div class="form-group">
      <label>Описание</label>
      <textarea id="bf-desc" rows="3" placeholder="Аннотация...">${esc(b.description || '')}</textarea>
    </div>

    <div class="form-group">
      <label>Обложка (URL)</label>
      <input type="url" id="bf-cover" value="${esc(b.cover || b.coverUrl || '')}"
             placeholder="https://..."/>
    </div>

    <!-- Статус чтения -->
    <div class="form-section">
      <h3>📖 Статус чтения</h3>
      <div class="form-group">
        <label>Статус</label>
        <select id="bf-status">
          <option value="tbr" ${b.status === 'tbr' ? 'selected' : ''}>📋 Хочу прочитать</option>
          <option value="reading" ${b.status === 'reading' ? 'selected' : ''}>📖 Читаю</option>
          <option value="finished" ${b.status === 'finished' ? 'selected' : ''}>✅ Прочитано</option>
          <option value="paused" ${b.status === 'paused' ? 'selected' : ''}>⏸️ Пауза</option>
          <option value="dropped" ${b.status === 'dropped' ? 'selected' : ''}>❌ Брошено</option>
        </select>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Текущая страница</label>
          <input type="number" id="bf-page" value="${b.currentPage || 0}" min="0"/>
        </div>
        <div class="form-group">
          <label>Оценка (1–5)</label>
          <input type="number" id="bf-rating" value="${b.rating || 0}" min="0" max="5"/>
        </div>
      </div>
    </div>

    <!-- Блогерский раздел -->
    <div class="form-section">
      <h3>🎬 Для блога</h3>
      <div class="toggle-row">
        <span class="toggle-label">📦 Получена от издательства (PR)</span>
        <div class="toggle ${b.isPR ? 'active' : ''}" id="bf-pr-toggle"></div>
      </div>
      <div id="bf-pr-fields" class="${b.isPR ? '' : 'hidden'}">
        <div class="form-group">
          <label>От кого</label>
          <input type="text" id="bf-received-from" value="${esc(b.receivedFrom || '')}"
                 placeholder="Издательство ЭКСМО"/>
        </div>
        <div class="form-group">
          <label>Дата получения</label>
          <input type="date" id="bf-received-date" value="${b.receivedDate || ''}"/>
        </div>
      </div>
      <div class="form-group">
        <label>Серия</label>
        <input type="text" id="bf-series" value="${esc(b.series || '')}"
               placeholder="Гарри Поттер"/>
      </div>
      <div class="form-group">
        <label>Теги для контента (через запятую)</label>
        <input type="text" id="bf-tags" value="${esc((b.contentTags || []).join(', '))}"
               placeholder="фэнтези, young adult, новинка 2026"/>
      </div>
    </div>

    <!-- Заметки -->
    <div class="form-section">
      <h3>📝 Заметки</h3>
      <div class="form-group">
        <textarea id="bf-notes" rows="3" placeholder="Личные заметки...">${esc(b.notes || '')}</textarea>
      </div>
    </div>

    <!-- Кнопки -->
    <div class="btn-group">
      <button id="bf-save" class="btn-primary">💾 Сохранить</button>
      ${book ? '<button id="bf-delete" class="btn-danger">🗑️ Удалить</button>' : ''}
    </div>
  `;

  // События формы
  const formBody = DOM.formBody;

  // Сканер
  formBody.querySelector('#bf-scan').addEventListener('click', () => {
    closeOverlay(DOM.formOverlay);
    openScanner();
  });

  // Поиск по ISBN
  formBody.querySelector('#bf-find').addEventListener('click', () => {
    const isbn = formBody.querySelector('#bf-isbn').value.trim();
    if (isbn) handleIsbnLookup(isbn);
  });

  // PR toggle
  const prToggle = formBody.querySelector('#bf-pr-toggle');
  prToggle.addEventListener('click', () => {
    prToggle.classList.toggle('active');
    formBody.querySelector('#bf-pr-fields').classList.toggle('hidden');
  });

  // Сохранение
  formBody.querySelector('#bf-save').addEventListener('click', () => saveBookForm());

  // Удаление
  const delBtn = formBody.querySelector('#bf-delete');
  if (delBtn) {
    delBtn.addEventListener('click', async () => {
      if (confirm('Удалить эту книгу?')) {
        await delBook(S.editingBookId);
        await deleteCover(S.editingBookId);
        S.books = S.books.filter(b => b.id !== S.editingBookId);
        closeOverlay(DOM.formOverlay);
        renderTab(S.currentTab);
        showToast('🗑️ Книга удалена', 'info');
      }
    });
  }

  openOverlay(DOM.formOverlay);
}

async function saveBookForm() {
  const f = DOM.formBody;
  const title = f.querySelector('#bf-title').value.trim();
  if (!title) {
    showToast('⚠️ Введите название книги', 'error');
    return;
  }

  const now = new Date().toISOString();
  const isPR = f.querySelector('#bf-pr-toggle').classList.contains('active');

  const bookData = {
    id: S.editingBookId || `book_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title,
    author: f.querySelector('#bf-author').value.trim(),
    cover: f.querySelector('#bf-cover').value.trim(),
    description: f.querySelector('#bf-desc').value.trim(),
    genre: f.querySelector('#bf-genre').value.trim(),
    publisher: f.querySelector('#bf-publisher').value.trim(),
    publishedDate: f.querySelector('#bf-year').value.trim(),
    pageCount: parseInt(f.querySelector('#bf-pages').value) || 0,
    isbn: cleanISBN(f.querySelector('#bf-isbn').value),
    ageRating: f.querySelector('#bf-age').value.trim(),
    status: f.querySelector('#bf-status').value,
    currentPage: parseInt(f.querySelector('#bf-page').value) || 0,
    rating: parseInt(f.querySelector('#bf-rating').value) || 0,
    isPR,
    receivedFrom: isPR ? f.querySelector('#bf-received-from').value.trim() : '',
    receivedDate: isPR ? f.querySelector('#bf-received-date').value : '',
    series: f.querySelector('#bf-series').value.trim(),
    contentTags: f.querySelector('#bf-tags').value.split(',').map(t => t.trim()).filter(Boolean),
    notes: f.querySelector('#bf-notes').value.trim(),
    dateAdded: S.editingBookId
      ? (S.books.find(b => b.id === S.editingBookId)?.dateAdded || now)
      : now,
    updatedAt: now,
  };

  // Сохраняем существующие поля при редактировании
  if (S.editingBookId) {
    const existing = S.books.find(b => b.id === S.editingBookId);
    if (existing) {
      bookData.contentItems = existing.contentItems || [];
      bookData.review = existing.review || {};
      bookData.readingForContent = existing.readingForContent || {};
      bookData.source = existing.source || 'manual';
    }
  } else {
    bookData.contentItems = [];
    bookData.review = {};
    bookData.readingForContent = {};
    bookData.source = 'manual';
  }

  // Сохраняем обложку как Blob если это URL
  if (bookData.cover && bookData.cover.startsWith('http')) {
    try {
      const imgRes = await fetch(bookData.cover);
      const blob = await imgRes.blob();
      await saveCover(bookData.id, blob);
      bookData.coverUrl = URL.createObjectURL(blob);
    } catch {
      bookData.coverUrl = bookData.cover;
    }
  }

  await putBook(bookData);

  // Обновляем состояние
  const idx = S.books.findIndex(b => b.id === bookData.id);
  if (idx >= 0) S.books[idx] = bookData;
  else S.books.push(bookData);

  closeOverlay(DOM.formOverlay);
  renderTab(S.currentTab);

  if (bookData.status === 'finished' && S.settings.confetti) {
    fireConfetti();
  }

  showToast(S.editingBookId ? '✅ Книга обновлена' : '✅ Книга добавлена', 'success');
  S.editingBookId = null;
}

// ═══════════════════════════════════════════════
//  КАРТОЧКА КНИГИ (детали)
// ═══════════════════════════════════════════════

function openBookDetail(bookId) {
  const book = S.books.find(b => b.id === bookId);
  if (!book) return;

  DOM.detailTitle.textContent = '📖 ' + (book.title || 'Книга');

  const statusLabels = {
    tbr: '📋 Хочу прочитать', reading: '📖 Читаю',
    finished: '✅ Прочитано', paused: '⏸️ Пауза', dropped: '❌ Брошено'
  };

  const progress = book.pageCount > 0
    ? Math.round((book.currentPage / book.pageCount) * 100) : 0;

  const contentItems = book.contentItems || [];
  const review = book.review || {};

  DOM.detailBody.innerHTML = `
    <!-- Обложка + инфо -->
    <div class="detail-hero">
      ${book.coverUrl
        ? `<img class="detail-cover" src="${book.coverUrl}" alt=""/>`
        : `<div class="detail-cover-placeholder">📕</div>`}
      <div>
        <div class="detail-title">${esc(book.title)}</div>
        <div class="detail-author">${esc(book.author)}</div>
        <div class="book-meta">
          <span class="book-badge badge-status">${statusLabels[book.status] || book.status}</span>
          ${book.isPR ? `<span class="book-badge badge-pr">📦 ${esc(book.receivedFrom || 'PR')}</span>` : ''}
          ${book.ageRating ? `<span class="book-badge badge-status">${esc(book.ageRating)}</span>` : ''}
        </div>
      </div>
    </div>

    <!-- Метаданные -->
    <div class="detail-meta-grid">
      ${book.genre ? `<div class="detail-meta-item"><div class="detail-meta-label">Жанр</div><div class="detail-meta-value">${esc(book.genre)}</div></div>` : ''}
      ${book.publisher ? `<div class="detail-meta-item"><div class="detail-meta-label">Издательство</div><div class="detail-meta-value">${esc(book.publisher)}</div></div>` : ''}
      ${book.publishedDate ? `<div class="detail-meta-item"><div class="detail-meta-label">Год</div><div class="detail-meta-value">${esc(book.publishedDate)}</div></div>` : ''}
      ${book.pageCount ? `<div class="detail-meta-item"><div class="detail-meta-label">Страниц</div><div class="detail-meta-value">${book.pageCount}</div></div>` : ''}
      ${book.isbn ? `<div class="detail-meta-item"><div class="detail-meta-label">ISBN</div><div class="detail-meta-value">${esc(book.isbn)}</div></div>` : ''}
      ${book.series ? `<div class="detail-meta-item"><div class="detail-meta-label">Серия</div><div class="detail-meta-value">${esc(book.series)}</div></div>` : ''}
    </div>

    <!-- Прогресс чтения -->
    ${book.status === 'reading' && book.pageCount > 0 ? `
      <div class="reading-progress">
        <div class="reading-progress-bar">
          <div class="reading-progress-fill" style="width:${progress}%"></div>
        </div>
        <div class="reading-progress-text">Стр. ${book.currentPage} из ${book.pageCount} (${progress}%)</div>
      </div>
    ` : ''}

    <!-- Описание -->
    ${book.description ? `
      <div class="detail-section">
        <h3>📝 Описание</h3>
        <div class="detail-description">${esc(book.description)}</div>
      </div>
    ` : ''}

    <!-- Контент по книге -->
    <div class="detail-section">
      <h3>🎬 Контент по книге (${contentItems.length})</h3>
      ${contentItems.length === 0
        ? '<div class="text-muted text-small">Пока нет контента</div>'
        : contentItems.map(c => `
          <div class="content-list-item" data-content-id="${c.id}">
            <span class="content-list-icon">${CONTENT_ICONS[c.type] || '🎬'}</span>
            <div class="content-list-info">
              <div class="content-list-title">${esc(c.title || CONTENT_LABELS[c.type] || c.type)}</div>
              <div class="content-list-sub">${PLATFORM_LABELS[c.platform] || c.platform}${c.publishedDate ? ' · ' + c.publishedDate : ''}</div>
            </div>
            <span class="content-list-status status-${c.status}">${CONTENT_STATUS_LABELS[c.status] || c.status}</span>
          </div>
        `).join('')}
      <button id="detail-add-content" class="btn-secondary mt-8" style="width:100%">
        ＋ Добавить контент
      </button>
    </div>

    <!-- Отзыв -->
    <div class="detail-section">
      <h3>✍️ Отзыв</h3>
      ${review.text || review.rating > 0 ? `
        <div class="review-stars">${'⭐'.repeat(review.rating || 0)}${'☆'.repeat(5 - (review.rating || 0))}</div>
        ${review.pros ? `<div class="review-pros">👍 ${esc(review.pros)}</div>` : ''}
        ${review.cons ? `<div class="review-cons">👎 ${esc(review.cons)}</div>` : ''}
        ${review.text ? `<div class="detail-description mt-8">${esc(review.text)}</div>` : ''}
        ${(review.quotes || []).length > 0 ? `
          <div class="mt-8">
            ${review.quotes.map(q => `
              <div class="quote-item">
                <span>«${esc(q.text)}»</span>
                ${q.page ? `<span class="quote-page">с. ${q.page}</span>` : ''}
                ${q.used ? '<span class="quote-used">✅</span>' : ''}
              </div>
            `).join('')}
          </div>
        ` : ''}
        ${review.recommendation ? `<div class="mt-8 text-small">🎯 Рекомендация: ${esc(review.recommendation)}</div>` : ''}
        ${review.targetAudience ? `<div class="text-small text-muted">Для: ${esc(review.targetAudience)}</div>` : ''}
      ` : '<div class="text-muted text-small">Отзыв ещё не написан</div>'}
      <button id="detail-edit-review" class="btn-secondary mt-8" style="width:100%">
        ${review.text || review.rating > 0 ? '✏️ Редактировать отзыв' : '✍️ Написать отзыв'}
      </button>
    </div>

    <!-- Заметки -->
    ${book.notes ? `
      <div class="detail-section">
        <h3>📝 Заметки</h3>
        <div class="detail-description">${esc(book.notes)}</div>
      </div>
    ` : ''}

    <!-- Действия -->
    <div class="btn-group mt-16">
      <button id="detail-edit" class="btn-secondary">✏️ Редактировать</button>
      <button id="detail-delete" class="btn-danger">🗑️ Удалить</button>
    </div>
  `;

  // События
  DOM.detailBody.querySelector('#detail-edit').addEventListener('click', () => {
    closeOverlay(DOM.detailOverlay);
    openBookForm(book);
  });

  DOM.detailBody.querySelector('#detail-delete').addEventListener('click', async () => {
    if (confirm('Удалить эту книгу?')) {
      await delBook(book.id);
      await deleteCover(book.id);
      S.books = S.books.filter(b => b.id !== book.id);
      closeOverlay(DOM.detailOverlay);
      renderTab(S.currentTab);
      showToast('🗑️ Книга удалена', 'info');
    }
  });

  DOM.detailBody.querySelector('#detail-add-content').addEventListener('click', () => {
    closeOverlay(DOM.detailOverlay);
    openContentForm(null, book.id);
  });

  DOM.detailBody.querySelector('#detail-edit-review').addEventListener('click', () => {
    closeOverlay(DOM.detailOverlay);
    openReviewForm(book.id);
  });

  openOverlay(DOM.detailOverlay);
}

// ═══════════════════════════════════════════════
//  ISBN ПОИСК
// ═══════════════════════════════════════════════

async function handleIsbnLookup(isbnInput) {
  const isbn = cleanISBN(isbnInput);

  if (!validateISBN(isbn)) {
    showToast('❌ Неверный формат ISBN', 'error');
    return;
  }

  showLoading('🔍 Ищу книгу...');

  const isRu = isRussianISBN(isbn);
  if (isRu) {
    updateLoading('🇷🇺 Российский ISBN — ищу в базах...');
  }

  // Ключи ЛитРес из настроек
  const litresKeys = S.settings.lrAppId && S.settings.lrSecret
    ? { appId: S.settings.lrAppId, secretKey: S.settings.lrSecret }
    : null;

  const book = await fetchBookByIsbn(isbn, litresKeys);

  hideLoading();
  closeScanner();

  if (book) {
    const sourceLabels = {
      google: '📗 Google Books',
      openlibrary: '📘 Open Library',
      litres: '📕 ЛитРес',
      cover: '🖼️ Только обложка'
    };
    showToast(`Найдено: ${sourceLabels[book.source] || book.source}`, 'success');

    // Предзаполняем форму
    openBookForm({
      ...book,
      isbn: book.isbn || isbn,
      status: 'tbr',
    });
  } else {
    showToast('📖 Не найдено — заполните вручную', 'info');
    openBookForm({ isbn, title: '', author: '', status: 'tbr' });
  }
}

// ═══════════════════════════════════════════════
//  СКАНЕР
// ═══════════════════════════════════════════════

async function openScanner() {
  DOM.scannerOverlay.classList.remove('hidden');
  DOM.scannerManualInput.value = '';

  const result = await startScanner(DOM.scannerVideo, (status, msg) => {
    DOM.scannerStatus.textContent = msg;
    DOM.scannerStatus.className = 'scanner-status' + (status === 'scanning' ? ' scanning' : '');
  });

  if (result) {
    handleIsbnLookup(result);
  }
}

function closeScanner() {
  stopScanner();
  DOM.scannerOverlay.classList.add('hidden');
}

// ═══════════════════════════════════════════════
//  КОНТЕНТ (делегирование в content.js)
// ═══════════════════════════════════════════════

async function handleDeleteContent(itemId, bookId) {
  if (!confirm('Удалить этот контент?')) return;
  await deleteContentItem(bookId, itemId);
  S.books = await loadBooks();
  renderTab(S.currentTab);
  showToast('🗑️ Контент удалён', 'info');
}

async function handleContentStatus(itemId, bookId, status) {
  await updateContentStatus(bookId, itemId, status);
  S.books = await loadBooks();
  renderTab(S.currentTab);

  if (status === 'published' && S.settings.confetti) {
    fireConfetti();
    showToast('📤 Контент опубликован! 🎉', 'success');
  }
}

// ═══════════════════════════════════════════════
//  ОТЗЫВЫ (делегирование в review.js)
// ═══════════════════════════════════════════════

async function handleDeleteReview(bookId) {
  if (!confirm('Удалить отзыв?')) return;
  await deleteReview(bookId);
  S.books = await loadBooks();
  renderTab(S.currentTab);
  showToast('🗑️ Отзыв удалён', 'info');
}

// ═══════════════════════════════════════════════
//  КАЛЕНДАРЬ: день
// ═══════════════════════════════════════════════

function showDayContent(dateStr) {
  const dayContent = [];
  for (const book of S.books) {
    for (const c of (book.contentItems || [])) {
      if (c.plannedDate === dateStr || c.publishedDate === dateStr) {
        dayContent.push({ ...c, bookTitle: book.title, bookId: book.id });
      }
    }
  }

  if (dayContent.length === 0) {
    showToast(`📅 ${dateStr}: нет запланированного контента`, 'info');
    return;
  }

  // Показываем список в тосте или алерте
  const list = dayContent.map(c =>
    `${CONTENT_ICONS[c.type] || '🎬'} ${c.title || CONTENT_LABELS[c.type]} — ${c.bookTitle}`
  ).join('\n');

  alert(`📅 ${dateStr}\n\n${list}`);
}

// ═══════════════════════════════════════════════
//  НАСТРОЙКИ
// ═══════════════════════════════════════════════

function renderSettingsTab() {
  const s = S.settings;
  DOM.mainContent.innerHTML = `
    <!-- Режим блогера -->
    <div class="settings-section">
      <h3>🎬 Режим бук-блогера</h3>
      <div class="toggle-row">
        <span class="toggle-label">Включить блогерские функции</span>
        <div class="toggle ${s.bloggerMode ? 'active' : ''}" id="set-blogger"></div>
      </div>
      <div class="hint">Контент-план, отзывы, календарь съёмок, PR-трекинг</div>
    </div>

    <!-- ЛитРес API -->
    <div class="settings-section">
      <h3>📚 ЛитРес API <span class="badge">опционально</span></h3>
      <p class="hint">
        Улучшает поиск российских книг (включая мелкие издательства).<br/>
        <strong>Как получить ключи:</strong><br/>
        1. Зарегистрируйтесь на
        <a href="https://www.litres.ru/pages/reader_partner/" target="_blank">litres.ru/pages/reader_partner</a><br/>
        2. Напишите на <a href="mailto:partners@litres.ru">partners@litres.ru</a>
        с запросом App ID и Secret Key<br/>
        3. Вставьте ключи ниже<br/><br/>
        ⚠️ Сейчас используются <strong>тестовые ключи</strong>.
        Замените на свои после получения.
      </p>

      <details>
        <summary>Catalit API (поиск по ISBN и названию)</summary>
        <div class="form-group mt-8">
          <label>App ID</label>
          <input type="text" id="set-lr-appid" value="${esc(s.lrAppId || '')}"
                 placeholder="Ваш App ID от ЛитРес"/>
        </div>
        <div class="form-group">
          <label>Secret Key</label>
          <input type="password" id="set-lr-secret" value="${esc(s.lrSecret || '')}"
                 placeholder="Ваш Secret Key"/>
        </div>
      </details>

      <details>
        <summary>Partner API (расширенные метаданные)</summary>
        <div class="form-group mt-8">
          <label>Partner ID</label>
          <input type="text" id="set-lr-pid" value="${esc(s.lrPartnerId || '')}"
                 placeholder="Тестовый: 16"/>
        </div>
        <div class="form-group">
          <label>Secret Key</label>
          <input type="password" id="set-lr-psecret" value="${esc(s.lrPartnerSecret || '')}"
                 placeholder="Тестовый ключ из документации"/>
        </div>
      </details>

      <button id="set-lr-test" class="btn-secondary mt-8">🔍 Проверить подключение</button>
      <span id="set-lr-status" class="status-text"></span>
    </div>

    <!-- Площадка по умолчанию -->
    <div class="settings-section">
      <h3>📱 Площадки</h3>
      <div class="form-group">
        <label>Площадка по умолчанию</label>
        <select id="set-platform">
          <option value="youtube" ${s.defaultPlatform === 'youtube' ? 'selected' : ''}>▶️ YouTube</option>
          <option value="tiktok" ${s.defaultPlatform === 'tiktok' ? 'selected' : ''}>🎵 TikTok</option>
          <option value="telegram" ${s.defaultPlatform === 'telegram' ? 'selected' : ''}>✈️ Telegram</option>
          <option value="vk" ${s.defaultPlatform === 'vk' ? 'selected' : ''}>🔵 VK</option>
          <option value="dzen" ${s.defaultPlatform === 'dzen' ? 'selected' : ''}>📰 Дзен</option>
          <option value="instagram" ${s.defaultPlatform === 'instagram' ? 'selected' : ''}>📸 Instagram</option>
        </select>
      </div>
    </div>

    <!-- Уведомления -->
    <div class="settings-section">
      <h3>🔔 Эффекты</h3>
      <div class="toggle-row">
        <span class="toggle-label">🎊 Конфетти при завершении</span>
        <div class="toggle ${s.confetti ? 'active' : ''}" id="set-confetti"></div>
      </div>
      <div class="toggle-row">
        <span class="toggle-label">🔊 Звуки</span>
        <div class="toggle ${s.sound ? 'active' : ''}" id="set-sound"></div>
      </div>
    </div>

    <!-- Данные -->
    <div class="settings-section">
      <h3>💾 Данные</h3>
      <div class="btn-group">
        <button id="set-export" class="btn-secondary">📤 Экспорт JSON</button>
        <button id="set-import" class="btn-secondary">📥 Импорт JSON</button>
      </div>
      <input type="file" id="set-import-file" accept=".json" class="hidden"/>
      <div class="btn-group">
        <button id="set-clear" class="btn-danger">🗑️ Очистить все данные</button>
      </div>
    </div>

    <!-- О приложении -->
    <div class="settings-section">
      <h3>ℹ️ О приложении</h3>
      <p class="hint">
        Book Tracker Pro v3.2.0<br/>
        Трекер книг для бук-блогера<br/>
        Работает полностью оффлайн<br/>
        Данные хранятся локально на устройстве
      </p>
    </div>
  `;

  // События настроек
  const mc = DOM.mainContent;

  // Blogger mode
  mc.querySelector('#set-blogger').addEventListener('click', function() {
    this.classList.toggle('active');
    S.settings.bloggerMode = this.classList.contains('active');
    saveAppSettings();
  });

  // Confetti
  mc.querySelector('#set-confetti').addEventListener('click', function() {
    this.classList.toggle('active');
    S.settings.confetti = this.classList.contains('active');
    saveAppSettings();
  });

  // Sound
  mc.querySelector('#set-sound').addEventListener('click', function() {
    this.classList.toggle('active');
    S.settings.sound = this.classList.contains('active');
    saveAppSettings();
  });

  // Platform
  mc.querySelector('#set-platform').addEventListener('change', function() {
    S.settings.defaultPlatform = this.value;
    saveAppSettings();
  });

  // LitRes test
  mc.querySelector('#set-lr-test').addEventListener('click', async () => {
    const appId = mc.querySelector('#set-lr-appid').value.trim();
    const secret = mc.querySelector('#set-lr-secret').value.trim();
    const status = mc.querySelector('#set-lr-status');

    if (!appId || !secret) {
      status.textContent = '⚠️ Заполните App ID и Secret Key';
      return;
    }

    status.textContent = '⏳ Проверяю...';
    try {
      const { searchBooks: sb } = await import('./isbn.js');
      const results = await sb('Пушкин', { appId, secretKey: secret });
      status.textContent = results.length > 0
        ? `✅ Найдено: «${results[0].title}»`
        : '⚠️ Подключено, но результатов нет';
    } catch {
      status.textContent = '❌ Ошибка подключения';
    }
  });

  // Export
  mc.querySelector('#set-export').addEventListener('click', () => {
    const data = JSON.stringify({ books: S.books, settings: S.settings }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `booktracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('📤 Данные экспортированы', 'success');
  });

  // Import
  const importFile = mc.querySelector('#set-import-file');
  mc.querySelector('#set-import').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (data.books) {
        for (const book of data.books) await putBook(book);
        S.books = await loadBooks();
      }
      if (data.settings) Object.assign(S.settings, data.settings);
      await saveAppSettings();
      renderTab(S.currentTab);
      showToast('📥 Данные импортированы', 'success');
    } catch {
      showToast('❌ Ошибка импорта', 'error');
    }
  });

  // Clear
  mc.querySelector('#set-clear').addEventListener('click', async () => {
    if (confirm('Удалить ВСЕ данные? Это необратимо!')) {
      const db = await openDB();
      const tx = db.transaction(['books', 'covers', 'settings'], 'readwrite');
      tx.objectStore('books').clear();
      tx.objectStore('covers').clear();
      tx.objectStore('settings').clear();
      S.books = [];
      renderTab('books');
      showToast('🗑️ Все данные удалены', 'info');
    }
  });
}

async function saveAppSettings() {
  // Сохраняем ключи ЛитРес из полей (если открыты)
  const appId = $('#set-lr-appid');
  const secret = $('#set-lr-secret');
  const pid = $('#set-lr-pid');
  const psecret = $('#set-lr-psecret');

  if (appId) S.settings.lrAppId = appId.value.trim();
  if (secret) S.settings.lrSecret = secret.value.trim();
  if (pid) S.settings.lrPartnerId = pid.value.trim();
  if (psecret) S.settings.lrPartnerSecret = psecret.value.trim();

  await saveSettings(S.settings);
}

// ═══════════════════════════════════════════════
//  КОНСТАНТЫ (иконки, лейблы)
// ═══════════════════════════════════════════════

export const CONTENT_ICONS = {
  unboxing: '📦', read_with_me: '📖', review: '💬',
  lipsync: '🎵', top: '🏆', quote: '✨',
  comparison: '⚖️', haul: '🛒'
};

export const CONTENT_LABELS = {
  unboxing: 'Распаковка', read_with_me: 'Начни читать со мной',
  review: 'Отзыв / Мнение', lipsync: 'Липсинг',
  top: 'Подборка / Топ', quote: 'Цитата',
  comparison: 'Сравнение', haul: 'Книжный haul'
};

export const CONTENT_STATUS_LABELS = {
  idea: '💡 Идея', planned: '📅 Запланировано',
  filming: '🎥 Снимаю', editing: '✂️ Монтаж',
  published: '📤 Опубликовано'
};

export const PLATFORM_LABELS = {
  youtube: '▶️ YouTube', tiktok: '🎵 TikTok',
  telegram: '✈️ Telegram', vk: '🔵 VK',
  dzen: '📰 Дзен', instagram: '📸 Instagram'
};

// ═══════════════════════════════════════════════
//  УТИЛИТЫ UI
// ═══════════════════════════════════════════════

function toggleDrawer(open) {
  DOM.drawer.classList.toggle('open', open);
  DOM.backdrop.classList.toggle('active', open);
}

function openOverlay(el) {
  el.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeOverlay(el) {
  el.classList.add('hidden');
  document.body.style.overflow = '';
}

let toastTimer = null;
export function showToast(msg, type = 'info') {
  DOM.toast.textContent = msg;
  DOM.toast.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    DOM.toast.classList.remove('show');
  }, 3000);
}

let loadingEl = null;
function showLoading(text = 'Загрузка...') {
  hideLoading();
  loadingEl = document.createElement('div');
  loadingEl.className = 'loading-overlay';
  loadingEl.innerHTML = `<div class="spinner"></div><div class="loading-text">${text}</div>`;
  document.body.appendChild(loadingEl);
}

function updateLoading(text) {
  if (loadingEl) {
    loadingEl.querySelector('.loading-text').textContent = text;
  }
}

function hideLoading() {
  if (loadingEl) {
    loadingEl.remove();
    loadingEl = null;
  }
}

export function esc(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ═══════════════════════════════════════════════
//  КОНФЕТТИ
// ═══════════════════════════════════════════════

function fireConfetti() {
  if (!S.settings.confetti) return;
  const canvas = DOM.confettiCanvas;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const particles = [];
  const colors = ['#6c8cff', '#4caf82', '#e0a030', '#e05555', '#a78bfa', '#f472b6', '#22d3ee'];

  for (let i = 0; i < 120; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * 200,
      w: 6 + Math.random() * 6,
      h: 4 + Math.random() * 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      vx: (Math.random() - 0.5) * 4,
      vy: 2 + Math.random() * 4,
      rot: Math.random() * 360,
      vr: (Math.random() - 0.5) * 10,
      life: 1,
    });
  }

  let frame = 0;
  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;

    for (const p of particles) {
      if (p.life <= 0) continue;
      alive = true;

      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.05;
      p.rot += p.vr;
      p.life -= 0.005;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rot * Math.PI) / 180);
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }

    frame++;
    if (alive && frame < 300) {
      requestAnimationFrame(animate);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  animate();
}

// ═══════════════════════════════════════════════
//  PWA INSTALL
// ═══════════════════════════════════════════════

function setupInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    S.deferredPrompt = e;
    DOM.installBanner.classList.remove('hidden');
  });

  window.addEventListener('appinstalled', () => {
    DOM.installBanner.classList.add('hidden');
    S.deferredPrompt = null;
    showToast('✅ Приложение установлено!', 'success');
  });
}

// ═══════════════════════════════════════════════
//  ЗАПУСК
// ═══════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', init);