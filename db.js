// 📦 BookTrackerPro — db.js
// 🔖 v3.8.6 | 2026-09-25
// 📝 IndexedDB: книги, обложки, настройки,
//    подборки, челленджи, теги, превью ссылок
//    Версия БД: 6
//    Stores: books, covers, settings,
//            collections, challenges, tags, previews,
//            pending-sync
//
//    Новое в 3.8.6: без функциональных изменений.
//    Сохранено из 3.8.5:
//      — importAll = СИНХРОНИЗАЦИЯ (merge):
//        добавляет только отсутствующие записи (по id/name),
//        дубли пропускает, возвращает сводку { added*, skipped* }
//      — shelfMark { color, text } в ensureBookFields
//      — putBooks (batch) — одна транзакция для N книг
//      — Store 'pending-sync' для Background Sync API
//      — repairCovers() / isValidCoverBlob()
//      — Миграции v1→v6 без потери данных
// ─────────────────────────────────────────────
import { safeUrl, safeLinkUrl } from './utils.js'; // 🆕 P1-2: валидация URL при записи

const DB_NAME = 'book-tracker-pro';
const DB_VER = 6;
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

/**
 * 🆕 P2-4: ошибка «база заблокирована другим открытым соединением»
 * (другая вкладка держит старую версию БД и мешает upgrade).
 * Выбрасывается из openDB() вместо бесконечного ожидания — иначе
 * init() навсегда висел, #skeleton оставался, UI выглядел зависшим.
 */
export class DBBlockedError extends Error {
  constructor() {
    super('Инициализация базы данных заблокирована — закройте другие вкладки BookTrackerPro');
    this.name = 'DBBlockedError';
    this.code = 'DB_BLOCKED';
  }
}

export function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VER);
    let settled = false;
    const settleReject = (e) => {
      if (settled) return;
      settled = true;
      reject(e);
    };
    const settleResolve = (db) => {
      if (settled) {
        // 🆕 P2-4: запрос был заблокирован и отклонён, но после снятия
        // блокировки (пользователь закрыл другую вкладку) IDB всё же
        // завершил upgrade успешно. Это осиротевшее соединение нам не нужно:
        // закрываем его, чтобы оно не «висело» и не блокировало будущие
        // openDB/deleteDatabase (в этот момент versionchange-транзакция уже
        // завершена, поэтому close() безопасен и не прерывает upgrade).
        db.close();
        return;
      }
      _db = db;
      _db.onclose = () => { _db = null; };
      _db.onversionchange = () => {
        _db.close();
        _db = null;
        // reload только там, где есть окно (не в node-тестах)
        if (typeof window !== 'undefined') window.location.reload();
      };
      settled = true;
      resolve(_db);
    };

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction;
      const oldVer = event.oldVersion;

      if (oldVer < 1) {
        const books = db.createObjectStore('books', { keyPath: 'id' });
        books.createIndex('status', 'status', { unique: false });
        books.createIndex('updatedAt', 'updatedAt', { unique: false });
        books.createIndex('dateAdded', 'dateAdded', { unique: false });
        books.createIndex('titleAuthor', ['title', 'author'], { unique: false });
        db.createObjectStore('settings', { keyPath: 'id' });
      }
      if (oldVer < 2) {
        if (!db.objectStoreNames.contains('covers')) {
          db.createObjectStore('covers', { keyPath: 'bookId' });
        }
      }
      if (oldVer < 3) {
        const books = tx.objectStore('books');
        if (!books.indexNames.contains('isPR')) books.createIndex('isPR', 'isPR', { unique: false });
        if (!books.indexNames.contains('blogStatus')) books.createIndex('blogStatus', 'blogStatus', { unique: false });
        if (!books.indexNames.contains('genre')) books.createIndex('genre', 'genre', { unique: false });
      }
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
      if (oldVer < 5) {
        if (!db.objectStoreNames.contains('previews')) {
          const previews = db.createObjectStore('previews', { keyPath: 'id' });
          previews.createIndex('cachedAt', 'cachedAt', { unique: false });
        }
      }
      if (oldVer < 6) {
        if (!db.objectStoreNames.contains('pending-sync')) {
          db.createObjectStore('pending-sync', { keyPath: 'id' });
        }
      }
    };

    request.onsuccess = () => settleResolve(request.result);
    request.onerror = () => settleReject(request.error || new Error('open failed'));
    // 🆕 P2-4: вместо console.warn + вечного зависания отклоняем Promise
    // специальной ошибкой. Убираем блокировку, регистрируем onblocked.
    request.onblocked = () => {
      console.warn('[DB] Blocked — закройте другие вкладки');
      settleReject(new DBBlockedError());
    };
  });
}

// 🆕 P1-5: ошибки IndexedDB больше НЕ маскируются под «успех».
// request.onerror / tx.onerror / tx.onabort отклоняют Promise,
// а не превращают сбой в штатное пустое значение/`false`.
// Используются закрытия req.error / tx.error — не зависит от того,
// передаёт ли реализация IDB объект события в обработчик.
// Исключения (намеренно остаются успешными «ненайденными»):
//   — несуществующий key в get* / *store-missing на легаси-БД → null/false/[];
//   — repairCovers() / exportAll() — best-effort ремонт и P2-1 export.

