// 📦 BookTrackerPro — app.js
// 🔖 v3.8.5 | 2026-08-17
// 📝 Точка входа: навигация, рендеринг, события
//
//    Новое в 3.8.5:
//      — Контент: клик по контенту (книга/контент-план/календарь/поиск)
//        открывает READ-ONLY карточку openContentDetail, не редактор
//      — FAB «+» → меню: книга / контент / отзыв / челлендж / серия / подборка
//      — Убрана кнопка «+ Новая подборка» из drawer
//      — «Контент-план» переименован в «Контент»
//      — Настройки: площадка через attachCustomSelect с brand-иконками
//      — Форма книги: attachDatePicker для даты получения PR
//      — Доп.оценки: SVG (pepper/droplet/mystery/facePalm),
//        имена «Горячесть/Слезливость/Интрига/Жуткость», выбор иконками
//      — Импорт = синхронизация (добавляет отсутствующее, дубли.skip)
//
//    Сохранено из 3.8.4:
//      — restoreCoverUrls, shelfMark, SVG-иконки, аккордеон drawer,
//        янтарные заголовки, разрыв циклов через utils.js
// ─────────────────────────────────────────────
import {
  openDB, loadBooks, putBook, delBook, loadSettings, saveSettings,
  saveCover, deleteCover, getCover, changeBookStatus,
  BOOK_STATUSES, CURRENCIES,
  loadCollections, loadChallenges, loadTags, putTag, delTag,
  moveCollection, getNextCollectionOrder,
  exportAll, importAll, getDBSize,
  repairCovers, isValidCoverBlob
} from './db.js';
import {
  validateISBN, cleanISBN, fetchBookByIsbn, searchBooks,
  isRussianISBN, formatISBN
} from './isbn.js';
import { startScanner, stopScanner } from './scanner.js';
import {
  renderContentTab, openContentForm, openContentDetail,
  deleteContentItem, updateContentStatus,
  platformIcon, CONTENT_TYPES, CONTENT_STATUSES
} from './content.js';
import { renderReviewsTab, openReviewForm, deleteReview } from './review.js';
import { renderStatsTab, renderCalendarTab, getPrevStatsSub } from './stats.js';
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
import {
  extractBookPreview, checkMicrolinkStatus, clearPreviewCache, setMicrolinkApiKey
} from './microlink.js';
import { registerSW, setupOnlineIndicator } from './sw-register.js';
import { showConfirm, attachCustomSelect, attachDatePicker } from './uikit.js';
import { icon, statusIcon, contentTypeIcon, CONTENT_TYPE_ICONS, CONTENT_STATUS_ICONS } from './icons.js';
import {
  esc, showToast, debounce, sanitizeColor,
  trackOverlay, untrackOverlay,
  consumePoppingState, popTopOverlay, hasOverlays, pushSentinel,
  formatPrice, convertToDefault
} from './utils.js';

export { esc, showToast, trackOverlay, untrackOverlay, formatPrice, convertToDefault };

// ═══════════════════════════════════════════════
//  СОСТОЯНИЕ
// ═══════════════════════════════════════════════
const S = {
  books: [], collections: [], challenges: [], tags: [],
  settings: {
    lrAppId: '', lrSecret: '', lrPartnerId: '', lrPartnerSecret: '',
    microlinkApiKey: '',
    confetti: true, sound: true,
    defaultPlatform: 'youtube',
    bloggerMode: true,
    defaultCurrency: 'RUB',
    showPriceInCards: true, showPriceInDetail: true, showPriceInStats: true,
    exchangeRates: { USD: 90, EUR: 98, KZT: 0.18, UAH: 2.2, GBP: 115 },
    ratesUpdated: '',
  },
  currentTab: 'books',
  bookFilter: 'all',
  searchQuery: '', searchScope: 'all', searchBookTag: null,
  editingBookId: null,
  activeFilter: null,
  openSeries: null, openCollection: null, openChallenge: null,
  deferredPrompt: null,
};

// 🆕 v3.8.5: «Контент» вместо «Контент-план»
const SEARCH_SCOPES = [
  { id: 'all', icon: 'search', label: 'Всё' },
  { id: 'books', icon: 'library', label: 'Книги' },
  { id: 'content', icon: 'film', label: 'Контент' },
  { id: 'reviews', icon: 'pen', label: 'Отзывы' },
  { id: 'quotes', icon: 'quote', label: 'Цитаты' },
  { id: 'collections', icon: 'folder', label: 'Подборки' },
  { id: 'challenges', icon: 'trophy', label: 'Челленджи' },
  { id: 'series', icon: 'layers', label: 'Серии' },
  { id: 'tags', icon: 'tag', label: 'Теги' },
];

const BOOK_FORMATS = {
  paper: { icon: 'bookClosed', label: 'Бумажная' },
  ebook: { icon: 'smartphone', label: 'Электронная' },
  audio: { icon: 'headphones', label: 'Аудиокнига' },
};

// 🆕 v3.8.5: доп.оценки — SVG-иконки и новые имена
const EXTRA_RATINGS = [
  { id: 'bf-pepper',    icon: 'pepper',   label: 'Горячесть',   color: 'var(--red)' },
  { id: 'bf-tear',      icon: 'droplet',  label: 'Слезливость', color: 'var(--cyan)' },
  { id: 'bf-intrigue',  icon: 'mystery',  label: 'Интрига',     color: 'var(--purple)' },
  { id: 'bf-horror',    icon: 'facePalm', label: 'Жуткость',    color: 'var(--orange)' },
];

const TAB_TITLES = {
  books: 'Мои книги', content: 'Контент', reviews: 'Отзывы',
  calendar: 'Календарь', challenges: 'Челленджи', stats: 'Статистика',
  settings: 'Настройки', series: 'Серии', collections: 'Подборки',
};
const TAB_ICONS = {
  books: 'library', content: 'film', reviews: 'pen', calendar: 'calendar',
  challenges: 'trophy', stats: 'chart', settings: 'gear',
  series: 'layers', collections: 'folder',
};
const NAV_ICON_SIZES = {
  books: 22, content: 22, reviews: 20, calendar: 20, challenges: 20,
  stats: 20, settings: 18, series: 20, collections: 20,
};

// 🆕 v3.8.5: FAB-меню создания
const FAB_ITEMS = [
  { id: 'book',       icon: 'bookClosed', label: 'Книга' },
  { id: 'content',    icon: 'film',       label: 'Контент' },
  { id: 'review',     icon: 'pen',        label: 'Отзыв' },
  { id: 'challenge',  icon: 'trophy',     label: 'Челлендж' },
  { id: 'series',     icon: 'layers',     label: 'Серия' },
  { id: 'collection', icon: 'folder',     label: 'Подборка' },
];

// ═══════════════════════════════════════════════
//  DOM
// ═══════════════════════════════════════════════
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const DOM = {};
function camel(s) { return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }
function cacheDom() {
  ['backdrop','drawer','drawer-close','menu-btn','page-title','main-content',
   'search-toggle','search-bar','search-input','search-close',
   'search-scopes','search-book-tags','search-results',
   'add-btn','scan-btn',
   'form-overlay','form-title','form-back','form-close','form-body',
   'detail-overlay','detail-title','detail-back','detail-close','detail-body',
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

// ═══════════════════════════════════════════════
//  HISTORY API — жест «назад»
// ═══════════════════════════════════════════════
let _exitArmed = false;
let _exitTimer = null;

function hideOverlayEl(el) {
  if (!el) return;
  el.classList.add('hidden');
  if (el === DOM.scannerOverlay) stopScanner();
  const anyOpen = [...document.querySelectorAll('.overlay')].some(o => !o.classList.contains('hidden'));
  if (!anyOpen) document.body.style.overflow = '';
}

function setupBackGesture() {
  try {
    history.replaceState({ btpBase: true }, '');
    pushSentinel();
  } catch (e) {}
  window.addEventListener('popstate', () => {
    if (consumePoppingState()) return;
    if (hasOverlays()) { hideOverlayEl(popTopOverlay()); return; }
    if (S.currentTab === 'stats') {
      const mc = DOM.mainContent;
      const prev = getPrevStatsSub(mc._statsSub || 'books');
      if (prev) { mc._statsSub = prev; renderTab('stats'); return; }
      mc._statsSub = 'books';
      S.currentTab = 'books';
      renderTab('books');
      pushSentinel();
      return;
    }
    if (!_exitArmed) {
      _exitArmed = true;
      showToast('🚪 Нажмите ещё раз для выхода', 'info');
      clearTimeout(_exitTimer);
      _exitTimer = setTimeout(() => {
        _exitArmed = false;
        if (!hasOverlays()) pushSentinel();
      }, 2000);
    }
  });
}

// ═══════════════════════════════════════════════
//  ИНИЦИАЛИЗАЦИЯ
// ═══════════════════════════════════════════════
async function init() {
  cacheDom();
  bindEvents();

  // 🆕 v3.8.5: убираем «+ Новая подборка» из drawer
  DOM.drawerAddCollection?.remove();

  await openDB();
  const repaired = await repairCovers();
  if (repaired > 0) console.log('[Cover] Удалено битых обложек: ' + repaired);

  S.books = await loadBooks();
  await restoreCoverUrls(S.books);
  S.collections = await loadCollections();
  S.challenges = await loadChallenges();
  S.tags = await loadTags();

  const saved = await loadSettings();
  if (saved) Object.assign(S.settings, saved);
  if (S.settings.microlinkApiKey) setMicrolinkApiKey(S.settings.microlinkApiKey);

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
  bindDrawerAccordion();
  renderDrawer();

  const skeleton = document.getElementById('skeleton');
  if (skeleton) skeleton.remove();

  renderTab('books');
  document.addEventListener('data-changed', refreshData);
  handleManifestShortcuts();
}

// ═══════════════════════════════════════════════
//  🆕 v3.8.5: АККОРДЕОН DRAWER (Подборки/Серии/Фильтры)
// ═══════════════════════════════════════════════
function bindDrawerAccordion() {
  const pairs = [
    ['drawerTitleCollections', 'drawerCollections'],
    ['drawerTitleSeries', 'drawerSeries'],
    ['drawerTitleFilters', 'drawerFilters'],
  ];
  pairs.forEach(([t, l]) => {
    let title = DOM[t];
    const list = DOM[l];
    if (!title || !list) return;

    // Клонируем узел, чтобы сбросить старые обработчики
    // (навигация из 3.8.4), если они остались в bindEvents
    const clone = title.cloneNode(true);
    title.replaceWith(clone);
    DOM[t] = clone;

    clone.addEventListener('click', () => {
      const nowOpen = list.classList.toggle('hidden') === false;
      clone.classList.toggle('open', nowOpen);
      clone.setAttribute('aria-expanded', String(nowOpen));
    });
  });
}

// 🆕 v3.8.4: восстановление Object URL обложек из IndexedDB
const _coverUrlCache = new Map();
async function restoreCoverUrls(books) {
  for (const book of books) {
    if (_coverUrlCache.has(book.id)) { book.coverUrl = _coverUrlCache.get(book.id); continue; }
    const blob = await getCover(book.id);
    if (blob) {
      const url = URL.createObjectURL(blob);
      _coverUrlCache.set(book.id, url);
      book.coverUrl = url;
    } else if (book.coverUrl && book.coverUrl.startsWith('blob:')) {
      book.coverUrl = '';
    }
  }
}
function cacheCoverUrl(bookId, url) { if (bookId && url) _coverUrlCache.set(bookId, url); }

async function refreshData() {
  S.books = await loadBooks();
  await restoreCoverUrls(S.books);
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

  DOM.drawerTitleCollections?.addEventListener('click', () => {
    S.openCollection = null; renderTab('collections'); toggleDrawer(false);
  });
  DOM.drawerTitleSeries?.addEventListener('click', () => {
    S.openSeries = null; renderTab('series'); toggleDrawer(false);
  });
  DOM.drawerTitleFilters?.addEventListener('click', () => {
    S.activeFilter = null; renderTab('books'); toggleDrawer(false);
  });
  // 🆕 v3.8.5: drawerAddCollection удалён — обработчик не нужен

  // Глобальный поиск
  DOM.searchToggle.addEventListener('click', () => {
    if (DOM.searchBar.classList.contains('hidden')) openGlobalSearch();
    else closeGlobalSearch();
  });
  DOM.searchClose.addEventListener('click', closeGlobalSearch);
  DOM.searchInput.addEventListener('input', debounce(() => {
    S.searchQuery = DOM.searchInput.value.trim().toLowerCase();
    performGlobalSearch();
  }, 250));

  // 🆕 v3.8.5: FAB «+» → меню создания
  DOM.addBtn.addEventListener('click', () => toggleFabMenu());
  DOM.scanBtn.addEventListener('click', () => openScanner());

  // Закрытие оверлеев
  DOM.formClose.addEventListener('click', () => closeOverlay(DOM.formOverlay));
  DOM.formBack?.addEventListener('click', () => closeOverlay(DOM.formOverlay));
  DOM.detailClose.addEventListener('click', () => closeOverlay(DOM.detailOverlay));
  DOM.detailBack?.addEventListener('click', () => closeOverlay(DOM.detailOverlay));
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

  // Обложка: камера + галерея
  DOM.coverPhotoBtn.addEventListener('click', () => DOM.coverPhotoInput.click());
  DOM.coverPhotoInput.addEventListener('change', handleCoverPhotoChange);
  DOM.coverGalleryBtn.addEventListener('click', () => DOM.coverGalleryInput.click());
  DOM.coverGalleryInput.addEventListener('change', handleCoverPhotoChange);

  document.addEventListener('btp-stats-sub', () => { pushSentinel(); });

  // PWA обновление / установка
  $('#update-apply')?.addEventListener('click', () => {
    navigator.serviceWorker?.getRegistration().then(r => r?.waiting?.postMessage('SKIP_WAITING'));
    DOM.updateBanner.classList.add('hidden');
  });
  $('#update-dismiss')?.addEventListener('click', () => DOM.updateBanner.classList.add('hidden'));
  $('#install-apply')?.addEventListener('click', () => {
    if (S.deferredPrompt) { S.deferredPrompt.prompt(); S.deferredPrompt = null; DOM.installBanner.classList.add('hidden'); }
  });
  $('#install-dismiss')?.addEventListener('click', () => DOM.installBanner.classList.add('hidden'));

  // Escape (🆕 v3.8.5: сначала закрываем FAB-меню)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (document.querySelector('.fab-menu')) { closeFabMenu(); return; }
    if (!DOM.scannerOverlay.classList.contains('hidden')) closeScanner();
    else if (!DOM.coverOverlay.classList.contains('hidden')) closeOverlay(DOM.coverOverlay);
    else if (!DOM.formOverlay.classList.contains('hidden')) closeOverlay(DOM.formOverlay);
    else if (!DOM.detailOverlay.classList.contains('hidden')) closeOverlay(DOM.detailOverlay);
    else if (!DOM.contentOverlay.classList.contains('hidden')) closeOverlay(DOM.contentOverlay);
    else if (!DOM.reviewOverlay.classList.contains('hidden')) closeOverlay(DOM.reviewOverlay);
    else if (!DOM.searchBar.classList.contains('hidden')) closeGlobalSearch();
    else if (DOM.drawer.classList.contains('open')) toggleDrawer(false);
    closeStatusDropdown();
  });

  // Клик вне — закрыть FAB-меню и dropdown статуса
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.fab-menu') && !e.target.closest('#add-btn')) closeFabMenu();
    if (!e.target.closest('.status-dropdown') && !e.target.closest('.status-btn')) closeStatusDropdown();
  });
}

