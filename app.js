// ─────────────────────────────────────────────
// 📦 BookTrackerPro — app.js
// 🔖 v3.5.0 | 2026-08-02
// 📝 Точка входа: навигация, рендеринг, события
//
//    ⚠️ ВАЖНО ПРИ КОПИРОВАНИИ: нигде в этом файле нет
//    переноса строки ВНУТРИ одинарных/двойных кавычек.
//    Все переносы — только внутри template-literal (`...`).
//    Если после вставки сайт «голый» — проверь, что редактор
//    не развернул '\n' в живой Enter (корень бага 3.4.2).
//
//    Новое в 3.5.0:
//      — Поиск вынесен в search.js (контракт onOpen* + getData)
//      — Иконки из icons.js (SVG вместо эмодзи в хроме)
//      — Обложки: валидация blob, фоновая загрузка (8с),
//        referrerPolicy no-referrer, repairCovers() при старте,
//        onerror-фолбэк blob → URL → генеративный плейсхолдер
//      — Read-only карточка контента (openContentCard) со степпером
//      — Жест «назад» (History API) + двойной «назад» для выхода
//      — «Копировать отзыв» в карточке книги
//      — Самодиагностика DOM + экранный репортёр ошибок
//
// ⚠️ ТЕСТОВЫЕ КЛЮЧИ ЛИТРЕС (замените в Настройках):
//    Partner: partner_id=16, secret=93w4jfhs8imksGo-oa3s85d6Akmkkbnsi9
// ─────────────────────────────────────────────
import {
  openDB, loadBooks, putBook, delBook, loadSettings, saveSettings,
  saveCover, deleteCover, changeBookStatus,
  BOOK_STATUSES, CURRENCIES,
  loadCollections, loadChallenges, loadTags, putTag, delTag,
  moveCollection, getNextCollectionOrder,
  exportAll, importAll, getDBSize,
  repairCovers, isValidCoverBlob
} from './db.js';
import {
  validateISBN, cleanISBN, fetchBookByIsbn, searchBooks, fetchBookFromUrl,
  isRussianISBN, formatISBN
} from './isbn.js';
import { startScanner, stopScanner } from './scanner.js';
import {
  renderContentTab, openContentForm, deleteContentItem, updateContentStatus,
  CONTENT_TYPES, CONTENT_STATUSES
} from './content.js';
import { renderReviewsTab, openReviewForm, deleteReview, copyReviewToClipboard } from './review.js';
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
import { checkMicrolinkStatus, clearPreviewCache } from './microlink.js';
import { registerSW, setupOnlineIndicator } from './sw-register.js';
import { initSearch, toggleSearch, closeSearch, isSearchOpen } from './search.js';
import {
  icon, statusIcon, contentTypeIcon, brandIcon,
  STATUS_ICONS, CONTENT_TYPE_ICONS, CONTENT_STATUS_ICONS
} from './icons.js';

// ═══════════════════════════════════════════════
//  СОСТОЯНИЕ
// ═══════════════════════════════════════════════
const S = {
  books: [],
  collections: [],
  challenges: [],
  tags: [],
  settings: {
    lrAppId: '', lrSecret: '',
    lrPartnerId: '16',
    lrPartnerSecret: '93w4jfhs8imksGo-oa3s85d6Akmkkbnsi9',
    microlinkApiKey: '',
    confetti: true, sound: true,
    defaultPlatform: 'youtube',
    bloggerMode: true,
    defaultCurrency: 'RUB',
    showPriceInCards: true,
    showPriceInDetail: true,
    showPriceInStats: true,
    exchangeRates: { USD: 90, EUR: 98, KZT: 0.18, UAH: 2.2, GBP: 115 },
    ratesUpdated: '',
  },
  currentTab: 'books',
  bookFilter: 'all',
  editingBookId: null,
  activeFilter: null,
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
   'search-toggle','search-bar','search-input','search-close',
   'search-scopes','search-book-tags','search-results',
   'add-btn','scan-btn',
   'form-overlay','form-title','form-close','form-body',
   'detail-overlay','detail-title','detail-close','detail-body',
   'scanner-overlay','scanner-video','scanner-status','scanner-close',
   'scanner-manual-input','scanner-manual-btn',
   'content-overlay','content-form-title','content-form-close','content-form-body',
   'review-overlay','review-form-title','review-form-close','review-form-body',
   'cover-overlay','cover-close','cover-viewer-img','cover-viewer-title',
   'cover-photo-btn','cover-photo-input','cover-gallery-btn','cover-gallery-input',
   'toast','confetti-canvas','update-banner','install-banner',
   'drawer-version','drawer-offline','active-filters',
   'drawer-collections','drawer-series','drawer-filters','drawer-add-collection',
   'drawer-title-collections','drawer-title-series','drawer-title-filters',
   'nav-count-books','nav-count-content','nav-count-reviews','nav-count-challenges'
  ].forEach(id => { DOM[camel(id)] = document.getElementById(id); });
}
function camel(s) { return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }

// ═══════════════════════════════════════════════
//  ИНИЦИАЛИЗАЦИЯ
// ═══════════════════════════════════════════════
async function init() {
  cacheDom();
  verifyDom();
  setupErrorReporter();
  bindEvents();
  await openDB();

  const repaired = await repairCovers();
  if (repaired > 0) console.log('[Cover] Удалено битых обложек: ' + repaired);

  S.books = await loadBooks();
  S.collections = await loadCollections();
  S.challenges = await loadChallenges();
  S.tags = await loadTags();
  const saved = await loadSettings();
  if (saved) Object.assign(S.settings, saved);

  try {
    const v = await (await fetch('version.json')).json();
    if (DOM.drawerVersion) DOM.drawerVersion.textContent = 'v' + v.version;
  } catch { /* offline */ }

  registerSW();
  setupOnlineIndicator(showToast);
  setupInstallPrompt();
  setupBackGesture();
  updateOfflineIndicator();
  injectNavIcons();
  renderDrawer();
  renderTab('books');

  // Контракт search.js v3.5.0: getData + именованные onOpen*
  initSearch({
    getData: () => ({
      books: S.books, collections: S.collections,
      challenges: S.challenges, tags: S.tags,
      series: getSeriesList(S.books),
    }),
    onOpenBook: openBookDetail,
    onOpenContent: (bookId, contentId) => {
      const book = S.books.find(b => b.id === bookId);
      const item = (book?.contentItems || []).find(c => c.id === contentId);
      if (item) openContentCard(item, bookId);
    },
    onOpenCollection: (id) => { S.openCollection = id; renderTab('collections'); },
    onOpenChallenge: (id) => { S.openChallenge = id; renderTab('challenges'); },
    onOpenSeries: (name) => { S.openSeries = name; renderTab('series'); },
    onFilterTag: (name) => { S.activeFilter = { type: 'tag', value: name }; renderTab('books'); },
  });

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
  if (!DOM.drawerOffline) return;
  DOM.drawerOffline.classList.toggle('hidden', navigator.onLine);
  window.addEventListener('offline', () => DOM.drawerOffline.classList.remove('hidden'));
  window.addEventListener('online', () => DOM.drawerOffline.classList.add('hidden'));
}

// ═══════════════════════════════════════════════
//  САМОДИАГНОСТИКА + РЕПОРТЁР ОШИБОК
// ═══════════════════════════════════════════════
function verifyDom() {
  const missing = Object.entries(DOM).filter(([, el]) => !el).map(([k]) => k);
  if (missing.length) console.warn('[DOM] Отсутствуют элементы: ' + missing.join(', '));
}
function setupErrorReporter() {
  window.addEventListener('error', (e) => {
    console.error('[Error]', e.message);
    showToast('⚠️ ' + (e.message || 'Ошибка'), 'error');
  });
  window.addEventListener('unhandledrejection', (e) => {
    console.error('[Promise]', e.reason);
    showToast('⚠️ ' + (e.reason?.message || 'Ошибка'), 'error');
  });
}

// ═══════════════════════════════════════════════
//  ЖЕСТ «НАЗАД» (History API)
// ═══════════════════════════════════════════════
let _backStack = [];
let _poppingState = false;
let _exitArmed = false;
let _exitTimer = null;