// ═══════════════════════════════════════════════
//  2. КНИГИ — CRUD
// ═══════════════════════════════════════════════
export async function loadBooks() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readonly');
    const req = tx.objectStore('books').getAll();
    req.onsuccess = () => {
      const books = (req.result || []).map(ensureBookFields);
      books.sort((a, b) => (b.dateAdded || '').localeCompare(a.dateAdded || ''));
      resolve(books);
    };
    req.onerror = () => reject(req.error || new Error('read failed'));
    // 🆕 P1-5: abort/error транзакции чтения тоже отклоняет Promise —
    // без этого искусственный abort (и некоторые реализации IDB) не вызывают req.onerror.
    tx.onerror = () => reject(tx.error || new Error('read failed'));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

export async function putBook(book) {
  const db = await openDB();
  const safe = ensureBookFields(book);
  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readwrite');
    tx.objectStore('books').put(safe);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => { console.error('[DB] putBook error:', tx.error); reject(tx.error || new Error('write failed')); };
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

export async function putBooks(books) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readwrite');
    const store = tx.objectStore('books');
    for (const book of books) store.put(ensureBookFields(book));
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('write failed'));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

export async function delBook(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readwrite');
    tx.objectStore('books').delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('write failed'));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

export async function getBook(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readonly');
    const req = tx.objectStore('books').get(id);
    req.onsuccess = () => resolve(req.result ? ensureBookFields(req.result) : null);
    req.onerror = () => reject(req.error || new Error('read failed'));
    tx.onerror = () => reject(tx.error || new Error('read failed'));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

// 🆕 P2-10: единая точка бизнес-правил перехода статуса.
// Используется обоими путями: dropdown (changeBookStatus) и формой (saveBookForm) —
// иначе одинаковые действия давали разные даты/readingDays/confetti/rating prompt.
// Принимает книгу с текущими dateStarted/dateFinished/readingDays/review,
// мутирует поля перехода и возвращает UI-флаги {confetti, askRating}.
// Смена статуса (old === new) — no-op: обычное сохранение не плодит эффекты.
export function applyStatusTransition(book, oldStatus, newStatus, nowIso = new Date().toISOString()) {
  if (!book) return { confetti: false, askRating: false };
  let confetti = false;
  let askRating = false;
  if (oldStatus === newStatus) return { confetti, askRating };
  const today = nowIso.slice(0, 10);
  book.status = newStatus;
  if (newStatus === 'reading' && !book.dateStarted) book.dateStarted = today;
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
  if (newStatus === 'dropped') {
    if (!book.dateFinished) book.dateFinished = today;
    askRating = true;
  }
  if (oldStatus === 'finished' && newStatus !== 'finished') {
    book.dateFinished = '';
    book.readingDays = undefined;
  }
  return { confetti, askRating };
}

export async function changeBookStatus(bookId, newStatus) {
  const book = await getBook(bookId);
  if (!book) return null;
  const oldStatus = book.status;
  const now = new Date().toISOString();
  book.updatedAt = now;
  const { confetti, askRating } = applyStatusTransition(book, oldStatus, newStatus, now);
  await putBook(book);
  return { confetti, askRating, book };
}

// ═══════════════════════════════════════════════
//  3. НАСТРОЙКИ
// ═══════════════════════════════════════════════
export async function loadSettings() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readonly');
    const req = tx.objectStore('settings').get('app');
    req.onsuccess = () => resolve(req.result?.value || null);
    req.onerror = () => reject(req.error || new Error('read failed'));
    tx.onerror = () => reject(tx.error || new Error('read failed'));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

export async function saveSettings(settings) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readwrite');
    tx.objectStore('settings').put({ id: 'app', value: settings });
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('write failed'));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

// ═══════════════════════════════════════════════
//  4. ОБЛОЖКИ (Blob)
// ═══════════════════════════════════════════════
export async function saveCover(bookId, blob) {
  if (!isValidCoverBlob(blob)) return false;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('covers', 'readwrite');
    tx.objectStore('covers').put({ bookId, blob, savedAt: Date.now() });
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('write failed'));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

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

export async function getCover(bookId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains('covers')) { resolve(null); return; }
    const tx = db.transaction('covers', 'readonly');
    const req = tx.objectStore('covers').get(bookId);
    req.onsuccess = () => resolve(req.result?.blob || null);
    req.onerror = () => reject(req.error || new Error('read failed'));
    tx.onerror = () => reject(tx.error || new Error('read failed'));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

// 🆕 P2-8: batch-загрузка обложек ОДНОЙ readonly-транзакцией.
// Стартовый путь app.js (restoreCoverUrls) раньше вызывал getCover() для
// КАЖДОЙ книги — N отдельных транзакций; на большой библиотеке это
// линейно тормозило старт до первого render. loadCovers() читает весь
// store 'covers' один раз и возвращает Map<bookId, Blob>.
// bookIds (необязательный массив) фильтрует результат; без него — все covers.
export async function loadCovers(bookIds) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains('covers')) { resolve(new Map()); return; }
    const tx = db.transaction('covers', 'readonly');
    const req = tx.objectStore('covers').getAll();
    req.onsuccess = () => {
      const map = new Map();
      const want = bookIds && bookIds.length ? new Set(bookIds) : null;
      for (const row of (req.result || [])) {
        if (row && row.bookId && (!want || want.has(row.bookId))) map.set(row.bookId, row.blob);
      }
      resolve(map);
    };
    req.onerror = () => reject(req.error || new Error('read failed'));
    tx.onerror = () => reject(tx.error || new Error('read failed'));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

export async function deleteCover(bookId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains('covers')) { resolve(false); return; }
    const tx = db.transaction('covers', 'readwrite');
    tx.objectStore('covers').delete(bookId);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('write failed'));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