// ═══════════════════════════════════════════════
//  SVG-ИКОНКИ В ХРОМЕ + ШОРТКАТЫ МАНИФЕСТА
// ═══════════════════════════════════════════════
function injectNavIcons() {
  $$('.nav-item[data-tab]').forEach(btn => {
    const ic = btn.querySelector('.nav-icon');
    const name = TAB_ICONS[btn.dataset.tab];
    const size = NAV_ICON_SIZES[btn.dataset.tab] || 20;
    if (ic && name) ic.innerHTML = icon(name, size);
  });

  // 🆕 v3.8.5: переименование «Контент-план» → «Контент» в drawer
  const contentNav = document.querySelector('.nav-item[data-tab="content"]');
  if (contentNav) {
    contentNav.innerHTML = `<span class="nav-icon">${icon('film', 22)}</span> Контент <span class="nav-count" id="nav-count-content"></span>`;
  }

  const logo = $('.drawer-logo');
  if (logo) logo.innerHTML = icon('bookOpen', 26);

  DOM.searchToggle.innerHTML = icon('search', 20);
  DOM.scanBtn.innerHTML = icon('camera', 20);
  DOM.addBtn.innerHTML = icon('plus', 22);
  DOM.menuBtn.innerHTML = icon('menu', 20);
  DOM.drawerClose.innerHTML = icon('close', 18);

  if (DOM.drawerTitleCollections) DOM.drawerTitleCollections.innerHTML = icon('folder', 13) + ' Подборки <span class="drawer-arrow">' + icon('chevronRight', 11) + '</span>';
  if (DOM.drawerTitleSeries) DOM.drawerTitleSeries.innerHTML = icon('layers', 13) + ' Серии <span class="drawer-arrow">' + icon('chevronRight', 11) + '</span>';
  if (DOM.drawerTitleFilters) DOM.drawerTitleFilters.innerHTML = icon('filter', 13) + ' Фильтры <span class="drawer-arrow">' + icon('chevronRight', 11) + '</span>';

  if (DOM.formBack) DOM.formBack.innerHTML = icon('arrowLeft', 18);
  if (DOM.detailBack) DOM.detailBack.innerHTML = icon('arrowLeft', 18);

  ['form-close','detail-close','scanner-close','content-form-close',
   'review-form-close','cover-close'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = icon('close', 18);
  });

  const backBtn = document.getElementById('back-btn');
  if (backBtn) backBtn.innerHTML = icon('arrowLeft', 20);
  const searchClose = document.getElementById('search-close');
  if (searchClose) searchClose.innerHTML = icon('close', 18);
  ['microlink-preview-close', 'sync-close'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = icon('close', 18);
  });
  ['update-dismiss', 'install-dismiss'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = icon('close', 16);
  });
}

function handleManifestShortcuts() {
  const params = new URLSearchParams(location.search);
  const action = params.get('action');
  const tab = params.get('tab');
  if (action === 'add') setTimeout(() => openBookForm(), 300);
  else if (action === 'scan') setTimeout(() => openScanner(), 300);
  else if (tab && TAB_TITLES[tab]) renderTab(tab);
  if (action || tab) history.replaceState({}, '', location.pathname);
}

// ═══════════════════════════════════════════════
//  ГЛОБАЛЬНЫЙ ПОИСК
// ═══════════════════════════════════════════════
function openGlobalSearch() {
  DOM.mainContent.classList.add('hidden');
  DOM.searchBar.classList.remove('hidden');
  renderSearchScopes();
  renderSearchBookTags();
  performGlobalSearch();
  setTimeout(() => DOM.searchInput.focus(), 50);
}
function closeGlobalSearch() {
  DOM.searchBar.classList.add('hidden');
  DOM.searchResults.classList.add('hidden');
  DOM.mainContent.classList.remove('hidden');
  DOM.searchInput.value = '';
  S.searchQuery = '';
  S.searchBookTag = null;
}
function renderSearchScopes() {
  DOM.searchScopes.innerHTML = SEARCH_SCOPES.map(s => `
    <button class="scope-chip ${S.searchScope === s.id ? 'active' : ''}" data-scope="${s.id}">
      ${icon(s.icon, 13)} ${s.label}
    </button>
  `).join('');
  DOM.searchScopes.querySelectorAll('[data-scope]').forEach(chip => {
    chip.addEventListener('click', () => {
      S.searchScope = chip.dataset.scope;
      if (S.searchScope !== 'books') S.searchBookTag = null;
      renderSearchScopes();
      renderSearchBookTags();
      performGlobalSearch();
    });
  });
}
function renderSearchBookTags() {
  if (S.searchScope !== 'books') {
    DOM.searchBookTags.classList.add('hidden');
    DOM.searchBookTags.innerHTML = '';
    return;
  }
  DOM.searchBookTags.classList.remove('hidden');
  if (S.tags.length === 0) {
    DOM.searchBookTags.innerHTML = '<span class="text-small text-muted" style="padding:2px 4px">Тегов пока нет — добавьте в форме книги</span>';
    return;
  }
  DOM.searchBookTags.innerHTML = S.tags.map(t => {
    const color = sanitizeColor(t.color);
    return `
      <button class="booktag-chip ${S.searchBookTag === t.name ? 'active' : ''}"
              data-booktag="${esc(t.name)}"
              style="color:${color};border-color:${color}55">
        ${icon('tag', 11)} ${esc(t.name)}
      </button>`;
  }).join('');
  DOM.searchBookTags.querySelectorAll('[data-booktag]').forEach(chip => {
    chip.addEventListener('click', () => {
      S.searchBookTag = S.searchBookTag === chip.dataset.booktag ? null : chip.dataset.booktag;
      renderSearchBookTags();
      performGlobalSearch();
    });
  });
}
function matchesBook(b, q) {
  if (!q) return true;
  return b.title.toLowerCase().includes(q) ||
    b.author.toLowerCase().includes(q) ||
    (b.isbn || '').includes(q) ||
    (b.genre || '').toLowerCase().includes(q) ||
    (b.publisher || '').toLowerCase().includes(q) ||
    (b.series || '').toLowerCase().includes(q) ||
    (b.tags || []).some(t => t.toLowerCase().includes(q)) ||
    (b.tropes || []).some(t => t.toLowerCase().includes(q));
}
function performGlobalSearch() {
  const q = S.searchQuery;
  const scope = S.searchScope;
  const hasQuery = !!q || !!S.searchBookTag;
  const results = { books: [], content: [], reviews: [], quotes: [], collections: [], challenges: [], series: [], tags: [] };
  if (hasQuery) {
    if (scope === 'all' || scope === 'books') {
      results.books = S.books.filter(b => matchesBook(b, q));
      if (S.searchBookTag) results.books = results.books.filter(b => (b.tags || []).includes(S.searchBookTag));
    }
    if (scope === 'all' || scope === 'content') {
      for (const b of S.books) for (const c of (b.contentItems || [])) {
        if (!q || (c.title || '').toLowerCase().includes(q) || b.title.toLowerCase().includes(q)) {
          results.content.push({ ...c, bookId: b.id, bookTitle: b.title });
        }
      }
    }
    if (scope === 'all' || scope === 'reviews') {
      results.reviews = S.books.filter(b => {
        const r = b.review || {};
        if (!(r.text || r.rating > 0)) return false;
        if (!q) return true;
        return (r.text || '').toLowerCase().includes(q) ||
          (r.pros || '').toLowerCase().includes(q) ||
          (r.cons || '').toLowerCase().includes(q) ||
          b.title.toLowerCase().includes(q);
      });
    }
    if (scope === 'all' || scope === 'quotes') {
      for (const b of S.books) for (const qt of (b.review?.quotes || [])) {
        if (!q || qt.text.toLowerCase().includes(q)) {
          results.quotes.push({ ...qt, bookId: b.id, bookTitle: b.title });
        }
      }
    }
    if (scope === 'all' || scope === 'collections') {
      results.collections = S.collections.filter(c => !q || c.name.toLowerCase().includes(q));
    }
    if (scope === 'all' || scope === 'challenges') {
      results.challenges = S.challenges.filter(c => !q || c.name.toLowerCase().includes(q));
    }
    if (scope === 'all' || scope === 'series') {
      results.series = getSeriesList(S.books).filter(s => !q || s.name.toLowerCase().includes(q));
    }
    if (scope === 'all' || scope === 'tags') {
      results.tags = S.tags.filter(t => !q || t.name.toLowerCase().includes(q));
    }
  }
  renderSearchResults(results, hasQuery);
}
function renderSearchResults(results, hasQuery) {
  const el = DOM.searchResults;
  el.classList.remove('hidden');
  DOM.mainContent.classList.add('hidden');
  if (!hasQuery) {
    el.innerHTML = `<div class="search-hint">${icon('search', 16)} Начните вводить — поиск идёт по всем разделам сразу</div>`;
    return;
  }
  const total = Object.values(results).reduce((s, arr) => s + arr.length, 0);
  if (total === 0) {
    el.innerHTML = `<div class="search-hint">Ничего не найдено${S.searchQuery ? ` по «${esc(S.searchQuery)}»` : ''}</div>`;
    return;
  }
  let html = '';
  if (results.books.length) {
    html += searchSection(icon('library', 13) + ' Книги', results.books.length, results.books.map(b => `
      <div class="sr-item" data-sr-book="${b.id}">
        ${b.coverUrl ? `<img class="sr-cover" src="${b.coverUrl}" alt="" loading="lazy" referrerpolicy="no-referrer"/>` : `<div class="sr-cover ph">${icon('bookClosed', 16)}</div>`}
        <div class="sr-info">
          <div class="sr-title">${esc(b.title)}</div>
          <div class="sr-sub">${esc(b.author)}${b.series ? ' · ' + esc(b.series) : ''}</div>
        </div>
      </div>`).join(''));
  }
  if (results.content.length) {
    html += searchSection(icon('film', 13) + ' Контент', results.content.length, results.content.map(c => `
      <div class="sr-item" data-sr-content-book="${c.bookId}" data-sr-content-id="${c.id}">
        <div class="sr-icon">${icon(CONTENT_TYPE_ICONS[c.type] || 'film', 20)}</div>
        <div class="sr-info">
          <div class="sr-title">${esc(c.title || CONTENT_LABELS[c.type] || c.type)}</div>
          <div class="sr-sub">${icon('bookClosed', 11)} ${esc(c.bookTitle)}</div>
        </div>
      </div>`).join(''));
  }
  if (results.reviews.length) {
    html += searchSection(icon('pen', 13) + ' Отзывы', results.reviews.length, results.reviews.map(b => `
      <div class="sr-item" data-sr-book="${b.id}">
        <div class="sr-icon">${icon('pen', 20)}</div>
        <div class="sr-info">
          <div class="sr-title">${esc(b.title)}</div>
          <div class="sr-sub">${starsRow(b.review?.rating || 0)} ${esc((b.review?.text || '').slice(0, 60))}</div>
        </div>
      </div>`).join(''));
  }
  if (results.quotes.length) {
    html += searchSection(icon('quote', 13) + ' Цитаты', results.quotes.length, results.quotes.map(qt => `
      <div class="sr-item" data-sr-book="${qt.bookId}">
        <div class="sr-icon">${icon('quote', 20)}</div>
        <div class="sr-info">
          <div class="sr-title">«${esc(qt.text.slice(0, 70))}»</div>
          <div class="sr-sub">${icon('bookClosed', 11)} ${esc(qt.bookTitle)}${qt.page ? ' · с. ' + qt.page : ''}</div>
        </div>
      </div>`).join(''));
  }
  if (results.collections.length) {
    html += searchSection(icon('folder', 13) + ' Подборки', results.collections.length, results.collections.map(c => `
      <div class="sr-item" data-sr-collection="${c.id}">
        <div class="sr-icon" aria-hidden="true">${c.emoji}</div>
        <div class="sr-info">
          <div class="sr-title">${esc(c.name)}</div>
          <div class="sr-sub">${c.bookIds.length} книг</div>
        </div>
      </div>`).join(''));
  }
  if (results.challenges.length) {
    html += searchSection(icon('trophy', 13) + ' Челленджи', results.challenges.length, results.challenges.map(c => `
      <div class="sr-item" data-sr-challenge="${c.id}">
        <div class="sr-icon" aria-hidden="true">${c.emoji || '🏆'}</div>
        <div class="sr-info">
          <div class="sr-title">${esc(c.name)}</div>
          <div class="sr-sub">${c.status === 'active' ? 'Активен' : c.status}</div>
        </div>
      </div>`).join(''));
  }
  if (results.series.length) {
    html += searchSection(icon('layers', 13) + ' Серии', results.series.length, results.series.map(s => `
      <div class="sr-item" data-sr-series="${esc(s.name)}">
        <div class="sr-icon" aria-hidden="true">${s.emoji}</div>
        <div class="sr-info">
          <div class="sr-title">${esc(s.name)}</div>
          <div class="sr-sub">${s.read} из ${s.effectiveTotal} прочитано</div>
        </div>
      </div>`).join(''));
  }
  if (results.tags.length) {
    html += searchSection(icon('tag', 13) + ' Теги', results.tags.length, results.tags.map(t => {
      const color = sanitizeColor(t.color, 'var(--accent)');
      return `
        <div class="sr-item" data-sr-tag="${esc(t.name)}">
          <div class="sr-icon" style="color:${color}">${icon('tag', 20)}</div>
          <div class="sr-info">
            <div class="sr-title" style="color:${sanitizeColor(t.color, 'var(--text-primary)')}">${esc(t.name)}</div>
            <div class="sr-sub">Нажмите, чтобы отфильтровать книги</div>
          </div>
        </div>`;
    }).join(''));
  }
  el.innerHTML = html;
  bindSearchResultEvents(el);
}
function searchSection(title, count, inner) {
  return `
    <div class="sr-section">
      <div class="sr-section-title">${title} <span class="sr-count">${count}</span></div>
      ${inner}
    </div>`;
}
function bindSearchResultEvents(el) {
  const go = (fn) => { closeGlobalSearch(); fn(); };
  el.querySelectorAll('[data-sr-book]').forEach(item => {
    item.addEventListener('click', () => go(() => openBookDetail(item.dataset.srBook)));
  });
  // 🆕 v3.8.5: контент из поиска → read-only карточка
  el.querySelectorAll('[data-sr-content-book]').forEach(item => {
    item.addEventListener('click', () => {
      const book = S.books.find(b => b.id === item.dataset.srContentBook);
      const contentItem = (book?.contentItems || []).find(c => c.id === item.dataset.srContentId);
      go(() => openContentDetail(contentItem, book, { settings: S.settings }));
    });
  });
  el.querySelectorAll('[data-sr-collection]').forEach(item => {
    item.addEventListener('click', () => go(() => { S.openCollection = item.dataset.srCollection; renderTab('collections'); }));
  });
  el.querySelectorAll('[data-sr-challenge]').forEach(item => {
    item.addEventListener('click', () => go(() => { S.openChallenge = item.dataset.srChallenge; renderTab('challenges'); }));
  });
  el.querySelectorAll('[data-sr-series]').forEach(item => {
    item.addEventListener('click', () => go(() => { S.openSeries = item.dataset.srSeries; renderTab('series'); }));
  });
  el.querySelectorAll('[data-sr-tag]').forEach(item => {
    item.addEventListener('click', () => go(() => { S.activeFilter = { type: 'tag', value: item.dataset.srTag }; renderTab('books'); }));
  });
}
// ═══════════════════════════════════════════════
//  ХЕЛПЕР: ряд SVG-звёзд (рейтинг)
// ═══════════════════════════════════════════════
function starsRow(n, size = 11) {
  let out = '';
  for (let i = 0; i < 5; i++) {
    const filled = i < n;
    out += `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" ` +
      `fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.6" ` +
      `aria-hidden="true" style="color:${filled ? 'var(--accent)' : 'var(--text-muted)'};vertical-align:middle">` +
      `<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/></svg>`;
  }
  return out;
}

