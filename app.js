// ─────────────────────────────────────────────
// 📦 BookTrackerPro — app.js
// 🔖 v3.3.0 | 2026-07-25
// 📝 Точка входа: навигация, рендеринг, события
//
//    Новое в 3.3.0:
//      — 7 статусов + dropdown по клику
//      — Модалка оценки после «Прочитано»/«Брошено»
//      — Поиск в интернете при добавлении
//      — Кликабельные теги, серии, подборки, челленджи
//      — Цена с валютой, просмотр обложки, цитаты по фото
//      — Совместное чтение, время чтения
//
// ⚠️ ТЕСТОВЫЕ КЛЮЧИ ЛИТРЕС (замените в Настройках):
//    Partner: partner_id=16, secret=93w4jfhs8imksGo-oa3s85d6Akmkkbnsi9
// ─────────────────────────────────────────────

import {
  openDB, loadBooks, putBook, delBook, loadSettings, saveSettings,
  saveCover, deleteCover, changeBookStatus,
  BOOK_STATUSES, CURRENCIES,
  loadCollections, loadChallenges, loadTags, putTag, delTag,
  exportAll, importAll, getDBSize
} from './db.js';
import {
  validateISBN, cleanISBN, fetchBookByIsbn, searchBooks,
  isRussianISBN, formatISBN
} from './isbn.js';
import { startScanner, stopScanner } from './scanner.js';
import {
  renderContentTab, openContentForm, deleteContentItem, updateContentStatus
} from './content.js';
import { renderReviewsTab, openReviewForm, deleteReview } from './review.js';
import { renderStatsTab, renderCalendarTab } from './stats.js';
import {
  renderCollectionsList, renderCollectionDetail, openCollectionForm,
  openBookCollectionsPicker, openAddBooksToCollection,
  createCollection, updateCollection, deleteCollection,
  removeBookFromCol, renderDrawerFilters
} from './collections.js';
import {
  renderChallengesList, renderChallengeDetail, openChallengeForm,
  openAddBooksToChallenge, createChallenge, updateChallenge,
  deleteChallengeById, addChallengeNote, removeChallengeNote
} from './challenges.js';
import {
  getSeriesList, renderSeriesList, renderSeriesDetail,
  attachSeriesAutocomplete, getSeriesTotal
} from './series.js';
import { captureQuoteByPhoto, checkOcrSupport } from './ocr.js';
import { registerSW, setupOnlineIndicator } from './sw-register.js';

// ═══════════════════════════════════════════════
//  СОСТОЯНИЕ
// ═══════════════════════════════════════════════

const S = {
  books: [],
  collections: [],
  challenges: [],
  tags: [],
  settings: {
    // ЛитРес (тестовые — замените в Настройках)
    lrAppId: '', lrSecret: '',
    lrPartnerId: '16',
    lrPartnerSecret: '93w4jfhs8imksGo-oa3s85d6Akmkkbnsi9',
    // Приложение
    confetti: true, sound: true,
    defaultPlatform: 'youtube',
    bloggerMode: true,
    // Цена
    defaultCurrency: 'RUB',
    showPriceInCards: true,
    showPriceInDetail: true,
    showPriceInStats: true,
    exchangeRates: { USD: 90, EUR: 98, KZT: 0.18, UAH: 2.2, GBP: 115 },
    ratesUpdated: '',
  },
  currentTab: 'books',
  bookFilter: 'all',
  searchQuery: '',
  editingBookId: null,
  // Активный фильтр: { type, value }
  activeFilter: null,
  // Открытая серия/подборка
  openSeries: null,
  openCollection: null,
  openChallenge: null,
  deferredPrompt: null,
};

// ═══════════════════════════════════════════════
//  DOM
// ═══════════════════════════════════════════════

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const DOM = {};

function cacheDom() {
  ['backdrop','drawer','drawer-close','menu-btn','page-title','main-content',
   'search-toggle','search-bar','search-input','search-close','add-btn','scan-btn',
   'form-overlay','form-title','form-close','form-body',
   'detail-overlay','detail-title','detail-close','detail-body',
   'scanner-overlay','scanner-video','scanner-status','scanner-close',
   'scanner-manual-input','scanner-manual-btn',
   'content-overlay','content-form-title','content-form-close','content-form-body',
   'review-overlay','review-form-title','review-form-close','review-form-body',
   'cover-overlay','cover-close','cover-viewer-img','cover-viewer-title',
   'cover-photo-btn','cover-photo-input',
   'toast-el','confetti-canvas','update-banner','install-banner',
   'drawer-version','drawer-offline','active-filters',
   'drawer-collections','drawer-series','drawer-filters','drawer-add-collection',
   'nav-count-books','nav-count-content','nav-count-reviews','nav-count-challenges'
  ].forEach(id => { DOM[camel(id)] = document.getElementById(id); });
}
function camel(s) { return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }

// ═══════════════════════════════════════════════
//  ИНИЦИАЛИЗАЦИЯ
// ═══════════════════════════════════════════════

async function init() {
  cacheDom();
  bindEvents();

  await openDB();
  S.books = await loadBooks();
  S.collections = await loadCollections();
  S.challenges = await loadChallenges();
  S.tags = await loadTags();

  const saved = await loadSettings();
  if (saved) Object.assign(S.settings, saved);

  // Версия
  try {
    const v = await (await fetch('version.json')).json();
    DOM.drawerVersion.textContent = `v${v.version}`;
  } catch { /* offline */ }

  registerSW();
  setupOnlineIndicator(showToast);
  setupInstallPrompt();
  updateOfflineIndicator();

  renderDrawer();
  renderTab('books');

  // Обновляем данные при изменениях из модулей
  document.addEventListener('data-changed', refreshData);
}

async function refreshData() {
  S.books = await loadBooks();
  S.collections = await loadCollections();
  S.challenges = await loadChallenges();
  S.tags = await loadTags();
  renderDrawer();
  renderTab(S.currentTab);
}

function updateOfflineIndicator() {
  DOM.drawerOffline.classList.toggle('hidden', navigator.onLine);
  window.addEventListener('offline', () => DOM.drawerOffline.classList.remove('hidden'));
  window.addEventListener('online', () => DOM.drawerOffline.classList.add('hidden'));
}

// ═══════════════════════════════════════════════
//  СОБЫТИЯ
// ═══════════════════════════════════════════════

function bindEvents() {
  DOM.menuBtn.addEventListener('click', () => toggleDrawer(true));
  DOM.backdrop.addEventListener('click', () => toggleDrawer(false));
  DOM.drawerClose.addEventListener('click', () => toggleDrawer(false));

  $$('.nav-item[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      S.activeFilter = null;
      S.openSeries = null; S.openCollection = null; S.openChallenge = null;
      renderTab(btn.dataset.tab);
      toggleDrawer(false);
    });
  });

  DOM.drawerAddCollection.addEventListener('click', () => {
    toggleDrawer(false);
    openCollectionForm(null, async (data) => {
      await createCollection(data);
      await refreshData();
      showToast('✅ Подборка создана', 'success');
    });
  });

  // Поиск
  DOM.searchToggle.addEventListener('click', () => {
    DOM.searchBar.classList.toggle('hidden');
    if (!DOM.searchBar.classList.contains('hidden')) DOM.searchInput.focus();
  });
  DOM.searchClose.addEventListener('click', () => {
    DOM.searchBar.classList.add('hidden');
    DOM.searchInput.value = ''; S.searchQuery = '';
    renderTab(S.currentTab);
  });
  DOM.searchInput.addEventListener('input', debounce(() => {
    S.searchQuery = DOM.searchInput.value.trim().toLowerCase();
    renderTab(S.currentTab);
  }, 300));

  DOM.addBtn.addEventListener('click', () => openBookForm());
  DOM.scanBtn.addEventListener('click', () => openScanner());

  // Закрытие оверлеев
  DOM.formClose.addEventListener('click', () => closeOverlay(DOM.formOverlay));
  DOM.detailClose.addEventListener('click', () => closeOverlay(DOM.detailOverlay));
  DOM.scannerClose.addEventListener('click', () => closeScanner());
  DOM.contentFormClose.addEventListener('click', () => closeOverlay(DOM.contentOverlay));
  DOM.reviewFormClose.addEventListener('click', () => closeOverlay(DOM.reviewOverlay));
  DOM.coverClose.addEventListener('click', () => closeOverlay(DOM.coverOverlay));

  [DOM.formOverlay, DOM.detailOverlay, DOM.scannerOverlay,
   DOM.contentOverlay, DOM.reviewOverlay].forEach(ov => {
    ov.addEventListener('click', (e) => {
      if (e.target === ov) (ov === DOM.scannerOverlay ? closeScanner() : closeOverlay(ov));
    });
  });
  DOM.coverOverlay.addEventListener('click', (e) => {
    if (e.target === DOM.coverOverlay) closeOverlay(DOM.coverOverlay);
  });

  // Сканер: ручной ввод
  DOM.scannerManualBtn.addEventListener('click', () => {
    const v = DOM.scannerManualInput.value.trim();
    if (v) handleIsbnLookup(v);
  });
  DOM.scannerManualInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const v = DOM.scannerManualInput.value.trim(); if (v) handleIsbnLookup(v); }
  });

  // Обложка: замена фото
  DOM.coverPhotoBtn.addEventListener('click', () => DOM.coverPhotoInput.click());
  DOM.coverPhotoInput.addEventListener('change', handleCoverPhotoChange);

  // Обновление / установка PWA
  $('#update-apply')?.addEventListener('click', () => {
    navigator.serviceWorker?.getRegistration().then(r => r?.waiting?.postMessage('SKIP_WAITING'));
    DOM.updateBanner.classList.add('hidden');
  });
  $('#update-dismiss')?.addEventListener('click', () => DOM.updateBanner.classList.add('hidden'));
  $('#install-apply')?.addEventListener('click', () => {
    if (S.deferredPrompt) { S.deferredPrompt.prompt(); S.deferredPrompt = null; DOM.installBanner.classList.add('hidden'); }
  });
  $('#install-dismiss')?.addEventListener('click', () => DOM.installBanner.classList.add('hidden'));

  // Escape
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!DOM.scannerOverlay.classList.contains('hidden')) closeScanner();
    else if (!DOM.coverOverlay.classList.contains('hidden')) closeOverlay(DOM.coverOverlay);
    else if (!DOM.formOverlay.classList.contains('hidden')) closeOverlay(DOM.formOverlay);
    else if (!DOM.detailOverlay.classList.contains('hidden')) closeOverlay(DOM.detailOverlay);
    else if (!DOM.contentOverlay.classList.contains('hidden')) closeOverlay(DOM.contentOverlay);
    else if (!DOM.reviewOverlay.classList.contains('hidden')) closeOverlay(DOM.reviewOverlay);
    else if (DOM.drawer.classList.contains('open')) toggleDrawer(false);
    closeStatusDropdown();
  });

  // Закрытие dropdown статуса по клику вне
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.status-dropdown') && !e.target.closest('.status-btn')) {
      closeStatusDropdown();
    }
  });
}