// 🆕 P1-8: каскадное удаление книги АТОМАРНО.
// Одна readwrite-транзакция по books+covers+collections+challenges:
//   1) удаляется сама книга;
//   2) удаляется её обложка;
//   3) bookIds фильтруется во ВСЕХ коллекциях и челленджах;
//   4) при любой ошибке транзакция abort'ится → книга не может
//      «исчезнуть, а ссылки остаться» / «книга удалена, cover остался».
// Возврат: boolean (true — транзакция применена; false — нет такой книги).
export async function deleteBookCascade(bookId) {
  const db = await openDB();
  const withStore = (name) => db.objectStoreNames.contains(name);
  const storeNames = ['books', 'covers', 'collections', 'challenges'].filter(withStore);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, 'readwrite');
    const booksStore = tx.objectStore('books');

    // ── подтверждаем, что книга существует (иначе no-op) ──
    const checkReq = booksStore.get(bookId);
    checkReq.onsuccess = () => {
      if (!checkReq.result) { resolve(false); return; }

      // 1) книга
      booksStore.delete(bookId);
      // 2) обложка
      if (withStore('covers')) tx.objectStore('covers').delete(bookId);

      // 3) фильтрация bookIds во всех подборках и челленджах
      const filterRefs = (storeName) => {
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = () => {
          for (const rec of req.result || []) {
            if (Array.isArray(rec.bookIds) && rec.bookIds.includes(bookId)) {
              rec.bookIds = rec.bookIds.filter(id => id !== bookId);
              store.put(rec);
            }
          }
        };
        req.onerror = () => reject(req.error || new Error('read failed'));
      };
      if (withStore('collections')) filterRefs('collections');
      if (withStore('challenges')) filterRefs('challenges');
    };
    checkReq.onerror = () => reject(checkReq.error || new Error('read failed'));

    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('write failed'));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

// 🆕 P1-8: безопасная repair-процедура для УЖЕ СУЩЕСТВУЮЩИХ dangling refs.
// Удаляет из bookIds коллекций/челленджей ссылки на несуществующие книги.
// Возвращает количество исправленных коллекций+челленджей.
export async function repairDanglingRefs() {
  const db = await openDB();
  if (!db.objectStoreNames.contains('collections') && !db.objectStoreNames.contains('challenges')) return 0;

  const existingIds = new Set();
  await new Promise((resolve) => {
    const req = db.transaction('books', 'readonly').objectStore('books').getAll();
    req.onsuccess = () => {
      for (const b of req.result || []) existingIds.add(b.id);
      resolve();
    };
    req.onerror = () => resolve(); // best-effort ремонт — сбой чтения не прерывает init
  });
  // Даже если книг нет вообще — любые ссылки dangling, ремонт их вычистит.

  return new Promise((resolve, reject) => {
    const storeNames = ['collections', 'challenges'].filter(n => db.objectStoreNames.contains(n));
    const tx = db.transaction(storeNames, 'readwrite');
    let fixed = 0;
    const filterRefs = (storeName) => {
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => {
        for (const rec of req.result || []) {
          if (Array.isArray(rec.bookIds)) {
            const before = rec.bookIds.length;
            rec.bookIds = rec.bookIds.filter(id => existingIds.has(id));
            if (rec.bookIds.length !== before) {
              store.put(rec);
              fixed++;
            }
          }
        }
      };
      req.onerror = () => reject(req.error || new Error('read failed'));
    };
    for (const name of storeNames) filterRefs(name);

    tx.oncomplete = () => resolve(fixed);
    tx.onerror = () => { /* best-effort: сбой readwrite не прерывает init */ };
  });
}

// ═══════════════════════════════════════════════
//  5. ВАЛИДАЦИЯ И РЕМОНТ ОБЛОЖЕК
// ═══════════════════════════════════════════════
export function isValidCoverBlob(blob) {
  if (!blob || typeof blob !== 'object') return false;
  if (blob.size < 200) return false;
  const type = (blob.type || '').toLowerCase();
  return type.startsWith('image/jpeg') ||
         type.startsWith('image/png') ||
         type.startsWith('image/webp');
}

