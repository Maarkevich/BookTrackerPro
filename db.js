// 📦 BookTrackerPro — db.js
// 🔖 v3.8.3 | 2026-08-14
// 📝 IndexedDB: книги, обложки, настройки,
//    подборки, челленджи, теги, превью ссылок
//    Версия БД: 6
//    Stores: books, covers, settings,
//            collections, challenges, tags, previews,
//            pending-sync (🆕 v3.8.3)
//
//    Новое в 3.8.3:
//      — Store 'pending-sync' для Background Sync API
//        (оффлайн-добавление книг → автосинхронизация)
//      — putPendingSync / getPendingSync / deletePendingSync
//      — Улучшенная обработка ошибок в транзакциях
//      — ensureBookFields: defaults для новых полей v3.8.x
//
//    Сохранено из 3.5.0:
//      — repairCovers() — лечение битых обложек
//      — isValidCoverBlob() — валидация Blob
//      — Миграции v1→v6 без потери данных
// ─────────────────────────────────────────────

const DB_NAME = 'book-tracker-pro';
const DB_VER = 6; // 🆕 v3.8.3: был 5, стал 6 (pending-sync)
let _db = null;

// ═══════════════════════════════════════════════
//  СТАТУСЫ КНИГ
// ═══════════════════════════════════════════════
export const BOOK_STATUSES = {
  wishlist: { icon: '🌟', label: 'Wishlist',      order: 0 },
  added:    { icon: '📦', label: 'Добавлено',     order: 1 },
  reading:  { icon: '📖', label: 'Читаю',         order: 2 },
  paused:   { icon: '⏸️', label: 'Пауза',         order: 3 },
  finished: { icon: '✅', label: 'Прочитано',     order: 4 },
  dropped:  { icon: '❌', label: 'Брошено',       order: 5 },
};

// ═══════════════════════════════════════════════
//  ВАЛЮТЫ
// ═══════════════════════════════════════════════
export const CURRENCIES = {
  RUB: { symbol: '₽', name: 'Рубль' },
  USD: { symbol: '$', name: 'Доллар' },
  EUR: { symbol: '€', name: 'Евро' },
  KZT: { symbol: '₸', name: 'Тенге' },
  UAH: { symbol: '₴', name: 'Гривна' },
  GBP: { symbol: '£', name: 'Фунт' },
};

// ═══════════════════════════════════════════════
//  1. ОТКРЫТИЕ / МИГРАЦИЯ
// ═══════════════════════════════════════════════
export function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VER);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction;
      const oldVer = event.oldVersion;

      // v1: книги + настройки
      if (oldVer < 1) {
        const books = db.createObjectStore('books', { keyPath: 'id' });
        books.createIndex('status', 'status', { unique: false });
        books.createIndex('updatedAt', 'updatedAt', { unique: false });
        books.createIndex('dateAdded', 'dateAdded', { unique: false });
        books.createIndex('titleAuthor', ['title', 'author'], { unique: false });
        db.createObjectStore('settings', { keyPath: 'id' });
      }

      // v2: обложки (Blob)
      if (oldVer < 2) {
        if (!db.objectStoreNames.contains('covers')) {
          db.createObjectStore('covers', { keyPath: 'bookId' });
        }
      }

      // v3: индексы для блогерских фич
      if (oldVer < 3) {
        const books = tx.objectStore('books');
        if (!books.indexNames.contains('isPR')) books.createIndex('isPR', 'isPR', { unique: false });
        if (!books.indexNames.contains('blogStatus')) books.createIndex('blogStatus', 'blogStatus', { unique: false });
        if (!books.indexNames.contains('genre')) books.createIndex('genre', 'genre', { unique: false });
      }

      // v4: подборки, челленджи, теги + индексы серий
      if (oldVer < 4) {
        if (!db.objectStoreNames.contains('collections')) {
          db.createObjectStore('collections', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('challenges')) {
          const ch = db.createObjectStore('challenges', { keyPath: 'id' });
          ch.createIndex('status', 'status', { unique: false });
        }
        if (!db.objectStoreNames.contains('tags')) {
          db.createObjectStore('tags', { keyPath: 'name' });
        }
        const books = tx.objectStore('books');
        if (!books.indexNames.contains('series')) books.createIndex('series', 'series', { unique: false });
        if (!books.indexNames.contains('dateFinished')) books.createIndex('dateFinished', 'dateFinished', { unique: false });
      }

      // v5: превью ссылок (Microlink)
      if (oldVer < 5) {
        if (!db.objectStoreNames.contains('previews')) {
          const previews = db.createObjectStore('previews', { keyPath: 'id' });
          previews.createIndex('cachedAt', 'cachedAt', { unique: false });
        }
      }

      // 🆕 v6 (3.8.3): отложенные операции для Background Sync
      if (oldVer < 6) {
        if (!db.objectStoreNames.contains('pending-sync')) {
          db.createObjectStore('pending-sync', { keyPath: 'id' });
        }
      }
    };

    request.onsuccess = () => {
      _db = request.result;
      _db.onclose = () => { _db = null; };
      _db.onversionchange = () => {
        _db.close();
        _db = null;
        // Другая вкладка обновила схему — перезагружаем
        window.location.reload();
      };
      resolve(_db);
    };

    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      console.warn('[DB] Blocked — закройте другие вкладки с приложением');
    };
  });
}