// ═══════════════════════════════════════════════
//  НАВИГАЦИЯ / ТАБЫ
// ═══════════════════════════════════════════════

const TAB_TITLES = {
  books: '📚 Мои книги', content: '🎬 Контент-план', reviews: '✍️ Отзывы',
  calendar: '📅 Календарь', challenges: '🏆 Челленджи', stats: '📊 Статистика',
  settings: '⚙️ Настройки', series: '📚 Серии', collections: '📂 Подборки',
};

function renderTab(tab) {
  S.currentTab = tab;
  DOM.pageTitle.textContent = TAB_TITLES[tab] || tab;

  $$('.nav-item[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  renderActiveFilters();

  const mc = DOM.mainContent;
  switch (tab) {
    case 'books': renderBooksTab(); break;
    case 'content': renderContentTab(mc, S.books, S.settings, {
      onEdit: (item, bookId) => openContentForm(item, bookId),
      onDelete: handleDeleteContent,
      onStatusChange: handleContentStatus,
      onAdd: () => openContentForm(null, null),
    }); break;
    case 'reviews': renderReviewsTab(mc, S.books, {
      onEdit: openReviewForm, onDelete: handleDeleteReview, onOpenBook: openBookDetail,
    }); break;
    case 'calendar': renderCalendarTab(mc, S.books, {
      onDayClick: showDayContent, onAdd: () => openContentForm(null, null),
    }); break;
    case 'challenges': renderChallenges(); break;
    case 'stats':
      window._challengesCache = S.challenges;   // ✅ ИСПРАВЛЕНО: внутри case, до рендера
      renderStatsTab(mc, S.books, S.settings);
      break;
    case 'settings': renderSettingsTab(); break;
    case 'series': renderSeriesScreen(); break;
    case 'collections': renderCollectionsScreen(); break;
  }
}

// ═══════════════════════════════════════════════
//  DRAWER (динамический)
// ═══════════════════════════════════════════════

function renderDrawer() {
  // Счётчики
  DOM.navCountBooks.textContent = S.books.length || '';
  DOM.navCountContent.textContent = S.books.reduce((s, b) => s + (b.contentItems || []).length, 0) || '';
  DOM.navCountReviews.textContent = S.books.filter(b => b.review?.text || b.review?.rating > 0).length || '';
  DOM.navCountChallenges.textContent = S.challenges.filter(c => c.status === 'active').length || '';

  // Подборки
  DOM.drawerCollections.innerHTML = S.collections.map(c => `
    <button class="nav-item sub" data-collection="${c.id}">
      <span class="nav-icon">${c.emoji}</span> ${esc(c.name)}
      <span class="nav-count">${c.bookIds.length}</span>
    </button>
  `).join('');

  DOM.drawerCollections.querySelectorAll('[data-collection]').forEach(btn => {
    btn.addEventListener('click', () => {
      S.openCollection = btn.dataset.collection;
      S.currentTab = 'collections';
      renderTab('collections');
      toggleDrawer(false);
    });
  });

  // Серии
  const series = getSeriesList(S.books);
  DOM.drawerSeries.innerHTML = series.length === 0
    ? '<div style="padding:4px 14px 8px;font-size:.78rem;color:var(--text-muted)">Нет серий</div>'
    : series.map(s => `
      <button class="nav-item sub" data-series="${esc(s.name)}">
        <span class="nav-icon">${s.emoji}</span> <span class="truncate" style="flex:1">${esc(s.name)}</span>
        <span class="nav-count">${s.read}/${s.effectiveTotal}</span>
      </button>
    `).join('');

  DOM.drawerSeries.querySelectorAll('[data-series]').forEach(btn => {
    btn.addEventListener('click', () => {
      S.openSeries = btn.dataset.series;
      S.currentTab = 'series';
      renderTab('series');
      toggleDrawer(false);
    });
  });

  // Системные фильтры
  DOM.drawerFilters.innerHTML = renderDrawerFilters(S.books);
  DOM.drawerFilters.querySelectorAll('.drawer-filter-toggle').forEach(t => {
    t.addEventListener('click', () => {
      t.classList.toggle('open');
      const items = DOM.drawerFilters.querySelector(`[data-fitems="${t.dataset.ftoggle}"]`);
      items.classList.toggle('hidden');
    });
  });
  DOM.drawerFilters.querySelectorAll('.drawer-filter-item').forEach(item => {
    item.addEventListener('click', () => {
      S.activeFilter = { type: item.dataset.filterType, value: item.dataset.filterValue };
      S.currentTab = 'books';
      renderTab('books');
      toggleDrawer(false);
    });
  });
}

// ═══════════════════════════════════════════════
//  АКТИВНЫЕ ФИЛЬТРЫ
// ═══════════════════════════════════════════════

function renderActiveFilters() {
  const el = DOM.activeFilters;
  if (!S.activeFilter) { el.classList.add('hidden'); el.innerHTML = ''; return; }

  const labels = {
    tag: '🏷️', collection: '📂', series: '📚',
    genre: '📂 Жанр', author: '👤 Автор', publisher: '🏢',
  };
  el.classList.remove('hidden');
  el.innerHTML = `
    <span class="active-filter-chip">
      ${labels[S.activeFilter.type] || ''} ${esc(S.activeFilter.value)}
      <button id="clear-filter">✕</button>
    </span>
  `;
  el.querySelector('#clear-filter').addEventListener('click', () => {
    S.activeFilter = null;
    renderTab(S.currentTab);
  });
}

// ═══════════════════════════════════════════════
//  ВКЛАДКА: КНИГИ
// ═══════════════════════════════════════════════

function renderBooksTab() {
  const mc = DOM.mainContent;
  let books = [...S.books];

  const filters = [
    { id: 'all', label: 'Все' },
    { id: 'wishlist', label: '🌟 Wishlist' },
    { id: 'added', label: '📦 Добавлено' },
    { id: 'reading', label: '📖 Читаю' },
    { id: 'finished', label: '✅ Прочитано' },
    { id: 'paused', label: '⏸️ Пауза' },
    { id: 'dropped', label: '❌ Брошено' },
    { id: 'pr', label: '📦 PR' },
  ];

  // Поиск
  if (S.searchQuery) {
    books = books.filter(b =>
      b.title.toLowerCase().includes(S.searchQuery) ||
      b.author.toLowerCase().includes(S.searchQuery) ||
      (b.isbn || '').includes(S.searchQuery) ||
      (b.genre || '').toLowerCase().includes(S.searchQuery) ||
      (b.publisher || '').toLowerCase().includes(S.searchQuery) ||
      (b.tags || []).some(t => t.toLowerCase().includes(S.searchQuery))
    );
  }

  // Активный фильтр
  if (S.activeFilter) {
    const { type, value } = S.activeFilter;
    if (type === 'tag') books = books.filter(b => (b.tags || []).includes(value));
    else if (type === 'genre') books = books.filter(b => b.genre === value);
    else if (type === 'author') books = books.filter(b => b.author === value);
    else if (type === 'publisher') books = books.filter(b => b.publisher === value);
    else if (type === 'series') books = books.filter(b => b.series === value);
    else if (type === 'collection') {
      const col = S.collections.find(c => c.id === value);
      books = col ? books.filter(b => col.bookIds.includes(b.id)) : [];
    }
  }
  // Фильтр по статусу
  else if (S.bookFilter === 'pr') books = books.filter(b => b.isPR);
  else if (S.bookFilter !== 'all') books = books.filter(b => b.status === S.bookFilter);

  books.sort((a, b) => (b.dateAdded || '').localeCompare(a.dateAdded || ''));

  mc.innerHTML = `
    <div class="filter-bar no-scrollbar">
      ${filters.map(f => `
        <button class="filter-chip ${S.bookFilter === f.id && !S.activeFilter ? 'active' : ''}"
                data-filter="${f.id}">${f.label}</button>
      `).join('')}
    </div>
    <div class="book-list">
      ${books.length === 0 ? renderEmptyBooks() : books.map(renderBookCard).join('')}
    </div>
  `;

  mc.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      S.activeFilter = null;
      S.bookFilter = chip.dataset.filter;
      renderBooksTab();
    });
  });

  // Клик по карточке
  mc.querySelectorAll('.book-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.status-btn')) return;
      if (e.target.closest('.tag-chip')) return;
      openBookDetail(card.dataset.id);
    });
  });

  // Dropdown статуса
  mc.querySelectorAll('.status-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openStatusDropdown(btn, btn.dataset.bookId);
    });
  });

  // Кликабельные теги
  mc.querySelectorAll('.tag-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      S.activeFilter = { type: 'tag', value: chip.dataset.tag };
      renderBooksTab();
    });
  });
}