export async function repairCovers() {
  const db = await openDB();
  if (!db.objectStoreNames.contains('covers')) return 0;
  const covers = await new Promise((resolve) => {
    const req = db.transaction('covers', 'readonly').objectStore('covers').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]); // best-effort ремонт — сбой чтения не прерывает init
  });
  let removed = 0;
  for (const cover of covers) {
    if (!isValidCoverBlob(cover.blob)) {
      try {
        await new Promise((resolve, reject) => {
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
//  6. ПОДБОРКИ
// ═══════════════════════════════════════════════
export async function loadCollections() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('collections', 'readonly');
    const req = tx.objectStore('collections').getAll();
    req.onsuccess = () => resolve((req.result || []).sort((a, b) => (a.order || 0) - (b.order || 0)));
    req.onerror = () => reject(req.error || new Error('read failed'));
    tx.onerror = () => reject(tx.error || new Error('read failed'));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

export async function putCollection(collection) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('collections', 'readwrite');
    tx.objectStore('collections').put(collection);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('write failed'));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

export async function delCollection(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('collections', 'readwrite');
    tx.objectStore('collections').delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('write failed'));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

export async function addBookToCollection(collectionId, bookId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
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
    tx.onerror = () => reject(tx.error || new Error('write failed'));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

export async function removeBookFromCollection(collectionId, bookId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
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
    tx.onerror = () => reject(tx.error || new Error('write failed'));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

export async function moveCollection(id, direction) {
  const collections = await loadCollections();
  const idx = collections.findIndex(c => c.id === id);
  if (idx < 0) return;
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= collections.length) return;
  const tempOrder = collections[idx].order;
  collections[idx].order = collections[swapIdx].order;
  collections[swapIdx].order = tempOrder;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('collections', 'readwrite');
    const store = tx.objectStore('collections');
    store.put(collections[idx]);
    store.put(collections[swapIdx]);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('write failed'));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

export async function getNextCollectionOrder() {
  const collections = await loadCollections();
  if (collections.length === 0) return 0;
  return Math.max(...collections.map(c => c.order || 0)) + 1;
}

// ═══════════════════════════════════════════════
//  7. ЧЕЛЛЕНДЖИ
// ═══════════════════════════════════════════════
export async function loadChallenges() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('challenges', 'readonly');
    const req = tx.objectStore('challenges').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error || new Error('read failed'));
    tx.onerror = () => reject(tx.error || new Error('read failed'));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

export async function putChallenge(challenge) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('challenges', 'readwrite');
    tx.objectStore('challenges').put(challenge);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('write failed'));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

export async function delChallenge(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('challenges', 'readwrite');
    tx.objectStore('challenges').delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('write failed'));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

export async function addBookToChallenge(challengeId, bookId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
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
    tx.onerror = () => reject(tx.error || new Error('write failed'));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

export async function removeBookFromChallenge(challengeId, bookId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
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
    tx.onerror = () => reject(tx.error || new Error('write failed'));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

// ═══════════════════════════════════════════════
//  8. ТЕГИ
// ═══════════════════════════════════════════════
export async function loadTags() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('tags', 'readonly');
    const req = tx.objectStore('tags').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error || new Error('read failed'));
    tx.onerror = () => reject(tx.error || new Error('read failed'));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

export async function putTag(tag) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('tags', 'readwrite');
    tx.objectStore('tags').put(tag);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('write failed'));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

export async function delTag(name) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('tags', 'readwrite');
    tx.objectStore('tags').delete(name);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('write failed'));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

// ═══════════════════════════════════════════════
//  9. КОНТЕНТ (внутри книг)
// ═══════════════════════════════════════════════
export async function addContentToBook(bookId, contentItem) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readwrite');
    const store = tx.objectStore('books');
    const req = store.get(bookId);
    req.onsuccess = () => {
      let book = req.result;
      if (!book && bookId === '__no_book__') {
        book = ensureBookFields({
          id: '__no_book__', title: 'Без книги', author: '',
          status: 'added', contentItems: [],
        });
      }
      if (!book) { resolve(false); return; }
      if (!book.contentItems) book.contentItems = [];
      book.contentItems.push(ensureContentItemFields(contentItem));
      book.updatedAt = new Date().toISOString();
      store.put(book);
    };
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('write failed'));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

export async function updateContentInBook(bookId, contentId, updates) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readwrite');
    const store = tx.objectStore('books');
    const req = store.get(bookId);
    req.onsuccess = () => {
      const book = req.result;
      if (!book) { resolve(false); return; }
      const item = (book.contentItems || []).find(c => c.id === contentId);
      if (!item) { resolve(false); return; }
      Object.assign(item, updates);
      // 🆕 P1-2: санитизация URL при любом обновлении контента
      if (typeof item.publishedUrl === 'string') item.publishedUrl = safeLinkUrl(item.publishedUrl);
      book.updatedAt = new Date().toISOString();
      store.put(book);
    };
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('write failed'));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

export async function removeContentFromBook(bookId, contentId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readwrite');
    const store = tx.objectStore('books');
    const req = store.get(bookId);
    req.onsuccess = () => {
      const book = req.result;
      if (!book) { resolve(false); return; }
      if (book.contentItems) book.contentItems = book.contentItems.filter(c => c.id !== contentId);
      book.updatedAt = new Date().toISOString();
      store.put(book);
    };
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('write failed'));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

/**
 * 🆕 P1-7: атомарный перенос content item между книгами.
 * Одна readwrite-транзакция по store 'books':
 *   — читает обе книги (source и target);
 *   — удаляет элемент из source;
 *   — добавляет в target (с replace по contentId — конфликт ID не дублирует элемент);
 *   — при любой ошибке транзакция abort'ится → элемент НЕ может оказаться
 *     одновременно в двух книгах или ни в одной.
 *
 * Результат (контракт P1-5):
 *   — true — перенос применён;
 *   — false — штатное «не найдено / no-op» (одинаковые книги, нет source,
 *     нет элемента в source, нет target; НИЧЕГО не записано, без abort);
 *   — reject — реальный сбой IndexedDB (ошибка/abort транзакции).
 *
 * @param {string} sourceBookId — книга, из которой переносится элемент
 * @param {string} targetBookId — книга, куда переносится элемент
 * @param {string} contentId — id переносимого content item
 * @param {object} [contentData] — новые данные элемента (если элемент редактировался);
 *                                 иначе переносится существующий элемент как есть
 */