// ═══════════════════════════════════════════════
//  НАВИГАЦИЯ / ТАБЫ (🆕 контент → read-only карточка)
// ═══════════════════════════════════════════════
function renderTab(tab) {
  S.currentTab = tab;
  DOM.pageTitle.innerHTML = icon(TAB_ICONS[tab] || 'bookOpen', 20) + '<span>' + esc(TAB_TITLES[tab] || tab) + '</span>';
  $$('.nav-item[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  if (!DOM.searchBar.classList.contains('hidden')) closeGlobalSearch();
  renderActiveFilters();
  const mc = DOM.mainContent;

  switch (tab) {
    case 'books': renderBooksTab(); break;
    case 'content': renderContentTab(mc, S.books, S.settings, {
      // 🆕 v3.8.5: клик по контенту → read-only карточка, не редактор
      onEdit: (item, bookId) => {
        const book = S.books.find(b => b.id === bookId);
        openContentDetail(item, book, { settings: S.settings });
      },
      onDelete: handleDeleteContent,
      onStatusChange: handleContentStatus,
      onAdd: () => openContentForm(null, null, S.settings),
    }); break;
    case 'reviews': renderReviewsTab(mc, S.books, {
      onEdit: openReviewForm, onDelete: handleDeleteReview, onOpenBook: openBookDetail,
    }); break;
    case 'calendar': renderCalendarTab(mc, S.books, {
      onDayClick: showDayContent,
      // 🆕 v3.8.5: клик по контенту в календаре → read-only карточка
      onOpenContent: (item, bookId) => {
        const book = S.books.find(b => b.id === bookId);
        openContentDetail(item, book, { settings: S.settings });
      },
      onAdd: () => openContentForm(null, null, S.settings),
    }); break;
    case 'challenges': renderChallenges(); break;
    case 'stats': renderStatsTab(mc, S.books, S.settings, S.challenges); break;
    case 'settings': renderSettingsTab(); break;
    case 'series': renderSeriesScreen(); break;
    case 'collections': renderCollectionsScreen(); break;
  }
}

// ═══════════════════════════════════════════════
//  DRAWER (🆕 без «+ Новая подборка»)
// ═══════════════════════════════════════════════
function renderDrawer() {
  // 🆕 v3.8.5: считываем счётчики свежими (content-узел пересоздаётся в injectNavIcons)
  const ncBooks = document.getElementById('nav-count-books');
  const ncContent = document.getElementById('nav-count-content');
  const ncReviews = document.getElementById('nav-count-reviews');
  const ncCh = document.getElementById('nav-count-challenges');
  if (ncBooks) ncBooks.textContent = S.books.filter(b => b.id !== '__no_book__').length || '';
  if (ncContent) ncContent.textContent = S.books.reduce((s, b) => s + (b.contentItems || []).length, 0) || '';
  if (ncReviews) ncReviews.textContent = S.books.filter(b => b.review?.text || b.review?.rating > 0).length || '';
  if (ncCh) ncCh.textContent = S.challenges.filter(c => c.status === 'active').length || '';

  DOM.drawerCollections.innerHTML = S.collections.map(c => `
    <button class="nav-item sub" data-collection="${c.id}">
      <span class="nav-icon" aria-hidden="true">${c.emoji}</span> ${esc(c.name)}
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

  const series = getSeriesList(S.books);
  DOM.drawerSeries.innerHTML = series.length === 0
    ? '<div style="padding:4px 14px 8px;font-size:.78rem;color:var(--text-muted)">Нет серий</div>'
    : series.map(s => `
      <button class="nav-item sub" data-series="${esc(s.name)}">
        <span class="nav-icon" aria-hidden="true">${s.emoji}</span> <span class="truncate" style="flex:1">${esc(s.name)}</span>
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

  DOM.drawerFilters.innerHTML = renderDrawerFilters(S.books);
  DOM.drawerFilters.querySelectorAll('.drawer-filter-toggle').forEach(t => {
    t.addEventListener('click', () => {
      t.classList.toggle('open');
      const items = DOM.drawerFilters.querySelector(`[data-fitems="${t.dataset.ftoggle}"]`);
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
//  АКТИВНЫЕ ФИЛЬТРЫ (🆕 SVG)
// ═══════════════════════════════════════════════
function renderActiveFilters() {
  const el = DOM.activeFilters;
  if (!S.activeFilter) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  const labels = {
    tag: icon('tag', 12), collection: icon('folder', 12), series: icon('layers', 12),
    genre: icon('folder', 12) + ' Жанр', author: icon('users', 12) + ' Автор', publisher: icon('library', 12),
  };
  el.classList.remove('hidden');
  el.innerHTML = `
    <span class="active-filter-chip">
      ${labels[S.activeFilter.type] || ''} ${esc(S.activeFilter.value)}
      <button id="clear-filter" aria-label="Сбросить фильтр">${icon('close', 11)}</button>
    </span>
  `;
  el.querySelector('#clear-filter').addEventListener('click', () => {
    S.activeFilter = null;
    renderTab(S.currentTab);
  });
}

// ═══════════════════════════════════════════════
//  ВКЛАДКА: КНИГИ (🆕 SVG-фильтры)
// ═══════════════════════════════════════════════
function renderBooksTab() {
  const mc = DOM.mainContent;
  let books = S.books.filter(b => b.id !== '__no_book__');

  const filters = [
    { id: 'all', label: 'Все', ic: '' },
    { id: 'wishlist', label: 'Wishlist', ic: 'star' },
    { id: 'added', label: 'Добавлено', ic: 'box' },
    { id: 'reading', label: 'Читаю', ic: 'bookOpen' },
    { id: 'finished', label: 'Прочитано', ic: 'checkCircle' },
    { id: 'paused', label: 'Пауза', ic: 'pause' },
    { id: 'dropped', label: 'Брошено', ic: 'xCircle' },
    { id: 'pr', label: 'PR', ic: 'box' },
  ];

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
  else if (S.bookFilter === 'pr') books = books.filter(b => b.isPR);
  else if (S.bookFilter !== 'all') books = books.filter(b => b.status === S.bookFilter);

  books.sort((a, b) => (b.dateAdded || '').localeCompare(a.dateAdded || ''));

  mc.innerHTML = `
    <div class="filter-bar no-scrollbar">
      ${filters.map(f => `
        <button class="filter-chip ${S.bookFilter === f.id && !S.activeFilter ? 'active' : ''}"
                data-filter="${f.id}">${f.ic ? icon(f.ic, 13) + ' ' : ''}${f.label}</button>
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

  mc.querySelectorAll('.book-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.status-btn')) return;
      if (e.target.closest('.tag-chip')) return;
      if (e.target.closest('.tag-more-btn')) return;
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

  mc.querySelectorAll('.tag-more-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openBookDetail(btn.dataset.id);
    });
  });
}

function renderEmptyBooks() {
  return `
    <div class="empty-state">
      <div class="empty-icon">${icon('library', 56)}</div>
      <div class="empty-title">Пока нет книг</div>
      <div class="empty-text">
        Нажмите ＋ чтобы добавить книгу, 📷 чтобы
        отсканировать ISBN, или найдите книгу в интернете
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════
//  КАРТОЧКА КНИГИ (🆕 метка полки + SVG-бейджи)
// ═══════════════════════════════════════════════
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
    ? `<img class="book-cover" src="${book.coverUrl}" alt="" loading="lazy" referrerpolicy="no-referrer"/>`
    : `<div class="book-cover-placeholder">${icon('bookClosed', 32)}<span class="cover-ph-title">${esc(book.title)}</span></div>`;

  const priceHtml = (S.settings.showPriceInCards && book.price?.amount > 0)
    ? `<span class="book-badge badge-price">${icon('coin', 11)} ${formatPrice(book.price)}</span>` : '';
  const seriesHtml = book.series
    ? `<span class="book-badge badge-series">${icon('layers', 11)} ${esc(book.series)}${book.seriesNumber ? ' #' + book.seriesNumber : ''}</span>` : '';
  const formatsHtml = (book.formats || []).map(f => {
    const fmt = BOOK_FORMATS[f];
    return fmt ? `<span class="book-badge badge-format-${f}">${icon(fmt.icon, 11)} ${fmt.label}</span>` : '';
  }).join('');

  // 🆕 v3.8.5: метка полки (круг → пилюля) в строке заголовка
  const markHtml = (book.shelfMark?.text)
    ? `<span class="shelf-mark" style="background:${sanitizeColor(book.shelfMark.color, 'var(--accent)')}">${esc(book.shelfMark.text)}</span>`
    : '';

  const allTags = book.tags || [];
  const visible = allTags.slice(0, 3);
  const tagsHtml = visible.map(t => {
    const tag = S.tags.find(x => x.name === t);
    const color = sanitizeColor(tag?.color);
    return `<span class="tag-chip" data-tag="${esc(t)}" style="color:${color};border-color:${color}40">${esc(t)}</span>`;
  }).join('') + (allTags.length > 3
    ? `<button class="tag-more-btn" data-id="${book.id}">+${allTags.length - 3}</button>` : '');

  return `
    <div class="book-card" data-id="${book.id}">
      ${coverHtml}
      <div class="book-info">
        <div class="book-title-row">
          <div class="book-title">${esc(book.title)}</div>
          ${markHtml}
        </div>
        <div class="book-author">${esc(book.author)}</div>
        <div class="book-meta">
          <button class="book-badge ${statusClass} status-btn" data-book-id="${book.id}" aria-label="Статус: ${st.label}">
            ${statusIcon(book.status, 12)} ${st.label} ${icon('chevronDown', 10)}
          </button>
          ${book.isPR ? `<span class="book-badge badge-pr">${icon('box', 11)} PR</span>` : ''}
          ${seriesHtml}
          ${priceHtml}
          ${formatsHtml}
          ${contentCount > 0 ? `<span class="book-badge badge-content">${icon('film', 11)} ${contentCount}${publishedCount ? ' · ' + icon('send', 10) + publishedCount : ''}</span>` : ''}
          ${book.review?.rating > 0 ? `<span class="book-badge badge-rating">${starsRow(book.review.rating)}</span>` : ''}
          ${book.jointReading?.active ? `<span class="book-badge badge-content">${icon('users', 11)} совместно</span>` : ''}
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
//  DROPDOWN СТАТУСА (🆕 SVG)
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
      ${statusIcon(key, 14)} ${st.label}
      ${book.status === key ? `<span style="margin-left:auto">${icon('check', 12)}</span>` : ''}
    </button>
  `).join('');
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
      else showToast(`Статус: ${BOOK_STATUSES[newStatus].label}`, 'success');
    });
  });
}
function closeStatusDropdown() {
  if (_statusDropdown) { _statusDropdown.remove(); _statusDropdown = null; }
}

// ═══════════════════════════════════════════════
//  МОДАЛКА ОЦЕНКИ (🆕 SVG)
// ═══════════════════════════════════════════════
function openRatingModal(book) {
  const isDropped = book.status === 'dropped';
  const modal = document.createElement('div');
  modal.className = 'rating-modal';
  modal.innerHTML = `
    <div class="rating-modal-panel">
      <div class="rating-modal-emoji">${isDropped ? icon('bookClosed', 44) : icon('trophy', 44)}</div>
      <div class="rating-modal-title">${isDropped ? 'Книга брошена' : 'Поздравляю, прочитано!'}</div>
      <div class="rating-modal-book">«${esc(book.title)}»${book.readingDays ? ` · ${book.readingDays} дн.` : ''}</div>
      <div class="star-rating" id="rm-stars">
        ${[1,2,3,4,5].map(i => `<span class="star" data-star="${i}">★</span>`).join('')}
      </div>
      <div class="btn-group" style="margin-top:0">
        <button id="rm-review" class="btn-primary">
          ${book.review?.text || book.review?.rating > 0 ? 'Дополнить отзыв' : 'Написать отзыв'}
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
//  🆕 v3.8.5: ДОП.ОЦЕНКИ — SVG-иконки
// ═══════════════════════════════════════════════
function extraRowHtml(cfg, value) {
  return `
    <div class="form-group">
      <label>${cfg.label}</label>
      <div class="extra-rating-row" data-rating-id="${cfg.id}" style="color:${cfg.color}">
        ${[1,2,3,4,5].map(i => `<span class="extra-star${value >= i ? ' filled' : ''}" data-val="${i}">${icon(cfg.icon, 18)}</span>`).join('')}
        <input type="hidden" id="${cfg.id}" value="${value}"/>
      </div>
    </div>
  `;
}
function bindExtraRatings(fb) {
  fb.querySelectorAll('.extra-rating-row').forEach(row => {
    const inputId = row.dataset.ratingId;
    const input = fb.querySelector('#' + inputId);
    const stars = row.querySelectorAll('.extra-star');
    let currentVal = parseInt(input?.value || 0);
    const update = (v) => stars.forEach((s, i) => s.classList.toggle('filled', i < v));
    stars.forEach(s => {
      s.addEventListener('click', () => {
        const v = parseInt(s.dataset.val);
        currentVal = (currentVal === v) ? 0 : v;
        if (input) input.value = currentVal;
        update(currentVal);
      });
      s.addEventListener('mouseenter', () => update(parseInt(s.dataset.val)));
      s.addEventListener('mouseleave', () => update(currentVal));
    });
  });
}

// ═══════════════════════════════════════════════
//  ФОРМА КНИГИ (🆕 метка полки + SVG доп.оценки + дата-пикер PR)
// ═══════════════════════════════════════════════
function openBookForm(book = null) {
  S.editingBookId = book?.id || null;
  DOM.formTitle.innerHTML = book ? `${icon('edit', 18)} Редактировать книгу` : `${icon('library', 18)} Новая книга`;
  const b = book || {};
  const cur = b.price?.currency || S.settings.defaultCurrency;
  const selectedTags = new Set(b.tags || []);
  const selectedFormats = new Set(b.formats || []);

  const extraValues = {
    'bf-pepper': b.pepperRating || 0,
    'bf-tear': b.tearRating || 0,
    'bf-intrigue': b.intrigueRating || 0,
    'bf-horror': b.horrorRating || 0,
  };

  DOM.formBody.innerHTML = `
    <div class="form-group">
      <label>${icon('search', 13)} Найти по ISBN</label>
      <div class="flex gap-8">
        <input type="text" id="bf-isbn" value="${esc(b.isbn || '')}" placeholder="978-5-17-098765-8" inputmode="numeric"/>
        <button id="bf-scan" class="btn-secondary" style="width:auto;flex-shrink:0">${icon('camera', 15)}</button>
        <button id="bf-find" class="btn-secondary" style="width:auto;flex-shrink:0">Найти</button>
      </div>
    </div>
    <div class="form-group">
      <label>${icon('globe', 13)} Поиск книги в интернете</label>
      <div class="flex gap-8">
        <input type="text" id="bf-webquery" placeholder="Название и автор, напр. «Мастер и Маргарита Булгаков»"/>
        <button id="bf-websearch" class="btn-secondary" style="width:auto;flex-shrink:0">${icon('search', 14)} Искать</button>
      </div>
      <div id="bf-webresults" class="web-search-results"></div>
    </div>
    <div class="form-group">
      <label>${icon('link', 13)} Или вставьте ссылку на страницу книги</label>
      <div class="flex gap-8">
        <input type="url" id="bf-page-url" placeholder="https://www.litres.ru/book/..."/>
        <button id="bf-page-extract" class="btn-secondary" style="width:auto;flex-shrink:0">${icon('download', 14)}</button>
      </div>
      <div class="form-hint">ЛитРес, Book24, Ozon — данные извлекутся автоматически (Microlink)</div>
    </div>
    <div class="divider"></div>
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
    <div class="form-group">
      <label>Обложка</label>
      <div class="flex gap-8 mb-8">
        <input type="file" id="bf-cover-gallery" accept="image/*" class="hidden"/>
        <input type="file" id="bf-cover-camera" accept="image/*" capture="environment" class="hidden"/>
        <button type="button" id="bf-cover-gallery-btn" class="btn-secondary" style="flex:1">${icon('image', 14)} Из галереи</button>
        <button type="button" id="bf-cover-camera-btn" class="btn-secondary" style="flex:1">${icon('camera', 14)} Камера</button>
      </div>
      <input type="url" id="bf-cover" value="${esc(b.cover || b.coverUrl || '')}" placeholder="https://... или загрузите выше"/>
      <div id="bf-cover-preview" class="cover-preview hidden">
        <img id="bf-cover-preview-img" src="" alt="Предпросмотр обложки"/>
      </div>
    </div>

    <!-- 🆕 v3.8.5: Метка полки -->
    <div class="form-section">
      <h3>${icon('tag', 15)} Метка полки</h3>
      <div class="form-hint mb-8">Цветная метка, чтобы знать, на какой полке стоит книга</div>
      <div class="shelf-mark-row">
        <input type="color" id="bf-shelf-color" value="${sanitizeColor(b.shelfMark?.color, '#e8a33d').replace('var(--accent)','#e8a33d')}" aria-label="Цвет метки"/>
        <input type="text" id="bf-shelf-text" value="${esc(b.shelfMark?.text || '')}" maxlength="4" placeholder="А1" aria-label="Текст метки"/>
        <span class="shelf-mark-preview" id="bf-shelf-preview"
              style="background:${sanitizeColor(b.shelfMark?.color, 'var(--accent)')}">${esc(b.shelfMark?.text || '')}</span>
        <button type="button" id="bf-shelf-clear" class="icon-btn" aria-label="Убрать метку">${icon('close', 14)}</button>
      </div>
    </div>

    <div class="form-section">
      <h3>${icon('bookClosed', 15)} Формат книги</h3>
      <div class="form-group">
        <div class="tags-chips" id="bf-formats">
          ${Object.entries(BOOK_FORMATS).map(([key, fmt]) => `
            <button class="tag-pick-chip ${selectedFormats.has(key) ? 'active' : ''}" data-format="${key}">
              ${icon(fmt.icon, 13)} ${fmt.label}
            </button>
          `).join('')}
        </div>
      </div>
    </div>
    <div class="form-section">
      <h3>${icon('layers', 15)} Серия</h3>
      <div class="form-group"><label>Название серии</label><input type="text" id="bf-series" value="${esc(b.series || '')}" placeholder="Гарри Поттер" autocomplete="off"/></div>
      <div class="form-row">
        <div class="form-group"><label>Номер в серии</label><input type="number" id="bf-series-num" value="${b.seriesNumber || ''}" min="1" placeholder="1"/></div>
        <div class="form-group"><label>Всего книг в серии</label><input type="number" id="bf-series-total" value="${b.seriesTotal || ''}" min="1" placeholder="7"/></div>
      </div>
    </div>
    <div class="form-section">
      <h3>${icon('coin', 15)} Цена</h3>
      <div class="form-row">
        <div class="form-group"><label>Цена</label><input type="number" id="bf-price" value="${b.price?.amount || ''}" min="0" placeholder="599"/></div>
        <div class="form-group"><label>Валюта</label>
          <select id="bf-currency">
            ${Object.entries(CURRENCIES).map(([k, c]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${c.symbol} ${c.name}</option>`).join('')}
          </select>
        </div>
      </div>
    </div>
    <div class="form-section">
      <h3>${icon('bookOpen', 15)} Статус</h3>
      <div class="form-group"><label>Статус</label>
        <select id="bf-status">
          ${Object.entries(BOOK_STATUSES).map(([k, st]) => `<option value="${k}" ${(b.status || 'wishlist') === k ? 'selected' : ''}>${st.label}</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Текущая страница</label><input type="number" id="bf-page" value="${b.currentPage || 0}" min="0"/></div>
        <div class="form-group"><label>Оценка (1–5)</label><input type="number" id="bf-rating" value="${b.rating || b.review?.rating || 0}" min="0" max="5"/></div>
      </div>
    </div>
    <div class="form-section">
      <h3>${icon('fire', 15)} Дополнительные оценки</h3>
      <div class="form-hint mb-8">Оценки от 0 до 5 по каждому параметру</div>
      <div class="form-row-2">
        ${EXTRA_RATINGS.map(cfg => extraRowHtml(cfg, extraValues[cfg.id])).join('')}
      </div>
    </div>
    <div class="form-section">
      <h3>${icon('users', 15)} Герои книги</h3>
      <div class="form-hint mb-8">Добавьте персонажей и оцените их</div>
      <div id="bf-characters-list">
        ${(b.characters || []).map((ch, i) => `
          <div class="character-row" data-char-idx="${i}">
            <input type="text" class="char-name-input" value="${esc(ch.name || '')}" placeholder="Имя персонажа" style="flex:1"/>
            <div class="char-stars">
              ${[1,2,3,4,5].map(s => `<span class="char-star${(ch.rating || 0) >= s ? ' filled' : ''}" data-star="${s}">★</span>`).join('')}
              <input type="hidden" class="char-rating" value="${ch.rating || 0}"/>
            </div>
            <button type="button" class="icon-btn char-del" title="Удалить" aria-label="Удалить">${icon('close', 14)}</button>
          </div>`).join('')}
      </div>
      <button type="button" id="bf-add-char" class="btn-secondary mt-8" style="width:100%">＋ Добавить персонажа</button>
    </div>
    <div class="form-section">
      <h3>${icon('tag', 15)} Теги</h3>
      <div class="form-group">
        <label>Существующие теги</label>
        <div id="bf-tags-chips" class="tags-chips">
          ${S.tags.length === 0
            ? '<span class="text-small text-muted">Тегов пока нет — добавьте новые ниже</span>'
            : S.tags.map(t => {
                const color = sanitizeColor(t.color);
                return `<button class="tag-pick-chip ${selectedTags.has(t.name) ? 'active' : ''}"
                        data-tag="${esc(t.name)}"
                        style="color:${color};border-color:${color}55">${esc(t.name)}</button>`;
              }).join('')}
        </div>
      </div>
      <div class="form-group"><label>Добавить новые (через запятую)</label>
        <input type="text" id="bf-tags" value="" placeholder="фэнтези, бумажная, перечитать"/>
      </div>
    </div>
    <div class="form-section">
      <h3>${icon('sparkles', 15)} Тропы</h3>
      <div class="form-group">
        <label>Тропы книги (через запятую)</label>
        <input type="text" id="bf-tropes" value="${esc((b.tropes || []).join(', '))}" placeholder="enemies to lovers, slow burn, академия магии"/>
        <div class="form-hint">Тропы помогают находить книги по сюжетным паттернам</div>
      </div>
    </div>
    <div class="form-section">
      <h3>${icon('film', 15)} Для блога</h3>
      <div class="toggle-row">
        <span class="toggle-label">${icon('box', 13)} Получена от издательства (PR)</span>
        <div class="toggle ${b.isPR ? 'active' : ''}" id="bf-pr-toggle" role="switch" aria-checked="${!!b.isPR}" tabindex="0"></div>
      </div>
      <div id="bf-pr-fields" class="${b.isPR ? '' : 'hidden'}">
        <div class="form-group"><label>От кого</label><input type="text" id="bf-received-from" value="${esc(b.receivedFrom || '')}" placeholder="Издательство ЭКСМО"/></div>
        <div class="form-group"><label>Дата получения</label><input type="date" id="bf-received-date" value="${b.receivedDate || ''}"/></div>
      </div>
    </div>
    <div class="form-section">
      <h3>${icon('users', 15)} Совместное чтение</h3>
      <div class="toggle-row">
        <span class="toggle-label">Читаем вместе с кем-то</span>
        <div class="toggle ${b.jointReading?.active ? 'active' : ''}" id="bf-joint-toggle" role="switch" aria-checked="${!!b.jointReading?.active}" tabindex="0"></div>
      </div>
      <div id="bf-joint-fields" class="${b.jointReading?.active ? '' : 'hidden'}">
        <div class="form-group"><label>Участники (через запятую)</label><input type="text" id="bf-joint-people" value="${esc((b.jointReading?.participants || []).join(', '))}" placeholder="Аня, Маша, Катя"/></div>
        <div class="form-group"><label>Ссылка на чат</label><input type="url" id="bf-joint-chat" value="${esc(b.jointReading?.chatLink || '')}" placeholder="https://t.me/+..."/></div>
        <div class="form-group"><label>Заметки</label><input type="text" id="bf-joint-notes" value="${esc(b.jointReading?.notes || '')}" placeholder="Читаем по 3 главы в день"/></div>
      </div>
    </div>
    <div class="form-section">
      <h3>${icon('edit', 15)} Заметки</h3>
      <div class="form-group"><textarea id="bf-notes" rows="3" placeholder="Личные заметки...">${esc(b.notes || '')}</textarea></div>
    </div>
    <div class="btn-group">
      <button id="bf-save" class="btn-primary">${icon('check', 15)} Сохранить</button>
      ${book ? `<button id="bf-delete" class="btn-danger">${icon('trash', 14)} Удалить</button>` : ''}
    </div>
  `;

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
    const result = await extractBookPreview(url);
    btn.disabled = false;
    if (result && result.merged && result.merged.title) {
      openMicrolinkPreview(result, fb);
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

  // 🆕 v3.8.5: живой предпросмотр метки полки
  const shelfColor = fb.querySelector('#bf-shelf-color');
  const shelfText = fb.querySelector('#bf-shelf-text');
  const shelfPrev = fb.querySelector('#bf-shelf-preview');
  const updateShelfPreview = () => {
    shelfPrev.style.background = shelfColor.value;
    shelfPrev.textContent = shelfText.value.trim();
  };
  shelfColor.addEventListener('input', updateShelfPreview);
  shelfText.addEventListener('input', updateShelfPreview);
  fb.querySelector('#bf-shelf-clear').addEventListener('click', () => {
    shelfText.value = '';
    updateShelfPreview();
  });

  async function handleFormCoverFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    try {
      const bitmap = await createImageBitmap(file);
      const MAX = 800;
      const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
      fb.querySelector('#bf-cover').value = dataUrl;
      fb.querySelector('#bf-cover-preview-img').src = dataUrl;
      fb.querySelector('#bf-cover-preview').classList.remove('hidden');
      showToast('✅ Обложка загружена', 'success');
    } catch (err) { showToast('❌ Не удалось загрузить: ' + err.message, 'error'); }
  }
  fb.querySelector('#bf-cover-gallery-btn').addEventListener('click', () => fb.querySelector('#bf-cover-gallery').click());
  fb.querySelector('#bf-cover-camera-btn').addEventListener('click', () => fb.querySelector('#bf-cover-camera').click());
  fb.querySelector('#bf-cover-gallery').addEventListener('change', handleFormCoverFile);
  fb.querySelector('#bf-cover-camera').addEventListener('change', handleFormCoverFile);

  fb.querySelectorAll('#bf-formats .tag-pick-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const f = chip.dataset.format;
      if (selectedFormats.has(f)) selectedFormats.delete(f); else selectedFormats.add(f);
      chip.classList.toggle('active');
    });
  });
  fb.querySelectorAll('#bf-tags-chips .tag-pick-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const t = chip.dataset.tag;
      if (selectedTags.has(t)) selectedTags.delete(t); else selectedTags.add(t);
      chip.classList.toggle('active');
    });
  });

  attachSeriesAutocomplete(fb.querySelector('#bf-series'), S.books, (name) => {
    const total = getSeriesTotal(S.books, name);
    if (total && !fb.querySelector('#bf-series-total').value) {
      fb.querySelector('#bf-series-total').value = total;
    }
  });
  attachCustomSelect(fb.querySelector('#bf-currency'), {});
  // 🆕 v3.8.5: статус — кастомный селект с SVG
  attachCustomSelect(fb.querySelector('#bf-status'), {
    renderOption: (opt) => `<span style="display:flex;align-items:center;gap:8px">${statusIcon(opt.value, 14)} ${esc(BOOK_STATUSES[opt.value]?.label || opt.textContent)}</span>`,
    renderTrigger: (opt) => `<span style="display:flex;align-items:center;gap:8px">${statusIcon(opt.value, 14)} ${esc(BOOK_STATUSES[opt.value]?.label || opt.textContent)}</span>`,
  });
  // 🆕 v3.8.5: дата-пикер для даты получения PR
  attachDatePicker(fb.querySelector('#bf-received-date'));

  const prToggle = fb.querySelector('#bf-pr-toggle');
  const togglePr = function() {
    this.classList.toggle('active');
    this.setAttribute('aria-checked', this.classList.contains('active'));
    fb.querySelector('#bf-pr-fields').classList.toggle('hidden');
  };
  prToggle.addEventListener('click', togglePr);
  prToggle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePr.call(prToggle); }
  });

  const jointToggle = fb.querySelector('#bf-joint-toggle');
  const toggleJoint = function() {
    this.classList.toggle('active');
    this.setAttribute('aria-checked', this.classList.contains('active'));
    fb.querySelector('#bf-joint-fields').classList.toggle('hidden');
  };
  jointToggle.addEventListener('click', toggleJoint);
  jointToggle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleJoint.call(jointToggle); }
  });

  bindExtraRatings(fb);

  function refreshCharList() {
    const list = fb.querySelector('#bf-characters-list');
    if (!list) return;
    list.querySelectorAll('.char-del').forEach(btn => {
      btn.onclick = () => btn.closest('.character-row').remove();
    });
    list.querySelectorAll('.char-star').forEach(star => {
      const row = star.closest('.char-stars');
      const ratingInput = row.querySelector('.char-rating');
      const allStars = row.querySelectorAll('.char-star');
      let cv = parseInt(ratingInput?.value || 0);
      const update = (v) => allStars.forEach((s, i) => s.classList.toggle('filled', i < v));
      star.onclick = () => {
        const v = parseInt(star.dataset.star);
        cv = (cv === v) ? 0 : v;
        if (ratingInput) ratingInput.value = cv;
        update(cv);
      };
      star.onmouseenter = () => update(parseInt(star.dataset.star));
      star.onmouseleave = () => update(cv);
    });
  }
  refreshCharList();
  fb.querySelector('#bf-add-char')?.addEventListener('click', () => {
    const list = fb.querySelector('#bf-characters-list');
    const row = document.createElement('div');
    row.className = 'character-row';
    row.innerHTML = `
      <input type="text" class="char-name-input" placeholder="Имя персонажа" style="flex:1"/>
      <div class="char-stars">
        ${[1,2,3,4,5].map(s => `<span class="char-star" data-star="${s}">★</span>`).join('')}
        <input type="hidden" class="char-rating" value="0"/>
      </div>
      <button type="button" class="icon-btn char-del" title="Удалить" aria-label="Удалить">${icon('close', 14)}</button>
    `;
    list.appendChild(row);
    refreshCharList();
  });

  fb.querySelector('#bf-save').addEventListener('click', () => saveBookForm(selectedTags, selectedFormats));
  const delBtn = fb.querySelector('#bf-delete');
  if (delBtn) delBtn.addEventListener('click', async () => {
    const ok = await showConfirm('Удалить эту книгу?', { danger: true, okText: 'Удалить' });
    if (ok) {
      await delBook(S.editingBookId);
      await deleteCover(S.editingBookId);
      closeOverlay(DOM.formOverlay);
      await refreshData();
      showToast('🗑️ Книга удалена', 'info');
    }
  });

  openOverlay(DOM.formOverlay);
}