function renderEmptyBooks() {
  return `
    <div class="empty-state">
      <div class="empty-icon">📚</div>
      <div class="empty-title">Пока нет книг</div>
      <div class="empty-text">
        Нажмите ＋ чтобы добавить книгу, 📷 чтобы
        отсканировать ISBN, или найдите книгу в интернете
      </div>
    </div>
  `;
}

function renderBookCard(book) {
  const st = BOOK_STATUSES[book.status] || BOOK_STATUSES.wishlist;
  const statusClass = {
    wishlist: 'badge-wishlist', added: 'badge-added', reading: 'badge-reading',
    paused: 'badge-paused', finished: 'badge-finished', dropped: 'badge-dropped',
  }[book.status] || 'badge-status';

  const contentCount = (book.contentItems || []).length;
  const publishedCount = (book.contentItems || []).filter(c => c.status === 'published').length;
  const progress = book.pageCount > 0 ? Math.round((book.currentPage / book.pageCount) * 100) : 0;

  const coverHtml = book.coverUrl
    ? `<img class="book-cover" src="${book.coverUrl}" alt="" loading="lazy"/>`
    : `<div class="book-cover-placeholder">📕</div>`;

  // Цена
  const priceHtml = (S.settings.showPriceInCards && book.price?.amount > 0)
    ? `<span class="book-badge badge-price">💰 ${formatPrice(book.price)}</span>` : '';

  // Серия
  const seriesHtml = book.series
    ? `<span class="book-badge badge-series">📚 ${esc(book.series)}${book.seriesNumber ? ' #' + book.seriesNumber : ''}</span>` : '';

  // Теги
  const tagsHtml = (book.tags || []).slice(0, 3).map(t => {
    const tag = S.tags.find(x => x.name === t);
    const color = tag?.color || 'var(--text-secondary)';
    return `<span class="tag-chip" data-tag="${esc(t)}" style="color:${color};border-color:${color}40">${esc(t)}</span>`;
  }).join('');

  return `
    <div class="book-card" data-id="${book.id}">
      ${coverHtml}
      <div class="book-info">
        <div class="book-title">${esc(book.title)}</div>
        <div class="book-author">${esc(book.author)}</div>
        <div class="book-meta">
          <button class="book-badge ${statusClass} status-btn" data-book-id="${book.id}">
            ${st.icon} ${st.label} ▾
          </button>
          ${book.isPR ? '<span class="book-badge badge-pr">📦 PR</span>' : ''}
          ${seriesHtml}
          ${priceHtml}
          ${contentCount > 0 ? `<span class="book-badge badge-content">🎬 ${contentCount}${publishedCount ? ' · 📤' + publishedCount : ''}</span>` : ''}
          ${book.review?.rating > 0 ? `<span class="book-badge badge-rating">${'⭐'.repeat(book.review.rating)}</span>` : ''}
          ${book.jointReading?.active ? '<span class="book-badge badge-content">👥 совместно</span>' : ''}
        </div>
        ${tagsHtml ? `<div class="book-meta">${tagsHtml}</div>` : ''}
        ${book.status === 'reading' && book.pageCount > 0 ? `
          <div class="book-progress"><div class="book-progress-fill" style="width:${progress}%"></div></div>
        ` : ''}
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════
//  DROPDOWN СТАТУСА
// ═══════════════════════════════════════════════

let _statusDropdown = null;

function openStatusDropdown(anchor, bookId) {
  closeStatusDropdown();
  const book = S.books.find(b => b.id === bookId);
  if (!book) return;

  const dd = document.createElement('div');
  dd.className = 'status-dropdown';
  dd.innerHTML = Object.entries(BOOK_STATUSES).map(([key, st]) => `
    <button class="status-dropdown-item ${book.status === key ? 'current' : ''}" data-status="${key}">
      <span>${st.icon}</span> ${st.label}
      ${book.status === key ? '<span style="margin-left:auto">✓</span>' : ''}
    </button>
  `).join('');

  document.body.appendChild(dd);
  _statusDropdown = dd;

  // Позиция рядом с кнопкой
  const rect = anchor.getBoundingClientRect();
  const ddH = dd.offsetHeight;
  let top = rect.bottom + 6;
  if (top + ddH > window.innerHeight - 10) top = rect.top - ddH - 6;
  dd.style.top = top + 'px';
  dd.style.left = Math.min(rect.left, window.innerWidth - 210) + 'px';

  dd.querySelectorAll('.status-dropdown-item').forEach(item => {
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      const newStatus = item.dataset.status;
      closeStatusDropdown();
      if (newStatus === book.status) return;

      const result = await changeBookStatus(bookId, newStatus);
      if (!result) return;

      await refreshData();

      if (result.confetti && S.settings.confetti) fireConfetti();
      if (result.askRating) openRatingModal(result.book);
      else showToast(`${BOOK_STATUSES[newStatus].icon} Статус: ${BOOK_STATUSES[newStatus].label}`, 'success');
    });
  });
}

function closeStatusDropdown() {
  if (_statusDropdown) { _statusDropdown.remove(); _statusDropdown = null; }
}

// ═══════════════════════════════════════════════
//  МОДАЛКА ОЦЕНКИ (после Прочитано/Брошено)
// ═══════════════════════════════════════════════

function openRatingModal(book) {
  const isDropped = book.status === 'dropped';
  const modal = document.createElement('div');
  modal.className = 'rating-modal';
  modal.innerHTML = `
    <div class="rating-modal-panel">
      <div class="rating-modal-emoji">${isDropped ? '📕' : '🎉'}</div>
      <div class="rating-modal-title">${isDropped ? 'Книга брошена' : 'Поздравляю, прочитано!'}</div>
      <div class="rating-modal-book">«${esc(book.title)}»${book.readingDays ? ` · ${book.readingDays} дн.` : ''}</div>
      <div class="star-rating" id="rm-stars">
        ${[1,2,3,4,5].map(i => `<span class="star" data-star="${i}">★</span>`).join('')}
      </div>
      <div class="btn-group" style="margin-top:0">
        <button id="rm-review" class="btn-primary">
          ${book.review?.text || book.review?.rating > 0 ? '✏️ Дополнить отзыв' : '✍️ Написать отзыв'}
        </button>
      </div>
      <button id="rm-later" class="btn-secondary mt-8" style="width:100%">Позже</button>
    </div>
  `;
  document.body.appendChild(modal);

  let rating = 0;
  const stars = modal.querySelector('#rm-stars');

  stars.querySelectorAll('.star').forEach(star => {
    star.addEventListener('click', async () => {
      rating = parseInt(star.dataset.star);
      stars.querySelectorAll('.star').forEach(s =>
        s.classList.toggle('filled', parseInt(s.dataset.star) <= rating));
      // Сохраняем сразу
      book.review = book.review || {};
      book.review.rating = rating;
      await putBook(book);
    });
    star.addEventListener('mouseenter', () => {
      const v = parseInt(star.dataset.star);
      stars.querySelectorAll('.star').forEach(s =>
        s.classList.toggle('filled', parseInt(s.dataset.star) <= v));
    });
  });
  stars.addEventListener('mouseleave', () => {
    stars.querySelectorAll('.star').forEach(s =>
      s.classList.toggle('filled', parseInt(s.dataset.star) <= rating));
  });

  const close = () => { modal.remove(); refreshData(); };

  modal.querySelector('#rm-later').addEventListener('click', close);
  modal.querySelector('#rm-review').addEventListener('click', () => {
    modal.remove();
    openReviewForm(book.id);
  });
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
}

// ═══════════════════════════════════════════════
//  ФОРМА КНИГИ
// ═══════════════════════════════════════════════

function openBookForm(book = null) {
  S.editingBookId = book?.id || null;
  DOM.formTitle.textContent = book ? '✏️ Редактировать книгу' : '📚 Новая книга';
  const b = book || {};
  const cur = b.price?.currency || S.settings.defaultCurrency;

  DOM.formBody.innerHTML = `
    <!-- ISBN -->
    <div class="form-group">
      <label>🔍 Найти по ISBN</label>
      <div class="flex gap-8">
        <input type="text" id="bf-isbn" value="${esc(b.isbn || '')}" placeholder="978-5-17-098765-8" inputmode="numeric"/>
        <button id="bf-scan" class="btn-secondary" style="width:auto;flex-shrink:0">📷</button>
        <button id="bf-find" class="btn-secondary" style="width:auto;flex-shrink:0">Найти</button>
      </div>
    </div>

    <!-- Поиск в интернете -->
    <div class="form-group">
      <label>🌐 Поиск книги в интернете</label>
      <div class="flex gap-8">
        <input type="text" id="bf-webquery" placeholder="Название и автор, напр. «Мастер и Маргарита Булгаков»"/>
        <button id="bf-websearch" class="btn-secondary" style="width:auto;flex-shrink:0">🔍 Искать</button>
      </div>
      <div id="bf-webresults" class="web-search-results"></div>
    </div>

    <div class="divider"></div>

    <!-- Основные поля -->
    <div class="form-group">
      <label>Название *</label>
      <input type="text" id="bf-title" value="${esc(b.title || '')}" placeholder="Мастер и Маргарита" required/>
    </div>
    <div class="form-group">
      <label>Автор</label>
      <input type="text" id="bf-author" value="${esc(b.author || '')}" placeholder="Михаил Булгаков"/>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Жанр</label><input type="text" id="bf-genre" value="${esc(b.genre || '')}" placeholder="Классика"/></div>
      <div class="form-group"><label>Издательство</label><input type="text" id="bf-publisher" value="${esc(b.publisher || '')}" placeholder="АСТ"/></div>
    </div>
    <div class="form-row-3">
      <div class="form-group"><label>Год</label><input type="text" id="bf-year" value="${esc(b.publishedDate || '')}" placeholder="2024"/></div>
      <div class="form-group"><label>Страниц</label><input type="number" id="bf-pages" value="${b.pageCount || ''}" placeholder="480" min="0"/></div>
      <div class="form-group"><label>Возраст</label><input type="text" id="bf-age" value="${esc(b.ageRating || '')}" placeholder="16+"/></div>
    </div>
    <div class="form-group"><label>Описание</label><textarea id="bf-desc" rows="3" placeholder="Аннотация...">${esc(b.description || '')}</textarea></div>
    <div class="form-group"><label>Обложка (URL)</label><input type="url" id="bf-cover" value="${esc(b.cover || b.coverUrl || '')}" placeholder="https://..."/></div>

    <!-- Серия -->
    <div class="form-section">
      <h3>📚 Серия</h3>
      <div class="form-group"><label>Название серии</label><input type="text" id="bf-series" value="${esc(b.series || '')}" placeholder="Гарри Поттер" autocomplete="off"/></div>
      <div class="form-row">
        <div class="form-group"><label>Номер в серии</label><input type="number" id="bf-series-num" value="${b.seriesNumber || ''}" min="1" placeholder="1"/></div>
        <div class="form-group"><label>Всего книг в серии</label><input type="number" id="bf-series-total" value="${b.seriesTotal || ''}" min="1" placeholder="7"/></div>
      </div>
    </div>

    <!-- Цена -->
    <div class="form-section">
      <h3>💰 Цена</h3>
      <div class="form-row">
        <div class="form-group"><label>Цена</label><input type="number" id="bf-price" value="${b.price?.amount || ''}" min="0" placeholder="599"/></div>
        <div class="form-group"><label>Валюта</label>
          <select id="bf-currency">
            ${Object.entries(CURRENCIES).map(([k, c]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${c.symbol} ${c.name}</option>`).join('')}
          </select>
        </div>
      </div>
    </div>

    <!-- Статус -->
    <div class="form-section">
      <h3>📖 Статус</h3>
      <div class="form-group"><label>Статус</label>
        <select id="bf-status">
          ${Object.entries(BOOK_STATUSES).map(([k, st]) => `<option value="${k}" ${(b.status || 'wishlist') === k ? 'selected' : ''}>${st.icon} ${st.label}</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Текущая страница</label><input type="number" id="bf-page" value="${b.currentPage || 0}" min="0"/></div>
        <div class="form-group"><label>Оценка (1–5)</label><input type="number" id="bf-rating" value="${b.rating || b.review?.rating || 0}" min="0" max="5"/></div>
      </div>
    </div>

    <!-- Теги -->
    <div class="form-section">
      <h3>🏷️ Теги</h3>
      <div class="form-group"><label>Теги (через запятую)</label>
        <input type="text" id="bf-tags" value="${esc((b.tags || []).join(', '))}" placeholder="фэнтези, бумажная, перечитать"/>
      </div>
    </div>

    <!-- Блог -->
    <div class="form-section">
      <h3>🎬 Для блога</h3>
      <div class="toggle-row">
        <span class="toggle-label">📦 Получена от издательства (PR)</span>
        <div class="toggle ${b.isPR ? 'active' : ''}" id="bf-pr-toggle"></div>
      </div>
      <div id="bf-pr-fields" class="${b.isPR ? '' : 'hidden'}">
        <div class="form-group"><label>От кого</label><input type="text" id="bf-received-from" value="${esc(b.receivedFrom || '')}" placeholder="Издательство ЭКСМО"/></div>
        <div class="form-group"><label>Дата получения</label><input type="date" id="bf-received-date" value="${b.receivedDate || ''}"/></div>
      </div>
    </div>

    <!-- Совместное чтение -->
    <div class="form-section">
      <h3>👥 Совместное чтение</h3>
      <div class="toggle-row">
        <span class="toggle-label">Читаем вместе с кем-то</span>
        <div class="toggle ${b.jointReading?.active ? 'active' : ''}" id="bf-joint-toggle"></div>
      </div>
      <div id="bf-joint-fields" class="${b.jointReading?.active ? '' : 'hidden'}">
        <div class="form-group"><label>Участники (через запятую)</label><input type="text" id="bf-joint-people" value="${esc((b.jointReading?.participants || []).join(', '))}" placeholder="Аня, Маша, Катя"/></div>
        <div class="form-group"><label>Ссылка на чат</label><input type="url" id="bf-joint-chat" value="${esc(b.jointReading?.chatLink || '')}" placeholder="https://t.me/+..."/></div>
        <div class="form-group"><label>Заметки</label><input type="text" id="bf-joint-notes" value="${esc(b.jointReading?.notes || '')}" placeholder="Читаем по 3 главы в день"/></div>
      </div>
    </div>

    <!-- Заметки -->
    <div class="form-section">
      <h3>📝 Заметки</h3>
      <div class="form-group"><textarea id="bf-notes" rows="3" placeholder="Личные заметки...">${esc(b.notes || '')}</textarea></div>
    </div>

    <div class="btn-group">
      <button id="bf-save" class="btn-primary">💾 Сохранить</button>
      ${book ? '<button id="bf-delete" class="btn-danger">🗑️ Удалить</button>' : ''}
    </div>
  `;

  const fb = DOM.formBody;

  // Сканер
  fb.querySelector('#bf-scan').addEventListener('click', () => { closeOverlay(DOM.formOverlay); openScanner(); });

  // ISBN поиск
  fb.querySelector('#bf-find').addEventListener('click', () => {
    const isbn = fb.querySelector('#bf-isbn').value.trim();
    if (isbn) handleIsbnLookup(isbn);
  });

  // Поиск в интернете
  fb.querySelector('#bf-websearch').addEventListener('click', () => handleWebSearch());
  fb.querySelector('#bf-webquery').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleWebSearch(); });

  // Автодополнение серии
  attachSeriesAutocomplete(fb.querySelector('#bf-series'), S.books, (name) => {
    const total = getSeriesTotal(S.books, name);
    if (total && !fb.querySelector('#bf-series-total').value) {
      fb.querySelector('#bf-series-total').value = total;
    }
  });

  // Toggles
  fb.querySelector('#bf-pr-toggle').addEventListener('click', function() {
    this.classList.toggle('active');
    fb.querySelector('#bf-pr-fields').classList.toggle('hidden');
  });
  fb.querySelector('#bf-joint-toggle').addEventListener('click', function() {
    this.classList.toggle('active');
    fb.querySelector('#bf-joint-fields').classList.toggle('hidden');
  });

  fb.querySelector('#bf-save').addEventListener('click', () => saveBookForm());

  const delBtn = fb.querySelector('#bf-delete');
  if (delBtn) delBtn.addEventListener('click', async () => {
    if (confirm('Удалить эту книгу?')) {
      await delBook(S.editingBookId);
      await deleteCover(S.editingBookId);
      closeOverlay(DOM.formOverlay);
      await refreshData();
      showToast('🗑️ Книга удалена', 'info');
    }
  });

  openOverlay(DOM.formOverlay);
}

// ─── Поиск в интернете ───
async function handleWebSearch() {
  const fb = DOM.formBody;
  const query = fb.querySelector('#bf-webquery').value.trim();
  const resultsEl = fb.querySelector('#bf-webresults');
  if (!query) { showToast('⚠️ Введите название или автора', 'error'); return; }

  resultsEl.innerHTML = '<div class="text-center text-muted text-small" style="padding:14px"><div class="spinner" style="margin:0 auto 8px;width:26px;height:26px"></div>Ищу в интернете...</div>';

  const litresKeys = S.settings.lrAppId && S.settings.lrSecret
    ? { appId: S.settings.lrAppId, secretKey: S.settings.lrSecret } : null;

  const results = await searchBooks(query, litresKeys);

  if (results.length === 0) {
    resultsEl.innerHTML = '<div class="text-center text-muted text-small" style="padding:14px">Ничего не найдено. Попробуйте другой запрос или заполните вручную.</div>';
    return;
  }

  const sourceMeta = {
    google: { label: '📗 Google Books', cls: 'badge-reading' },
    openlibrary: { label: '📘 Open Library', cls: 'badge-status' },
    litres: { label: '📕 ЛитРес', cls: 'badge-pr' },
  };

  resultsEl.innerHTML = results.map((r, i) => {
    const src = sourceMeta[r.source] || { label: r.source, cls: 'badge-source' };
    return `
      <div class="web-result" data-idx="${i}">
        ${r.cover ? `<img class="web-result-cover" src="${r.cover}" alt="" loading="lazy"/>` : '<div class="web-result-cover" style="display:flex;align-items:center;justify-content:center">📕</div>'}
        <div class="web-result-info">
          <div class="web-result-title">${esc(r.title)}</div>
          <div class="web-result-meta">${esc(r.author)}${r.publisher ? ' · ' + esc(r.publisher) : ''}${r.pageCount ? ' · ' + r.pageCount + ' стр.' : ''}</div>
          <span class="web-result-source book-badge ${src.cls}">${src.label}</span>
        </div>
      </div>
    `;
  }).join('');

  resultsEl.querySelectorAll('.web-result').forEach(el => {
    el.addEventListener('click', () => {
      const r = results[parseInt(el.dataset.idx)];
      fillFormFromResult(r);
      showToast(`✅ Выбрано: ${sourceMeta[r.source]?.label || r.source}`, 'success');
    });
  });
}

function fillFormFromResult(r) {
  const fb = DOM.formBody;
  const set = (id, val) => { const el = fb.querySelector(id); if (el && val) el.value = val; };
  set('#bf-title', r.title);
  set('#bf-author', r.author);
  set('#bf-genre', r.genre);
  set('#bf-publisher', r.publisher);
  set('#bf-year', r.publishedDate);
  set('#bf-pages', r.pageCount);
  set('#bf-desc', r.description);
  set('#bf-cover', r.cover);
  set('#bf-isbn', r.isbn);
  // Серия из ЛитРес
  if (r.litresSeries?.length > 0) {
    set('#bf-series', r.litresSeries[0].name);
    set('#bf-series-num', r.litresSeries[0].number);
  }
  if (r.litresMinAge) set('#bf-age', r.litresMinAge + '+');
}

// ─── Сохранение формы ───
async function saveBookForm() {
  const f = DOM.formBody;
  const title = f.querySelector('#bf-title').value.trim();
  if (!title) { showToast('⚠️ Введите название книги', 'error'); return; }

  const now = new Date().toISOString();
  const isPR = f.querySelector('#bf-pr-toggle').classList.contains('active');
  const isJoint = f.querySelector('#bf-joint-toggle').classList.contains('active');

  const tags = f.querySelector('#bf-tags').value.split(',').map(t => t.trim()).filter(Boolean);

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
    series: f.querySelector('#bf-series').value.trim(),
    seriesNumber: parseInt(f.querySelector('#bf-series-num').value) || null,
    seriesTotal: parseInt(f.querySelector('#bf-series-total').value) || null,
    price: {
      amount: parseFloat(f.querySelector('#bf-price').value) || 0,
      currency: f.querySelector('#bf-currency').value,
    },
    status: f.querySelector('#bf-status').value,
    currentPage: parseInt(f.querySelector('#bf-page').value) || 0,
    rating: parseInt(f.querySelector('#bf-rating').value) || 0,
    tags,
    isPR,
    receivedFrom: isPR ? f.querySelector('#bf-received-from').value.trim() : '',
    receivedDate: isPR ? f.querySelector('#bf-received-date').value : '',
    jointReading: {
      active: isJoint,
      participants: isJoint ? f.querySelector('#bf-joint-people').value.split(',').map(p => p.trim()).filter(Boolean) : [],
      chatLink: isJoint ? f.querySelector('#bf-joint-chat').value.trim() : '',
      notes: isJoint ? f.querySelector('#bf-joint-notes').value.trim() : '',
      startDate: isJoint ? (S.books.find(b => b.id === S.editingBookId)?.jointReading?.startDate || now.slice(0, 10)) : '',
    },
    notes: f.querySelector('#bf-notes').value.trim(),
    dateAdded: S.editingBookId ? (S.books.find(b => b.id === S.editingBookId)?.dateAdded || now) : now,
    updatedAt: now,
  };

  // Сохраняем существующие поля при редактировании
  if (S.editingBookId) {
    const ex = S.books.find(b => b.id === S.editingBookId);
    if (ex) {
      bookData.contentItems = ex.contentItems || [];
      bookData.review = ex.review || {};
      bookData.readingForContent = ex.readingForContent || {};
      bookData.dateStarted = ex.dateStarted || '';
      bookData.dateFinished = ex.dateFinished || '';
      bookData.readingDays = ex.readingDays;
      bookData.source = ex.source || 'manual';
      // Если статус сменился на reading — ставим dateStarted
      if (bookData.status === 'reading' && !bookData.dateStarted) bookData.dateStarted = now.slice(0, 10);
      if ((bookData.status === 'finished' || bookData.status === 'dropped') && ex.status !== bookData.status) bookData.dateFinished = now.slice(0, 10);
    }
  } else {
    bookData.contentItems = []; bookData.review = {}; bookData.readingForContent = {};
    bookData.source = 'manual';
    if (bookData.status === 'reading') bookData.dateStarted = now.slice(0, 10);
  }

  // Сохраняем теги с цветами (если новые)
  for (const t of tags) {
    if (!S.tags.find(x => x.name === t)) {
      await putTag({ name: t, color: pickTagColor(S.tags.length) });
    }
  }

  // Обложка → Blob
  if (bookData.cover && bookData.cover.startsWith('http')) {
    try {
      const blob = await (await fetch(bookData.cover)).blob();
      await saveCover(bookData.id, blob);
      bookData.coverUrl = URL.createObjectURL(blob);
    } catch { bookData.coverUrl = bookData.cover; }
  }

  await putBook(bookData);
  closeOverlay(DOM.formOverlay);
  await refreshData();

  if (bookData.status === 'finished' && S.settings.confetti) fireConfetti();
  showToast(S.editingBookId ? '✅ Книга обновлена' : '✅ Книга добавлена', 'success');
  S.editingBookId = null;
}

function pickTagColor(i) {
  const colors = ['#e8a33d','#94b878','#d98aa8','#7fb8b0','#b092d6','#8aa3c9','#e0955c','#d97b6c'];
  return colors[i % colors.length];
}

// ═══════════════════════════════════════════════
//  ISBN ПОИСК
// ═══════════════════════════════════════════════

async function handleIsbnLookup(isbnInput) {
  const isbn = cleanISBN(isbnInput);
  if (!validateISBN(isbn)) { showToast('❌ Неверный формат ISBN', 'error'); return; }

  showLoading('🔍 Ищу книгу...');
  if (isRussianISBN(isbn)) updateLoading('🇷🇺 Российский ISBN — ищу в базах...');

  const litresKeys = S.settings.lrAppId && S.settings.lrSecret
    ? { appId: S.settings.lrAppId, secretKey: S.settings.lrSecret } : null;

  const book = await fetchBookByIsbn(isbn, litresKeys);
  hideLoading();
  closeScanner();

  const sourceLabels = { google: '📗 Google Books', openlibrary: '📘 Open Library', litres: '📕 ЛитРес', cover: '🖼️ Только обложка' };
  if (book) {
    showToast(`Найдено: ${sourceLabels[book.source] || book.source}`, 'success');
    openBookForm({ ...book, isbn: book.isbn || isbn, status: 'wishlist' });
  } else {
    showToast('📖 Не найдено — заполните вручную', 'info');
    openBookForm({ isbn, title: '', author: '', status: 'wishlist' });
  }
}

// ═══════════════════════════════════════════════
//  КАРТОЧКА КНИГИ (детали)
// ═══════════════════════════════════════════════

function openBookDetail(bookId) {
  const book = S.books.find(b => b.id === bookId);
  if (!book) return;

  DOM.detailTitle.textContent = '📖 ' + (book.title || 'Книга');
  const st = BOOK_STATUSES[book.status] || BOOK_STATUSES.wishlist;
  const progress = book.pageCount > 0 ? Math.round((book.currentPage / book.pageCount) * 100) : 0;
  const contentItems = book.contentItems || [];
  const review = book.review || {};
  const quotes = review.quotes || [];
  const jr = book.jointReading || {};

  DOM.detailBody.innerHTML = `
    <div class="detail-hero">
      ${book.coverUrl
        ? `<img class="detail-cover" id="detail-cover-img" src="${book.coverUrl}" alt="" style="cursor:zoom-in"/>`
        : `<div class="detail-cover-placeholder">📕</div>`}
      <div style="flex:1;min-width:0">
        <div class="detail-title">${esc(book.title)}</div>
        <div class="detail-author">${esc(book.author)}</div>
        <div class="book-meta">
          <button class="book-badge badge-status status-btn" data-book-id="${book.id}">${st.icon} ${st.label} ▾</button>
          ${book.isPR ? `<span class="book-badge badge-pr">📦 ${esc(book.receivedFrom || 'PR')}</span>` : ''}
          ${book.ageRating ? `<span class="book-badge badge-status">${esc(book.ageRating)}</span>` : ''}
        </div>
        ${book.readingDays ? `<div class="text-small text-muted mt-8">⏱️ Прочитана за ${book.readingDays} дн.</div>` : ''}
      </div>
    </div>

    <div class="detail-meta-grid">
      ${book.genre ? meta('Жанр', book.genre) : ''}
      ${book.publisher ? meta('Издательство', book.publisher) : ''}
      ${book.publishedDate ? meta('Год', book.publishedDate) : ''}
      ${book.pageCount ? meta('Страниц', book.pageCount) : ''}
      ${book.isbn ? meta('ISBN', formatISBN(book.isbn)) : ''}
      ${book.series ? meta('Серия', book.series + (book.seriesNumber ? ' #' + book.seriesNumber : '')) : ''}
      ${(S.settings.showPriceInDetail && book.price?.amount > 0) ? meta('Цена', '💰 ' + formatPrice(book.price)) : ''}
    </div>

    ${book.status === 'reading' && book.pageCount > 0 ? `
      <div class="reading-progress">
        <div class="reading-progress-bar"><div class="reading-progress-fill" style="width:${progress}%"></div></div>
        <div class="reading-progress-text">Стр. ${book.currentPage} из ${book.pageCount} (${progress}%)</div>
      </div>
    ` : ''}

    ${book.description ? `<div class="detail-section"><h3>📝 Описание</h3><div class="detail-description">${esc(book.description)}</div></div>` : ''}

    <!-- Контент -->
    <div class="detail-section">
      <h3>🎬 Контент по книге (${contentItems.length})</h3>
      ${contentItems.length === 0 ? '<div class="text-muted text-small">Пока нет контента</div>'
        : contentItems.map(c => `
          <div class="content-list-item">
            <span class="content-list-icon">${CONTENT_ICONS[c.type] || '🎬'}</span>
            <div class="content-list-info">
              <div class="content-list-title">${esc(c.title || CONTENT_LABELS[c.type] || c.type)}</div>
              <div class="content-list-sub">${PLATFORM_LABELS[c.platform] || c.platform}${c.publishedDate ? ' · ' + c.publishedDate : ''}</div>
            </div>
            <span class="content-list-status status-${c.status}">${CONTENT_STATUS_LABELS[c.status] || c.status}</span>
          </div>`).join('')}
      <button id="detail-add-content" class="btn-secondary mt-8" style="width:100%">＋ Добавить контент</button>
    </div>

    <!-- Цитаты (вне отзыва) -->
    <div class="detail-section">
      <h3>💬 Цитаты (${quotes.length})</h3>
      <div id="detail-quotes">
        ${quotes.map((q, i) => `
          <div class="quote-item">
            <span>«${esc(q.text)}»</span>
            ${q.page ? `<span class="quote-page">с. ${q.page}</span>` : ''}
            ${q.used ? '<span class="quote-used">✅</span>' : ''}
          </div>`).join('')}
      </div>
      <div class="flex gap-8 mt-8">
        <input type="text" id="dq-text" placeholder="Новая цитата..." style="flex:1"/>
        <input type="number" id="dq-page" placeholder="Стр." style="width:70px" min="0"/>
        <button id="dq-add" class="btn-secondary" style="width:auto;flex-shrink:0">＋</button>
      </div>
      <button id="dq-ocr" class="btn-secondary mt-8" style="width:100%">📷 Сфотографировать цитату (OCR)</button>
    </div>

    <!-- Отзыв -->
    <div class="detail-section">
      <h3>✍️ Отзыв</h3>
      ${review.text || review.rating > 0 ? `
        <div class="review-stars">${'⭐'.repeat(review.rating || 0)}${'☆'.repeat(5 - (review.rating || 0))}</div>
        ${review.pros ? `<div class="review-pros">👍 ${esc(review.pros)}</div>` : ''}
        ${review.cons ? `<div class="review-cons">👎 ${esc(review.cons)}</div>` : ''}
        ${review.text ? `<div class="detail-description mt-8">${esc(review.text)}</div>` : ''}
        ${review.recommendation ? `<div class="mt-8 text-small">🎯 ${esc(review.recommendation)}</div>` : ''}
      ` : '<div class="text-muted text-small">Отзыв ещё не написан</div>'}
      <button id="detail-edit-review" class="btn-secondary mt-8" style="width:100%">
        ${review.text || review.rating > 0 ? '✏️ Редактировать отзыв' : '✍️ Написать отзыв'}
      </button>
    </div>

    <!-- Совместное чтение -->
    ${jr.active ? `
      <div class="detail-section">
        <h3>👥 Совместное чтение</h3>
        <div class="text-small">👥 ${esc((jr.participants || []).join(', '))}</div>
        ${jr.chatLink ? `<div class="text-small mt-8">💬 <a href="${esc(jr.chatLink)}" target="_blank" rel="noopener">${esc(jr.chatLink)}</a></div>` : ''}
        ${jr.notes ? `<div class="text-small text-muted mt-8">📝 ${esc(jr.notes)}</div>` : ''}
      </div>
    ` : ''}

    ${book.notes ? `<div class="detail-section"><h3>📝 Заметки</h3><div class="detail-description">${esc(book.notes)}</div></div>` : ''}

    <div class="btn-group mt-16">
      <button id="detail-collections" class="btn-secondary">📂 В подборку</button>
      <button id="detail-edit" class="btn-secondary">✏️ Изменить</button>
      <button id="detail-delete" class="btn-danger">🗑️</button>
    </div>
  `;

  function meta(label, value) {
    return `<div class="detail-meta-item"><div class="detail-meta-label">${label}</div><div class="detail-meta-value">${esc(String(value))}</div></div>`;
  }

  // События
  const db = DOM.detailBody;

  // Клик по обложке → просмотр
  const coverImg = db.querySelector('#detail-cover-img');
  if (coverImg) coverImg.addEventListener('click', () => openCoverViewer(book));

  // Dropdown статуса
  db.querySelector('.status-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    openStatusDropdown(e.currentTarget, book.id);
  });

  db.querySelector('#detail-edit').addEventListener('click', () => { closeOverlay(DOM.detailOverlay); openBookForm(book); });
  db.querySelector('#detail-delete').addEventListener('click', async () => {
    if (confirm('Удалить эту книгу?')) {
      await delBook(book.id); await deleteCover(book.id);
      closeOverlay(DOM.detailOverlay);
      await refreshData();
      showToast('🗑️ Книга удалена', 'info');
    }
  });
  db.querySelector('#detail-add-content').addEventListener('click', () => { closeOverlay(DOM.detailOverlay); openContentForm(null, book.id); });
  db.querySelector('#detail-edit-review').addEventListener('click', () => { closeOverlay(DOM.detailOverlay); openReviewForm(book.id); });
  db.querySelector('#detail-collections').addEventListener('click', () => {
    openBookCollectionsPicker(book.id, S.books, S.collections, refreshData);
  });

  // Цитаты
  const addQuote = async (text, page) => {
    if (!text) return;
    book.review = book.review || {};
    book.review.quotes = book.review.quotes || [];
    book.review.quotes.push({ text, page: page || 0, used: false });
    await putBook(book);
    await refreshData();
    openBookDetail(book.id); // перерисовать
    showToast('💬 Цитата добавлена', 'success');
  };

  db.querySelector('#dq-add').addEventListener('click', () => {
    addQuote(db.querySelector('#dq-text').value.trim(), parseInt(db.querySelector('#dq-page').value) || 0);
  });
  db.querySelector('#dq-text').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addQuote(db.querySelector('#dq-text').value.trim(), parseInt(db.querySelector('#dq-page').value) || 0);
  });

  // OCR цитата — ИСПРАВЛЕНО: без showLoading (иначе спиннер z-9000 накрывает камеру z-300)
  db.querySelector('#dq-ocr').addEventListener('click', async () => {
    closeOverlay(DOM.detailOverlay);
    const text = await captureQuoteByPhoto();
    if (text) {
      await addQuote(text, 0);
    } else {
      openBookDetail(book.id);
    }
  });

  openOverlay(DOM.detailOverlay);
}

// ═══════════════════════════════════════════════
//  ПРОСМОТР ОБЛОЖКИ
// ═══════════════════════════════════════════════

let _coverBookId = null;

function openCoverViewer(book) {
  if (!book.coverUrl) { showToast('Нет обложки', 'info'); return; }
  _coverBookId = book.id;
  DOM.coverViewerImg.src = book.coverUrl;
  DOM.coverViewerTitle.textContent = `${book.title} — ${book.author}`;
  openOverlay(DOM.coverOverlay);
}

async function handleCoverPhotoChange(e) {
  const file = e.target.files[0];
  if (!file || !_coverBookId) return;
  e.target.value = '';

  showLoading('💾 Сохраняю обложку...');
  try {
    // Сжатие до ~800px
    const bitmap = await createImageBitmap(file);
    const MAX = 800;
    const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.88));
    await saveCover(_coverBookId, blob);
    hideLoading();
    closeOverlay(DOM.coverOverlay);
    await refreshData();
    openBookDetail(_coverBookId);
    showToast('✅ Обложка обновлена', 'success');
  } catch (err) {
    hideLoading();
    showToast('❌ Ошибка: ' + err.message, 'error');
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
  if (result) handleIsbnLookup(result);
}

function closeScanner() { stopScanner(); DOM.scannerOverlay.classList.add('hidden'); }

// ═══════════════════════════════════════════════
//  КОНТЕНТ / ОТЗЫВЫ (делегирование)
// ═══════════════════════════════════════════════

async function handleDeleteContent(itemId, bookId) {
  if (!confirm('Удалить этот контент?')) return;
  await deleteContentItem(bookId, itemId);
  await refreshData();
  showToast('🗑️ Контент удалён', 'info');
}

async function handleContentStatus(itemId, bookId, status) {
  await updateContentStatus(bookId, itemId, status);
  await refreshData();
  if (status === 'published' && S.settings.confetti) {
    fireConfetti();
    showToast('📤 Контент опубликован! 🎉', 'success');
  }
}

async function handleDeleteReview(bookId) {
  if (!confirm('Удалить отзыв?')) return;
  await deleteReview(bookId);
  await refreshData();
  showToast('🗑️ Отзыв удалён', 'info');
}

// ═══════════════════════════════════════════════
//  СЕРИИ
// ═══════════════════════════════════════════════

function renderSeriesScreen() {
  const mc = DOM.mainContent;
  if (S.openSeries) {
    renderSeriesDetail(mc, S.openSeries, S.books, {
      onOpenBook: openBookDetail,
      onAddBook: (seriesName, total) => {
        openBookForm({ series: seriesName, seriesTotal: total, status: 'wishlist' });
      },
      onBack: () => { S.openSeries = null; renderSeriesScreen(); },
    });
  } else {
    renderSeriesList(mc, S.books, {
      onOpenSeries: (name) => { S.openSeries = name; renderSeriesScreen(); },
    });
  }
}

// ═══════════════════════════════════════════════
//  ПОДБОРКИ
// ═══════════════════════════════════════════════

function renderCollectionsScreen() {
  const mc = DOM.mainContent;
  const col = S.collections.find(c => c.id === S.openCollection);

  if (col) {
    renderCollectionDetail(mc, col, S.books, {
      onOpenBook: openBookDetail,
      onRemoveBook: async (colId, bookId) => {
        await removeBookFromCol(colId, bookId);
        await refreshData();
        showToast('Убрано из подборки', 'info');
      },
      onAddBook: (colId) => openAddBooksToCollection(colId, S.books, col, refreshData),
      onBack: () => { S.openCollection = null; renderCollectionsScreen(); },
      onEdit: (c) => openCollectionForm(c, async (data) => {
        await updateCollection(data); await refreshData(); showToast('✅ Сохранено', 'success');
      }),
    });
  } else {
    renderCollectionsList(mc, S.books, S.collections, {
      onOpen: (id) => { S.openCollection = id; renderCollectionsScreen(); },
      onAdd: () => openCollectionForm(null, async (data) => {
        await createCollection(data); await refreshData(); showToast('✅ Подборка создана', 'success');
      }),
      onEdit: (c) => openCollectionForm(c, async (data) => {
        await updateCollection(data); await refreshData(); showToast('✅ Сохранено', 'success');
      }),
      onDelete: async (id) => {
        if (confirm('Удалить подборку?')) {
          await deleteCollection(id); await refreshData(); showToast('🗑️ Подборка удалена', 'info');
        }
      },
      onAddBook: () => {},
    });
  }
}

// ═══════════════════════════════════════════════
//  ЧЕЛЛЕНДЖИ
// ═══════════════════════════════════════════════

function renderChallenges() {
  const mc = DOM.mainContent;
  const ch = S.challenges.find(c => c.id === S.openChallenge);

  if (ch) {
    renderChallengeDetail(mc, ch, S.books, {
      onBack: () => { S.openChallenge = null; renderChallenges(); },
      onEdit: (c) => openChallengeForm(c, S.books, async (data) => {
        await updateChallenge(data); await refreshData(); showToast('✅ Сохранено', 'success');
      }),
      onDelete: async (id) => {
        if (confirm('Удалить челлендж?')) {
          await deleteChallengeById(id); S.openChallenge = null;
          await refreshData(); showToast('🗑️ Челлендж удалён', 'info');
        }
      },
      onOpenBook: openBookDetail,
      onAddBook: (chId) => openAddBooksToChallenge(chId, ch, S.books, refreshData),
      onStatusChange: async (chId, status) => {
        const challenges = await loadChallenges();
        const c = challenges.find(x => x.id === chId);
        if (c) { c.status = status; await updateChallenge(c); }
        await refreshData();
        if (status === 'completed' && S.settings.confetti) {
          fireConfetti();
          showToast('🏆 Челлендж завершён! 🎉', 'success');
        } else {
          showToast(`Статус: ${status === 'active' ? '🟢 Активен' : '🏆 Завершён'}`, 'success');
        }
      },
      onAddNote: async (chId, text) => { await addChallengeNote(chId, text); await refreshData(); },
      onDelNote: async (chId, idx) => { await removeChallengeNote(chId, idx); await refreshData(); },
    });
  } else {
    renderChallengesList(mc, S.challenges, S.books, {
      onOpen: (id) => { S.openChallenge = id; renderChallenges(); },
      onAdd: () => openChallengeForm(null, S.books, async (data) => {
        await createChallenge(data); await refreshData(); showToast('✅ Челлендж создан', 'success');
      }),
      onEdit: (c) => openChallengeForm(c, S.books, async (data) => {
        await updateChallenge(data); await refreshData();
      }),
      onDelete: async (id) => {
        if (confirm('Удалить челлендж?')) {
          await deleteChallengeById(id); await refreshData(); showToast('🗑️ Удалён', 'info');
        }
      },
    });
  }
}

// ═══════════════════════════════════════════════
//  КАЛЕНДАРЬ: день
// ═══════════════════════════════════════════════

function showDayContent(dateStr) {
  const dayContent = [];
  for (const book of S.books) {
    for (const c of (book.contentItems || [])) {
      if (c.plannedDate === dateStr || c.publishedDate === dateStr) {
        dayContent.push({ ...c, bookTitle: book.title });
      }
    }
  }
  if (dayContent.length === 0) { showToast(`📅 ${dateStr}: нет контента`, 'info'); return; }
  const list = dayContent.map(c => `${CONTENT_ICONS[c.type] || '🎬'} ${c.title || CONTENT_LABELS[c.type]} — ${c.bookTitle}`).join('\n');
  alert(`📅 ${dateStr}\n\n${list}`);
}

// ═══════════════════════════════════════════════
//  НАСТРОЙКИ
// ═══════════════════════════════════════════════

function renderSettingsTab() {
  const s = S.settings;
  const mc = DOM.mainContent;

  mc.innerHTML = `
    <!-- Режим блогера -->
    <div class="settings-section">
      <h3>🎬 Режим бук-блогера</h3>
      <div class="toggle-row">
        <span class="toggle-label">Включить блогерские функции</span>
        <div class="toggle ${s.bloggerMode ? 'active' : ''}" id="set-blogger"></div>
      </div>
    </div>

    <!-- Цена -->
    <div class="settings-section">
      <h3>💰 Цена и валюта</h3>
      <div class="form-group">
        <label>Валюта по умолчанию</label>
        <select id="set-currency">
          ${Object.entries(CURRENCIES).map(([k, c]) => `<option value="${k}" ${s.defaultCurrency === k ? 'selected' : ''}>${c.symbol} ${c.name}</option>`).join('')}
        </select>
      </div>
      <div class="toggle-row"><span class="toggle-label">Показывать цену в карточках</span><div class="toggle ${s.showPriceInCards ? 'active' : ''}" id="set-price-cards"></div></div>
      <div class="toggle-row"><span class="toggle-label">Показывать цену на странице книги</span><div class="toggle ${s.showPriceInDetail ? 'active' : ''}" id="set-price-detail"></div></div>
      <div class="toggle-row"><span class="toggle-label">Показывать цену в статистике</span><div class="toggle ${s.showPriceInStats ? 'active' : ''}" id="set-price-stats"></div></div>
      <div class="hint mt-8">Курсы валют обновлены: ${s.ratesUpdated || 'никогда'} · 1 USD = ${s.exchangeRates.USD} ₽</div>
      <button id="set-rates-update" class="btn-secondary mt-8">🔄 Обновить курсы</button>
    </div>

    <!-- Теги -->
    <div class="settings-section">
      <h3>🏷️ Теги и цвета</h3>
      <div id="set-tags-list">
        ${S.tags.map(t => `
          <div class="flex items-center gap-8 mb-8">
            <input type="color" data-tag-color="${esc(t.name)}" value="${t.color || '#e8a33d'}" style="width:44px;height:36px;padding:2px;border-radius:8px;cursor:pointer"/>
            <span class="flex-1 text-small">${esc(t.name)}</span>
            <button data-tag-del="${esc(t.name)}" class="icon-btn" style="width:30px;height:30px;font-size:.8rem">🗑️</button>
          </div>
        `).join('') || '<div class="text-small text-muted">Нет тегов. Добавьте теги в форме книги.</div>'}
      </div>
    </div>

    <!-- ЛитРес -->
    <div class="settings-section">
      <h3>📚 ЛитРес API <span class="badge">опционально</span></h3>
      <p class="hint">
        Улучшает поиск российских книг. Получите ключи:<br/>
        1. <a href="https://www.litres.ru/pages/reader_partner/" target="_blank">litres.ru/pages/reader_partner</a><br/>
        2. Напишите на <a href="mailto:partners@litres.ru">partners@litres.ru</a><br/>
        ⚠️ Сейчас стоят <strong>тестовые ключи</strong>.
      </p>
      <details>
        <summary>Catalit API (поиск по ISBN и названию)</summary>
        <div class="form-group mt-8"><label>App ID</label><input type="text" id="set-lr-appid" value="${esc(s.lrAppId || '')}" placeholder="Ваш App ID"/></div>
        <div class="form-group"><label>Secret Key</label><input type="password" id="set-lr-secret" value="${esc(s.lrSecret || '')}" placeholder="Ваш Secret Key"/></div>
      </details>
      <details>
        <summary>Partner API (расширенные метаданные)</summary>
        <div class="form-group mt-8"><label>Partner ID</label><input type="text" id="set-lr-pid" value="${esc(s.lrPartnerId || '')}"/></div>
        <div class="form-group"><label>Secret Key</label><input type="password" id="set-lr-psecret" value="${esc(s.lrPartnerSecret || '')}"/></div>
      </details>
      <button id="set-lr-test" class="btn-secondary mt-8">🔍 Проверить подключение</button>
      <span id="set-lr-status" class="status-text"></span>
    </div>

    <!-- OCR -->
    <div class="settings-section">
      <h3>📷 Распознавание цитат (OCR)</h3>
      <p class="hint">Полный оффлайн. Файлы Tesseract.js должны лежать в корне проекта.</p>
      <button id="set-ocr-check" class="btn-secondary">🔍 Проверить файлы OCR</button>
      <span id="set-ocr-status" class="status-text"></span>
    </div>

    <!-- Площадка -->
    <div class="settings-section">
      <h3>📱 Площадки</h3>
      <div class="form-group"><label>Площадка по умолчанию</label>
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

    <!-- Эффекты -->
    <div class="settings-section">
      <h3>🔔 Эффекты</h3>
      <div class="toggle-row"><span class="toggle-label">🎊 Конфетти</span><div class="toggle ${s.confetti ? 'active' : ''}" id="set-confetti"></div></div>
      <div class="toggle-row"><span class="toggle-label">🔊 Звуки</span><div class="toggle ${s.sound ? 'active' : ''}" id="set-sound"></div></div>
    </div>

    <!-- Данные -->
    <div class="settings-section">
      <h3>💾 Данные</h3>
      <div class="btn-group">
        <button id="set-export" class="btn-secondary">📤 Экспорт</button>
        <button id="set-import" class="btn-secondary">📥 Импорт</button>
      </div>
      <input type="file" id="set-import-file" accept=".json" class="hidden"/>
      <div class="btn-group"><button id="set-clear" class="btn-danger">🗑️ Очистить всё</button></div>
      <div class="hint mt-8">Размер базы: <span id="set-dbsize">...</span></div>
    </div>

    <div class="settings-section">
      <h3>ℹ️ О приложении</h3>
      <p class="hint">Book Tracker Pro v3.3.0 · Трекер книг для бук-блогера · Работает оффлайн</p>
    </div>
  `;

  // События
  const bind = (id, fn) => mc.querySelector(id)?.addEventListener('click', fn);
  const bindToggle = (id, key) => mc.querySelector(id).addEventListener('click', function() {
    this.classList.toggle('active');
    S.settings[key] = this.classList.contains('active');
    saveAppSettings();
  });

  bindToggle('#set-blogger', 'bloggerMode');
  bindToggle('#set-price-cards', 'showPriceInCards');
  bindToggle('#set-price-detail', 'showPriceInDetail');
  bindToggle('#set-price-stats', 'showPriceInStats');
  bindToggle('#set-confetti', 'confetti');
  bindToggle('#set-sound', 'sound');

  mc.querySelector('#set-currency').addEventListener('change', function() {
    S.settings.defaultCurrency = this.value; saveAppSettings();
  });
  mc.querySelector('#set-platform').addEventListener('change', function() {
    S.settings.defaultPlatform = this.value; saveAppSettings();
  });

  // Обновление курсов
  bind('#set-rates-update', async () => {
    const status = mc.querySelector('#set-rates-update');
    status.textContent = '⏳ Обновляю...';
    try {
      const r = await fetch('https://open.er-api.com/v6/latest/RUB');
      const data = await r.json();
      if (data.rates) {
        S.settings.exchangeRates = {
          USD: +(1 / data.rates.USD).toFixed(2),
          EUR: +(1 / data.rates.EUR).toFixed(2),
          KZT: +(1 / data.rates.KZT).toFixed(3),
          UAH: +(1 / data.rates.UAH).toFixed(2),
          GBP: +(1 / data.rates.GBP).toFixed(2),
        };
        S.settings.ratesUpdated = new Date().toLocaleDateString('ru-RU');
        await saveAppSettings();
        showToast('✅ Курсы обновлены', 'success');
        renderSettingsTab();
      }
    } catch {
      status.textContent = '🔄 Обновить курсы';
      showToast('❌ Нет интернета', 'error');
    }
  });

  // Цвета тегов
  mc.querySelectorAll('[data-tag-color]').forEach(inp => {
    inp.addEventListener('change', async () => {
      const tag = S.tags.find(t => t.name === inp.dataset.tagColor);
      if (tag) { tag.color = inp.value; await putTag(tag); S.tags = await loadTags(); }
    });
  });
  mc.querySelectorAll('[data-tag-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (confirm(`Удалить тег «${btn.dataset.tagDel}»?`)) {
        await delTag(btn.dataset.tagDel);
        S.tags = await loadTags();
        renderSettingsTab();
      }
    });
  });

  // ЛитРес тест
  bind('#set-lr-test', async () => {
    const appId = mc.querySelector('#set-lr-appid').value.trim();
    const secret = mc.querySelector('#set-lr-secret').value.trim();
    const status = mc.querySelector('#set-lr-status');
    if (!appId || !secret) { status.textContent = '⚠️ Заполните оба поля'; return; }
    status.textContent = '⏳ Проверяю...';
    try {
      const results = await searchBooks('Пушкин', { appId, secretKey: secret });
      status.textContent = results.length > 0 ? `✅ Найдено: «${results[0].title}»` : '⚠️ Нет результатов';
    } catch { status.textContent = '❌ Ошибка'; }
  });

  // OCR проверка
  bind('#set-ocr-check', async () => {
    const status = mc.querySelector('#set-ocr-status');
    status.textContent = '⏳ Проверяю...';
    const r = await checkOcrSupport();
    status.textContent = r.ok ? '✅ Файлы OCR на месте' : '❌ ' + r.error;
  });

  // Экспорт / импорт
  bind('#set-export', async () => {
    const data = await exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `booktracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    showToast('📤 Экспортировано', 'success');
  });

  const importFile = mc.querySelector('#set-import-file');
  bind('#set-import', () => importFile.click());
  importFile.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await importAll(JSON.parse(await file.text()));
      await refreshData();
      showToast('📥 Импортировано', 'success');
    } catch { showToast('❌ Ошибка импорта', 'error'); }
  });

  bind('#set-clear', async () => {
    if (confirm('Удалить ВСЕ данные? Это необратимо!')) {
      const db = await openDB();
      ['books','covers','settings','collections','challenges','tags'].forEach(st => {
        try { db.transaction(st, 'readwrite').objectStore(st).clear(); } catch {}
      });
      await refreshData();
      showToast('🗑️ Всё удалено', 'info');
    }
  });

  getDBSize().then(size => { const el = mc.querySelector('#set-dbsize'); if (el) el.textContent = size; });
}