export async function moveContentItem(sourceBookId, targetBookId, contentId, contentData) {
  if (!sourceBookId || !targetBookId || !contentId || sourceBookId === targetBookId) return false;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readwrite');
    const store = tx.objectStore('books');

    const srcReq = store.get(sourceBookId);
    srcReq.onsuccess = () => {
      const srcBook = srcReq.result;
      if (!srcBook) { resolve(false); return; }
      const existingItem = (srcBook.contentItems || []).find(c => c.id === contentId);
      if (!existingItem) { resolve(false); return; }

      const dstReq = store.get(targetBookId);
      dstReq.onsuccess = () => {
        let dstBook = dstReq.result;
        if (!dstBook && targetBookId === '__no_book__') {
          dstBook = ensureBookFields({
            id: '__no_book__', title: 'Без книги', author: '',
            status: 'added', contentItems: [],
          });
        }
        if (!dstBook) { resolve(false); return; }

        // ── обе книги подтверждены — теперь модификации в одной транзакции ──
        const itemToMove = contentData
          ? ensureContentItemFields(contentData)
          : existingItem;

        // удаляем из source
        srcBook.contentItems = (srcBook.contentItems || []).filter(c => c.id !== contentId);
        srcBook.updatedAt = new Date().toISOString();
        store.put(srcBook);

        // добавляем в target (замена по id — исключает дубликат при конфликте)
        if (!dstBook.contentItems) dstBook.contentItems = [];
        dstBook.contentItems = dstBook.contentItems.filter(c => c.id !== contentId);
        dstBook.contentItems.push(itemToMove);
        dstBook.updatedAt = new Date().toISOString();
        store.put(dstBook);
      };
      dstReq.onerror = () => reject(dstReq.error || new Error('read failed'));
    };
    srcReq.onerror = () => reject(srcReq.error || new Error('read failed'));

    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('write failed'));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

// ═══════════════════════════════════════════════
//  10. ОТЗЫВЫ (внутри книг)
// ═══════════════════════════════════════════════
export async function saveReviewForBook(bookId, review) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
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
    tx.onerror = () => reject(tx.error || new Error('write failed'));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

export async function removeReviewFromBook(bookId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
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
    tx.onerror = () => reject(tx.error || new Error('write failed'));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

// ═══════════════════════════════════════════════
//  11. PENDING SYNC (Background Sync)
// ═══════════════════════════════════════════════
export async function putPendingSync(item) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains('pending-sync')) { resolve(false); return; }
    const tx = db.transaction('pending-sync', 'readwrite');
    tx.objectStore('pending-sync').put(item);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('write failed'));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

export async function getPendingSync() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains('pending-sync')) { resolve([]); return; }
    const tx = db.transaction('pending-sync', 'readonly');
    const req = tx.objectStore('pending-sync').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error || new Error('read failed'));
    tx.onerror = () => reject(tx.error || new Error('read failed'));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

export async function deletePendingSync(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains('pending-sync')) { resolve(false); return; }
    const tx = db.transaction('pending-sync', 'readwrite');
    tx.objectStore('pending-sync').delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('write failed'));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

// ═══════════════════════════════════════════════
//  12. ЭКСПОРТ
// ═══════════════════════════════════════════════
/**
 * Blob → base64 (для переноса локальных обложек в JSON-бэкап).
 *
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
async function blobToBase64(blob) {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * base64 → Blob (восстановление обложки при импорте).
 *
 * @param {string} b64
 * @param {string} mime
 * @returns {Blob}
 */
function base64ToBlob(b64, mime) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * 🆕 P1-4: чистит настройки для экспорта по ЯВНОМУ allowlist.
 * Возвращает НОВЫЙ объект только с безопасными ключами.
 * Credentials (lrAppId/lrSecret/lrPartnerId/lrPartnerSecret/
 * microlinkApiKey) и любые будущие неизвестные ключи
 * в backup не попадают (denylist не используется).
 *
 * @param {object|null|undefined} settings — сырые настройки из IndexedDB
 * @returns {object} — объект только из безопасных полей (никогда null)
 */
export function sanitizeSettingsForExport(settings) {
  const SAFE_SETTINGS_KEYS = [
    'confetti', 'sound', 'defaultPlatform', 'bloggerMode',
    'defaultCurrency', 'showPriceInCards', 'showPriceInDetail', 'showPriceInStats',
    'exchangeRates', 'ratesUpdated',
  ];
  if (!settings || typeof settings !== 'object') return {};
  const out = {};
  for (const key of SAFE_SETTINGS_KEYS) {
    if (key in settings) out[key] = settings[key];
  }
  return out;
}

/**
 * Экспорт: книги, подборки, челленджи, теги, настройки
 * (БЕЗ credentials — P1-4) и ЛОКАЛЬНЫЕ ОБЛОЖКИ (covers store → base64).
 * Внешние https-URL книг не конвертируются в base64 — остаются текстом.
 *
 * 🆕 P2-1: при сбое чтения ЛЮБОГО обязательного store экспорт
 * ОТКЛОНЯЕТСЯ (throw). Раньше req.onerror = resolve([]) превращал ошибку
 * чтения в «пустой массив» и создавался якобы успешный backup с
 * потерянными данными. Теперь неполный файл не скачивается.
 *
 * @returns {Promise<object>}
 * @throws {Error} — при ошибке чтения store / закрытии БД / quota
 */