function setupBackGesture() {
  history.replaceState({ btpBase: true }, '');
  history.pushState({ btpSentinel: true }, '');
  window.addEventListener('popstate', () => {
    if (_poppingState) { _poppingState = false; return; }
    if (_backStack.length > 0) {
      const el = _backStack.pop();
      hideOverlayEl(el);
      return;
    }
    if (!_exitArmed) {
      _exitArmed = true;
      showToast('🚪 Нажмите ещё раз для выхода', 'info');
      clearTimeout(_exitTimer);
      _exitTimer = setTimeout(() => {
        _exitArmed = false;
        if (_backStack.length === 0) history.pushState({ btpSentinel: true }, '');
      }, 2000);
    }
  });
}
function trackOverlay(el) {
  _backStack.push(el);
  history.pushState({ btpOverlay: true }, '');
}
function untrackOverlay(el) {
  const idx = _backStack.lastIndexOf(el);
  if (idx >= 0) {
    _backStack.splice(idx, 1);
    _poppingState = true;
    history.back();
  }
}
function hideOverlayEl(el) {
  if (!el) return;
  el.classList.add('hidden');
  if (el === DOM.scannerOverlay) stopScanner();
  restoreScrollIfFree();
}
function restoreScrollIfFree() {
  const anyOpen = [...document.querySelectorAll('.overlay')].some(o => !o.classList.contains('hidden'))
    || (DOM.drawer && DOM.drawer.classList.contains('open'));
  if (!anyOpen) document.body.style.overflow = '';
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
      closeSearch();
      S.activeFilter = null;
      S.openSeries = null; S.openCollection = null; S.openChallenge = null;
      renderTab(btn.dataset.tab);
      toggleDrawer(false);
    });
  });

  if (DOM.drawerTitleCollections) DOM.drawerTitleCollections.addEventListener('click', () => {
    closeSearch(); S.openCollection = null; renderTab('collections'); toggleDrawer(false);
  });
  if (DOM.drawerTitleSeries) DOM.drawerTitleSeries.addEventListener('click', () => {
    closeSearch(); S.openSeries = null; renderTab('series'); toggleDrawer(false);
  });
  if (DOM.drawerTitleFilters) DOM.drawerTitleFilters.addEventListener('click', () => {
    closeSearch(); S.activeFilter = null; renderTab('books'); toggleDrawer(false);
  });
  DOM.drawerAddCollection.addEventListener('click', () => {
    toggleDrawer(false);
    openCollectionForm(null, async (data) => {
      data.order = await getNextCollectionOrder();
      await createCollection(data);
      await refreshData();
      showToast('✅ Подборка создана', 'success');
    });
  });

  // Лупа — один слушатель, делегировано search.js
  DOM.searchToggle.addEventListener('click', toggleSearch);

  DOM.addBtn.addEventListener('click', () => openBookForm());
  DOM.scanBtn.addEventListener('click', () => openScanner());

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

  DOM.scannerManualBtn.addEventListener('click', () => {
    const v = DOM.scannerManualInput.value.trim();
    if (v) handleIsbnLookup(v);
  });
  DOM.scannerManualInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const v = DOM.scannerManualInput.value.trim(); if (v) handleIsbnLookup(v); }
  });

  DOM.coverPhotoBtn.addEventListener('click', () => DOM.coverPhotoInput.click());
  DOM.coverPhotoInput.addEventListener('change', handleCoverPhotoChange);
  DOM.coverGalleryBtn.addEventListener('click', () => DOM.coverGalleryInput.click());
  DOM.coverGalleryInput.addEventListener('change', handleCoverPhotoChange);

  const updApply = $('#update-apply');
  if (updApply) updApply.addEventListener('click', () => {
    navigator.serviceWorker?.getRegistration().then(r => r?.waiting?.postMessage('SKIP_WAITING'));
    DOM.updateBanner.classList.add('hidden');
  });
  const updDismiss = $('#update-dismiss');
  if (updDismiss) updDismiss.addEventListener('click', () => DOM.updateBanner.classList.add('hidden'));
  const instApply = $('#install-apply');
  if (instApply) instApply.addEventListener('click', () => {
    if (S.deferredPrompt) { S.deferredPrompt.prompt(); S.deferredPrompt = null; DOM.installBanner.classList.add('hidden'); }
  });
  const instDismiss = $('#install-dismiss');
  if (instDismiss) instDismiss.addEventListener('click', () => DOM.installBanner.classList.add('hidden'));

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!DOM.scannerOverlay.classList.contains('hidden')) closeScanner();
    else if (!DOM.coverOverlay.classList.contains('hidden')) closeOverlay(DOM.coverOverlay);
    else if (!DOM.formOverlay.classList.contains('hidden')) closeOverlay(DOM.formOverlay);
    else if (!DOM.detailOverlay.classList.contains('hidden')) closeOverlay(DOM.detailOverlay);
    else if (!DOM.contentOverlay.classList.contains('hidden')) closeOverlay(DOM.contentOverlay);
    else if (!DOM.reviewOverlay.classList.contains('hidden')) closeOverlay(DOM.reviewOverlay);
    else if (isSearchOpen()) closeSearch();
    else if (DOM.drawer.classList.contains('open')) toggleDrawer(false);
    closeStatusDropdown();
  });

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
  books: 'Мои книги', content: 'Контент-план', reviews: 'Отзывы',
  calendar: 'Календарь', challenges: 'Челленджи', stats: 'Статистика',
  settings: 'Настройки', series: 'Серии', collections: 'Подборки',
};
const TAB_ICONS = {
  books: 'library', content: 'film', reviews: 'pen', calendar: 'calendar',
  challenges: 'trophy', stats: 'chart', settings: 'gear', series: 'layers', collections: 'folder',
};
function renderTab(tab) {
  closeSearch();
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
      onDayClick: () => {}, onAdd: () => openContentForm(null, null),
      onOpenContent: (item, bookId) => openContentCard(item, bookId),
    }); break;
    case 'challenges': renderChallenges(); break;
    case 'stats': renderStatsTab(mc, S.books, S.settings, S.challenges); break;
    case 'settings': renderSettingsTab(); break;
    case 'series': renderSeriesScreen(); break;
    case 'collections': renderCollectionsScreen(); break;
  }
}

function injectNavIcons() {
  $$('.nav-item[data-tab]').forEach(btn => {
    const ic = btn.querySelector('.nav-icon');
    const name = TAB_ICONS[btn.dataset.tab];
    if (ic && name) ic.innerHTML = icon(name, 20);
  });
}

// ═══════════════════════════════════════════════
//  DRAWER
// ═══════════════════════════════════════════════
function renderDrawer() {
  DOM.navCountBooks.textContent = S.books.length || '';
  DOM.navCountContent.textContent = S.books.reduce((s, b) => s + (b.contentItems || []).length, 0) || '';
  DOM.navCountReviews.textContent = S.books.filter(b => b.review?.text || b.review?.rating > 0).length || '';
  DOM.navCountChallenges.textContent = S.challenges.filter(c => c.status === 'active').length || '';

  DOM.drawerCollections.innerHTML = S.collections.map(c =>
    '<button class="nav-item sub" data-collection="' + c.id + '">' +
    '<span class="nav-icon">' + c.emoji + '</span> ' + esc(c.name) +
    '<span class="nav-count">' + c.bookIds.length + '</span></button>'
  ).join('');
  DOM.drawerCollections.querySelectorAll('[data-collection]').forEach(btn => {
    btn.addEventListener('click', () => {
      S.openCollection = btn.dataset.collection;
      S.currentTab = 'collections';
      renderTab('collections');
      toggleDrawer(false);
    });
  });

  const series = getSeriesList(S.books);
  DOM.drawerSeries.innerHTML = series.length === 0
    ? '<div style="padding:4px 14px 8px;font-size:.78rem;color:var(--text-muted)">Нет серий</div>'
    : series.map(s =>
        '<button class="nav-item sub" data-series="' + esc(s.name) + '">' +
        '<span class="nav-icon">' + s.emoji + '</span> ' +
        '<span class="truncate" style="flex:1">' + esc(s.name) + '</span>' +
        '<span class="nav-count">' + s.read + '/' + s.effectiveTotal + '</span></button>'
      ).join('');
  DOM.drawerSeries.querySelectorAll('[data-series]').forEach(btn => {
    btn.addEventListener('click', () => {
      S.openSeries = btn.dataset.series;
      S.currentTab = 'series';
      renderTab('series');
      toggleDrawer(false);
    });
  });

  DOM.drawerFilters.innerHTML = renderDrawerFilters(S.books);
  DOM.drawerFilters.querySelectorAll('.drawer-filter-toggle').forEach(t => {
    t.addEventListener('click', () => {
      t.classList.toggle('open');
      const items = DOM.drawerFilters.querySelector('[data-fitems="' + t.dataset.ftoggle + '"]');
      if (items) items.classList.toggle('hidden');
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
  const icons = { tag: 'tag', collection: 'folder', series: 'layers', genre: 'folder', author: 'users', publisher: 'folder' };
  el.classList.remove('hidden');
  el.innerHTML =
    '<span class="active-filter-chip">' +
    icon(icons[S.activeFilter.type] || 'filter', 13) + ' ' + esc(S.activeFilter.value) +
    '<button id="clear-filter">' + icon('close', 11) + '</button></span>';
  el.querySelector('#clear-filter').addEventListener('click', () => {
    S.activeFilter = null;
    renderTab(S.currentTab);
  });
}

// ═══════════════════════════════════════════════
//  ГЕНЕРАТИВНЫЙ ПЛЕЙСХОЛДЕР ОБЛОЖКИ
// ═══════════════════════════════════════════════
const PLACEHOLDER_GRADIENTS = [
  ['#3a2c1f','#5a422e'], ['#2e3a2c','#425a40'], ['#3a2c35','#5a4052'],
  ['#2c333a','#40505a'], ['#35302a','#554a3c'], ['#2a2f3a','#3e4a5c'],
  ['#3a2a2a','#5c3e3e'], ['#303a2a','#4a5c3c'],
];
function coverPlaceholder(book, cls) {
  let h = 0;
  const key = book.title || 'книга';
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const pair = PLACEHOLDER_GRADIENTS[h % PLACEHOLDER_GRADIENTS.length];
  const short = key.length > 40 ? key.slice(0, 40) + '…' : key;
  return '<div class="' + cls + '" style="background:linear-gradient(150deg,' + pair[0] + ',' + pair[1] + ')">' +
    '<span class="ph-spine"></span><span class="ph-title">' + esc(short) + '</span></div>';
}
window.__bookCoverFallback = function (img) {
  const card = img.closest('.book-card');
  const id = card ? card.dataset.id : null;
  const book = S.books.find(b => b.id === id);
  return book ? coverPlaceholder(book, 'book-cover-placeholder') : '';
};

// ═══════════════════════════════════════════════
//  ВКЛАДКА: КНИГИ
// ═══════════════════════════════════════════════
function renderBooksTab() {
  const mc = DOM.mainContent;
  let books = [...S.books];
  const filters = [
    { id: 'all', label: 'Все' },
    { id: 'wishlist', label: 'Wishlist' },
    { id: 'added', label: 'Добавлено' },
    { id: 'reading', label: 'Читаю' },
    { id: 'finished', label: 'Прочитано' },
    { id: 'paused', label: 'Пауза' },
    { id: 'dropped', label: 'Брошено' },
    { id: 'pr', label: 'PR' },
  ];
  if (S.activeFilter) {
    const type = S.activeFilter.type, value = S.activeFilter.value;
    if (type === 'tag') books = books.filter(b => (b.tags || []).includes(value));
    else if (type === 'genre') books = books.filter(b => b.genre === value);
    else if (type === 'author') books = books.filter(b => b.author === value);
    else if (type === 'publisher') books = books.filter(b => b.publisher === value);
    else if (type === 'series') books = books.filter(b => b.series === value);
    else if (type === 'collection') {
      const col = S.collections.find(c => c.id === value);
      books = col ? books.filter(b => col.bookIds.includes(b.id)) : [];
    }
  } else if (S.bookFilter === 'pr') books = books.filter(b => b.isPR);
  else if (S.bookFilter !== 'all') books = books.filter(b => b.status === S.bookFilter);
  books.sort((a, b) => (b.dateAdded || '').localeCompare(a.dateAdded || ''));

  mc.innerHTML =
    '<div class="filter-bar no-scrollbar">' +
    filters.map(f =>
      '<button class="filter-chip ' + (S.bookFilter === f.id && !S.activeFilter ? 'active' : '') +
      '" data-filter="' + f.id + '">' +
      (f.id !== 'all' ? statusIcon(f.id, 12) + ' ' : '') + f.label + '</button>'
    ).join('') +
    '</div><div class="book-list">' +
    (books.length === 0 ? renderEmptyBooks() : books.map(renderBookCard).join('')) +
    '</div>';

  mc.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      S.activeFilter = null;
      S.bookFilter = chip.dataset.filter;
      renderBooksTab();
    });
  });
  mc.querySelectorAll('.book-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.status-btn')) return;
      if (e.target.closest('.tag-chip')) return;
      openBookDetail(card.dataset.id);
    });
  });
  mc.querySelectorAll('.status-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openStatusDropdown(btn, btn.dataset.bookId);
    });
  });
  mc.querySelectorAll('.tag-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      S.activeFilter = { type: 'tag', value: chip.dataset.tag };
      renderBooksTab();
    });
  });
}