async function saveAppSettings() {
  const g = (id) => document.querySelector(id);
  if (g('#set-lr-appid')) S.settings.lrAppId = g('#set-lr-appid').value.trim();
  if (g('#set-lr-secret')) S.settings.lrSecret = g('#set-lr-secret').value.trim();
  if (g('#set-lr-pid')) S.settings.lrPartnerId = g('#set-lr-pid').value.trim();
  if (g('#set-lr-psecret')) S.settings.lrPartnerSecret = g('#set-lr-psecret').value.trim();
  await saveSettings(S.settings);
}

// ═══════════════════════════════════════════════
//  КОНСТАНТЫ (для других модулей)
// ═══════════════════════════════════════════════

export const CONTENT_ICONS = {
  unboxing: '📦', read_with_me: '📖', review: '💬', lipsync: '🎵',
  top: '🏆', quote: '✨', comparison: '⚖️', haul: '🛒'
};
export const CONTENT_LABELS = {
  unboxing: 'Распаковка', read_with_me: 'Начни читать со мной', review: 'Отзыв / Мнение',
  lipsync: 'Липсинг', top: 'Подборка / Топ', quote: 'Цитата', comparison: 'Сравнение', haul: 'Книжный haul'
};
export const CONTENT_STATUS_LABELS = {
  idea: '💡 Идея', planned: '📅 Запланировано', filming: '🎥 Снимаю',
  editing: '✂️ Монтаж', published: '📤 Опубликовано'
};
export const PLATFORM_LABELS = {
  youtube: '▶️ YouTube', tiktok: '🎵 TikTok', telegram: '✈️ Telegram',
  vk: '🔵 VK', dzen: '📰 Дзен', instagram: '📸 Instagram'
};