export async function exportAll() {
  const db = await openDB();

  // 🆕 P2-1: fail-fast при ошибке чтения store.
  // Легитимный «отсутствующий store» (старая схема) по-прежнему → [].
  const getAll = (storeName) => new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(storeName)) { resolve([]); return; }
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error || new Error(`read failed: ${storeName}`));
    tx.onerror = () => reject(tx.error || new Error(`read failed: ${storeName}`));
    tx.onabort = () => reject(tx.error || new Error(`transaction aborted: ${storeName}`));
  });

  const [books, collections, challenges, tags, rawCovers] = await Promise.all([
    getAll('books'), getAll('collections'), getAll('challenges'), getAll('tags'), getAll('covers'),
  ]);
  // 🆕 P1-4: в backup попадают только не-секретные настройки
  // loadSettings() отклоняется при сбое чтения (P1-5) → экспорт fail-fast
  const settings = sanitizeSettingsForExport(await loadSettings());

  // 🆕 P1-3: сериализуем только валидные локальные обложки
  const covers = [];
  for (const c of rawCovers) {
    if (c && isValidCoverBlob(c.blob)) {
      try {
        const base64 = await blobToBase64(c.blob);
        covers.push({ bookId: c.bookId, mime: c.blob.type, base64, savedAt: c.savedAt });
      } catch { /* битый blob — пропускаем */ }
    }
  }

  return {
    app: 'BookTrackerPro',
    version: 1,
    exportedAt: new Date().toISOString(),
    books, collections, challenges, tags, settings, covers,
  };
}

// ═══════════════════════════════════════════════
//  🆕 13. ИМПОРТ = СИНХРОНИЗАЦИЯ (v3.8.5)
// ═══════════════════════════════════════════════
//  🆕 P1-6: импорт АТОМАРЕН и полностью валидируется ДО записи.
//    — schema/type/size/ID/URL/reference валидация (throw при сбое);
//    — все новые записи (books, collections, challenges, tags, covers)
//      пишутся ОДНОЙ readwrite-транзакцией;
//    — added* попадают в результат только после tx.oncomplete;
//    — при любой ошибке транзакция abort'ится → частичный импорт невозможен.
const MAX_IMPORT_ENTITY_COUNT = 5000;   // DoS-защита: записей на сущность
const MAX_IMPORT_STRING_LEN = 100000;   // DoS-защита: длина строкового поля

/**
 * Импорт в режиме СИНХРОНИЗАЦИИ (merge).
 * Добавляет только отсутствующие записи; существующие
 * (совпадающие по id / name) пропускает — данные НЕ затираются.
 * Обложки существующих книг не перезаписываются (P1-3).
 *
 * 🆕 P2-2 policy импорта settings (restore-merge, БЕЗ credentials P1-4):
 *   — из backup берутся ТОЛЬКО ключи из SAFE_SETTINGS_KEYS (sanitize);
 *   — каждый такой ключ ЗАМЕНЯЕТ локальное значение;
 *   — локальные ключи, которых нет в backup, сохраняются;
 *   — при отсутствии/пустом settings в backup — настройки не трогаются;
 *   — применяется в ТОЙ ЖЕ атомарной транзакции, что и остальной импорт.
 * Версия backup защищена: version !== 1 → отказ ДО записи.
 *
 * @param {object} data — результат exportAll()
 * @returns {Promise<object>} сводка { addedBooks, skippedBooks, ... }
 * @throws {Error} при невалидном формате/версии/типах/размере/дубликатах
 */