function renderEmptyBooks() {
  return '<div class="empty-state"><div class="empty-icon">' + icon('library', 56) + '</div>' +
    '<div class="empty-title">Пока нет книг</div>' +
    '<div class="empty-text">Нажмите ＋ чтобы добавить книгу, ' + icon('camera', 14) +
    ' чтобы отсканировать ISBN, или найдите книгу в интернете</div></div>';
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
    ? '<img class="book-cover" src="' + book.coverUrl + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML=window.__bookCoverFallback(this)"/>'
    : coverPlaceholder(book, 'book-cover-placeholder');
  const priceHtml = (S.settings.showPriceInCards && book.price?.amount > 0)
    ? '<span class="book-badge badge-price">' + icon('coin', 11) + ' ' + formatPrice(book.price) + '</span>' : '';
  const seriesHtml = book.series
    ? '<span class="book-badge badge-series">' + icon('layers', 11) + ' ' + esc(book.series) + (book.seriesNumber ? ' #' + book.seriesNumber : '') + '</span>' : '';
  const tagsHtml = (book.tags || []).slice(0, 3).map(t => {
    const tag = S.tags.find(x => x.name === t);
    const color = tag?.color || 'var(--text-secondary)';
    return '<span class="tag-chip" data-tag="' + esc(t) + '" style="color:' + color + ';border-color:' + color + '40">' + esc(t) + '</span>';
  }).join('');

  return '<div class="book-card" data-id="' + book.id + '">' + coverHtml +
    '<div class="book-info"><div class="book-title">' + esc(book.title) + '</div>' +
    '<div class="book-author">' + esc(book.author) + '</div>' +
    '<div class="book-meta">' +
    '<button class="book-badge ' + statusClass + ' status-btn" data-book-id="' + book.id + '">' +
    statusIcon(book.status, 13) + ' ' + st.label + ' ' + icon('chevronDown', 10) + '</button>' +
    (book.isPR ? '<span class="book-badge badge-pr">' + icon('box', 11) + ' PR</span>' : '') +
    seriesHtml + priceHtml +
    (contentCount > 0 ? '<span class="book-badge badge-content">' + icon('film', 11) + ' ' + contentCount + (publishedCount ? ' · ' + icon('send', 10) + publishedCount : '') + '</span>' : '') +
    (book.review?.rating > 0 ? '<span class="book-badge badge-rating">' + '⭐'.repeat(book.review.rating) + '</span>' : '') +
    (book.jointReading?.active ? '<span class="book-badge badge-content">' + icon('users', 11) + ' совместно</span>' : '') +
    '</div>' +
    (tagsHtml ? '<div class="book-meta">' + tagsHtml + '</div>' : '') +
    (book.status === 'reading' && book.pageCount > 0 ? '<div class="book-progress"><div class="book-progress-fill" style="width:' + progress + '%"></div></div>' : '') +
    '</div></div>';
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
  dd.innerHTML = Object.entries(BOOK_STATUSES).map(([key, st]) =>
    '<button class="status-dropdown-item ' + (book.status === key ? 'current' : '') + '" data-status="' + key + '">' +
    '<span>' + statusIcon(key, 16) + '</span> ' + st.label +
    (book.status === key ? '<span style="margin-left:auto">' + icon('check', 14) + '</span>' : '') +
    '</button>'
  ).join('');
  document.body.appendChild(dd);
  _statusDropdown = dd;
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
      else showToast(BOOK_STATUSES[newStatus].label, 'success');
    });
  });
}
function closeStatusDropdown() {
  if (_statusDropdown) { _statusDropdown.remove(); _statusDropdown = null; }
}

// ═══════════════════════════════════════════════
//  МОДАЛКА ОЦЕНКИ
// ═══════════════════════════════════════════════
function openRatingModal(book) {
  const isDropped = book.status === 'dropped';
  const modal = document.createElement('div');
  modal.className = 'rating-modal';
  modal.innerHTML =
    '<div class="rating-modal-panel">' +
    '<div class="rating-modal-emoji">' + (isDropped ? icon('xCircle', 44) : icon('sparkles', 44)) + '</div>' +
    '<div class="rating-modal-title">' + (isDropped ? 'Книга брошена' : 'Поздравляю, прочитано!') + '</div>' +
    '<div class="rating-modal-book">«' + esc(book.title) + '»' + (book.readingDays ? ' · ' + book.readingDays + ' дн.' : '') + '</div>' +
    '<div class="star-rating" id="rm-stars">' +
    [1,2,3,4,5].map(i => '<span class="star" data-star="' + i + '">★</span>').join('') +
    '</div>' +
    '<div class="btn-group" style="margin-top:0"><button id="rm-review" class="btn-primary">' +
    (book.review?.text || book.review?.rating > 0 ? 'Дополнить отзыв' : 'Написать отзыв') +
    '</button></div>' +
    '<button id="rm-later" class="btn-secondary mt-8" style="width:100%">Позже</button></div>';
  document.body.appendChild(modal);
  let rating = 0;
  const stars = modal.querySelector('#rm-stars');
  stars.querySelectorAll('.star').forEach(star => {
    star.addEventListener('click', async () => {
      rating = parseInt(star.dataset.star);
      stars.querySelectorAll('.star').forEach(s => s.classList.toggle('filled', parseInt(s.dataset.star) <= rating));
      book.review = book.review || {};
      book.review.rating = rating;
      await putBook(book);
    });
    star.addEventListener('mouseenter', () => {
      const v = parseInt(star.dataset.star);
      stars.querySelectorAll('.star').forEach(s => s.classList.toggle('filled', parseInt(s.dataset.star) <= v));
    });
  });
  stars.addEventListener('mouseleave', () => {
    stars.querySelectorAll('.star').forEach(s => s.classList.toggle('filled', parseInt(s.dataset.star) <= rating));
  });
  const close = () => { modal.remove(); refreshData(); };
  modal.querySelector('#rm-later').addEventListener('click', close);
  modal.querySelector('#rm-review').addEventListener('click', () => { modal.remove(); openReviewForm(book.id); });
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
}