// ═══════════════════════════════════════════════
//  ЦЕНА: форматирование и конвертация
// ═══════════════════════════════════════════════

export function formatPrice(price) {
  if (!price || !price.amount) return '';
  const cur = CURRENCIES[price.currency] || CURRENCIES.RUB;
  return `${price.amount.toLocaleString('ru')} ${cur.symbol}`;
}

export function convertToDefault(price, settings) {
  if (!price || !price.amount) return null;
  const rates = settings.exchangeRates || {};
  const toRub = price.currency === 'RUB' ? price.amount : price.amount * (rates[price.currency] || 1);
  const def = settings.defaultCurrency;
  if (def === 'RUB') return { amount: Math.round(toRub), currency: 'RUB' };
  return { amount: Math.round(toRub / (rates[def] || 1)), currency: def };
}

// ═══════════════════════════════════════════════
//  УТИЛИТЫ UI
// ═══════════════════════════════════════════════

function toggleDrawer(open) {
  DOM.drawer.classList.toggle('open', open);
  DOM.backdrop.classList.toggle('active', open);
}

function openOverlay(el) { el.classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
function closeOverlay(el) { el.classList.add('hidden'); document.body.style.overflow = ''; }

let toastTimer = null;
export function showToast(msg, type = 'info') {
  DOM.toast.textContent = msg;
  DOM.toast.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => DOM.toast.classList.remove('show'), 3000);
}