export async function importAll(data) {
  // ── 1. ВАЛИДАЦИЯ ВСЕГО JSON ДО ТРАНЗАКЦИИ ──
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Неверный формат бэкапа');
  if (!Array.isArray(data.books)) throw new Error('Неверный формат бэкапа');
  if (data.version !== undefined && data.version !== 1) throw new Error('Неизвестная версия бэкапа');

  const rawCols = data.collections === undefined ? [] : data.collections;
  const rawChallenges = data.challenges === undefined ? [] : data.challenges;
  const rawTags = data.tags === undefined ? [] : data.tags;
  const rawCovers = data.covers === undefined ? [] : data.covers;
  if (!Array.isArray(rawCols) || !Array.isArray(rawChallenges) || !Array.isArray(rawTags) || !Array.isArray(rawCovers)) {
    throw new Error('Неверный формат бэкапа');
  }
  if (data.books.length > MAX_IMPORT_ENTITY_COUNT || rawCols.length > MAX_IMPORT_ENTITY_COUNT ||
      rawChallenges.length > MAX_IMPORT_ENTITY_COUNT || rawTags.length > MAX_IMPORT_ENTITY_COUNT) {
    throw new Error('Бэкап слишком большой');
  }

  validateImportBooks(data.books);
  validateImportCollections(rawCols);
  validateImportChallenges(rawChallenges);
  validateImportTags(rawTags);

  // ── 2. MERGE: только отсутствующие записи ──
  const [existingBooks, existingCols, existingChallenges, existingTags, existingSettings] = await Promise.all([
    loadBooks(), loadCollections(), loadChallenges(), loadTags(),
    // 🆕 P2-2: текущие настройки для restore-merge (reject при сбое чтения — P1-5)
    loadSettings(),
  ]);
  const bookIds = new Set(existingBooks.map(b => b.id));
  const colIds = new Set(existingCols.map(c => c.id));
  const challengeIds = new Set(existingChallenges.map(c => c.id));
  const tagNames = new Set(existingTags.map(t => t.name));

  const newBooks = data.books.filter(b => !bookIds.has(b.id));
  const newCols = rawCols.filter(c => !colIds.has(c.id));
  const newChallenges = rawChallenges.filter(c => !challengeIds.has(c.id));
  const newTags = rawTags.filter(t => !tagNames.has(t.name));

  // 🆕 P2-2: только несекретные ключи backup (sanitizeSettingsForExport = allowlist P1-4).
  // `settings` — объект из backup (может отсутствовать в старых backup).
  const importedSettings = typeof data.settings === 'object' && data.settings !== null && !Array.isArray(data.settings)
    ? sanitizeSettingsForExport(data.settings)
    : {};
  // restore-merge: импортированные ключи заменяют локальные; локальные, которых
  // нет в backup, сохраняются.
  const mergedSettings = { ...(existingSettings || {}), ...importedSettings };
  const settingsChanged = Object.keys(importedSettings).length > 0
    && JSON.stringify(mergedSettings) !== JSON.stringify(existingSettings || {});

  // Ссылки: bookIds подборок/челленджей ограничиваем известными книгами
  // (существующие + новые из этого backup) — dangling references не создаются.
  const knownBookIds = new Set([...bookIds, ...newBooks.map(b => b.id)]);
  const sanitizeRefs = (arr) => (Array.isArray(arr) ? arr.filter(id => typeof id === 'string' && knownBookIds.has(id)) : []);
  for (const c of newCols) c.bookIds = sanitizeRefs(c.bookIds);
  for (const c of newChallenges) c.bookIds = sanitizeRefs(c.bookIds);

  // Подготавливаем записи ДО транзакции (makeValid обязателен для новых книг)
  const booksToPut = newBooks.map(b => makeValidBook(b));
  const colsToPut = newCols.map(c => ({ ...c }));
  const challengesToPut = newChallenges.map(c => ({ ...c }));
  const tagsToPut = newTags.map(t => ({ ...t }));

  const summary = {
    addedBooks: booksToPut.length, skippedBooks: data.books.length - booksToPut.length,
    addedCollections: colsToPut.length, skippedCollections: rawCols.length - colsToPut.length,
    addedChallenges: challengesToPut.length, skippedChallenges: rawChallenges.length - challengesToPut.length,
    addedTags: tagsToPut.length, skippedTags: rawTags.length - tagsToPut.length,
    // 🆕 P2-2: число ПРИМЕНЁННЫХ несекретных настроек из backup
    appliedSettings: settingsChanged ? Object.keys(importedSettings).length : 0,
  };

  // ── 3. ОДНА readwrite-ТРАНЗАКЦИЯ по всем stores ──
  const db = await openDB();
  const storeNames = ['books', 'covers', 'collections', 'challenges', 'tags', 'settings']
    .filter(name => db.objectStoreNames.contains(name));

  // obложки новых книг (P1-3): base64 → Blob, повреждённый base64 молча пропускаем
  const coversToPut = [];
  if (storeNames.includes('covers')) {
    const coversByBook = new Map();
    for (const c of rawCovers) {
      if (c && typeof c.bookId === 'string' && typeof c.base64 === 'string' && !coversByBook.has(c.bookId)) {
        coversByBook.set(c.bookId, c);
      }
    }
    for (const book of booksToPut) {
      const coverData = coversByBook.get(book.id);
      if (!coverData) continue;
      try {
        const blob = base64ToBlob(coverData.base64, coverData.mime || 'image/jpeg');
        if (isValidCoverBlob(blob)) coversToPut.push({ bookId: book.id, blob, savedAt: coverData.savedAt || Date.now() });
      } catch { /* повреждённый base64 — обложку пропускаем */ }
    }
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, 'readwrite');
    try {
      const putAll = (storeName, records) => {
        const store = tx.objectStore(storeName);
        for (const rec of records) store.put(rec);
      };
      putAll('books', booksToPut);
      putAll('collections', colsToPut);
      putAll('challenges', challengesToPut);
      putAll('tags', tagsToPut);
      putAll('covers', coversToPut);
      // 🆕 P2-2: настройки пишутся в ТУ ЖЕ атомарную транзакцию.
      if (settingsChanged && storeNames.includes('settings')) {
        tx.objectStore('settings').put({ id: 'app', value: mergedSettings });
      }
    } catch (e) {
      try { tx.abort(); } catch { /* */ }
      reject(e);
      return;
    }
    tx.oncomplete = () => resolve(summary); // added* только после успешного commit
    tx.onerror = () => { try { tx.abort(); } catch { /* */ } reject(tx.error || new Error('import failed')); };
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

/** Валидация книг: id/типы строковых полей/структурные типы/размер. */
function validateImportBooks(books) {
  const seen = new Set();
  for (const b of books) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Error('Неверный формат книги в бэкапе');
    if (typeof b.id !== 'string' || !b.id || b.id.length > MAX_IMPORT_STRING_LEN) throw new Error('Неверный id книги');
    if (seen.has(b.id)) throw new Error('Дубликат id книги в бэкапе');
    seen.add(b.id);
    requireStrings(b, ['title', 'author', 'description', 'genre', 'publisher', 'isbn', 'series', 'notes']);
    requireArrays(b, ['contentItems', 'tags', 'tropes', 'formats', 'characters']);
    requireNumbers(b, ['rating', 'currentPage', 'pageCount', 'pepperRating', 'tearRating', 'intrigueRating', 'horrorRating']);
    if (b.isPR !== undefined && typeof b.isPR !== 'boolean') throw new Error('Неверный тип isPR');
    if (b.price !== undefined) {
      if (!b.price || typeof b.price !== 'object' || Array.isArray(b.price)) throw new Error('Неверный тип price');
      if (b.price.amount !== undefined && typeof b.price.amount !== 'number') throw new Error('Неверный тип price.amount');
      if (b.price.currency !== undefined && typeof b.price.currency !== 'string') throw new Error('Неверный тип price.currency');
    }
    if (b.review !== undefined && !isPlainObject(b.review)) throw new Error('Неверный тип review');
    if (b.jointReading !== undefined && !isPlainObject(b.jointReading)) throw new Error('Неверный тип jointReading');
    if (b.shelfMark !== undefined && !isPlainObject(b.shelfMark)) throw new Error('Неверный тип shelfMark');
  }
}