// ═══════════════════════════════════════════════
//  ФОРМА КНИГИ
// ═══════════════════════════════════════════════
function openBookForm(book = null) {
  S.editingBookId = book?.id || null;
  DOM.formTitle.textContent = book ? 'Редактировать книгу' : 'Новая книга';
  const b = book || {};
  const cur = b.price?.currency || S.settings.defaultCurrency;
  const selectedTags = new Set(b.tags || []);
  const coverVal = esc(b.cover || (b.coverUrl?.startsWith('http') ? b.coverUrl : '') || '');

  DOM.formBody.innerHTML =
    '<div class="form-group"><label>' + icon('scan', 13) + ' Найти по ISBN</label>' +
    '<div class="flex gap-8"><input type="text" id="bf-isbn" value="' + esc(b.isbn || '') + '" placeholder="978-5-17-098765-8" inputmode="numeric"/>' +
    '<button id="bf-scan" class="btn-secondary" style="width:auto;flex-shrink:0">' + icon('camera', 16) + '</button>' +
    '<button id="bf-find" class="btn-secondary" style="width:auto;flex-shrink:0">Найти</button></div></div>' +
    '<div class="form-group"><label>' + icon('globe', 13) + ' Поиск книги в интернете</label>' +
    '<div class="flex gap-8"><input type="text" id="bf-webquery" placeholder="Название и автор, напр. «Мастер и Маргарита Булгаков»"/>' +
    '<button id="bf-websearch" class="btn-secondary" style="width:auto;flex-shrink:0">' + icon('search', 15) + ' Искать</button></div>' +
    '<div id="bf-webresults" class="web-search-results"></div></div>' +
    '<div class="form-group"><label>' + icon('link', 13) + ' Или вставьте ссылку на страницу книги</label>' +
    '<div class="flex gap-8"><input type="url" id="bf-page-url" placeholder="https://www.litres.ru/book/..."/>' +
    '<button id="bf-page-extract" class="btn-secondary" style="width:auto;flex-shrink:0">' + icon('download', 15) + '</button></div>' +
    '<div class="form-hint">ЛитРес, Book24, Ozon — данные извлекутся автоматически (Microlink)</div></div>' +
    '<div class="divider"></div>' +
    '<div class="form-group"><label>Название *</label><input type="text" id="bf-title" value="' + esc(b.title || '') + '" placeholder="Мастер и Маргарита" required/></div>' +
    '<div class="form-group"><label>Автор</label><input type="text" id="bf-author" value="' + esc(b.author || '') + '" placeholder="Михаил Булгаков"/></div>' +
    '<div class="form-row"><div class="form-group"><label>Жанр</label><input type="text" id="bf-genre" value="' + esc(b.genre || '') + '" placeholder="Классика"/></div>' +
    '<div class="form-group"><label>Издательство</label><input type="text" id="bf-publisher" value="' + esc(b.publisher || '') + '" placeholder="АСТ"/></div></div>' +
    '<div class="form-row-3"><div class="form-group"><label>Год</label><input type="text" id="bf-year" value="' + esc(b.publishedDate || '') + '" placeholder="2024"/></div>' +
    '<div class="form-group"><label>Страниц</label><input type="number" id="bf-pages" value="' + (b.pageCount || '') + '" placeholder="480" min="0"/></div>' +
    '<div class="form-group"><label>Возраст</label><input type="text" id="bf-age" value="' + esc(b.ageRating || '') + '" placeholder="16+"/></div></div>' +
    '<div class="form-group"><label>Описание</label><textarea id="bf-desc" rows="3" placeholder="Аннотация...">' + esc(b.description || '') + '</textarea></div>' +
    '<div class="form-group"><label>Обложка (URL)</label><input type="url" id="bf-cover" value="' + coverVal + '" placeholder="https://..."/>' +
    '<div id="bf-cover-preview" class="cover-preview hidden"><img id="bf-cover-preview-img" src="" alt="Предпросмотр обложки"/></div></div>' +
    '<div class="form-section"><h3>' + icon('layers', 15) + ' Серия</h3>' +
    '<div class="form-group"><label>Название серии</label><input type="text" id="bf-series" value="' + esc(b.series || '') + '" placeholder="Гарри Поттер" autocomplete="off"/></div>' +
    '<div class="form-row"><div class="form-group"><label>Номер в серии</label><input type="number" id="bf-series-num" value="' + (b.seriesNumber || '') + '" min="1" placeholder="1"/></div>' +
    '<div class="form-group"><label>Всего книг в серии</label><input type="number" id="bf-series-total" value="' + (b.seriesTotal || '') + '" min="1" placeholder="7"/></div></div></div>' +
    '<div class="form-section"><h3>' + icon('coin', 15) + ' Цена</h3><div class="form-row">' +
    '<div class="form-group"><label>Цена</label><input type="number" id="bf-price" value="' + (b.price?.amount || '') + '" min="0" placeholder="599"/></div>' +
    '<div class="form-group"><label>Валюта</label><select id="bf-currency">' +
    Object.entries(CURRENCIES).map(([k, c]) => '<option value="' + k + '"' + (cur === k ? ' selected' : '') + '>' + c.symbol + ' ' + c.name + '</option>').join('') +
    '</select></div></div></div>' +
    '<div class="form-section"><h3>' + icon('bookOpen', 15) + ' Статус</h3>' +
    '<div class="form-group"><label>Статус</label><select id="bf-status">' +
    Object.entries(BOOK_STATUSES).map(([k, st]) => '<option value="' + k + '"' + ((b.status || 'wishlist') === k ? ' selected' : '') + '>' + st.label + '</option>').join('') +
    '</select></div><div class="form-row">' +
    '<div class="form-group"><label>Текущая страница</label><input type="number" id="bf-page" value="' + (b.currentPage || 0) + '" min="0"/></div>' +
    '<div class="form-group"><label>Оценка (1–5)</label><input type="number" id="bf-rating" value="' + (b.rating || b.review?.rating || 0) + '" min="0" max="5"/></div></div></div>' +
    '<div class="form-section"><h3>' + icon('tag', 15) + ' Теги</h3>' +
    '<div class="form-group"><label>Существующие теги</label><div id="bf-tags-chips" class="tags-chips">' +
    (S.tags.length === 0
      ? '<span class="text-small text-muted">Тегов пока нет — добавьте новые ниже</span>'
      : S.tags.map(t => '<button class="tag-pick-chip ' + (selectedTags.has(t.name) ? 'active' : '') + '" data-tag="' + esc(t.name) + '" style="color:' + (t.color || 'var(--text-secondary)') + ';border-color:' + ((t.color || '#888') + '55') + '">' + esc(t.name) + '</button>').join('')) +
    '</div></div><div class="form-group"><label>Добавить новые (через запятую)</label>' +
    '<input type="text" id="bf-tags" value="" placeholder="фэнтези, бумажная, перечитать"/></div></div>' +
    '<div class="form-section"><h3>' + icon('film', 15) + ' Для блога</h3>' +
    '<div class="toggle-row"><span class="toggle-label">' + icon('box', 14) + ' Получена от издательства (PR)</span>' +
    '<div class="toggle ' + (b.isPR ? 'active' : '') + '" id="bf-pr-toggle"></div></div>' +
    '<div id="bf-pr-fields" class="' + (b.isPR ? '' : 'hidden') + '">' +
    '<div class="form-group"><label>От кого</label><input type="text" id="bf-received-from" value="' + esc(b.receivedFrom || '') + '" placeholder="Издательство ЭКСМО"/></div>' +
    '<div class="form-group"><label>Дата получения</label><input type="date" id="bf-received-date" value="' + (b.receivedDate || '') + '"/></div></div></div>' +
    '<div class="form-section"><h3>' + icon('users', 15) + ' Совместное чтение</h3>' +
    '<div class="toggle-row"><span class="toggle-label">Читаем вместе с кем-то</span>' +
    '<div class="toggle ' + (b.jointReading?.active ? 'active' : '') + '" id="bf-joint-toggle"></div></div>' +
    '<div id="bf-joint-fields" class="' + (b.jointReading?.active ? '' : 'hidden') + '">' +
    '<div class="form-group"><label>Участники (через запятую)</label><input type="text" id="bf-joint-people" value="' + esc((b.jointReading?.participants || []).join(', ')) + '" placeholder="Аня, Маша, Катя"/></div>' +
    '<div class="form-group"><label>Ссылка на чат</label><input type="url" id="bf-joint-chat" value="' + esc(b.jointReading?.chatLink || '') + '" placeholder="https://t.me/+..."/></div>' +
    '<div class="form-group"><label>Заметки</label><input type="text" id="bf-joint-notes" value="' + esc(b.jointReading?.notes || '') + '" placeholder="Читаем по 3 главы в день"/></div></div></div>' +
    '<div class="form-section"><h3>' + icon('edit', 15) + ' Заметки</h3>' +
    '<div class="form-group"><textarea id="bf-notes" rows="3" placeholder="Личные заметки...">' + esc(b.notes || '') + '</textarea></div></div>' +
    '<div class="btn-group"><button id="bf-save" class="btn-primary">' + icon('check', 16) + ' Сохранить</button>' +
    (book ? '<button id="bf-delete" class="btn-danger">' + icon('trash', 15) + ' Удалить</button>' : '') + '</div>';

  const fb = DOM.formBody;
  fb.querySelector('#bf-scan').addEventListener('click', () => { closeOverlay(DOM.formOverlay); openScanner(); });
  fb.querySelector('#bf-find').addEventListener('click', () => {
    const isbn = fb.querySelector('#bf-isbn').value.trim();
    if (isbn) handleIsbnLookup(isbn);
  });
  fb.querySelector('#bf-websearch').addEventListener('click', () => handleWebSearch());
  fb.querySelector('#bf-webquery').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleWebSearch(); });

  fb.querySelector('#bf-page-extract').addEventListener('click', async () => {
    const url = fb.querySelector('#bf-page-url').value.trim();
    if (!url) { showToast('⚠️ Вставьте ссылку на страницу книги', 'error'); return; }
    const btn = fb.querySelector('#bf-page-extract');
    btn.disabled = true;
    const data = await fetchBookFromUrl(url);
    btn.disabled = false;
    if (data && data.title) {
      fillFormFromResult(data);
      updateCoverPreview();
      showToast('✅ Извлечено: ' + data.title, 'success');
    } else {
      showToast('❌ Не удалось извлечь данные', 'error');
    }
  });

  function updateCoverPreview() {
    const url = fb.querySelector('#bf-cover').value.trim();
    const box = fb.querySelector('#bf-cover-preview');
    const img = fb.querySelector('#bf-cover-preview-img');
    if (url && /^https?:\/\//i.test(url)) { img.src = url; box.classList.remove('hidden'); }
    else { box.classList.add('hidden'); img.src = ''; }
  }
  fb.querySelector('#bf-cover').addEventListener('input', debounce(updateCoverPreview, 400));
  updateCoverPreview();
  fb._updateCoverPreview = updateCoverPreview;

  fb.querySelectorAll('.tag-pick-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const t = chip.dataset.tag;
      if (selectedTags.has(t)) selectedTags.delete(t); else selectedTags.add(t);
      chip.classList.toggle('active');
    });
  });

  attachSeriesAutocomplete(fb.querySelector('#bf-series'), S.books, (name) => {
    const total = getSeriesTotal(S.books, name);
    if (total && !fb.querySelector('#bf-series-total').value) fb.querySelector('#bf-series-total').value = total;
  });

  fb.querySelector('#bf-pr-toggle').addEventListener('click', function() {
    this.classList.toggle('active');
    fb.querySelector('#bf-pr-fields').classList.toggle('hidden');
  });
  fb.querySelector('#bf-joint-toggle').addEventListener('click', function() {
    this.classList.toggle('active');
    fb.querySelector('#bf-joint-fields').classList.toggle('hidden');
  });
  fb.querySelector('#bf-save').addEventListener('click', () => saveBookForm(selectedTags));
  const delBtn = fb.querySelector('#bf-delete');
  if (delBtn) delBtn.addEventListener('click', async () => {
    if (confirm('Удалить эту книгу?')) {
      await delBook(S.editingBookId);
      await deleteCover(S.editingBookId);
      closeOverlay(DOM.formOverlay);
      await refreshData();
      showToast('Книга удалена', 'info');
    }
  });
  openOverlay(DOM.formOverlay);
}