let loadingEl = null;
function showLoading(text = 'Загрузка...') {
  hideLoading();
  loadingEl = document.createElement('div');
  loadingEl.className = 'loading-overlay';
  loadingEl.innerHTML = `<div class="spinner"></div><div class="loading-text">${text}</div>`;
  document.body.appendChild(loadingEl);
}
function updateLoading(text) { if (loadingEl) loadingEl.querySelector('.loading-text').textContent = text; }
function hideLoading() { if (loadingEl) { loadingEl.remove(); loadingEl = null; } }

export function esc(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
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

  const colors = ['#e8a33d','#94b878','#d98aa8','#7fb8b0','#b092d6','#e0955c','#f0e7d8'];
  const particles = [];
  for (let i = 0; i < 140; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * 220,
      w: 6 + Math.random() * 6, h: 4 + Math.random() * 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      vx: (Math.random() - 0.5) * 4.5,
      vy: 2 + Math.random() * 4.5,
      rot: Math.random() * 360, vr: (Math.random() - 0.5) * 11,
      life: 1,
    });
  }

  let frame = 0;
  (function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    for (const p of particles) {
      if (p.life <= 0) continue;
      alive = true;
      p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.rot += p.vr; p.life -= 0.005;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rot * Math.PI) / 180);
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    frame++;
    if (alive && frame < 300) requestAnimationFrame(animate);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  })();
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