/** Валидация подборок: id/name/массив bookIds. */
function validateImportCollections(cols) {
  const seen = new Set();
  for (const c of cols) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error('Неверный формат подборки в бэкапе');
    if (typeof c.id !== 'string' || !c.id || c.id.length > MAX_IMPORT_STRING_LEN) throw new Error('Неверный id подборки');
    if (seen.has(c.id)) throw new Error('Дубликат id подборки в бэкапе');
    seen.add(c.id);
    if (c.name !== undefined && (typeof c.name !== 'string' || c.name.length > MAX_IMPORT_STRING_LEN)) throw new Error('Неверный тип name подборки');
    validateBookIdRefs(c.bookIds, 'подборки');
  }
}

/** Валидация челленджей: id/name/массив bookIds. */
function validateImportChallenges(chs) {
  const seen = new Set();
  for (const c of chs) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error('Неверный формат челленджа в бэкапе');
    if (typeof c.id !== 'string' || !c.id || c.id.length > MAX_IMPORT_STRING_LEN) throw new Error('Неверный id челленджа');
    if (seen.has(c.id)) throw new Error('Дубликат id челленджа в бэкапе');
    seen.add(c.id);
    if (c.name !== undefined && (typeof c.name !== 'string' || c.name.length > MAX_IMPORT_STRING_LEN)) throw new Error('Неверный тип name челленджа');
    validateBookIdRefs(c.bookIds, 'челленджа');
  }
}

/** Валидация тегов: уникальность и тип name. */
function validateImportTags(tags) {
  const seen = new Set();
  for (const t of tags) {
    if (!t || typeof t !== 'object' || Array.isArray(t)) throw new Error('Неверный формат тега в бэкапе');
    if (typeof t.name !== 'string' || !t.name || t.name.length > MAX_IMPORT_STRING_LEN) throw new Error('Неверный name тега');
    if (seen.has(t.name)) throw new Error('Дубликат тега в бэкапе');
    seen.add(t.name);
  }
}

function validateBookIdRefs(bookIds, what) {
  if (bookIds === undefined) return;
  if (!Array.isArray(bookIds)) throw new Error(`Неверный тип bookIds ${what}`);
  // сами элементы могут содержать мусор из легаси-backup —
  // «битые» ссылки отфильтровывает sanitizeRefs() при импорте (нет dangling refs)
}

function requireStrings(obj, keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && (typeof obj[k] !== 'string' || obj[k].length > MAX_IMPORT_STRING_LEN)) {
      throw new Error(`Неверный тип поля ${k}`);
    }
  }
}

function requireArrays(obj, keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && !Array.isArray(obj[k])) throw new Error(`Неверный тип поля ${k}`);
  }
}

function requireNumbers(obj, keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && typeof obj[k] !== 'number') throw new Error(`Неверный тип поля ${k}`);
  }
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Клонирует книгу и прогоняет ensureBookFields (дефолты + санитизация URL). */
function makeValidBook(b) {
  const clone = JSON.parse(JSON.stringify(b));
  return ensureBookFields(clone);
}

// ═══════════════════════════════════════════════
//  14. РАЗМЕР БАЗЫ
// ═══════════════════════════════════════════════
export async function getDBSize() {
  try {
    if (!navigator.storage?.estimate) return 'недоступно';
    const { usage } = await navigator.storage.estimate();
    if (usage < 1024) return usage + ' Б';
    if (usage < 1024 * 1024) return (usage / 1024).toFixed(1) + ' КБ';
    return (usage / (1024 * 1024)).toFixed(1) + ' МБ';
  } catch { return 'недоступно'; }
}

// ═══════════════════════════════════════════════
//  15. СЛУЖЕБНОЕ
// ═══════════════════════════════════════════════
export function ensureBookFields(book) {
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
  if (book.shelfMark === undefined) {
    book.shelfMark = { color: '', text: '' };
  }
  // 🆕 P1-2: валидация URL ДО сохранения/после чтения.
  // coverUrl — изображение (blob: допустим для локальных обложек),
  // cover — изображение, chatLink/publishedUrl — внешние ссылки.
  if (typeof book.cover === 'string') book.cover = safeUrl(book.cover);
  if (typeof book.coverUrl === 'string') book.coverUrl = safeUrl(book.coverUrl);
  if (book.jointReading && typeof book.jointReading.chatLink === 'string') {
    book.jointReading.chatLink = safeLinkUrl(book.jointReading.chatLink);
  }
  if (Array.isArray(book.contentItems)) {
    for (const item of book.contentItems) {
      if (item && typeof item.publishedUrl === 'string') {
        item.publishedUrl = safeLinkUrl(item.publishedUrl);
      }
    }
  }
  return book;
}

export function ensureContentItemFields(item) {
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
  // 🆕 P1-2: внешняя ссылка публикации — только http/https
  if (typeof item.publishedUrl === 'string') item.publishedUrl = safeLinkUrl(item.publishedUrl);
  return item;
}