// ═══════════════════════════════════════════════
//  2. КНИГИ — CRUD
// ═══════════════════════════════════════════════

/**
 * Загружает все книги, отсортированные по dateAdded (новые сверху).
 * Гарантирует наличие всех обязательных полей.
 */
export async function loadBooks() {
  const db = await openDB();
  return new Promise((resolve) => {
    const req = db.transaction('books', 'readonly').objectStore('books').getAll();
    req.onsuccess = () => {
      const books = (req.result || []).map(ensureBookFields);
      books.sort((a, b) => (b.dateAdded || '').localeCompare(a.dateAdded || ''));
      resolve(books);
    };
    req.onerror = () => resolve([]);
  });
}

/**
 * Сохраняет книгу (создание или обновление).
 */
export async function putBook(book) {
  const db = await openDB();
  const safe = ensureBookFields(book);
  return new Promise((resolve) => {
    const tx = db.transaction('books', 'readwrite');
    tx.objectStore('books').put(safe);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => {
      console.error('[DB] putBook error:', tx.error);
      resolve(false);
    };
  });
}

/**
 * Массовое сохранение книг (одна транзакция — быстрее).
 */
export async function putBooks(books) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction('books', 'readwrite');
    const store = tx.objectStore('books');
    for (const book of books) {
      store.put(ensureBookFields(book));
    }
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

/**
 * Удаляет книгу по id.
 */
export async function delBook(id) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction('books', 'readwrite');
    tx.objectStore('books').delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

/**
 * Возвращает одну книгу по id.
 */
export async function getBook(id) {
  const db = await openDB();
  return new Promise((resolve) => {
    const req = db.transaction('books', 'readonly').objectStore('books').get(id);
    req.onsuccess = () => resolve(req.result ? ensureBookFields(req.result) : null);
    req.onerror = () => resolve(null);
  });
}

/**
 * Меняет статус книги с автоматическим расчётом дат.
 * Возвращает { confetti, askRating, book } для UI-реакций.
 */
