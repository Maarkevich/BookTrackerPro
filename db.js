// ─────────────────────────────────────────────
// 📦 BookTrackerPro — db.js
// 🔖 v3.2.0 | 2026-07-24
// 📝 IndexedDB: книги, обложки (Blob), настройки
//    Версия БД: 3
//    Stores: books, covers, settings
// ─────────────────────────────────────────────

const DB_NAME = 'book-tracker-pro';
const DB_VER = 3;

let _db = null;

// ═══════════════════════════════════════════════
//  1. ОТКРЫТИЕ / МИГРАЦИЯ
// ═══════════════════════════════════════════════

/**
 * Открывает (или создаёт) базу данных.
 * Вызывается один раз при старте приложения.
 * @returns {Promise<IDBDatabase>}
 */
export function openDB() {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VER);

    // ─── Миграция схемы ───
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction;
      const oldVer = event.oldVersion;

      // v0 → v1: создаём books
      if (oldVer < 1) {
        const books = db.createObjectStore('books', { keyPath: 'id' });
        books.createIndex('status', 'status', { unique: false });
        books.createIndex('updatedAt', 'updatedAt', { unique: false });
        books.createIndex('dateAdded', 'dateAdded', { unique: false });
        books.createIndex('titleAuthor', ['title', 'author'], { unique: false });

        db.createObjectStore('settings', { keyPath: 'id' });
      }

      // v1 → v2: добавляем covers (Blob вместо base64)
      if (oldVer < 2) {
        if (!db.objectStoreNames.contains('covers')) {
          db.createObjectStore('covers', { keyPath: 'bookId' });
        }
      }

      // v2 → v3: добавляем индексы для блогерских полей
      if (oldVer < 3) {
        const books = tx.objectStore('books');

        if (!books.indexNames.contains('isPR')) {
          books.createIndex('isPR', 'isPR', { unique: false });
        }
        if (!books.indexNames.contains('blogStatus')) {
          books.createIndex('blogStatus', 'blogStatus', { unique: false });
        }
        if (!books.indexNames.contains('genre')) {
          books.createIndex('genre', 'genre', { unique: false });
        }
      }
    };

    request.onsuccess = () => {
      _db = request.result;

      // Обработка закрытия извне (например, обновление браузера)
      _db.onclose = () => { _db = null; };
      _db.onversionchange = () => {
        _db.close();
        _db = null;
        // Перезагружаем страницу при обновлении схемы
        window.location.reload();
      };

      resolve(_db);
    };

    request.onerror = () => {
      console.error('[DB] Open error:', request.error);
      reject(request.error);
    };

    request.onblocked = () => {
      console.warn('[DB] Blocked — закройте другие вкладки');
    };
  });
}

// ═══════════════════════════════════════════════
//  2. КНИГИ — CRUD
// ═══════════════════════════════════════════════

/**
 * Загрузить все книги.
 * Обложки подгружаются отдельно через getCover().
 * @returns {Promise<object[]>}
 */
export async function loadBooks() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readonly');
    const store = tx.objectStore('books');
    const req = store.getAll();

    req.onsuccess = async () => {
      const books = req.result || [];

      // Подгружаем обложки (Blob → ObjectURL)
      for (const book of books) {
        try {
          const blob = await getCover(book.id);
          if (blob) {
            book.coverUrl = URL.createObjectURL(blob);
          } else if (book.cover && book.cover.startsWith('http')) {
            book.coverUrl = book.cover;
          }
        } catch {
          // Обложка недоступна — используем URL или заглушку
          if (book.cover && book.cover.startsWith('http')) {
            book.coverUrl = book.cover;
          }
        }

        // Гарантируем наличие блогерских полей (миграция данных)
        ensureBlogFields(book);
      }

      resolve(books);
    };

    req.onerror = () => reject(req.error);
  });
}

/**
 * Сохранить (создать или обновить) книгу.
 * @param {object} book
 * @returns {Promise<void>}
 */