// ═══════════════════════════════════════════════
//  СОХРАНЕНИЕ ФОРМЫ (🆕 shelfMark)
// ═══════════════════════════════════════════════
async function saveBookForm(selectedTags, selectedFormats) {
  const f = DOM.formBody;
  const title = f.querySelector('#bf-title').value.trim();
  if (!title) { showToast('⚠️ Введите название книги', 'error'); return; }

  const now = new Date().toISOString();
  const isPR = f.querySelector('#bf-pr-toggle').classList.contains('active');
  const isJoint = f.querySelector('#bf-joint-toggle').classList.contains('active');
  const freeTags = f.querySelector('#bf-tags').value.split(',').map(t => t.trim()).filter(Boolean);
  const tags = [...new Set([...(selectedTags ? [...selectedTags] : []), ...freeTags])];
  const tropes = f.querySelector('#bf-tropes').value.split(',').map(t => t.trim()).filter(Boolean);
  const formats = selectedFormats ? [...selectedFormats] : [];

  // 🆕 v3.8.5: метка полки
  const shelfText = f.querySelector('#bf-shelf-text').value.trim();
  const shelfMark = shelfText
    ? { color: f.querySelector('#bf-shelf-color').value, text: shelfText }
    : { color: '', text: '' };

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
    tags, tropes, formats, shelfMark,
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
    pepperRating: parseInt(f.querySelector('#bf-pepper')?.value) || 0,
    tearRating: parseInt(f.querySelector('#bf-tear')?.value) || 0,
    intrigueRating: parseInt(f.querySelector('#bf-intrigue')?.value) || 0,
    horrorRating: parseInt(f.querySelector('#bf-horror')?.value) || 0,
    characters: [...(f.querySelectorAll('#bf-characters-list .character-row') || [])].map(row => ({
      name: row.querySelector('.char-name-input')?.value.trim() || '',
      rating: parseInt(row.querySelector('.char-rating')?.value) || 0,
    })).filter(ch => ch.name),
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
    if (!S.tags.find(x => x.name === t)) {
      await putTag({ name: t, color: pickTagColor(S.tags.length) });
    }
  }

  const coverVal = bookData.cover;
  if (coverVal && coverVal.startsWith('data:')) {
    try {
      const arr = coverVal.split(',');
      const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
      const bytes = atob(arr[1]);
      const buf = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
      const blob = new Blob([buf], { type: mime });
      if (isValidCoverBlob(blob)) {
        await saveCover(bookData.id, blob);
        bookData.coverUrl = URL.createObjectURL(blob);
        cacheCoverUrl(bookData.id, bookData.coverUrl);
        bookData.cover = '';
      }
    } catch (err) { console.warn('[Cover] dataURL save failed:', err); }
  } else if (coverVal && coverVal.startsWith('http')) {
    try {
      const blob = await (await fetch(coverVal)).blob();
      if (isValidCoverBlob(blob)) {
        await saveCover(bookData.id, blob);
        bookData.coverUrl = URL.createObjectURL(blob);
        cacheCoverUrl(bookData.id, bookData.coverUrl);
      } else {
        bookData.coverUrl = coverVal;
      }
    } catch { bookData.coverUrl = coverVal; }
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
//  MICROLINK ПРЕДПРОСМОТР (маппинг полей)
// ═══════════════════════════════════════════════
function openMicrolinkPreview(result, fb) {
  const { merged, fields } = result;
  const TARGETS = [
    { value: '', label: '— Не использовать —' },
    { value: 'title', label: 'Название' }, { value: 'author', label: 'Автор' },
    { value: 'isbn', label: 'ISBN' }, { value: 'publisher', label: 'Издательство' },
    { value: 'year', label: 'Год' }, { value: 'pages', label: 'Страницы' },
    { value: 'genre', label: 'Жанр' }, { value: 'desc', label: 'Описание' },
    { value: 'cover', label: 'Обложка' }, { value: 'price', label: 'Цена' },
    { value: 'age', label: 'Возраст' }, { value: 'series', label: 'Серия' },
  ];
  const SOURCE_LABELS = { 'json-ld': 'JSON-LD', 'open-graph': 'Open Graph', 'microdata': 'Microdata', 'microlink': 'Microlink' };
  const mapping = {};
  (fields || []).forEach(f => { mapping[f.id] = f.target || ''; });

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="overlay-panel" style="max-height:88dvh">
      <div class="overlay-header">
        <h2>${icon('download', 16)} Предпросмотр данных</h2>
        <button class="icon-btn ml-close">${icon('close', 16)}</button>
      </div>
      <div class="overlay-body">
        <div class="text-small text-muted mb-16">
          Найдено полей: <strong>${(fields || []).length}</strong>.
          Назначьте, куда подставить каждое поле, затем «Применить».
        </div>
        <div id="ml-fields">
          ${(fields || []).map(f => `
            <div class="ml-field" data-field-id="${f.id}">
              <div class="ml-field-head">
                <span class="badge">${SOURCE_LABELS[f.source] || f.source}</span>
                <span class="text-small text-muted">${esc(f.key)}</span>
              </div>
              <div class="text-small" style="margin:6px 0">${esc(f.value || '—')}</div>
              <select class="ml-target" data-field-id="${f.id}">
                ${TARGETS.map(t => `<option value="${t.value}" ${mapping[f.id] === t.value ? 'selected' : ''}>${t.label}</option>`).join('')}
              </select>
            </div>
          `).join('')}
        </div>
        <button id="ml-apply" class="btn-primary mt-16">${icon('check', 15)} Применить</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  trackOverlay(overlay);

  overlay.querySelectorAll('.ml-target').forEach(sel => {
    sel.addEventListener('change', () => { mapping[sel.dataset.fieldId] = sel.value; });
  });

  const close = () => {
    overlay.remove();
    untrackOverlay(overlay);
    const anyOpen = [...document.querySelectorAll('.overlay')].some(o => !o.classList.contains('hidden'));
    if (!anyOpen) document.body.style.overflow = '';
  };
  overlay.querySelector('.ml-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  overlay.querySelector('#ml-apply').addEventListener('click', () => {
    const values = {};
    (fields || []).forEach(f => {
      const target = mapping[f.id];
      if (target && f.value && !values[target]) values[target] = f.value;
    });
    const set = (id, val) => { const el = fb.querySelector(id); if (el && val) el.value = val; };
    if (values.title) set('#bf-title', values.title);
    if (values.author) set('#bf-author', values.author);
    if (values.isbn) set('#bf-isbn', values.isbn);
    if (values.publisher) set('#bf-publisher', values.publisher);
    if (values.year) set('#bf-year', values.year);
    if (values.pages) set('#bf-pages', values.pages);
    if (values.genre) set('#bf-genre', values.genre);
    if (values.desc) set('#bf-desc', values.desc);
    if (values.cover) set('#bf-cover', values.cover);
    if (values.age) set('#bf-age', values.age);
    if (values.series) set('#bf-series', values.series);
    if (values.price) {
      const pm = values.price.match(/([\d.]+)\s*([A-Za-zА-Яа-я]*)/);
      if (pm) { set('#bf-price', pm[1]); if (pm[2]) set('#bf-currency', pm[2].toUpperCase()); }
    }
    close();
    showToast('✅ Данные применены', 'success');
  });
}