async function handleWebSearch() {
  const fb = DOM.formBody;
  const query = fb.querySelector('#bf-webquery').value.trim();
  const resultsEl = fb.querySelector('#bf-webresults');
  if (!query) { showToast('⚠️ Введите название или автора', 'error'); return; }
  resultsEl.innerHTML = '<div class="text-center text-muted text-small" style="padding:14px"><div class="spinner" style="margin:0 auto 8px;width:26px;height:26px"></div>Ищу в интернете...</div>';
  const litresKeys = S.settings.lrAppId && S.settings.lrSecret ? { appId: S.settings.lrAppId, secretKey: S.settings.lrSecret } : null;
  const results = await searchBooks(query, litresKeys);
  if (results.length === 0) {
    resultsEl.innerHTML = '<div class="text-center text-muted text-small" style="padding:14px">Ничего не найдено. Попробуйте другой запрос или заполните вручную.</div>';
    return;
  }
  const sourceMeta = {
    google: { label: 'Google Books', cls: 'badge-reading' },
    openlibrary: { label: 'Open Library', cls: 'badge-status' },
    litres: { label: 'ЛитРес', cls: 'badge-pr' },
    microlink: { label: 'Microlink', cls: 'badge-content' },
  };
  resultsEl.innerHTML = results.map((r, i) => {
    const src = sourceMeta[r.source] || { label: r.source, cls: 'badge-source' };
    return '<div class="web-result" data-idx="' + i + '">' +
      (r.cover ? '<img class="web-result-cover" src="' + r.cover + '" alt="" loading="lazy" referrerpolicy="no-referrer"/>' : '<div class="web-result-cover" style="display:flex;align-items:center;justify-content:center">' + icon('bookClosed', 18) + '</div>') +
      '<div class="web-result-info"><div class="web-result-title">' + esc(r.title) + '</div>' +
      '<div class="web-result-meta">' + esc(r.author) + (r.publisher ? ' · ' + esc(r.publisher) : '') + (r.pageCount ? ' · ' + r.pageCount + ' стр.' : '') + '</div>' +
      '<span class="web-result-source book-badge ' + src.cls + '">' + src.label + '</span></div></div>';
  }).join('');
  resultsEl.querySelectorAll('.web-result').forEach(el => {
    el.addEventListener('click', () => {
      const r = results[parseInt(el.dataset.idx)];
      fillFormFromResult(r);
      if (fb._updateCoverPreview) fb._updateCoverPreview();
      const sm = sourceMeta[r.source];
      showToast('✅ Выбрано: ' + (sm ? sm.label : r.source), 'success');
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
  if (r.litresSeries?.length > 0) {
    set('#bf-series', r.litresSeries[0].name);
    set('#bf-series-num', r.litresSeries[0].number);
  }
  if (r.litresMinAge) set('#bf-age', r.litresMinAge + '+');
  if (r.price?.amount > 0) {
    set('#bf-price', r.price.amount);
    set('#bf-currency', r.price.currency);
  }
}

async function saveBookForm(selectedTags) {
  const f = DOM.formBody;
  const title = f.querySelector('#bf-title').value.trim();
  if (!title) { showToast('⚠️ Введите название книги', 'error'); return; }
  const now = new Date().toISOString();
  const isPR = f.querySelector('#bf-pr-toggle').classList.contains('active');
  const isJoint = f.querySelector('#bf-joint-toggle').classList.contains('active');
  const freeTags = f.querySelector('#bf-tags').value.split(',').map(t => t.trim()).filter(Boolean);
  const tags = [...new Set([...(selectedTags ? [...selectedTags] : []), ...freeTags])];

  let coverVal = f.querySelector('#bf-cover').value.trim();
  if (coverVal.startsWith('blob:')) {
    coverVal = S.editingBookId ? (S.books.find(b => b.id === S.editingBookId)?.cover || '') : '';
  }

  const bookData = {
    id: S.editingBookId || ('book_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)),
    title,
    author: f.querySelector('#bf-author').value.trim(),
    cover: coverVal,
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
      if (bookData.status === 'reading' && !bookData.dateStarted) bookData.dateStarted = now.slice(0, 10);
      if ((bookData.status === 'finished' || bookData.status === 'dropped') && ex.status !== bookData.status) bookData.dateFinished = now.slice(0, 10);
    }
  } else {
    bookData.contentItems = []; bookData.review = {}; bookData.readingForContent = {};
    bookData.source = 'manual';
    if (bookData.status === 'reading') bookData.dateStarted = now.slice(0, 10);
  }

  for (const t of tags) {
    if (!S.tags.find(x => x.name === t)) await putTag({ name: t, color: pickTagColor(S.tags.length) });
  }

  if (bookData.cover && bookData.cover.startsWith('http')) {
    bookData.coverUrl = bookData.cover;
    downloadCoverAsync(bookData.id, bookData.cover);
  }

  await putBook(bookData);
  closeOverlay(DOM.formOverlay);
  await refreshData();
  if (bookData.status === 'finished' && S.settings.confetti) fireConfetti();
  showToast(S.editingBookId ? '✅ Книга обновлена' : '✅ Книга добавлена', 'success');
  S.editingBookId = null;
}

async function downloadCoverAsync(bookId, url) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const response = await fetch(url, { signal: ctrl.signal, referrerPolicy: 'no-referrer' });
    clearTimeout(timer);
    if (!response.ok) return;
    const blob = await response.blob();
    if (!isValidCoverBlob(blob)) return;
    await saveCover(bookId, blob);
    document.dispatchEvent(new CustomEvent('data-changed'));
  } catch { /* остаёмся на URL-фолбэке */ }
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
  showLoading('Ищу книгу...');
  if (isRussianISBN(isbn)) updateLoading('🇷🇺 Российский ISBN — ищу в базах...');
  const litresKeys = S.settings.lrAppId && S.settings.lrSecret ? { appId: S.settings.lrAppId, secretKey: S.settings.lrSecret } : null;
  const book = await fetchBookByIsbn(isbn, litresKeys);
  hideLoading();
  closeScanner();
  if (book) {
    showToast('Найдено: ' + book.source, 'success');
    openBookForm(Object.assign({}, book, { isbn: book.isbn || isbn, status: 'wishlist' }));
  } else {
    showToast('Не найдено — заполните вручную', 'info');
    openBookForm({ isbn: isbn, title: '', author: '', status: 'wishlist' });
  }
}

// ═══════════════════════════════════════════════
//  КАРТОЧКА КНИГИ (детали)
// ═══════════════════════════════════════════════
function openBookDetail(bookId) {
  const book = S.books.find(b => b.id === bookId);
  if (!book) return;
  DOM.detailTitle.textContent = book.title || 'Книга';
  const st = BOOK_STATUSES[book.status] || BOOK_STATUSES.wishlist;
  const progress = book.pageCount > 0 ? Math.round((book.currentPage / book.pageCount) * 100) : 0;
  const contentItems = book.contentItems || [];
  const review = book.review || {};
  const quotes = review.quotes || [];
  const jr = book.jointReading || {};

  const coverHtml = book.coverUrl
    ? '<img class="detail-cover" id="detail-cover-img" src="' + book.coverUrl + '" alt="" referrerpolicy="no-referrer" style="cursor:zoom-in"/>'
    : coverPlaceholder(book, 'detail-cover-placeholder');

  let html =
    '<div class="detail-hero">' + coverHtml +
    '<div style="flex:1;min-width:0"><div class="detail-title">' + esc(book.title) + '</div>' +
    '<div class="detail-author">' + esc(book.author) + '</div>' +
    '<div class="book-meta"><button class="book-badge badge-status status-btn" data-book-id="' + book.id + '">' + statusIcon(book.status, 13) + ' ' + st.label + ' ' + icon('chevronDown', 10) + '</button>' +
    (book.isPR ? '<span class="book-badge badge-pr">' + icon('box', 11) + ' ' + esc(book.receivedFrom || 'PR') + '</span>' : '') +
    (book.ageRating ? '<span class="book-badge badge-status">' + esc(book.ageRating) + '</span>' : '') + '</div>' +
    (book.readingDays ? '<div class="text-small text-muted mt-8">' + icon('clock', 12) + ' Прочитана за ' + book.readingDays + ' дн.</div>' : '') +
    '</div></div>' +
    '<div class="detail-meta-grid">' +
    (book.genre ? meta('Жанр', book.genre) : '') +
    (book.publisher ? meta('Издательство', book.publisher) : '') +
    (book.publishedDate ? meta('Год', book.publishedDate) : '') +
    (book.pageCount ? meta('Страниц', book.pageCount) : '') +
    (book.isbn ? meta('ISBN', formatISBN(book.isbn)) : '') +
    (book.series ? meta('Серия', book.series + (book.seriesNumber ? ' #' + book.seriesNumber : '')) : '') +
    ((S.settings.showPriceInDetail && book.price?.amount > 0) ? meta('Цена', formatPrice(book.price)) : '') +
    '</div>' +
    (book.status === 'reading' && book.pageCount > 0
      ? '<div class="reading-progress"><div class="reading-progress-bar"><div class="reading-progress-fill" style="width:' + progress + '%"></div></div><div class="reading-progress-text">Стр. ' + book.currentPage + ' из ' + book.pageCount + ' (' + progress + '%)</div></div>'
      : '') +
    (book.description ? '<div class="detail-section"><h3>' + icon('edit', 14) + ' Описание</h3><div class="detail-description">' + esc(book.description) + '</div></div>' : '') +
    '<div class="detail-section"><h3>' + icon('film', 14) + ' Контент по книге (' + contentItems.length + ')</h3>' +
    (contentItems.length === 0 ? '<div class="text-muted text-small">Пока нет контента</div>'
      : contentItems.map(c =>
          '<div class="content-list-item content-clickable" data-content-id="' + c.id + '" title="Открыть контент">' +
          '<span class="content-list-icon">' + contentTypeIcon(c.type, 20) + '</span>' +
          '<div class="content-list-info"><div class="content-list-title">' + esc(c.title || CONTENT_TYPES[c.type]?.label || c.type) + '</div>' +
          '<div class="content-list-sub">' + brandIcon(c.platform, 11) + ' ' + (c.publishedDate ? c.publishedDate : (c.plannedDate || '')) + '</div></div>' +
          '<span class="content-list-status status-' + c.status + '">' + (CONTENT_STATUSES[c.status]?.label || c.status) + '</span></div>'
        ).join('')) +
    '<button id="detail-add-content" class="btn-secondary mt-8" style="width:100%">' + icon('plus', 14) + ' Добавить контент</button></div>' +
    '<div class="detail-section"><h3>' + icon('quote', 14) + ' Цитаты (' + quotes.length + ')</h3><div id="detail-quotes">' +
    quotes.map(q => '<div class="quote-item"><span>«' + esc(q.text) + '»</span>' + (q.page ? '<span class="quote-page">с. ' + q.page + '</span>' : '') + (q.used ? '<span class="quote-used">' + icon('check', 11) + '</span>' : '') + '</div>').join('') +
    '</div><div class="flex gap-8 mt-8"><input type="text" id="dq-text" placeholder="Новая цитата..." style="flex:1"/>' +
    '<input type="number" id="dq-page" placeholder="Стр." style="width:70px" min="0"/>' +
    '<button id="dq-add" class="btn-secondary" style="width:auto;flex-shrink:0">' + icon('plus', 14) + '</button></div>' +
    '<button id="dq-ocr" class="btn-secondary mt-8" style="width:100%">' + icon('camera', 14) + ' Сфотографировать цитату (OCR)</button></div>' +
    '<div class="detail-section"><h3>' + icon('pen', 14) + ' Отзыв</h3>' +
    (review.text || review.rating > 0
      ? '<div class="review-stars">' + '⭐'.repeat(review.rating || 0) + '☆'.repeat(5 - (review.rating || 0)) + '</div>' +
        (review.pros ? '<div class="review-pros">👍 ' + esc(review.pros) + '</div>' : '') +
        (review.cons ? '<div class="review-cons">👎 ' + esc(review.cons) + '</div>' : '') +
        (review.text ? '<div class="detail-description mt-8">' + esc(review.text) + '</div>' : '') +
        (review.recommendation ? '<div class="mt-8 text-small">' + icon('target', 12) + ' ' + esc(review.recommendation) + '</div>' : '')
      : '<div class="text-muted text-small">Отзыв ещё не написан</div>') +
    '<div class="flex gap-8 mt-8"><button id="detail-edit-review" class="btn-secondary" style="flex:1">' +
    (review.text || review.rating > 0 ? icon('edit', 14) + ' Редактировать' : icon('pen', 14) + ' Написать отзыв') + '</button>' +
    (review.text || review.rating > 0 ? '<button id="detail-copy-review" class="btn-secondary" style="flex:1">' + icon('copy', 14) + ' Копировать</button>' : '') +
    '</div></div>' +
    (jr.active
      ? '<div class="detail-section"><h3>' + icon('users', 14) + ' Совместное чтение</h3><div class="text-small">' + icon('users', 12) + ' ' + esc((jr.participants || []).join(', ')) + '</div>' +
        (jr.chatLink ? '<div class="text-small mt-8">' + icon('link', 12) + ' <a href="' + esc(jr.chatLink) + '" target="_blank" rel="noopener">' + esc(jr.chatLink) + '</a></div>' : '') +
        (jr.notes ? '<div class="text-small text-muted mt-8">' + icon('edit', 12) + ' ' + esc(jr.notes) + '</div>' : '') + '</div>'
      : '') +
    (book.notes ? '<div class="detail-section"><h3>' + icon('edit', 14) + ' Заметки</h3><div class="detail-description">' + esc(book.notes) + '</div></div>' : '') +
    '<div class="btn-group mt-16"><button id="detail-collections" class="btn-secondary">' + icon('folder', 14) + ' В подборку</button>' +
    '<button id="detail-edit" class="btn-secondary">' + icon('edit', 14) + ' Изменить</button>' +
    '<button id="detail-delete" class="btn-danger">' + icon('trash', 14) + '</button></div>';

  function meta(label, value) {
    return '<div class="detail-meta-item"><div class="detail-meta-label">' + label + '</div><div class="detail-meta-value">' + esc(String(value)) + '</div></div>';
  }

  DOM.detailBody.innerHTML = html;
  const db = DOM.detailBody;
  const coverImg = db.querySelector('#detail-cover-img');
  if (coverImg) coverImg.addEventListener('click', () => openCoverViewer(book));
  db.querySelector('.status-btn').addEventListener('click', (e) => { e.stopPropagation(); openStatusDropdown(e.currentTarget, book.id); });
  db.querySelector('#detail-edit').addEventListener('click', () => { closeOverlay(DOM.detailOverlay); openBookForm(book); });
  db.querySelector('#detail-delete').addEventListener('click', async () => {
    if (confirm('Удалить эту книгу?')) {
      await delBook(book.id); await deleteCover(book.id);
      closeOverlay(DOM.detailOverlay); await refreshData();
      showToast('Книга удалена', 'info');
    }
  });
  db.querySelector('#detail-add-content').addEventListener('click', () => { closeOverlay(DOM.detailOverlay); openContentForm(null, book.id); });
  db.querySelector('#detail-edit-review').addEventListener('click', () => { closeOverlay(DOM.detailOverlay); openReviewForm(book.id); });
  const copyBtn = db.querySelector('#detail-copy-review');
  if (copyBtn) copyBtn.addEventListener('click', () => copyReviewToClipboard(book));
  db.querySelector('#detail-collections').addEventListener('click', () => { openBookCollectionsPicker(book.id, S.books, S.collections, refreshData); });
  db.querySelectorAll('.content-clickable').forEach(el => {
    el.addEventListener('click', () => {
      const item = contentItems.find(c => c.id === el.dataset.contentId);
      if (item) openContentCard(item, book.id);
    });
  });

  const addQuote = async (text, page) => {
    if (!text) return;
    book.review = book.review || {};
    book.review.quotes = book.review.quotes || [];
    book.review.quotes.push({ text: text, page: page || 0, used: false });
    await putBook(book);
    await refreshData();
    openBookDetail(book.id);
    showToast('Цитата добавлена', 'success');
  };
  db.querySelector('#dq-add').addEventListener('click', () => {
    addQuote(db.querySelector('#dq-text').value.trim(), parseInt(db.querySelector('#dq-page').value) || 0);
  });
  db.querySelector('#dq-text').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addQuote(db.querySelector('#dq-text').value.trim(), parseInt(db.querySelector('#dq-page').value) || 0);
  });
  db.querySelector('#dq-ocr').addEventListener('click', async () => {
    closeOverlay(DOM.detailOverlay);
    const text = await captureQuoteByPhoto();
    if (text) await addQuote(text, 0); else openBookDetail(book.id);
  });
  openOverlay(DOM.detailOverlay);
}