export async function changeBookStatus(bookId, newStatus) {
  const book = await getBook(bookId);
  if (!book) return null;

  const oldStatus = book.status;
  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  book.status = newStatus;
  book.updatedAt = now;

  let confetti = false;
  let askRating = false;

  // Переход в reading — фиксируем дату начала
  if (newStatus === 'reading' && !book.dateStarted) {
    book.dateStarted = today;
  }

  // Переход в finished — дата конца + readingDays + конфетти
  if (newStatus === 'finished') {
    if (!book.dateFinished) book.dateFinished = today;
    if (book.dateStarted) {
      const start = new Date(book.dateStarted);
      const end = new Date(today);
      book.readingDays = Math.max(1, Math.round((end - start) / 86400000));
    }
    confetti = true;
    askRating = !(book.review?.rating > 0);
  }

  // Переход в dropped — тоже фиксируем дату
  if (newStatus === 'dropped') {
    if (!book.dateFinished) book.dateFinished = today;
    askRating = true;
  }

  // Выход из finished — сбрасываем дату конца
  if (oldStatus === 'finished' && newStatus !== 'finished') {
    book.dateFinished = '';
    book.readingDays = undefined;
  }

  await putBook(book);
  return { confetti, askRating, book };
}

// ═══════════════════════════════════════════════
//  3. НАСТРОЙКИ
// ═══════════════════════════════════════════════

export async function loadSettings() {
  const db = await openDB();
  return new Promise((resolve) => {
    const req = db.transaction('settings', 'readonly').objectStore('settings').get('app');
    req.onsuccess = () => resolve(req.result?.value || null);
    req.onerror = () => resolve(null);
  });
}

export async function saveSettings(settings) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction('settings', 'readwrite');
    tx.objectStore('settings').put({ id: 'app', value: settings });
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

// ═══════════════════════════════════════════════
//  4. ОБЛОЖКИ (Blob)
// ═══════════════════════════════════════════════

/**
 * Сохраняет Blob обложки для книги.
 */
export async function saveCover(bookId, blob) {
  if (!isValidCoverBlob(blob)) return false;
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction('covers', 'readwrite');
    tx.objectStore('covers').put({ bookId, blob, savedAt: Date.now() });
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

/**
 * Скачивает обложку по URL и сохраняет как Blob.
 */
export async function saveCoverFromUrl(bookId, url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return false;
    const blob = await response.blob();
    if (blob.size < 100) return false;
    await saveCover(bookId, blob);
    return true;
  } catch { return false; }
}

/**
 * Возвращает Blob обложки для книги.
 */
export async function getCover(bookId) {
  const db = await openDB();
  return new Promise((resolve) => {
    if (!db.objectStoreNames.contains('covers')) { resolve(null); return; }
    const req = db.transaction('covers', 'readonly').objectStore('covers').get(bookId);
    req.onsuccess = () => resolve(req.result?.blob || null);
    req.onerror = () => resolve(null);
  });
}

/**
 * Удаляет обложку книги.
 */