// ═══════════════════════════════════════════════
//  ПОИСК В ИНТЕРНЕТЕ (🆕 SVG-бейджи источников)
// ═══════════════════════════════════════════════
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
    google: { label: 'Google Books', cls: 'badge-reading', ic: 'bookOpen' },
    openlibrary: { label: 'Open Library', cls: 'badge-status', ic: 'library' },
    litres: { label: 'ЛитРес', cls: 'badge-pr', ic: 'bookClosed' },
    microlink: { label: 'Microlink', cls: 'badge-content', ic: 'link' },
  };

  resultsEl.innerHTML = results.map((r, i) => {
    const src = sourceMeta[r.source] || { label: r.source, cls: 'badge-source', ic: 'globe' };
    return `
      <div class="web-result" data-idx="${i}">
        ${r.cover ? `<img class="web-result-cover" src="${r.cover}" alt="" loading="lazy" referrerpolicy="no-referrer"/>` : `<div class="web-result-cover" style="display:flex;align-items:center;justify-content:center">${icon('bookClosed', 18)}</div>`}
        <div class="web-result-info">
          <div class="web-result-title">${esc(r.title)}</div>
          <div class="web-result-meta">${esc(r.author)}${r.publisher ? ' · ' + esc(r.publisher) : ''}${r.pageCount ? ' · ' + r.pageCount + ' стр.' : ''}</div>
          <span class="web-result-source book-badge ${src.cls}">${icon(src.ic, 11)} ${src.label}</span>
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
  set('#bf-title', r.title); set('#bf-author', r.author); set('#bf-genre', r.genre);
  set('#bf-publisher', r.publisher); set('#bf-year', r.publishedDate); set('#bf-pages', r.pageCount);
  set('#bf-desc', r.description); set('#bf-cover', r.cover); set('#bf-isbn', r.isbn);
  if (r.litresSeries?.length > 0) { set('#bf-series', r.litresSeries[0].name); set('#bf-series-num', r.litresSeries[0].number); }
  if (r.litresMinAge) set('#bf-age', r.litresMinAge + '+');
  if (r.price?.amount > 0) { set('#bf-price', r.price.amount); set('#bf-currency', r.price.currency); }
}

// ═══════════════════════════════════════════════
//  ISBN ПОИСК
// ═══════════════════════════════════════════════
async function handleIsbnLookup(isbnInput) {
  const isbn = cleanISBN(isbnInput);
  if (!validateISBN(isbn)) { showToast('❌ Неверный формат ISBN', 'error'); return; }
  showLoading('🔍 Ищу книгу...');
  if (isRussianISBN(isbn)) updateLoading('Российский ISBN — ищу в базах...');
  const litresKeys = S.settings.lrAppId && S.settings.lrSecret
    ? { appId: S.settings.lrAppId, secretKey: S.settings.lrSecret } : null;
  const book = await fetchBookByIsbn(isbn, litresKeys);
  hideLoading();
  closeScanner();
  const sourceLabels = { google: 'Google Books', openlibrary: 'Open Library', litres: 'ЛитРес', cover: 'Только обложка', microlink: 'Microlink' };
  if (book) {
    showToast(`Найдено: ${sourceLabels[book.source] || book.source}`, 'success');
    openBookForm({ ...book, isbn: book.isbn || isbn, status: 'wishlist' });
  } else {
    showToast('Не найдено — заполните вручную', 'info');
    openBookForm({ isbn, title: '', author: '', status: 'wishlist' });
  }
}

// ═══════════════════════════════════════════════
//  🆕 v3.8.5: SVG-характеристики (Горячесть/Слезливость/...)
// ═══════════════════════════════════════════════
function extraDotsSvg(iconName, value, color) {
  let out = '';
  for (let i = 1; i <= 5; i++) {
    out += `<span style="opacity:${i <= value ? 1 : .25};color:${color};display:inline-flex">${icon(iconName, 12)}</span>`;
  }
  return out;
}
function extraDisplayHtml(book) {
  const items = [
    { icon: 'pepper',   label: 'Горячесть',   color: 'var(--red)',    value: book.pepperRating || 0 },
    { icon: 'droplet',  label: 'Слезливость', color: 'var(--cyan)',   value: book.tearRating || 0 },
    { icon: 'mystery',  label: 'Интрига',     color: 'var(--purple)', value: book.intrigueRating || 0 },
    { icon: 'facePalm', label: 'Жуткость',    color: 'var(--orange)', value: book.horrorRating || 0 },
  ].filter(x => x.value > 0);
  if (items.length === 0) return '';
  return `
    <div class="detail-section">
      <h3>${icon('fire', 14)} Характеристики</h3>
      <div class="extra-ratings-display">
        ${items.map(x => `
          <div class="extra-rating-item">
            <span class="extra-label" style="color:${x.color}">${icon(x.icon, 12)} ${x.label}</span>
            <span class="extra-dots">${extraDotsSvg(x.icon, x.value, x.color)}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════
//  КАРТОЧКА КНИГИ (🆕 метка полки + SVG-характеристики)
// ═══════════════════════════════════════════════
function openBookDetail(bookId) {
  const book = S.books.find(b => b.id === bookId);
  if (!book) return;
  DOM.detailTitle.innerHTML = icon('bookOpen', 18) + ' ' + esc(book.title || 'Книга');
  const st = BOOK_STATUSES[book.status] || BOOK_STATUSES.wishlist;
  const progress = book.pageCount > 0 ? Math.round((book.currentPage / book.pageCount) * 100) : 0;
  const contentItems = book.contentItems || [];
  const review = book.review || {};
  const quotes = review.quotes || [];
  const jr = book.jointReading || {};

  // 🆕 v3.8.5: метка полки в строке заголовка
  const markHtml = (book.shelfMark?.text)
    ? `<span class="shelf-mark" style="background:${sanitizeColor(book.shelfMark.color, 'var(--accent)')}">${esc(book.shelfMark.text)}</span>`
    : '';

  const tagsHtml = (book.tags || []).length > 0 ? `
    <div class="detail-section">
      <h3>${icon('tag', 14)} Теги</h3>
      <div class="book-meta">
        ${(book.tags || []).map(t => {
          const tag = S.tags.find(x => x.name === t);
          const color = sanitizeColor(tag?.color);
          return `<span class="tag-chip" data-tag="${esc(t)}" style="color:${color};border-color:${color}40">${esc(t)}</span>`;
        }).join('')}
      </div>
    </div>` : '';

  const tropesHtml = (book.tropes || []).length > 0 ? `
    <div class="detail-section">
      <h3>${icon('sparkles', 14)} Тропы</h3>
      <div class="book-meta">${(book.tropes || []).map(t => `<span class="trope-chip">${esc(t)}</span>`).join('')}</div>
    </div>` : '';

  const formatsHtml = (book.formats || []).length > 0 ? `
    <div class="detail-section">
      <h3>${icon('bookClosed', 14)} Формат</h3>
      <div class="book-meta">
        ${(book.formats || []).map(f => {
          const fmt = BOOK_FORMATS[f];
          return fmt ? `<span class="book-badge badge-format-${f}">${icon(fmt.icon, 11)} ${fmt.label}</span>` : '';
        }).join('')}
      </div>
    </div>` : '';

  DOM.detailBody.innerHTML = `
    <div class="detail-hero">
      ${book.coverUrl
        ? `<img class="detail-cover" id="detail-cover-img" src="${book.coverUrl}" alt="" style="cursor:zoom-in" referrerpolicy="no-referrer"/>`
        : `<div class="detail-cover-placeholder" id="detail-cover-ph" style="cursor:pointer" title="Добавить обложку">${icon('bookClosed', 52)}<span class="cover-ph-title">${esc(book.title)}</span></div>`}
      <div style="flex:1;min-width:0">
        <div class="detail-title-row">
          <div class="detail-title">${esc(book.title)}</div>
          ${markHtml}
        </div>
        <div class="detail-author">${esc(book.author)}</div>
        <div class="book-meta">
          <button class="book-badge badge-status status-btn" data-book-id="${book.id}">${statusIcon(book.status, 12)} ${st.label} ${icon('chevronDown', 10)}</button>
          ${book.isPR ? `<span class="book-badge badge-pr">${icon('box', 11)} ${esc(book.receivedFrom || 'PR')}</span>` : ''}
          ${book.ageRating ? `<span class="book-badge badge-status">${esc(book.ageRating)}</span>` : ''}
        </div>
        ${book.readingDays ? `<div class="text-small text-muted mt-8">${icon('clock', 11)} Прочитана за ${book.readingDays} дн.</div>` : ''}
      </div>
    </div>
    <div class="detail-meta-grid">
      ${book.genre ? meta('Жанр', book.genre) : ''}
      ${book.publisher ? meta('Издательство', book.publisher) : ''}
      ${book.publishedDate ? meta('Год', book.publishedDate) : ''}
      ${book.pageCount ? meta('Страниц', book.pageCount) : ''}
      ${book.isbn ? meta('ISBN', formatISBN(book.isbn)) : ''}
      ${book.series ? meta('Серия', book.series + (book.seriesNumber ? ' #' + book.seriesNumber : '')) : ''}
      ${(S.settings.showPriceInDetail && book.price?.amount > 0) ? meta('Цена', formatPrice(book.price)) : ''}
    </div>
    ${formatsHtml}
    ${book.status === 'reading' && book.pageCount > 0 ? `
      <div class="reading-progress">
        <div class="reading-progress-bar"><div class="reading-progress-fill" style="width:${progress}%"></div></div>
        <div class="reading-progress-text">Стр. ${book.currentPage} из ${book.pageCount} (${progress}%)</div>
      </div>` : ''}
    ${book.description ? `<div class="detail-section"><h3>${icon('edit', 14)} Описание</h3><div class="detail-description">${esc(book.description)}</div></div>` : ''}
    ${tagsHtml}
    ${tropesHtml}
    <div class="detail-section">
      <h3>${icon('film', 14)} Контент по книге (${contentItems.length})</h3>
      ${contentItems.length === 0 ? '<div class="text-muted text-small">Пока нет контента</div>'
        : contentItems.map(c => {
            const cs = CONTENT_STATUSES[c.status] || { label: c.status, class: '' };
            return `
            <div class="content-list-item content-clickable" data-content-id="${c.id}" title="Открыть контент">
              <span class="content-list-icon">${icon(CONTENT_TYPE_ICONS[c.type] || 'film', 20)}</span>
              <div class="content-list-info">
                <div class="content-list-title">${esc(c.title || CONTENT_LABELS[c.type] || c.type)}</div>
                <div class="content-list-sub">${platformIcon(c.platform, 11)} ${PLATFORM_LABELS[c.platform] || c.platform}${c.publishedDate ? ' · ' + c.publishedDate : ''}</div>
              </div>
              <span class="content-list-status ${cs.class}">${icon(CONTENT_STATUS_ICONS[c.status] || 'film', 12)} ${cs.label}</span>
            </div>`;
          }).join('')}
      <button id="detail-add-content" class="btn-secondary mt-8" style="width:100%">＋ Добавить контент</button>
    </div>
    <div class="detail-section">
      <h3>${icon('quote', 14)} Цитаты (${quotes.length})</h3>
      <div id="detail-quotes">
        ${quotes.map(q => `
          <div class="quote-item">
            <span>«${esc(q.text)}»</span>
            ${q.page ? `<span class="quote-page">с. ${q.page}</span>` : ''}
            ${q.used ? `<span class="quote-used">${icon('check', 11)}</span>` : ''}
          </div>`).join('')}
      </div>
      <div class="flex gap-8 mt-8">
        <input type="text" id="dq-text" placeholder="Новая цитата..." style="flex:1"/>
        <input type="number" id="dq-page" placeholder="Стр." style="width:70px" min="0"/>
        <button id="dq-add" class="btn-secondary" style="width:auto;flex-shrink:0">＋</button>
      </div>
      <button id="dq-ocr" class="btn-secondary mt-8" style="width:100%">${icon('camera', 14)} Сфотографировать цитату (OCR)</button>
    </div>
    ${extraDisplayHtml(book)}
    ${(book.characters || []).length > 0 ? `
      <div class="detail-section">
        <h3>${icon('users', 14)} Герои книги</h3>
        <div class="characters-list">
          ${(book.characters || []).map(ch => `
            <div class="character-item">
              <span class="character-name">${esc(ch.name)}</span>
              <span class="character-stars">${starsRow(ch.rating || 0, 12)}</span>
            </div>`).join('')}
        </div>
      </div>` : ''}
    <div class="detail-section">
      <h3>${icon('pen', 14)} Отзыв</h3>
      ${review.text || review.rating > 0 ? `
        <div class="review-stars">${starsRow(review.rating || 0, 14)}</div>
        ${review.pros ? `<div class="review-pros">${icon('check', 12)} ${esc(review.pros)}</div>` : ''}
        ${review.cons ? `<div class="review-cons">${icon('close', 12)} ${esc(review.cons)}</div>` : ''}
        ${review.text ? `<div class="detail-description mt-8">${esc(review.text)}</div>` : ''}
        ${review.recommendation ? `<div class="mt-8 text-small">${icon('target', 12)} ${esc(review.recommendation)}</div>` : ''}
      ` : '<div class="text-muted text-small">Отзыв ещё не написан</div>'}
      <button id="detail-edit-review" class="btn-secondary mt-8" style="width:100%">
        ${review.text || review.rating > 0 ? 'Редактировать отзыв' : 'Написать отзыв'}
      </button>
    </div>
    ${jr.active ? `
      <div class="detail-section">
        <h3>${icon('users', 14)} Совместное чтение</h3>
        <div class="text-small">${icon('users', 12)} ${esc((jr.participants || []).join(', '))}</div>
        ${jr.chatLink ? `<div class="text-small mt-8">${icon('link', 12)} <a href="${esc(jr.chatLink)}" target="_blank" rel="noopener">${esc(jr.chatLink)}</a></div>` : ''}
        ${jr.notes ? `<div class="text-small text-muted mt-8">${esc(jr.notes)}</div>` : ''}
      </div>` : ''}
    ${book.notes ? `<div class="detail-section"><h3>${icon('edit', 14)} Заметки</h3><div class="detail-description">${esc(book.notes)}</div></div>` : ''}
    <div class="btn-group mt-16">
      <button id="detail-collections" class="btn-secondary">${icon('folder', 13)} В подборку</button>
      <button id="detail-edit" class="btn-secondary">${icon('edit', 13)} Изменить</button>
      <button id="detail-delete" class="btn-danger">${icon('trash', 13)}</button>
    </div>
  `;

  function meta(label, value) {
    return `<div class="detail-meta-item"><div class="detail-meta-label">${label}</div><div class="detail-meta-value">${esc(String(value))}</div></div>`;
  }

  const db = DOM.detailBody;
  const coverImg = db.querySelector('#detail-cover-img');
  if (coverImg) coverImg.addEventListener('click', () => openCoverViewer(book));
  const coverPh = db.querySelector('#detail-cover-ph');
  if (coverPh) coverPh.addEventListener('click', () => openCoverViewer(book));
  db.querySelector('.status-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    openStatusDropdown(e.currentTarget, book.id);
  });
  db.querySelector('#detail-edit').addEventListener('click', () => { closeOverlay(DOM.detailOverlay); openBookForm(book); });
  db.querySelector('#detail-delete').addEventListener('click', async () => {
    const ok = await showConfirm('Удалить эту книгу?', { danger: true, okText: 'Удалить' });
    if (ok) {
      await delBook(book.id); await deleteCover(book.id);
      closeOverlay(DOM.detailOverlay);
      await refreshData();
      showToast('🗑️ Книга удалена', 'info');
    }
  });
  db.querySelector('#detail-add-content').addEventListener('click', () => { closeOverlay(DOM.detailOverlay); openContentForm(null, book.id, S.settings); });
  db.querySelector('#detail-edit-review').addEventListener('click', () => { closeOverlay(DOM.detailOverlay); openReviewForm(book.id); });
  db.querySelector('#detail-collections').addEventListener('click', () => {
    openBookCollectionsPicker(book.id, S.books, S.collections, refreshData);
  });
  db.querySelectorAll('.tag-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      S.activeFilter = { type: 'tag', value: chip.dataset.tag };
      closeOverlay(DOM.detailOverlay);
      renderTab('books');
    });
  });
  // 🆕 v3.8.5: контент → read-only карточка
  db.querySelectorAll('.content-clickable').forEach(el => {
    el.addEventListener('click', () => {
      const item = contentItems.find(c => c.id === el.dataset.contentId);
      closeOverlay(DOM.detailOverlay);
      openContentDetail(item, book, { settings: S.settings });
    });
  });

  const addQuote = async (text, page) => {
    if (!text) return;
    book.review = book.review || {};
    book.review.quotes = book.review.quotes || [];
    book.review.quotes.push({ text, page: page || 0, used: false });
    await putBook(book);
    await refreshData();
    openBookDetail(book.id);
    showToast('💬 Цитата добавлена', 'success');
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
    if (text) await addQuote(text, 0);
    else openBookDetail(book.id);
  });

  openOverlay(DOM.detailOverlay);
}

// ═══════════════════════════════════════════════
//  ПРОСМОТР ОБЛОЖКИ
// ═══════════════════════════════════════════════
let _coverBookId = null;
function openCoverViewer(book) {
  _coverBookId = book.id;
  if (book.coverUrl) {
    DOM.coverViewerImg.src = book.coverUrl;
    DOM.coverViewerImg.style.display = '';
    const existingPh = DOM.coverOverlay.querySelector('.cover-viewer-empty');
    if (existingPh) existingPh.style.display = 'none';
  } else {
    DOM.coverViewerImg.src = '';
    DOM.coverViewerImg.style.display = 'none';
    let emptyPh = DOM.coverOverlay.querySelector('.cover-viewer-empty');
    if (!emptyPh) {
      emptyPh = document.createElement('div');
      emptyPh.className = 'cover-viewer-empty';
      emptyPh.innerHTML = `${icon('bookClosed', 64)}<span>Обложка не добавлена</span><span class="text-small">Нажмите «Из галереи» или «Заменить фото»</span>`;
      DOM.coverOverlay.querySelector('.cover-viewer').insertBefore(emptyPh, DOM.coverViewerImg.nextSibling);
    }
    emptyPh.style.display = '';
  }
  DOM.coverViewerTitle.textContent = `${book.title} — ${book.author}`;
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
    if (!isValidCoverBlob(blob)) { hideLoading(); showToast('❌ Не удалось обработать изображение', 'error'); return; }
    await saveCover(_coverBookId, blob);
    cacheCoverUrl(_coverBookId, URL.createObjectURL(blob));
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
  DOM.scannerManualInput.value = '';
  const result = await startScanner(DOM.scannerVideo, (status, msg) => {
    DOM.scannerStatus.textContent = msg;
    DOM.scannerStatus.className = 'scanner-status' + (status === 'scanning' ? ' scanning' : '');
  });
  if (result) handleIsbnLookup(result);
}
function closeScanner() { stopScanner(); DOM.scannerOverlay.classList.add('hidden'); document.body.style.overflow = ''; }

// ═══════════════════════════════════════════════
//  КОНТЕНТ / ОТЗЫВЫ
// ═══════════════════════════════════════════════
async function handleDeleteContent(itemId, bookId) {
  const ok = await showConfirm('Удалить этот контент?', { danger: true, okText: 'Удалить' });
  if (!ok) return;
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
  const ok = await showConfirm('Удалить отзыв?', { danger: true, okText: 'Удалить' });
  if (!ok) return;
  await deleteReview(bookId);
  await refreshData();
  showToast('🗑️ Отзыв удалён', 'info');
}

// ═══════════════════════════════════════════════
//  🆕 v3.8.5: FAB-МЕНЮ «+»
// ═══════════════════════════════════════════════
function toggleFabMenu() {
  if (document.querySelector('.fab-menu')) closeFabMenu();
  else openFabMenu();
}
function closeFabMenu() {
  document.querySelector('.fab-menu')?.remove();
}
function openFabMenu() {
  closeFabMenu();
  const menu = document.createElement('div');
  menu.className = 'fab-menu';
  menu.innerHTML = FAB_ITEMS.map(it => `
    <button class="fab-menu-item" data-fab="${it.id}">
      ${icon(it.icon, 16)} ${it.label}
    </button>
  `).join('');
  document.body.appendChild(menu);

  menu.querySelectorAll('[data-fab]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeFabMenu();
      fabAction(btn.dataset.fab);
    });
  });
}
function fabAction(id) {
  switch (id) {
    case 'book': openBookForm(); break;
    case 'content': openContentForm(null, null, S.settings); break;
    case 'review': openBookPicker(b => openReviewForm(b.id), 'Выберите книгу для отзыва'); break;
    case 'challenge': openChallengeForm(null, S.books, async (data) => {
      await createChallenge(data); await refreshData(); showToast('✅ Челлендж создан', 'success');
    }); break;
    case 'series': openBookPicker(b => {
      openBookForm(b);
      showToast('Укажите серию в форме', 'info');
    }, 'Выберите книгу для серии'); break;
    case 'collection': openCollectionForm(null, async (data) => {
      data.order = await getNextCollectionOrder();
      await createCollection(data); await refreshData(); showToast('✅ Подборка создана', 'success');
    }); break;
  }
}

// 🆕 v3.8.5: выбор книги (для отзыва / серии)
function openBookPicker(onPick, titleText = 'Выберите книгу') {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="overlay-panel" style="max-height:80dvh">
      <div class="overlay-header">
        <h2>${icon('bookClosed', 16)} ${esc(titleText)}</h2>
        <button class="icon-btn bp-close">${icon('close', 16)}</button>
      </div>
      <div class="overlay-body">
        <div class="form-group">
          <input type="text" id="bp-search" placeholder="Поиск по названию или автору..." autocomplete="off"/>
        </div>
        <div id="bp-list">
          ${S.books.filter(b => b.id !== '__no_book__').map(b => `
            <label class="picker-row" data-search="${(b.title + ' ' + b.author).toLowerCase()}" data-bp-id="${b.id}" style="cursor:pointer">
              ${b.coverUrl
                ? `<img src="${b.coverUrl}" referrerpolicy="no-referrer" alt="" style="width:32px;height:48px;border-radius:4px;object-fit:cover"/>`
                : `<span style="width:32px;height:48px;display:flex;align-items:center;justify-content:center;background:var(--bg-input);border-radius:4px">${icon('bookClosed', 18)}</span>`}
              <span class="picker-name" style="flex:1">${esc(b.title)}</span>
            </label>
          `).join('')}
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  trackOverlay(overlay);

  const close = () => {
    overlay.remove();
    untrackOverlay(overlay);
    document.body.style.overflow = '';
  };
  overlay.querySelector('.bp-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const search = overlay.querySelector('#bp-search');
  search.addEventListener('input', () => {
    const q = search.value.toLowerCase().trim();
    overlay.querySelectorAll('#bp-list .picker-row').forEach(row => {
      row.style.display = row.dataset.search.includes(q) ? '' : 'none';
    });
  });

  overlay.querySelectorAll('#bp-list .picker-row').forEach(row => {
    row.addEventListener('click', () => {
      const book = S.books.find(b => b.id === row.dataset.bpId);
      close();
      if (book) onPick(book);
    });
  });
}

// ═══════════════════════════════════════════════
//  СЕРИИ / ПОДБОРКИ / ЧЕЛЛЕНДЖИ
// ═══════════════════════════════════════════════
function renderSeriesScreen() {
  const mc = DOM.mainContent;
  if (S.openSeries) {
    renderSeriesDetail(mc, S.openSeries, S.books, {
      onOpenBook: openBookDetail,
      onAddBook: (seriesName, total) => openBookForm({ series: seriesName, seriesTotal: total, status: 'wishlist' }),
      onBack: () => { S.openSeries = null; renderSeriesScreen(); },
    });
  } else {
    renderSeriesList(mc, S.books, {
      onOpenSeries: (name) => { S.openSeries = name; renderSeriesScreen(); },
    });
  }
}

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
        data.order = await getNextCollectionOrder();
        await createCollection(data); await refreshData(); showToast('✅ Подборка создана', 'success');
      }),
      onEdit: (c) => openCollectionForm(c, async (data) => {
        await updateCollection(data); await refreshData(); showToast('✅ Сохранено', 'success');
      }),
      onDelete: async (id) => {
        const ok = await showConfirm('Удалить подборку?', { danger: true, okText: 'Удалить' });
        if (ok) { await deleteCollection(id); await refreshData(); showToast('🗑️ Подборка удалена', 'info'); }
      },
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
      onEdit: (c) => openChallengeForm(c, S.books, async (data) => {
        await updateChallenge(data); await refreshData(); showToast('✅ Сохранено', 'success');
      }),
      onDelete: async (id) => {
        const ok = await showConfirm('Удалить челлендж?', { danger: true, okText: 'Удалить' });
        if (ok) { await deleteChallengeById(id); S.openChallenge = null; await refreshData(); showToast('🗑️ Челлендж удалён', 'info'); }
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
          showToast(`Статус: ${status === 'active' ? 'Активен' : 'Завершён'}`, 'success');
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
        const ok = await showConfirm('Удалить челлендж?', { danger: true, okText: 'Удалить' });
        if (ok) { await deleteChallengeById(id); await refreshData(); showToast('🗑️ Удалён', 'info'); }
      },
    });
  }
}

// ═══════════════════════════════════════════════
//  КАЛЕНДАРЬ: день (🆕 контент → read-only карточка)
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
  if (dayContent.length === 0) { showToast(`${dateStr}: нет контента`, 'info'); return; }

  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.style.zIndex = '1100';
  ov.innerHTML = `
    <div class="overlay-panel" style="max-width:420px">
      <div class="overlay-header">
        <h2>${icon('calendar', 18)} ${esc(dateStr)}</h2>
        <button class="icon-btn day-ov-close">${icon('close', 18)}</button>
      </div>
      <div class="overlay-body">
        ${dayContent.map(c => {
          const t = CONTENT_TYPES[c.type] || { label: c.type };
          const s = CONTENT_STATUSES[c.status] || { label: c.status, class: '' };
          return `
          <div class="content-list-item content-clickable"
               data-book-id="${c.bookId}" data-content-id="${c.id}"
               style="cursor:pointer;margin-bottom:8px">
            <span class="content-list-icon">${icon(CONTENT_TYPE_ICONS[c.type] || 'film', 20)}</span>
            <div class="content-list-info">
              <div class="content-list-title">${esc(c.title || t.label)}</div>
              <div class="content-list-sub">${esc(c.bookTitle)}</div>
            </div>
            <span class="content-list-status ${s.class}">${icon(CONTENT_STATUS_ICONS[c.status] || 'film', 12)} ${s.label}</span>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  document.body.appendChild(ov);
  trackOverlay(ov);
  const closeDay = () => { untrackOverlay(ov); ov.remove(); };
  ov.querySelector('.day-ov-close').addEventListener('click', closeDay);
  ov.addEventListener('click', (e) => { if (e.target === ov) closeDay(); });
  ov.querySelectorAll('.content-clickable').forEach(el => {
    el.addEventListener('click', () => {
      const bk = S.books.find(b => b.id === el.dataset.bookId);
      const item = (bk?.contentItems || []).find(c => c.id === el.dataset.contentId);
      closeDay();
      if (item) openContentDetail(item, bk, { settings: S.settings });
    });
  });
}

// ═══════════════════════════════════════════════
//  НАСТРОЙКИ (🆕 площадка через attachCustomSelect)
// ═══════════════════════════════════════════════
function renderSettingsTab() {
  const s = S.settings;
  const mc = DOM.mainContent;
  mc.innerHTML = `
    <div class="settings-section">
      <h3>${icon('film', 15)} Режим бук-блогера</h3>
      <div class="toggle-row">
        <span class="toggle-label">Включить блогерские функции</span>
        <div class="toggle ${s.bloggerMode ? 'active' : ''}" id="set-blogger" role="switch" aria-checked="${!!s.bloggerMode}" tabindex="0"></div>
      </div>
    </div>
    <div class="settings-section">
      <h3>${icon('coin', 15)} Цена и валюта</h3>
      <div class="form-group">
        <label>Валюта по умолчанию</label>
        <select id="set-currency">
          ${Object.entries(CURRENCIES).map(([k, c]) => `<option value="${k}" ${s.defaultCurrency === k ? 'selected' : ''}>${c.symbol} ${c.name}</option>`).join('')}
        </select>
      </div>
      <div class="toggle-row"><span class="toggle-label">Показывать цену в карточках</span><div class="toggle ${s.showPriceInCards ? 'active' : ''}" id="set-price-cards" role="switch" tabindex="0"></div></div>
      <div class="toggle-row"><span class="toggle-label">Показывать цену на странице книги</span><div class="toggle ${s.showPriceInDetail ? 'active' : ''}" id="set-price-detail" role="switch" tabindex="0"></div></div>
      <div class="toggle-row"><span class="toggle-label">Показывать цену в статистике</span><div class="toggle ${s.showPriceInStats ? 'active' : ''}" id="set-price-stats" role="switch" tabindex="0"></div></div>
      <div class="hint mt-8">Курсы валют обновлены: ${s.ratesUpdated || 'никогда'} · 1 USD = ${s.exchangeRates.USD} ₽</div>
      <button id="set-rates-update" class="btn-secondary mt-8">${icon('refresh', 13)} Обновить курсы</button>
    </div>
    <div class="settings-section">
      <h3>${icon('tag', 15)} Теги и цвета</h3>
      <div class="flex gap-8 mb-16">
        <input type="text" id="set-tag-new" placeholder="Новый тег..." style="flex:1"/>
        <input type="color" id="set-tag-new-color" value="#e8a33d" style="width:44px;height:36px;padding:2px;border-radius:8px;cursor:pointer"/>
        <button id="set-tag-add" class="btn-secondary" style="width:auto;flex-shrink:0">＋</button>
      </div>
      <div id="set-tags-list">
        ${S.tags.map(t => `
          <div class="flex items-center gap-8 mb-8">
            <input type="color" data-tag-color="${esc(t.name)}" value="${sanitizeColor(t.color, '#e8a33d').replace('var(--accent)','#e8a33d')}" style="width:44px;height:36px;padding:2px;border-radius:8px;cursor:pointer"/>
            <span class="flex-1 text-small">${esc(t.name)}</span>
            <button data-tag-del="${esc(t.name)}" class="icon-btn" style="width:30px;height:30px;font-size:.8rem" aria-label="Удалить тег">${icon('trash', 13)}</button>
          </div>
        `).join('') || '<div class="text-small text-muted">Нет тегов. Добавьте первый выше или в форме книги.</div>'}
      </div>
    </div>
    <div class="settings-section">
      <h3>${icon('link', 15)} Microlink API <span class="badge">превью ссылок</span></h3>
      <p class="hint">Автоматически подтягивает превью для опубликованного контента и извлекает данные книг по ссылкам на ЛитРес / Book24 / Ozon.<br/>Бесплатно: 25 запросов/день. Ключ не требуется.</p>
      <div class="form-group">
        <label>API-ключ (если есть Pro)</label>
        <input type="password" id="set-microlink-key" value="${esc(s.microlinkApiKey || '')}" placeholder="Ваш ключ Microlink Pro"/>
      </div>
      <button id="set-microlink-check" class="btn-secondary">Проверить доступность</button>
      <span id="set-microlink-status" class="status-text"></span>
      <div class="mt-8"><button id="set-microlink-clear" class="btn-secondary">Очистить кеш превью</button></div>
    </div>
    <div class="settings-section">
      <h3>${icon('bookClosed', 15)} ЛитРес API <span class="badge">опционально</span></h3>
      <p class="hint">Улучшает поиск российских книг. Ключи задаются здесь и хранятся локально.</p>
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
      <button id="set-lr-test" class="btn-secondary mt-8">Проверить подключение</button>
      <span id="set-lr-status" class="status-text"></span>
    </div>
    <div class="settings-section">
      <h3>${icon('camera', 15)} Распознавание цитат (OCR)</h3>
      <p class="hint">Полный оффлайн. Файлы Tesseract.js должны лежать в корне проекта.</p>
      <button id="set-ocr-check" class="btn-secondary">Проверить файлы OCR</button>
      <span id="set-ocr-status" class="status-text"></span>
    </div>
    <div class="settings-section">
      <h3>${icon('smartphone', 15)} Площадки</h3>
      <div class="form-group"><label>Площадка по умолчанию</label>
        <select id="set-platform">
          <option value="youtube" ${s.defaultPlatform === 'youtube' ? 'selected' : ''}>YouTube</option>
          <option value="tiktok" ${s.defaultPlatform === 'tiktok' ? 'selected' : ''}>TikTok</option>
          <option value="telegram" ${s.defaultPlatform === 'telegram' ? 'selected' : ''}>Telegram</option>
          <option value="vk" ${s.defaultPlatform === 'vk' ? 'selected' : ''}>VK</option>
          <option value="dzen" ${s.defaultPlatform === 'dzen' ? 'selected' : ''}>Дзен</option>
          <option value="instagram" ${s.defaultPlatform === 'instagram' ? 'selected' : ''}>Instagram</option>
          <option value="pinterest" ${s.defaultPlatform === 'pinterest' ? 'selected' : ''}>Pinterest</option>
          <option value="threads" ${s.defaultPlatform === 'threads' ? 'selected' : ''}>Threads</option>
        </select>
      </div>
    </div>
    <div class="settings-section">
      <h3>${icon('sparkles', 15)} Эффекты</h3>
      <div class="toggle-row"><span class="toggle-label">Конфетти</span><div class="toggle ${s.confetti ? 'active' : ''}" id="set-confetti" role="switch" tabindex="0"></div></div>
      <div class="toggle-row"><span class="toggle-label">Звуки</span><div class="toggle ${s.sound ? 'active' : ''}" id="set-sound" role="switch" tabindex="0"></div></div>
    </div>
    <div class="settings-section">
      <h3>${icon('download', 15)} Данные</h3>
      <div class="btn-group">
        <button id="set-export" class="btn-secondary">Экспорт</button>
        <button id="set-import" class="btn-secondary">Импорт (синхронизация)</button>
      </div>
      <input type="file" id="set-import-file" accept=".json" class="hidden"/>
      <div class="btn-group"><button id="set-clear" class="btn-danger">Очистить всё</button></div>
      <div class="hint mt-8">Размер базы: <span id="set-dbsize">...</span></div>
    </div>
    <div class="settings-section">
      <h3>${icon('gear', 15)} О приложении</h3>
      <p class="hint">Book Tracker Pro v3.8.5 · Трекер книг для бук-блогера · Работает оффлайн</p>
    </div>
  `;

  const bind = (id, fn) => mc.querySelector(id)?.addEventListener('click', fn);
  const bindToggle = (id, key) => {
    const el = mc.querySelector(id);
    if (!el) return;
    const fn = function() {
      this.classList.toggle('active');
      this.setAttribute('aria-checked', this.classList.contains('active'));
      S.settings[key] = this.classList.contains('active');
      saveAppSettings();
    };
    el.addEventListener('click', fn);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn.call(el); }
    });
  };
  bindToggle('#set-blogger', 'bloggerMode');
  bindToggle('#set-price-cards', 'showPriceInCards');
  bindToggle('#set-price-detail', 'showPriceInDetail');
  bindToggle('#set-price-stats', 'showPriceInStats');
  bindToggle('#set-confetti', 'confetti');
  bindToggle('#set-sound', 'sound');

  mc.querySelector('#set-currency')?.addEventListener('change', function() {
    S.settings.defaultCurrency = this.value; saveAppSettings();
  });

  // 🆕 v3.8.5: площадка через attachCustomSelect с brand-иконками
  const platformSel = mc.querySelector('#set-platform');
  const platformRenderer = (opt) => `<span style="display:flex;align-items:center;gap:8px">${platformIcon(opt.value, 14)} ${esc(opt.textContent)}</span>`;
  attachCustomSelect(platformSel, { renderOption: platformRenderer, renderTrigger: platformRenderer });
  platformSel?.addEventListener('change', function() {
    S.settings.defaultPlatform = this.value; saveAppSettings();
  });

  bind('#set-rates-update', async () => {
    const status = mc.querySelector('#set-rates-update');
    status.textContent = '⏳ Обновляю...';
    try {
      const r = await fetch('https://open.er-api.com/v6/latest/RUB');
      const data = await r.json();
      if (data.rates) {
        S.settings.exchangeRates = {
          USD: +(1 / data.rates.USD).toFixed(2), EUR: +(1 / data.rates.EUR).toFixed(2),
          KZT: +(1 / data.rates.KZT).toFixed(3), UAH: +(1 / data.rates.UAH).toFixed(2),
          GBP: +(1 / data.rates.GBP).toFixed(2),
        };
        S.settings.ratesUpdated = new Date().toLocaleDateString('ru-RU');
        await saveAppSettings();
        showToast('✅ Курсы обновлены', 'success');
        renderSettingsTab();
      }
    } catch {
      status.textContent = 'Обновить курсы';
      showToast('❌ Нет интернета', 'error');
    }
  });

  bind('#set-tag-add', async () => {
    const name = mc.querySelector('#set-tag-new').value.trim();
    const color = mc.querySelector('#set-tag-new-color').value;
    if (!name) { showToast('⚠️ Введите название тега', 'error'); return; }
    if (S.tags.find(t => t.name.toLowerCase() === name.toLowerCase())) { showToast('⚠️ Такой тег уже есть', 'error'); return; }
    await putTag({ name, color });
    S.tags = await loadTags();
    renderSettingsTab();
    showToast(`✅ Тег «${name}» добавлен`, 'success');
  });
  mc.querySelectorAll('[data-tag-color]').forEach(inp => {
    inp.addEventListener('change', async () => {
      const tag = S.tags.find(t => t.name === inp.dataset.tagColor);
      if (tag) { tag.color = inp.value; await putTag(tag); S.tags = await loadTags(); }
    });
  });
  mc.querySelectorAll('[data-tag-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await showConfirm(`Удалить тег «${btn.dataset.tagDel}»?`, { danger: true, okText: 'Удалить' });
      if (ok) { await delTag(btn.dataset.tagDel); S.tags = await loadTags(); renderSettingsTab(); }
    });
  });

  const mlKey = mc.querySelector('#set-microlink-key');
  mlKey?.addEventListener('change', function() {
    S.settings.microlinkApiKey = this.value.trim();
    setMicrolinkApiKey(S.settings.microlinkApiKey);
    saveAppSettings();
  });
  bind('#set-microlink-check', async () => {
    const status = mc.querySelector('#set-microlink-status');
    status.textContent = '⏳ Проверяю...';
    const r = await checkMicrolinkStatus(S.settings.microlinkApiKey);
    status.textContent = r.ok ? `✅ Работает · осталось ~${r.remaining} запросов` : `❌ ${r.error || 'Недоступен'}`;
  });
  bind('#set-microlink-clear', async () => {
    await clearPreviewCache();
    showToast('🗑️ Кеш превью очищен', 'info');
  });

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
    a.download = `booktracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    showToast('📤 Экспортировано', 'success');
  });
  const importFile = mc.querySelector('#set-import-file');
  bind('#set-import', () => importFile.click());
  // 🆕 v3.8.5: импорт = синхронизация (добавляет отсутствующее)
  importFile?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const result = await importAll(JSON.parse(await file.text()));
      await refreshData();
      if (result && typeof result === 'object' && ('addedBooks' in result)) {
        showToast(`📥 Добавлено: ${result.addedBooks} книг, ${result.addedCollections} подборок, ${result.addedChallenges} челленджей · пропущено дублей: ${result.skippedBooks}`, 'success');
      } else {
        showToast('📥 Импортировано', 'success');
      }
    } catch { showToast('❌ Ошибка импорта', 'error'); }
  });
  bind('#set-clear', async () => {
    const ok = await showConfirm('Удалить ВСЕ данные? Это необратимо!', { danger: true, okText: 'Удалить всё' });
    if (ok) {
      const db = await openDB();
      ['books','covers','settings','collections','challenges','tags','previews'].forEach(st => {
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
  trackOverlay(el);
}
function closeOverlay(el) {
  el.classList.add('hidden');
  untrackOverlay(el);
  const anyOpen = [...document.querySelectorAll('.overlay')].some(o => !o.classList.contains('hidden'));
  if (!anyOpen) document.body.style.overflow = '';
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

// ═══════════════════════════════════════════════
//  КОНФЕТТИ (🆕 prefers-reduced-motion)
// ═══════════════════════════════════════════════
function fireConfetti() {
  if (!S.settings.confetti) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = DOM.confettiCanvas;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const colors = ['#e8a33d','#94b878','#d98aa8','#7fb8b0','#b092d6','#e0955c','#f0e7d8'];
  const particles = [];
  for (let i = 0; i < 140; i++) {
    particles.push({
      x: Math.random() * canvas.width, y: -20 - Math.random() * 220,
      w: 6 + Math.random() * 6, h: 4 + Math.random() * 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      vx: (Math.random() - 0.5) * 4.5, vy: 2 + Math.random() * 4.5,
      rot: Math.random() * 360, vr: (Math.random() - 0.5) * 11, life: 1,
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
//  🆕 v3.8.5: СТИЛИ FAB-МЕНЮ (инжектируются один раз)
// ═══════════════════════════════════════════════
const FAB_STYLES = `
.fab-menu {
  position: fixed;
  right: 16px;
  bottom: calc(20px + env(safe-area-inset-bottom) + 132px);
  display: flex; flex-direction: column; gap: 8px;
  z-index: 95;
  animation: fabIn .18s var(--ease-bounce);
}
.fab-menu-item {
  display:flex; align-items:center; gap:10px;
  padding:10px 16px;
  background:var(--bg-card);
  border:1px solid var(--border);
  border-radius:var(--radius);
  color:var(--text-primary);
  font-size:.88rem; font-weight:600;
  box-shadow:var(--shadow-sm);
  cursor:pointer;
  transition:all .15s var(--ease);
}
.fab-menu-item:hover { border-color:var(--accent); color:var(--accent); transform:translateX(-2px); }
.fab-menu-item .ic { color:var(--accent); }
@keyframes fabIn { from { opacity:0; transform:translateY(8px);} to { opacity:1; transform:translateY(0);} }
@media (prefers-reduced-motion: reduce) {
  .fab-menu { animation: none; }
  .fab-menu-item { transition: none; }
}
`;
if (!document.getElementById('fab-styles')) {
  const style = document.createElement('style');
  style.id = 'fab-styles';
  style.textContent = FAB_STYLES;
  document.head.appendChild(style);
}

// ═══════════════════════════════════════════════
//  ЗАПУСК
// ═══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', init);