// ═══════════════════════════════════════════════
//  READ-ONLY КАРТОЧКА КОНТЕНТА
// ═══════════════════════════════════════════════
const CONTENT_STATUS_ORDER = ['idea', 'planned', 'filming', 'editing', 'published'];
function openContentCard(item, bookId) {
  const book = S.books.find(b => b.id === bookId);
  const type = CONTENT_TYPES[item.type] || { label: item.type, color: '' };
  const overlay = document.createElement('div');
  overlay.className = 'overlay end';

  const stepper = CONTENT_STATUS_ORDER.map(s => {
    const active = CONTENT_STATUS_ORDER.indexOf(item.status) >= CONTENT_STATUS_ORDER.indexOf(s);
    const cur = item.status === s;
    return '<button class="cc-step ' + (active ? 'active' : '') + ' ' + (cur ? 'current' : '') + '" data-step="' + s + '" ' +
      'style="flex:1;display:flex;flex-direction:column;align-items:center;gap:5px;padding:9px 4px;border-radius:10px;' +
      'background:' + (active ? 'var(--accent-dim)' : 'var(--bg-input)') + ';border:1px solid ' + (cur ? 'var(--accent)' : 'var(--border-soft)') + ';' +
      'color:' + (active ? 'var(--accent)' : 'var(--text-muted)') + ';font-size:.66rem;font-weight:700;transition:all .2s">' +
      icon(CONTENT_STATUS_ICONS[s] || 'film', 16) + (CONTENT_STATUSES[s]?.label || s) + '</button>';
  }).join('');

  const bookBlock =
    '<div class="cc-book" style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg-input);border-radius:var(--radius-sm);cursor:pointer">' +
    (book?.coverUrl ? '<img src="' + book.coverUrl + '" referrerpolicy="no-referrer" style="width:36px;height:54px;border-radius:4px;object-fit:cover"/>' : icon('bookClosed', 24)) +
    '<div style="flex:1;min-width:0"><div style="font-weight:700;font-size:.9rem">' + esc(book?.title || '') + '</div>' +
    '<div class="text-small text-muted">' + esc(book?.author || '') + '</div></div></div>';

  const linkBlock = item.publishedUrl
    ? '<div class="form-group mt-16"><label>' + icon('link', 13) + ' Ссылка</label><div class="flex gap-8">' +
      '<a href="' + esc(item.publishedUrl) + '" target="_blank" rel="noopener" class="btn-secondary" style="flex:1;text-decoration:none">' + icon('external', 14) + ' Открыть</a>' +
      '<button class="btn-secondary cc-copy-url" style="flex:1">' + icon('copy', 14) + ' Копировать</button></div></div>'
    : '';

  const notesBlock = item.notes
    ? '<div class="form-group mt-16"><label>' + icon('edit', 13) + ' Заметки</label><div class="detail-description">' + esc(item.notes) + '</div></div>'
    : '';

  overlay.innerHTML =
    '<div class="overlay-panel"><div class="overlay-header"><h2>' + contentTypeIcon(item.type, 20) + ' ' + esc(item.title || type.label) + '</h2>' +
    '<button class="icon-btn cc-close">' + icon('close', 18) + '</button></div>' +
    '<div class="overlay-body">' + bookBlock +
    '<div class="cc-stepper" style="display:flex;gap:6px;margin:18px 0">' + stepper + '</div>' +
    '<div class="detail-meta-grid">' +
    '<div class="detail-meta-item"><div class="detail-meta-label">Площадка</div><div class="detail-meta-value" style="display:flex;align-items:center;gap:6px">' + brandIcon(item.platform, 14) + ' ' + (item.platform || '—') + '</div></div>' +
    '<div class="detail-meta-item"><div class="detail-meta-label">Дата плана</div><div class="detail-meta-value">' + (item.plannedDate || '—') + '</div></div>' +
    '<div class="detail-meta-item"><div class="detail-meta-label">Публикация</div><div class="detail-meta-value">' + (item.publishedDate || '—') + '</div></div>' +
    '<div class="detail-meta-item"><div class="detail-meta-label">Создан</div><div class="detail-meta-value">' + ((item.createdAt || '').slice(0, 10) || '—') + '</div></div>' +
    '</div>' + linkBlock + notesBlock +
    '<div class="btn-group mt-16"><button class="btn-primary cc-edit">' + icon('edit', 15) + ' Редактировать</button>' +
    '<button class="btn-danger cc-del">' + icon('trash', 15) + '</button></div></div></div>';

  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  trackOverlay(overlay);

  const close = () => { overlay.remove(); untrackOverlay(overlay); restoreScrollIfFree(); };
  overlay.querySelector('.cc-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('.cc-book').addEventListener('click', () => { close(); openBookDetail(bookId); });
  const copyUrl = overlay.querySelector('.cc-copy-url');
  if (copyUrl) copyUrl.addEventListener('click', () => {
    navigator.clipboard?.writeText(item.publishedUrl).then(() => showToast('Ссылка скопирована', 'success'));
  });
  overlay.querySelectorAll('.cc-step').forEach(btn => {
    btn.addEventListener('click', async () => {
      const newStatus = btn.dataset.step;
      if (newStatus === item.status) return;
      await updateContentStatus(bookId, item.id, newStatus);
      if (newStatus === 'published' && S.settings.confetti) fireConfetti();
      document.dispatchEvent(new CustomEvent('data-changed'));
      close();
      showToast('Статус: ' + (CONTENT_STATUSES[newStatus]?.label || newStatus), 'success');
    });
  });
  overlay.querySelector('.cc-edit').addEventListener('click', () => { close(); openContentForm(item, bookId); });
  overlay.querySelector('.cc-del').addEventListener('click', async () => {
    if (!confirm('Удалить этот контент?')) return;
    await deleteContentItem(bookId, item.id);
    document.dispatchEvent(new CustomEvent('data-changed'));
    close();
    showToast('Контент удалён', 'info');
  });
}

// ═══════════════════════════════════════════════
//  ПРОСМОТР ОБЛОЖКИ
// ═══════════════════════════════════════════════
let _coverBookId = null;
function openCoverViewer(book) {
  if (!book.coverUrl) { showToast('Нет обложки', 'info'); return; }
  _coverBookId = book.id;
  DOM.coverViewerImg.src = book.coverUrl;
  DOM.coverViewerTitle.textContent = book.title + ' — ' + book.author;
  openOverlay(DOM.coverOverlay);
}
async function handleCoverPhotoChange(e) {
  const file = e.target.files[0];
  if (!file || !_coverBookId) return;
  e.target.value = '';
  showLoading('Сохраняю обложку...');
  try {
    const bitmap = await createImageBitmap(file);
    const MAX = 800;
    const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.88));
    if (isValidCoverBlob(blob)) await saveCover(_coverBookId, blob);
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
  document.body.style.overflow = 'hidden';
  trackOverlay(DOM.scannerOverlay);
  DOM.scannerManualInput.value = '';
  const result = await startScanner(DOM.scannerVideo, (status, msg) => {
    DOM.scannerStatus.textContent = msg;
    DOM.scannerStatus.className = 'scanner-status' + (status === 'scanning' ? ' scanning' : '');
  });
  if (result) handleIsbnLookup(result);
}
function closeScanner() {
  stopScanner();
  DOM.scannerOverlay.classList.add('hidden');
  untrackOverlay(DOM.scannerOverlay);
  restoreScrollIfFree();
}