export async function putBook(book) {
  const db = await openDB();
  ensureBlogFields(book);
  book.updatedAt = new Date().toISOString();

  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readwrite');
    const store = tx.objectStore('books');
    const req = store.put(book);

    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Удалить книгу по ID.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function delBook(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readwrite');
    tx.objectStore('books').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Получить одну книгу по ID.
 * @param {string} id
 * @returns {Promise<object|undefined>}
 */
export async function getBook(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readonly');
    const req = tx.objectStore('books').get(id);
    req.onsuccess = () => {
      const book = req.result;
      if (book) ensureBlogFields(book);
      resolve(book);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Поиск книг по индексу.
 * @param {string} indexName — 'status' | 'genre' | 'isPR' | 'blogStatus'
 * @param {*} value
 * @returns {Promise<object[]>}
 */
export async function getBooksByIndex(indexName, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readonly');
    const index = tx.objectStore('books').index(indexName);
    const req = index.getAll(value);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Массовое сохранение (импорт).
 * @param {object[]} books
 * @returns {Promise<void>}
 */
export async function putBooks(books) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readwrite');
    const store = tx.objectStore('books');

    for (const book of books) {
      ensureBlogFields(book);
      store.put(book);
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Количество книг.
 * @returns {Promise<number>}
 */
export async function countBooks() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readonly');
    const req = tx.objectStore('books').count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ═══════════════════════════════════════════════
//  3. ОБЛОЖКИ — Blob-хранилище
// ═══════════════════════════════════════════════
//  Обложки храним как Blob в отдельном store,
//  а не base64 в записи книги. Это экономит
//  память и ускоряет чтение при 50+ книгах.
// ═══════════════════════════════════════════════

/**
 * Сохранить обложку как Blob.
 * @param {string} bookId
 * @param {Blob} blob
 * @returns {Promise<void>}
 */
export async function saveCover(bookId, blob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('covers', 'readwrite');
    tx.objectStore('covers').put({
      bookId,
      blob,
      savedAt: Date.now()
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Сохранить обложку из URL (загружает и конвертирует в Blob).
 * @param {string} bookId
 * @param {string} url
 * @returns {Promise<boolean>} — true если удалось
 */
export async function saveCoverFromUrl(bookId, url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return false;
    const blob = await response.blob();
    if (blob.size < 100) return false; // слишком маленькая = заглушка
    await saveCover(bookId, blob);
    return true;
  } catch {
    return false;
  }
}

/**
 * Получить обложку как Blob.
 * @param {string} bookId
 * @returns {Promise<Blob|null>}
 */
export async function getCover(bookId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('covers', 'readonly');
    const req = tx.objectStore('covers').get(bookId);
    req.onsuccess = () => resolve(req.result?.blob || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Удалить обложку.
 * @param {string} bookId
 * @returns {Promise<void>}
 */
export async function deleteCover(bookId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('covers', 'readwrite');
    tx.objectStore('covers').delete(bookId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Получить ObjectURL для обложки (для отображения в <img>).
 * Вызывающий код должен вызвать URL.revokeObjectURL() когда не нужно.
 * @param {string} bookId
 * @returns {Promise<string|null>}
 */
export async function getCoverUrl(bookId) {
  const blob = await getCover(bookId);
  return blob ? URL.createObjectURL(blob) : null;
}

// ═══════════════════════════════════════════════
//  4. НАСТРОЙКИ
// ═══════════════════════════════════════════════

/**
 * Загрузить настройки.
 * @returns {Promise<object|null>}
 */
export async function loadSettings() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readonly');
    const req = tx.objectStore('settings').get('app');
    req.onsuccess = () => resolve(req.result?.data || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Сохранить настройки.
 * @param {object} settings
 * @returns {Promise<void>}
 */
export async function saveSettings(settings) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readwrite');
    tx.objectStore('settings').put({
      id: 'app',
      data: settings,
      savedAt: Date.now()
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ═══════════════════════════════════════════════
//  5. КОНТЕНТ (вложенные операции)
// ═══════════════════════════════════════════════
//  Контент хранится внутри записи книги
//  (массив contentItems), но операции
//  вынесены сюда для удобства.
// ═══════════════════════════════════════════════

/**
 * Добавить контент-элемент к книге.
 * @param {string} bookId
 * @param {object} contentItem
 * @returns {Promise<void>}
 */
export async function addContentToBook(bookId, contentItem) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readwrite');
    const store = tx.objectStore('books');
    const req = store.get(bookId);

    req.onsuccess = () => {
      const book = req.result;
      if (!book) { reject(new Error('Book not found')); return; }

      if (!book.contentItems) book.contentItems = [];
      book.contentItems.push(contentItem);
      book.updatedAt = new Date().toISOString();
      store.put(book);
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Обновить контент-элемент.
 * @param {string} bookId
 * @param {string} contentId
 * @param {object} updates — поля для обновления
 * @returns {Promise<void>}
 */
export async function updateContentInBook(bookId, contentId, updates) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readwrite');
    const store = tx.objectStore('books');
    const req = store.get(bookId);

    req.onsuccess = () => {
      const book = req.result;
      if (!book) { reject(new Error('Book not found')); return; }

      const idx = (book.contentItems || []).findIndex(c => c.id === contentId);
      if (idx >= 0) {
        Object.assign(book.contentItems[idx], updates);
        book.updatedAt = new Date().toISOString();
        store.put(book);
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Удалить контент-элемент.
 * @param {string} bookId
 * @param {string} contentId
 * @returns {Promise<void>}
 */
export async function removeContentFromBook(bookId, contentId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readwrite');
    const store = tx.objectStore('books');
    const req = store.get(bookId);

    req.onsuccess = () => {
      const book = req.result;
      if (!book) { reject(new Error('Book not found')); return; }

      book.contentItems = (book.contentItems || [])
        .filter(c => c.id !== contentId);
      book.updatedAt = new Date().toISOString();
      store.put(book);
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ═══════════════════════════════════════════════
//  6. ОТЗЫВЫ (вложенные операции)
// ═══════════════════════════════════════════════

/**
 * Сохранить отзыв для книги.
 * @param {string} bookId
 * @param {object} review
 * @returns {Promise<void>}
 */
export async function saveReviewForBook(bookId, review) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readwrite');
    const store = tx.objectStore('books');
    const req = store.get(bookId);

    req.onsuccess = () => {
      const book = req.result;
      if (!book) { reject(new Error('Book not found')); return; }

      book.review = {
        ...review,
        updatedAt: new Date().toISOString()
      };
      book.updatedAt = new Date().toISOString();
      store.put(book);
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Удалить отзыв.
 * @param {string} bookId
 * @returns {Promise<void>}
 */
export async function removeReviewFromBook(bookId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readwrite');
    const store = tx.objectStore('books');
    const req = store.get(bookId);

    req.onsuccess = () => {
      const book = req.result;
      if (!book) { reject(new Error('Book not found')); return; }

      book.review = {};
      book.updatedAt = new Date().toISOString();
      store.put(book);
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ═══════════════════════════════════════════════
//  7. ЭКСПОРТ / ИМПОРТ
// ═══════════════════════════════════════════════

/**
 * Экспорт всех данных в JSON-совместимый объект.
 * Обложки (Blob) конвертируются в base64 для переносимости.
 * @returns {Promise<object>}
 */
export async function exportAll() {
  const db = await openDB();

  const books = await new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readonly');
    const req = tx.objectStore('books').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });

  const covers = await new Promise((resolve, reject) => {
    const tx = db.transaction('covers', 'readonly');
    const req = tx.objectStore('covers').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });

  const settings = await loadSettings();

  // Конвертируем Blob → base64 для экспорта
  const coversB64 = [];
  for (const c of covers) {
    if (c.blob) {
      const b64 = await blobToBase64(c.blob);
      coversB64.push({ bookId: c.bookId, data: b64, savedAt: c.savedAt });
    }
  }

  return {
    version: DB_VER,
    exportDate: new Date().toISOString(),
    books,
    covers: coversB64,
    settings
  };
}

/**
 * Импорт данных из JSON.
 * @param {object} data — результат exportAll()
 * @returns {Promise<void>}
 */
export async function importAll(data) {
  const db = await openDB();

  // Книги
  if (data.books) {
    await putBooks(data.books);
  }

  // Обложки (base64 → Blob)
  if (data.covers) {
    for (const c of data.covers) {
      if (c.data) {
        const blob = base64ToBlob(c.data);
        if (blob) await saveCover(c.bookId, blob);
      }
    }
  }

  // Настройки
  if (data.settings) {
    await saveSettings(data.settings);
  }
}

// ═══════════════════════════════════════════════
//  8. СЛУЖЕБНЫЕ ФУНКЦИИ
// ═══════════════════════════════════════════════

/**
 * Гарантирует наличие всех блогерских полей.
 * Вызывается при загрузке для миграции старых записей.
 */
function ensureBlogFields(book) {
  if (!book.contentItems) book.contentItems = [];
  if (!book.review) book.review = {};
  if (!book.readingForContent) book.readingForContent = {};
  if (!book.contentTags) book.contentTags = [];
  if (book.isPR === undefined) book.isPR = false;
  if (!book.receivedFrom) book.receivedFrom = '';
  if (!book.receivedDate) book.receivedDate = '';
  if (!book.blogStatus) book.blogStatus = 'none';
  if (!book.series) book.series = '';
  if (!book.ageRating) book.ageRating = '';
  if (!book.source) book.source = 'manual';
}

/**
 * Blob → base64 string (для экспорта).
 */
function blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

/**
 * base64 string → Blob (для импорта).
 */
function base64ToBlob(dataUrl) {
  try {
    const [header, data] = dataUrl.split(',');
    const mime = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
  } catch {
    return null;
  }
}

/**
 * Получить размер базы данных (примерно).
 * @returns {Promise<string>} — человекочитаемый размер
 */
export async function getDBSize() {
  if (!navigator.storage?.estimate) return 'N/A';
  const est = await navigator.storage.estimate();
  const mb = (est.usage || 0) / (1024 * 1024);
  return `${mb.toFixed(1)} МБ`;
}