export async function deleteCover(bookId) {
  const db = await openDB();
  return new Promise((resolve) => {
    if (!db.objectStoreNames.contains('covers')) { resolve(false); return; }
    const tx = db.transaction('covers', 'readwrite');
    tx.objectStore('covers').delete(bookId);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

// ═══════════════════════════════════════════════
//  5. ВАЛИДАЦИЯ ОБЛОЖЕК
// ═══════════════════════════════════════════════

/**
 * Проверяет, является ли Blob валидной обложкой.
 * Защита от битых/пустых файлов в IndexedDB.
 */
export function isValidCoverBlob(blob) {
  if (!blob || typeof blob !== 'object') return false;
  if (blob.size < 200) return false;
  const type = (blob.type || '').toLowerCase();
  return type.startsWith('image/jpeg') ||
         type.startsWith('image/png') ||
         type.startsWith('image/webp');
}

// ═══════════════════════════════════════════════
//  6. РЕМОНТ БИТЫХ ОБЛОЖЕК
// ═══════════════════════════════════════════════

/**
 * Удаляет невалидные обложки из IndexedDB.
 * Вызывается при старте приложения.
 * @returns {number} — количество удалённых
 */
export async function repairCovers() {
  const db = await openDB();
  if (!db.objectStoreNames.contains('covers')) return 0;

  const covers = await new Promise((resolve) => {
    const req = db.transaction('covers', 'readonly').objectStore('covers').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });

  let removed = 0;
  for (const cover of covers) {
    const blob = cover.blob;
    if (!isValidCoverBlob(blob)) {
      try {
        await new Promise((resolve) => {
          const tx = db.transaction('covers', 'readwrite');
          tx.objectStore('covers').delete(cover.bookId);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        });
        removed++;
      } catch { /* ignore */ }
    }
  }
  return removed;
}

// ═══════════════════════════════════════════════
//  7. ПОДБОРКИ (collections)
// ═══════════════════════════════════════════════

/**
 * Загружает все подборки, отсортированные по order.
 */
export async function loadCollections() {
  const db = await openDB();
  return new Promise((resolve) => {
    const req = db.transaction('collections', 'readonly').objectStore('collections').getAll();
    req.onsuccess = () => {
      const cols = (req.result || []).sort((a, b) => (a.order || 0) - (b.order || 0));
      resolve(cols);
    };
    req.onerror = () => resolve([]);
  });
}

export async function putCollection(collection) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction('collections', 'readwrite');
    tx.objectStore('collections').put(collection);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

export async function delCollection(id) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction('collections', 'readwrite');
    tx.objectStore('collections').delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

export async function addBookToCollection(collectionId, bookId) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction('collections', 'readwrite');
    const store = tx.objectStore('collections');
    const req = store.get(collectionId);
    req.onsuccess = () => {
      const col = req.result;
      if (!col) { resolve(false); return; }
      if (!col.bookIds) col.bookIds = [];
      if (!col.bookIds.includes(bookId)) col.bookIds.push(bookId);
      store.put(col);
    };
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

export async function removeBookFromCollection(collectionId, bookId) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction('collections', 'readwrite');
    const store = tx.objectStore('collections');
    const req = store.get(collectionId);
    req.onsuccess = () => {
      const col = req.result;
      if (!col) { resolve(false); return; }
      if (col.bookIds) col.bookIds = col.bookIds.filter(id => id !== bookId);
      store.put(col);
    };
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

/**
 * Перемещает подборку вверх/вниз в списке.
 */
export async function moveCollection(id, direction) {
  const collections = await loadCollections();
  const idx = collections.findIndex(c => c.id === id);
  if (idx < 0) return;

  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= collections.length) return;

  // Меняем order местами
  const tempOrder = collections[idx].order;
  collections[idx].order = collections[swapIdx].order;
  collections[swapIdx].order = tempOrder;

  // Сохраняем обе в одной транзакции
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction('collections', 'readwrite');
    const store = tx.objectStore('collections');
    store.put(collections[idx]);
    store.put(collections[swapIdx]);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

/**
 * Возвращает следующий order для новой подборки.
 */
export async function getNextCollectionOrder() {
  const collections = await loadCollections();
  if (collections.length === 0) return 0;
  return Math.max(...collections.map(c => c.order || 0)) + 1;
}

// ═══════════════════════════════════════════════
//  8. ЧЕЛЛЕНДЖИ (challenges)
// ═══════════════════════════════════════════════

export async function loadChallenges() {
  const db = await openDB();
  return new Promise((resolve) => {
    const req = db.transaction('challenges', 'readonly').objectStore('challenges').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

export async function putChallenge(challenge) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction('challenges', 'readwrite');
    tx.objectStore('challenges').put(challenge);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

export async function delChallenge(id) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction('challenges', 'readwrite');
    tx.objectStore('challenges').delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

export async function addBookToChallenge(challengeId, bookId) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction('challenges', 'readwrite');
    const store = tx.objectStore('challenges');
    const req = store.get(challengeId);
    req.onsuccess = () => {
      const ch = req.result;
      if (!ch) { resolve(false); return; }
      if (!ch.bookIds) ch.bookIds = [];
      if (!ch.bookIds.includes(bookId)) ch.bookIds.push(bookId);
      store.put(ch);
    };
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

export async function removeBookFromChallenge(challengeId, bookId) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction('challenges', 'readwrite');
    const store = tx.objectStore('challenges');
    const req = store.get(challengeId);
    req.onsuccess = () => {
      const ch = req.result;
      if (!ch) { resolve(false); return; }
      if (ch.bookIds) ch.bookIds = ch.bookIds.filter(id => id !== bookId);
      store.put(ch);
    };
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

// ═══════════════════════════════════════════════
//  9. ТЕГИ (tags)
// ═══════════════════════════════════════════════

export async function loadTags() {
  const db = await openDB();
  return new Promise((resolve) => {
    const req = db.transaction('tags', 'readonly').objectStore('tags').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

export async function putTag(tag) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction('tags', 'readwrite');
    tx.objectStore('tags').put(tag);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

export async function delTag(name) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction('tags', 'readwrite');
    tx.objectStore('tags').delete(name);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

// ═══════════════════════════════════════════════
//  10. КОНТЕНТ (внутри книг)
// ═══════════════════════════════════════════════

/**
 * Добавляет контент-элемент к книге.
 * Если bookId = '__no_book__', контент хранится в специальной записи.
 */
export async function addContentToBook(bookId, contentItem) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction('books', 'readwrite');
    const store = tx.objectStore('books');
    const req = store.get(bookId);
    req.onsuccess = () => {
      let book = req.result;
      // Создаём __no_book__ если не существует
      if (!book && bookId === '__no_book__') {
        book = ensureBookFields({
          id: '__no_book__',
          title: 'Без книги',
          author: '',
          status: 'added',
          contentItems: [],
        });
      }
      if (!book) { resolve(false); return; }
      if (!book.contentItems) book.contentItems = [];
      book.contentItems.push(ensureContentItemFields(contentItem));
      book.updatedAt = new Date().toISOString();
      store.put(book);
    };
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

/**
 * Обновляет контент-элемент внутри книги (partial update).
 */
export async function updateContentInBook(bookId, contentId, updates) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction('books', 'readwrite');
    const store = tx.objectStore('books');
    const req = store.get(bookId);
    req.onsuccess = () => {
      const book = req.result;
      if (!book) { resolve(false); return; }
      const item = (book.contentItems || []).find(c => c.id === contentId);
      if (!item) { resolve(false); return; }
      Object.assign(item, updates);
      book.updatedAt = new Date().toISOString();
      store.put(book);
    };
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

/**
 * Удаляет контент-элемент из книги.
 */
export async function removeContentFromBook(bookId, contentId) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction('books', 'readwrite');
    const store = tx.objectStore('books');
    const req = store.get(bookId);
    req.onsuccess = () => {
      const book = req.result;
      if (!book) { resolve(false); return; }
      if (book.contentItems) {
        book.contentItems = book.contentItems.filter(c => c.id !== contentId);
      }
      book.updatedAt = new Date().toISOString();
      store.put(book);
    };
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

// ═══════════════════════════════════════════════
//  11. ОТЗЫВЫ (внутри книг)
// ═══════════════════════════════════════════════

/**
 * Сохраняет отзыв для книги.
 */
export async function saveReviewForBook(bookId, review) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction('books', 'readwrite');
    const store = tx.objectStore('books');
    const req = store.get(bookId);
    req.onsuccess = () => {
      const book = req.result;
      if (!book) { resolve(false); return; }
      book.review = review;
      book.updatedAt = new Date().toISOString();
      store.put(book);
    };
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

/**
 * Удаляет отзыв из книги.
 */
export async function removeReviewFromBook(bookId) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction('books', 'readwrite');
    const store = tx.objectStore('books');
    const req = store.get(bookId);
    req.onsuccess = () => {
      const book = req.result;
      if (!book) { resolve(false); return; }
      book.review = {};
      book.updatedAt = new Date().toISOString();
      store.put(book);
    };
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

// ═══════════════════════════════════════════════
//  12. PENDING SYNC (🆕 v3.8.3)
// ═══════════════════════════════════════════════

/**
 * Добавляет операцию в очередь отложенной синхронизации.
 * Используется при офлайн-добавлении книги по ISBN.
 *
 * Связь с sw.js: обработчик 'sync' читает этот store
 * и повторяет запросы к API при восстановлении сети.
 *
 * @param {{ id: string, bookId: string, isbn: string }} item
 */
export async function putPendingSync(item) {
  const db = await openDB();
  return new Promise((resolve) => {
    if (!db.objectStoreNames.contains('pending-sync')) { resolve(false); return; }
    const tx = db.transaction('pending-sync', 'readwrite');
    tx.objectStore('pending-sync').put(item);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

/**
 * Возвращает все отложенные операции.
 */
export async function getPendingSync() {
  const db = await openDB();
  return new Promise((resolve) => {
    if (!db.objectStoreNames.contains('pending-sync')) { resolve([]); return; }
    const req = db.transaction('pending-sync', 'readonly').objectStore('pending-sync').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

/**
 * Удаляет операцию из очереди после успешной синхронизации.
 */
export async function deletePendingSync(id) {
  const db = await openDB();
  return new Promise((resolve) => {
    if (!db.objectStoreNames.contains('pending-sync')) { resolve(false); return; }
    const tx = db.transaction('pending-sync', 'readwrite');
    tx.objectStore('pending-sync').delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

// ═══════════════════════════════════════════════
//  13. ЭКСПОРТ / ИМПОРТ
// ═══════════════════════════════════════════════

/**
 * Экспортирует все данные в JSON-объект.
 */
export async function exportAll() {
  const db = await openDB();
  const getAll = (storeName) => new Promise((resolve) => {
    if (!db.objectStoreNames.contains(storeName)) { resolve([]); return; }
    const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });

  const [books, collections, challenges, tags, previews] = await Promise.all([
    getAll('books'),
    getAll('collections'),
    getAll('challenges'),
    getAll('tags'),
    getAll('previews'),
  ]);

  const settings = await loadSettings();

  return {
    app: 'BookTrackerPro',
    version: 1,
    exportedAt: new Date().toISOString(),
    books,
    collections,
    challenges,
    tags,
    settings,
    // Обложки экспортируем отдельно (Blob → base64)
    // Для простоты в v3.8.3 обложки не включены в экспорт
  };
}

/**
 * Импортирует данные из JSON-объекта (заменяет текущие).
 */
export async function importAll(data) {
  if (!data || !data.books) throw new Error('Неверный формат бэкапа');

  const db = await openDB();

  // Очищаем текущие данные (одна транзакция на store)
  const stores = ['books', 'collections', 'challenges', 'tags', 'previews'];
  for (const storeName of stores) {
    if (!db.objectStoreNames.contains(storeName)) continue;
    await new Promise((resolve) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  // Импортируем книги
  if (data.books?.length > 0) {
    await new Promise((resolve) => {
      const tx = db.transaction('books', 'readwrite');
      const store = tx.objectStore('books');
      for (const book of data.books) {
        store.put(ensureBookFields(book));
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  // Импортируем подборки
  if (data.collections?.length > 0) {
    await new Promise((resolve) => {
      const tx = db.transaction('collections', 'readwrite');
      const store = tx.objectStore('collections');
      for (const col of data.collections) store.put(col);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  // Импортируем челленджи
  if (data.challenges?.length > 0) {
    await new Promise((resolve) => {
      const tx = db.transaction('challenges', 'readwrite');
      const store = tx.objectStore('challenges');
      for (const ch of data.challenges) store.put(ch);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  // Импортируем теги
  if (data.tags?.length > 0) {
    await new Promise((resolve) => {
      const tx = db.transaction('tags', 'readwrite');
      const store = tx.objectStore('tags');
      for (const tag of data.tags) store.put(tag);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  // Импортируем настройки
  if (data.settings) {
    await saveSettings(data.settings);
  }

  return true;
}

// ═══════════════════════════════════════════════
//  14. РАЗМЕР БАЗЫ
// ═══════════════════════════════════════════════

/**
 * Возвращает приблизительный размер данных приложения.
 */
export async function getDBSize() {
  try {
    if (!navigator.storage?.estimate) return 'недоступно';
    const { usage } = await navigator.storage.estimate();
    if (usage < 1024) return usage + ' Б';
    if (usage < 1024 * 1024) return (usage / 1024).toFixed(1) + ' КБ';
    return (usage / (1024 * 1024)).toFixed(1) + ' МБ';
  } catch {
    return 'недоступно';
  }
}

// ═══════════════════════════════════════════════
//  15. СЛУЖЕБНОЕ: обеспечение полей
// ═══════════════════════════════════════════════

/**
 * Гарантирует наличие всех обязательных полей книги.
 * Вызывается при каждой загрузке из IndexedDB.
 */
function ensureBookFields(book) {
  if (!book.id) book.id = `book_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  if (!book.title) book.title = '';
  if (!book.author) book.author = '';
  if (!book.status) book.status = 'wishlist';
  if (!book.dateAdded) book.dateAdded = new Date().toISOString();
  if (!book.updatedAt) book.updatedAt = book.dateAdded;
  if (!book.contentItems) book.contentItems = [];
  if (!book.review) book.review = {};
  if (!book.tags) book.tags = [];
  if (!book.tropes) book.tropes = [];
  if (!book.formats) book.formats = [];
  if (!book.notes) book.notes = '';
  if (!book.description) book.description = '';
  if (!book.genre) book.genre = '';
  if (!book.publisher) book.publisher = '';
  if (!book.isbn) book.isbn = '';
  if (!book.series) book.series = '';
  if (book.cover === undefined) book.cover = '';
  if (book.coverUrl === undefined) book.coverUrl = '';
  if (book.price === undefined) book.price = { amount: 0, currency: 'RUB' };
  if (book.isPR === undefined) book.isPR = false;
  if (book.currentPage === undefined) book.currentPage = 0;
  if (book.pageCount === undefined) book.pageCount = 0;
  if (book.rating === undefined) book.rating = 0;
  if (book.pepperRating === undefined) book.pepperRating = 0;
  if (book.tearRating === undefined) book.tearRating = 0;
  if (book.intrigueRating === undefined) book.intrigueRating = 0;
  if (book.horrorRating === undefined) book.horrorRating = 0;
  if (book.characters === undefined) book.characters = [];
  if (book.jointReading === undefined) {
    book.jointReading = { active: false, participants: [], chatLink: '', notes: '', startDate: '' };
  }
  return book;
}

/**
 * Гарантирует наличие всех обязательных полей контент-элемента.
 */
function ensureContentItemFields(item) {
  if (!item.id) item.id = `content_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  if (!item.type) item.type = 'unboxing';
  if (!item.title) item.title = '';
  if (!item.platform) item.platform = 'youtube';
  if (!item.status) item.status = 'idea';
  if (!item.plannedDate) item.plannedDate = '';
  if (!item.publishedDate) item.publishedDate = '';
  if (!item.publishedUrl) item.publishedUrl = '';
  if (!item.notes) item.notes = '';
  if (!item.createdAt) item.createdAt = new Date().toISOString();
  if (!item.updatedAt) item.updatedAt = item.createdAt;
  if (item.reportSent === undefined) item.reportSent = false;
  if (!item.reportDate) item.reportDate = '';
  return item;
}