// ═══════════════════════════════════════════════
//  КОНТЕНТ / ОТЗЫВЫ (делегирование)
// ═══════════════════════════════════════════════
async function handleDeleteContent(itemId, bookId) {
  if (!confirm('Удалить этот контент?')) return;
  await deleteContentItem(bookId, itemId);
  await refreshData();
  showToast('Контент удалён', 'info');
}
async function handleContentStatus(itemId, bookId, status) {
  await updateContentStatus(bookId, itemId, status);
  await refreshData();
  if (status === 'published' && S.settings.confetti) {
    fireConfetti();
    showToast('Контент опубликован! 🎉', 'success');
  }
}
async function handleDeleteReview(bookId) {
  if (!confirm('Удалить отзыв?')) return;
  await deleteReview(bookId);
  await refreshData();
  showToast('Отзыв удалён', 'info');
}

// ═══════════════════════════════════════════════
//  СЕРИИ / ПОДБОРКИ / ЧЕЛЛЕНДЖИ
// ═══════════════════════════════════════════════
function renderSeriesScreen() {
  const mc = DOM.mainContent;
  if (S.openSeries) {
    renderSeriesDetail(mc, S.openSeries, S.books, {
      onOpenBook: openBookDetail,
      onAddBook: (seriesName, total) => { openBookForm({ series: seriesName, seriesTotal: total, status: 'wishlist' }); },
      onBack: () => { S.openSeries = null; renderSeriesScreen(); },
    });
  } else {
    renderSeriesList(mc, S.books, { onOpenSeries: (name) => { S.openSeries = name; renderSeriesScreen(); } });
  }
}

function renderCollectionsScreen() {
  const mc = DOM.mainContent;
  const col = S.collections.find(c => c.id === S.openCollection);
  if (col) {
    renderCollectionDetail(mc, col, S.books, {
      onOpenBook: openBookDetail,
      onRemoveBook: async (colId, bookId) => { await removeBookFromCol(colId, bookId); await refreshData(); showToast('Убрано из подборки', 'info'); },
      onAddBook: (colId) => openAddBooksToCollection(colId, S.books, col, refreshData),
      onBack: () => { S.openCollection = null; renderCollectionsScreen(); },
      onEdit: (c) => openCollectionForm(c, async (data) => { await updateCollection(data); await refreshData(); showToast('✅ Сохранено', 'success'); }),
    });
  } else {
    renderCollectionsList(mc, S.books, S.collections, {
      onOpen: (id) => { S.openCollection = id; renderCollectionsScreen(); },
      onAdd: () => openCollectionForm(null, async (data) => { data.order = await getNextCollectionOrder(); await createCollection(data); await refreshData(); showToast('✅ Подборка создана', 'success'); }),
      onEdit: (c) => openCollectionForm(c, async (data) => { await updateCollection(data); await refreshData(); showToast('✅ Сохранено', 'success'); }),
      onDelete: async (id) => { if (confirm('Удалить подборку?')) { await deleteCollection(id); await refreshData(); showToast('Подборка удалена', 'info'); } },
      onMove: async (id, direction) => { await moveCollection(id, direction); await refreshData(); },
      onAddBook: () => {},
    });
  }
}

function renderChallenges() {
  const mc = DOM.mainContent;
  const ch = S.challenges.find(c => c.id === S.openChallenge);
  if (ch) {
    renderChallengeDetail(mc, ch, S.books, {
      onBack: () => { S.openChallenge = null; renderChallenges(); },
      onEdit: (c) => openChallengeForm(c, S.books, async (data) => { await updateChallenge(data); await refreshData(); showToast('✅ Сохранено', 'success'); }),
      onDelete: async (id) => { if (confirm('Удалить челлендж?')) { await deleteChallengeById(id); S.openChallenge = null; await refreshData(); showToast('Челлендж удалён', 'info'); } },
      onOpenBook: openBookDetail,
      onAddBook: (chId) => openAddBooksToChallenge(chId, ch, S.books, refreshData),
      onStatusChange: async (chId, status) => {
        const challenges = await loadChallenges();
        const c = challenges.find(x => x.id === chId);
        if (c) { c.status = status; await updateChallenge(c); }
        await refreshData();
        if (status === 'completed' && S.settings.confetti) { fireConfetti(); showToast('Челлендж завершён! 🎉', 'success'); }
        else showToast('Статус: ' + (status === 'active' ? 'Активен' : 'Завершён'), 'success');
      },
      onAddNote: async (chId, text) => { await addChallengeNote(chId, text); await refreshData(); },
      onDelNote: async (chId, idx) => { await removeChallengeNote(chId, idx); await refreshData(); },
    });
  } else {
    renderChallengesList(mc, S.challenges, S.books, {
      onOpen: (id) => { S.openChallenge = id; renderChallenges(); },
      onAdd: () => openChallengeForm(null, S.books, async (data) => { await createChallenge(data); await refreshData(); showToast('✅ Челлендж создан', 'success'); }),
      onEdit: (c) => openChallengeForm(c, S.books, async (data) => { await updateChallenge(data); await refreshData(); }),
      onDelete: async (id) => { if (confirm('Удалить челлендж?')) { await deleteChallengeById(id); await refreshData(); showToast('Удалён', 'info'); } },
    });
  }
}

// ═══════════════════════════════════════════════
//  НАСТРОЙКИ
// ═══════════════════════════════════════════════
function renderSettingsTab() {
  const s = S.settings;
  const mc = DOM.mainContent;
  const platformKeys = ['youtube','tiktok','telegram','vk','dzen','instagram','pinterest','threads'];

  mc.innerHTML =
    '<div class="settings-section"><h3>' + icon('film', 15) + ' Режим бук-блогера</h3>' +
    '<div class="toggle-row"><span class="toggle-label">Включить блогерские функции</span>' +
    '<div class="toggle ' + (s.bloggerMode ? 'active' : '') + '" id="set-blogger"></div></div></div>' +
    '<div class="settings-section"><h3>' + icon('coin', 15) + ' Цена и валюта</h3>' +
    '<div class="form-group"><label>Валюта по умолчанию</label><select id="set-currency">' +
    Object.entries(CURRENCIES).map(([k, c]) => '<option value="' + k + '"' + (s.defaultCurrency === k ? ' selected' : '') + '>' + c.symbol + ' ' + c.name + '</option>').join('') +
    '</select></div>' +
    '<div class="toggle-row"><span class="toggle-label">Показывать цену в карточках</span><div class="toggle ' + (s.showPriceInCards ? 'active' : '') + '" id="set-price-cards"></div></div>' +
    '<div class="toggle-row"><span class="toggle-label">Показывать цену на странице книги</span><div class="toggle ' + (s.showPriceInDetail ? 'active' : '') + '" id="set-price-detail"></div></div>' +
    '<div class="toggle-row"><span class="toggle-label">Показывать цену в статистике</span><div class="toggle ' + (s.showPriceInStats ? 'active' : '') + '" id="set-price-stats"></div></div>' +
    '<div class="hint mt-8">Курсы валют обновлены: ' + (s.ratesUpdated || 'никогда') + ' · 1 USD = ' + s.exchangeRates.USD + ' ₽</div>' +
    '<button id="set-rates-update" class="btn-secondary mt-8">' + icon('refresh', 14) + ' Обновить курсы</button></div>' +
    '<div class="settings-section"><h3>' + icon('tag', 15) + ' Теги и цвета</h3>' +
    '<div class="flex gap-8 mb-16"><input type="text" id="set-tag-new" placeholder="Новый тег..." style="flex:1"/>' +
    '<input type="color" id="set-tag-new-color" value="#e8a33d" style="width:44px;height:36px;padding:2px;border-radius:8px;cursor:pointer"/>' +
    '<button id="set-tag-add" class="btn-secondary" style="width:auto;flex-shrink:0">' + icon('plus', 14) + '</button></div>' +
    '<div id="set-tags-list">' +
    (S.tags.map(t =>
      '<div class="flex items-center gap-8 mb-8"><input type="color" data-tag-color="' + esc(t.name) + '" value="' + (t.color || '#e8a33d') + '" style="width:44px;height:36px;padding:2px;border-radius:8px;cursor:pointer"/>' +
      '<span class="flex-1 text-small">' + esc(t.name) + '</span>' +
      '<button data-tag-del="' + esc(t.name) + '" class="icon-btn" style="width:30px;height:30px">' + icon('trash', 14) + '</button></div>'
    ).join('') || '<div class="text-small text-muted">Нет тегов. Добавьте первый выше или в форме книги.</div>') +
    '</div></div>' +
    '<div class="settings-section"><h3>' + icon('link', 15) + ' Microlink API <span class="badge">превью ссылок</span></h3>' +
    '<p class="hint">Автоматически подтягивает превью для опубликованного контента и извлекает данные книг по ссылкам на ЛитРес / Book24 / Ozon.<br/>Бесплатно: <strong>25 запросов/день</strong> без ключа.</p>' +
    '<div class="form-group"><label>API-ключ (если куплен доступ)</label>' +
    '<input type="password" id="set-microlink-key" value="' + esc(s.microlinkApiKey || '') + '" placeholder="Ваш ключ Microlink Pro"/>' +
    '<div class="form-hint">С ключом запросы идут на pro.microlink.io — лимит выше</div></div>' +
    '<button id="set-microlink-check" class="btn-secondary">' + icon('search', 14) + ' Проверить доступность</button>' +
    '<span id="set-microlink-status" class="status-text"></span>' +
    '<div class="mt-8"><button id="set-microlink-clear" class="btn-secondary">' + icon('trash', 14) + ' Очистить кеш превью</button></div></div>' +
    '<div class="settings-section"><h3>' + icon('library', 15) + ' ЛитРес API <span class="badge">опционально</span></h3>' +
    '<p class="hint">Улучшает поиск российских книг. Получите ключи:<br/>1. <a href="https://www.litres.ru/pages/reader_partner/" target="_blank">litres.ru/pages/reader_partner</a><br/>2. Напишите на <a href="mailto:partners@litres.ru">partners@litres.ru</a><br/>⚠️ Сейчас стоят <strong>тестовые ключи</strong>.</p>' +
    '<details><summary>Catalit API (поиск по ISBN и названию)</summary>' +
    '<div class="form-group mt-8"><label>App ID</label><input type="text" id="set-lr-appid" value="' + esc(s.lrAppId || '') + '" placeholder="Ваш App ID"/></div>' +
    '<div class="form-group"><label>Secret Key</label><input type="password" id="set-lr-secret" value="' + esc(s.lrSecret || '') + '" placeholder="Ваш Secret Key"/></div></details>' +
    '<details><summary>Partner API (расширенные метаданные)</summary>' +
    '<div class="form-group mt-8"><label>Partner ID</label><input type="text" id="set-lr-pid" value="' + esc(s.lrPartnerId || '') + '"/></div>' +
    '<div class="form-group"><label>Secret Key</label><input type="password" id="set-lr-psecret" value="' + esc(s.lrPartnerSecret || '') + '"/></div></details>' +
    '<button id="set-lr-test" class="btn-secondary mt-8">' + icon('search', 14) + ' Проверить подключение</button>' +
    '<span id="set-lr-status" class="status-text"></span></div>' +
    '<div class="settings-section"><h3>' + icon('camera', 15) + ' Распознавание цитат (OCR)</h3>' +
    '<p class="hint">Полный оффлайн. Файлы Tesseract.js должны лежать в корне проекта.</p>' +
    '<button id="set-ocr-check" class="btn-secondary">' + icon('search', 14) + ' Проверить файлы OCR</button>' +
    '<span id="set-ocr-status" class="status-text"></span></div>' +
    '<div class="settings-section"><h3>' + icon('globe', 15) + ' Площадки</h3>' +
    '<div class="form-group"><label>Площадка по умолчанию</label><div class="platform-grid" id="set-platform-grid">' +
    platformKeys.map(p => '<button class="platform-btn ' + (s.defaultPlatform === p ? 'active' : '') + '" data-platform="' + p + '">' + brandIcon(p, 15) + ' ' + p + '</button>').join('') +
    '</div></div></div>' +
    '<div class="settings-section"><h3>' + icon('sparkles', 15) + ' Эффекты</h3>' +
    '<div class="toggle-row"><span class="toggle-label">Конфетти</span><div class="toggle ' + (s.confetti ? 'active' : '') + '" id="set-confetti"></div></div>' +
    '<div class="toggle-row"><span class="toggle-label">Звуки</span><div class="toggle ' + (s.sound ? 'active' : '') + '" id="set-sound"></div></div></div>' +
    '<div class="settings-section"><h3>' + icon('download', 15) + ' Данные</h3>' +
    '<div class="btn-group"><button id="set-export" class="btn-secondary">' + icon('upload', 14) + ' Экспорт</button>' +
    '<button id="set-import" class="btn-secondary">' + icon('download', 14) + ' Импорт</button></div>' +
    '<input type="file" id="set-import-file" accept=".json" class="hidden"/>' +
    '<div class="btn-group"><button id="set-clear" class="btn-danger">' + icon('trash', 14) + ' Очистить всё</button></div>' +
    '<div class="hint mt-8">Размер базы: <span id="set-dbsize">...</span></div></div>' +
    '<div class="settings-section"><h3>' + icon('bookOpen', 15) + ' О приложении</h3>' +
    '<p class="hint">Book Tracker Pro v3.5.0 · Трекер книг для бук-блогера · Работает оффлайн</p></div>';

  const bind = (id, fn) => { const el = mc.querySelector(id); if (el) el.addEventListener('click', fn); };
  const bindToggle = (id, key) => { const el = mc.querySelector(id); if (el) el.addEventListener('click', function() { this.classList.toggle('active'); S.settings[key] = this.classList.contains('active'); saveAppSettings(); }); };
  bindToggle('#set-blogger', 'bloggerMode');
  bindToggle('#set-price-cards', 'showPriceInCards');
  bindToggle('#set-price-detail', 'showPriceInDetail');
  bindToggle('#set-price-stats', 'showPriceInStats');
  bindToggle('#set-confetti', 'confetti');
  bindToggle('#set-sound', 'sound');

  const curSel = mc.querySelector('#set-currency');
  if (curSel) curSel.addEventListener('change', function() { S.settings.defaultCurrency = this.value; saveAppSettings(); });

  mc.querySelectorAll('#set-platform-grid .platform-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      mc.querySelectorAll('#set-platform-grid .platform-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      S.settings.defaultPlatform = btn.dataset.platform;
      saveAppSettings();
    });
  });

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
      status.innerHTML = icon('refresh', 14) + ' Обновить курсы';
      showToast('❌ Нет интернета', 'error');
    }
  });

  bind('#set-tag-add', async () => {
    const name = mc.querySelector('#set-tag-new').value.trim();
    const color = mc.querySelector('#set-tag-new-color').value;
    if (!name) { showToast('⚠️ Введите название тега', 'error'); return; }
    if (S.tags.find(t => t.name.toLowerCase() === name.toLowerCase())) { showToast('⚠️ Такой тег уже есть', 'error'); return; }
    await putTag({ name: name, color: color });
    S.tags = await loadTags();
    renderSettingsTab();
    showToast('✅ Тег «' + name + '» добавлен', 'success');
  });
  mc.querySelectorAll('[data-tag-color]').forEach(inp => {
    inp.addEventListener('change', async () => {
      const tag = S.tags.find(t => t.name === inp.dataset.tagColor);
      if (tag) { tag.color = inp.value; await putTag(tag); S.tags = await loadTags(); }
    });
  });
  mc.querySelectorAll('[data-tag-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (confirm('Удалить тег «' + btn.dataset.tagDel + '»?')) {
        await delTag(btn.dataset.tagDel);
        S.tags = await loadTags();
        renderSettingsTab();
      }
    });
  });

  const mkKey = mc.querySelector('#set-microlink-key');
  if (mkKey) mkKey.addEventListener('change', function() { S.settings.microlinkApiKey = this.value.trim(); saveAppSettings(); });
  bind('#set-microlink-check', async () => {
    const status = mc.querySelector('#set-microlink-status');
    status.textContent = '⏳ Проверяю...';
    const r = await checkMicrolinkStatus(S.settings.microlinkApiKey);
    status.textContent = r.ok
      ? '✅ Работает' + (S.settings.microlinkApiKey ? ' (Pro)' : '') + ' · осталось ~' + r.remaining + ' запросов'
      : '❌ ' + (r.error || 'Недоступен');
  });
  bind('#set-microlink-clear', async () => { await clearPreviewCache(); showToast('Кеш превью очищен', 'info'); });

  bind('#set-lr-test', async () => {
    const appId = mc.querySelector('#set-lr-appid').value.trim();
    const secret = mc.querySelector('#set-lr-secret').value.trim();
    const status = mc.querySelector('#set-lr-status');
    if (!appId || !secret) { status.textContent = '⚠️ Заполните оба поля'; return; }
    status.textContent = '⏳ Проверяю...';
    try {
      const results = await searchBooks('Пушкин', { appId: appId, secretKey: secret });
      status.textContent = results.length > 0 ? '✅ Найдено: «' + results[0].title + '»' : '⚠️ Нет результатов';
    } catch { status.textContent = '❌ Ошибка'; }
  });
  bind('#set-ocr-check', async () => {
    const status = mc.querySelector('#set-ocr-status');
    status.textContent = '⏳ Проверяю...';
    const r = await checkOcrSupport();
    status.textContent = r.ok ? '✅ Файлы OCR на месте' : '❌ ' + r.error;
  });

  bind('#set-export', async () => {
    const data = await exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'booktracker-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    showToast('Экспортировано', 'success');
  });
  const importFile = mc.querySelector('#set-import-file');
  bind('#set-import', () => importFile.click());
  if (importFile) importFile.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await importAll(JSON.parse(await file.text()));
      await refreshData();
      showToast('Импортировано', 'success');
    } catch { showToast('❌ Ошибка импорта', 'error'); }
  });
  bind('#set-clear', async () => {
    if (confirm('Удалить ВСЕ данные? Это необратимо!')) {
      const db = await openDB();
      ['books','covers','settings','collections','challenges','tags','previews'].forEach(st => {
        try { db.transaction(st, 'readwrite').objectStore(st).clear(); } catch {}
      });
      await refreshData();
      showToast('Всё удалено', 'info');
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
//  КОНСТАНТЫ / ЦЕНА / УТИЛИТЫ
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
  idea: 'Идея', planned: 'Запланировано', filming: 'Снимаю',
  editing: 'Монтаж', published: 'Опубликовано'
};
export const PLATFORM_LABELS = {
  youtube: 'YouTube', tiktok: 'TikTok', telegram: 'Telegram',
  vk: 'VK', dzen: 'Дзен', instagram: 'Instagram',
  pinterest: 'Pinterest', threads: 'Threads'
};

export function formatPrice(price) {
  if (!price || !price.amount) return '';
  const cur = CURRENCIES[price.currency] || CURRENCIES.RUB;
  return price.amount.toLocaleString('ru') + ' ' + cur.symbol;
}
export function convertToDefault(price, settings) {
  if (!price || !price.amount) return null;
  const rates = settings.exchangeRates || {};
  const toRub = price.currency === 'RUB' ? price.amount : price.amount * (rates[price.currency] || 1);
  const def = settings.defaultCurrency;
  if (def === 'RUB') return { amount: Math.round(toRub), currency: 'RUB' };
  return { amount: Math.round(toRub / (rates[def] || 1)), currency: def };
}

function toggleDrawer(open) {
  DOM.drawer.classList.toggle('open', open);
  DOM.backdrop.classList.toggle('active', open);
  if (!open) restoreScrollIfFree();
}
function openOverlay(el) {
  el.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  trackOverlay(el);
}
function closeOverlay(el) {
  el.classList.add('hidden');
  untrackOverlay(el);
  restoreScrollIfFree();
}
let toastTimer = null;
export function showToast(msg, type = 'info') {
  if (!DOM.toast) return;
  DOM.toast.textContent = msg;
  DOM.toast.className = 'toast ' + type + ' show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => DOM.toast.classList.remove('show'), 3000);
}
let loadingEl = null;
function showLoading(text = 'Загрузка...') {
  hideLoading();
  loadingEl = document.createElement('div');
  loadingEl.className = 'loading-overlay';
  loadingEl.innerHTML = '<div class="spinner"></div><div class="loading-text">' + text + '</div>';
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