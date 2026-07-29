// ─────────────────────────────────────────────
// 📦 BookTrackerPro — db.js
// 🔖 v3.4.2 | 2026-07-30
// 📝 IndexedDB: книги, обложки, настройки,
//    подборки, челленджи, теги, превью ссылок
//    Версия БД: 5
//    Stores: books, covers, settings,
//            collections, challenges, tags,
//            previews (новое в v5 — кеш Microlink)
//
//    Новое в 3.4.0:
//      — Store 'previews' для кеша превью Microlink
//      — Поле order у подборок (изменение порядка)
//      — moveCollection() — перестановка ↑/↓
//      — loadCollections() сортирует по order
// ─────────────────────────────────────────────

const DB_NAME = 'book-tracker-pro';
const DB_VER = 5;
let _db = null;

// ═══════════════════════════════════════════════
//  СТАТУСЫ КНИГ (7 штук)
// ═══════════════════════════════════════════════

export const BOOK_STATUSES = {
  wishlist: { icon: '🌟', label: 'Wishlist',      order: 0 },
  added:    { icon: '📦', label: 'Добавлено',     order: 1 },
  reading:  { icon: '📖', label: 'Читаю',         order: 2 },
  paused:   { icon: '⏸️', label: 'Пауза',         order: 3 },
  finished: { icon: '✅', label: 'Прочитано',     order: 4 },
  dropped:  { icon: '❌', label: 'Брошено',       order: 5 },
};

// Валюты
export const CURRENCIES = {
  RUB: { symbol: '₽', name: 'Рубли' },
  USD: { symbol: '$', name: 'Доллары' },
  EUR: { symbol: '€', name: 'Евро' },
  KZT: { symbol: '₸', name: 'Тенге' },
  UAH: { symbol: '₴', name: 'Гривны' },
  GBP: { symbol: '£', name: 'Фунты' },
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

      // v0 → v1: books + settings
      if (oldVer < 1) {
        const books = db.createObjectStore('books', { keyPath: 'id' });
        books.createIndex('status', 'status', { unique: false });
        books.createIndex('updatedAt', 'updatedAt', { unique: false });
        books.createIndex('dateAdded', 'dateAdded', { unique: false });
        books.createIndex('titleAuthor', ['title', 'author'], { unique: false });
        db.createObjectStore('settings', { keyPath: 'id' });
      }

      // v1 → v2: covers (Blob)
      if (oldVer < 2) {
        if (!db.objectStoreNames.contains('covers')) {
          db.createObjectStore('covers', { keyPath: 'bookId' });
        }
      }

      // v2 → v3: блогерские индексы
      if (oldVer < 3) {
        const books = tx.objectStore('books');
        if (!books.indexNames.contains('isPR')) books.createIndex('isPR', 'isPR', { unique: false });
        if (!books.indexNames.contains('blogStatus')) books.createIndex('blogStatus', 'blogStatus', { unique: false });
        if (!books.indexNames.contains('genre')) books.createIndex('genre', 'genre', { unique: false });
      }

      // v3 → v4: подборки, челленджи, теги + индексы серий
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

      // v4 → v5: кеш превью Microlink
      if (oldVer < 5) {
        if (!db.objectStoreNames.contains('previews')) {
          const previews = db.createObjectStore('previews', { keyPath: 'id' });
          previews.createIndex('cachedAt', 'cachedAt', { unique: false });
        }
      }
    };

    request.onsuccess = () => {
      _db = request.result;
      _db.onclose = () => { _db = null; };
      _db.onversionchange = () => {
        _db.close();
        _db = null;
        window.location.reload();
      };
      resolve(_db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => console.warn('[DB] Blocked — закройте другие вкладки');
  });
}

// ═══════════════════════════════════════════════
//  2. КНИГИ — CRUD
// ═══════════════════════════════════════════════

export async function loadBooks() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readonly');
    const req = tx.objectStore('books').getAll();
    req.onsuccess = async () => {
      const books = req.result || [];
      for (const book of books) {
        // Обложка
        try {
          const blob = await getCover(book.id);
          if (blob) book.coverUrl = URL.createObjectURL(blob);
          else if (book.cover?.startsWith('http')) book.coverUrl = book.cover;
        } catch {
          if (book.cover?.startsWith('http')) book.coverUrl = book.cover;
        }
        ensureBookFields(book);
      }
      resolve(books);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function putBook(book) {
  const db = await openDB();
  ensureBookFields(book);
  book.updatedAt = new Date().toISOString();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readwrite');
    tx.objectStore('books').put(book);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function delBook(id) {
  const db = await openDB();
  // Убираем из всех подборок и челленджей
  await removeFromAllCollections(id);
  await removeFromAllChallenges(id);
  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readwrite');
    tx.objectStore('books').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getBook(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readonly');
    const req = tx.objectStore('books').get(id);
    req.onsuccess = () => {
      const book = req.result;
      if (book) ensureBookFields(book);
      resolve(book);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function putBooks(books) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readwrite');
    const store = tx.objectStore('books');
    for (const book of books) {
      ensureBookFields(book);
      store.put(book);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Обновление статуса книги с автоматическими датами.
 * Возвращает { confetti, askRating } для UI.
 */
export async function changeBookStatus(bookId, newStatus) {
  const book = await getBook(bookId);
  if (!book) return null;

  const today = new Date().toISOString().slice(0, 10);
  let confetti = false;
  let askRating = false;

  // Читаю → ставим dateStarted только один раз
  if (newStatus === 'reading' && !book.dateStarted) {
    book.dateStarted = today;
  }

  // Прочитано / Брошено → dateFinished + конфетти + оценка
  if ((newStatus === 'finished' || newStatus === 'dropped') && book.status !== newStatus) {
    book.dateFinished = today;
    confetti = true;
    askRating = true;
    // Считаем дни чтения
    if (book.dateStarted) {
      const start = new Date(book.dateStarted);
      const end = new Date(today);
      book.readingDays = Math.max(1, Math.round((end - start) / 86400000));
    }
  }

  book.status = newStatus;
  await putBook(book);
  return { book, confetti, askRating };
}

// ═══════════════════════════════════════════════
//  3. ОБЛОЖКИ (Blob)
// ═══════════════════════════════════════════════

export async function saveCover(bookId, blob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('covers', 'readwrite');
    tx.objectStore('covers').put({ bookId, blob, savedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
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
    const tx = db.transaction('covers', 'readonly');
    const req = tx.objectStore('covers').get(bookId);
    req.onsuccess = () => resolve(req.result?.blob || null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteCover(bookId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('covers', 'readwrite');
    tx.objectStore('covers').delete(bookId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ═══════════════════════════════════════════════
//  4. НАСТРОЙКИ
// ═══════════════════════════════════════════════

export async function loadSettings() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readonly');
    const req = tx.objectStore('settings').get('app');
    req.onsuccess = () => resolve(req.result?.data || null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveSettings(settings) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readwrite');
    tx.objectStore('settings').put({ id: 'app', data: settings, savedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ═══════════════════════════════════════════════
//  5. ПОДБОРКИ (collections)
// ═══════════════════════════════════════════════

/**
 * Загрузить все подборки, отсортированные по order.
 * При первом запуске создаёт предсозданные:
 *   ❤️ Любимые, 💩 Книги-какахи
 * Миграция v5: добавляет поле order старым записям.
 */
export async function loadCollections() {
  const db = await openDB();
  let collections = await new Promise((resolve, reject) => {
    const tx = db.transaction('collections', 'readonly');
    const req = tx.objectStore('collections').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });

  // Предсозданные подборки
  const presets = [
    { id: 'fav', name: 'Любимые',      emoji: '❤️', isSystem: true },
    { id: 'bad', name: 'Книги-какахи', emoji: '💩', isSystem: true },
  ];
  let changed = false;
  for (const preset of presets) {
    if (!collections.find(c => c.id === preset.id)) {
      collections.push({
        ...preset,
        bookIds: [],
        description: '',
        createdAt: new Date().toISOString(),
      });
      changed = true;
    }
  }

  // Миграция v5: гарантируем поле order у всех подборок
  if (collections.some(c => typeof c.order !== 'number')) {
    // Базовый порядок: системные первыми, далее по дате создания
    collections.sort((a, b) => {
      if (a.isSystem && !b.isSystem) return -1;
      if (!a.isSystem && b.isSystem) return 1;
      return (a.createdAt || '').localeCompare(b.createdAt || '');
    });
    collections.forEach((c, i) => { c.order = i; });
    changed = true;
  }

  if (changed) {
    for (const c of collections) await putCollection(c);
  }

  // Сортировка по order
  collections.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return collections;
}

export async function putCollection(collection) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('collections', 'readwrite');
    tx.objectStore('collections').put(collection);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function delCollection(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('collections', 'readwrite');
    tx.objectStore('collections').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Переместить подборку вверх/вниз в списке (новое в v3.4.2).
 * Меняет order местами с соседней подборкой.
 * @param {string} id
 * @param {'up'|'down'} direction
 * @returns {Promise<boolean>} — удалось ли переместить
 */
export async function moveCollection(id, direction) {
  const collections = await loadCollections(); // уже отсортированы по order
  const idx = collections.findIndex(c => c.id === id);
  if (idx < 0) return false;

  const j = direction === 'up' ? idx - 1 : idx + 1;
  if (j < 0 || j >= collections.length) return false;

  const a = collections[idx];
  const b = collections[j];

  // Нормализация при дубликатах order (на всякий случай)
  if (a.order === b.order) {
    collections.forEach((c, i) => { c.order = i; });
    for (const c of collections) await putCollection(c);
  }

  const tmp = a.order;
  a.order = b.order;
  b.order = tmp;
  await putCollection(a);
  await putCollection(b);
  return true;
}

/**
 * Следующий order для новой подборки (максимум + 1).
 */
export async function getNextCollectionOrder() {
  const collections = await loadCollections();
  if (collections.length === 0) return 0;
  return Math.max(...collections.map(c => c.order ?? 0)) + 1;
}

/**
 * Добавить книгу в подборку.
 */
export async function addBookToCollection(collectionId, bookId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('collections', 'readwrite');
    const store = tx.objectStore('collections');
    const req = store.get(collectionId);
    req.onsuccess = () => {
      const col = req.result;
      if (!col) { reject(new Error('Collection not found')); return; }
      if (!col.bookIds.includes(bookId)) col.bookIds.push(bookId);
      store.put(col);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Убрать книгу из подборки.
 */
export async function removeBookFromCollection(collectionId, bookId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('collections', 'readwrite');
    const store = tx.objectStore('collections');
    const req = store.get(collectionId);
    req.onsuccess = () => {
      const col = req.result;
      if (!col) { reject(new Error('Collection not found')); return; }
      col.bookIds = col.bookIds.filter(id => id !== bookId);
      store.put(col);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Убрать книгу из всех подборок (при удалении книги).
 */
async function removeFromAllCollections(bookId) {
  const collections = await loadCollections();
  for (const col of collections) {
    if (col.bookIds.includes(bookId)) {
      await removeBookFromCollection(col.id, bookId);
    }
  }
}

// ═══════════════════════════════════════════════
//  6. ЧЕЛЛЕНДЖИ (challenges)
// ═══════════════════════════════════════════════

export async function loadChallenges() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('challenges', 'readonly');
    const req = tx.objectStore('challenges').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function putChallenge(challenge) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('challenges', 'readwrite');
    tx.objectStore('challenges').put(challenge);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function delChallenge(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('challenges', 'readwrite');
    tx.objectStore('challenges').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
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
      if (!ch) { reject(new Error('Challenge not found')); return; }
      if (!ch.bookIds.includes(bookId)) ch.bookIds.push(bookId);
      store.put(ch);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
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
      if (!ch) { reject(new Error('Challenge not found')); return; }
      ch.bookIds = ch.bookIds.filter(id => id !== bookId);
      store.put(ch);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function removeFromAllChallenges(bookId) {
  const challenges = await loadChallenges();
  for (const ch of challenges) {
    if (ch.bookIds.includes(bookId)) {
      await removeBookFromChallenge(ch.id, bookId);
    }
  }
}

// ═══════════════════════════════════════════════
//  7. ТЕГИ (tags)
// ═══════════════════════════════════════════════

export async function loadTags() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('tags', 'readonly');
    const req = tx.objectStore('tags').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function putTag(tag) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('tags', 'readwrite');
    tx.objectStore('tags').put(tag);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function delTag(name) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('tags', 'readwrite');
    tx.objectStore('tags').delete(name);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ═══════════════════════════════════════════════
//  8. КОНТЕНТ (вложенные операции)
// ═══════════════════════════════════════════════

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

export async function removeContentFromBook(bookId, contentId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readwrite');
    const store = tx.objectStore('books');
    const req = store.get(bookId);
    req.onsuccess = () => {
      const book = req.result;
      if (!book) { reject(new Error('Book not found')); return; }
      book.contentItems = (book.contentItems || []).filter(c => c.id !== contentId);
      book.updatedAt = new Date().toISOString();
      store.put(book);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ═══════════════════════════════════════════════
//  9. ОТЗЫВЫ (вложенные операции)
// ═══════════════════════════════════════════════

export async function saveReviewForBook(bookId, review) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readwrite');
    const store = tx.objectStore('books');
    const req = store.get(bookId);
    req.onsuccess = () => {
      const book = req.result;
      if (!book) { reject(new Error('Book not found')); return; }
      book.review = { ...review, updatedAt: new Date().toISOString() };
      book.updatedAt = new Date().toISOString();
      store.put(book);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
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
//  10. ЭКСПОРТ / ИМПОРТ
// ═══════════════════════════════════════════════

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

  const collections = await loadCollections();
  const challenges = await loadChallenges();
  const tags = await loadTags();
  const settings = await loadSettings();

  const coversB64 = [];
  for (const c of covers) {
    if (c.blob) {
      const b64 = await blobToBase64(c.blob);
      coversB64.push({ bookId: c.bookId, data: b64, savedAt: c.savedAt });
    }
  }

  // Превью Microlink не экспортируем — это кеш, он пересоздастся сам
  return {
    version: DB_VER,
    exportDate: new Date().toISOString(),
    books, covers: coversB64, collections, challenges, tags, settings
  };
}

export async function importAll(data) {
  if (data.books) await putBooks(data.books);
  if (data.covers) {
    for (const c of data.covers) {
      if (c.data) {
        const blob = base64ToBlob(c.data);
        if (blob) await saveCover(c.bookId, blob);
      }
    }
  }
  if (data.collections) for (const c of data.collections) await putCollection(c);
  if (data.challenges) for (const c of data.challenges) await putChallenge(c);
  if (data.tags) for (const t of data.tags) await putTag(t);
  if (data.settings) await saveSettings(data.settings);
}

// ═══════════════════════════════════════════════
//  11. СЛУЖЕБНОЕ
// ═══════════════════════════════════════════════

/**
 * Гарантирует наличие всех полей книги (v3.4.2).
 * Мигрирует старые записи.
 */
function ensureBookFields(book) {
  // Базовые
  if (!book.contentItems) book.contentItems = [];
  if (!book.review) book.review = {};
  if (!book.readingForContent) book.readingForContent = {};
  if (!book.contentTags) book.contentTags = [];
  if (!book.tags) book.tags = [];
  if (book.isPR === undefined) book.isPR = false;
  if (!book.receivedFrom) book.receivedFrom = '';
  if (!book.receivedDate) book.receivedDate = '';
  if (!book.blogStatus) book.blogStatus = 'none';
  if (!book.series) book.series = '';
  if (book.seriesNumber === undefined) book.seriesNumber = null;
  if (book.seriesTotal === undefined) book.seriesTotal = null;
  if (!book.ageRating) book.ageRating = '';
  if (!book.source) book.source = 'manual';

  // Цена
  if (!book.price) book.price = { amount: 0, currency: 'RUB' };

  // Совместное чтение
  if (!book.jointReading) {
    book.jointReading = { active: false, participants: [], chatLink: '', startDate: '', notes: '' };
  }

  // Даты чтения
  if (!book.dateStarted) book.dateStarted = '';
  if (!book.dateFinished) book.dateFinished = '';
  if (book.readingDays === undefined) book.readingDays = null;

  // Миграция старого статуса tbr → wishlist
  if (book.status === 'tbr') book.status = 'wishlist';
  if (!book.status) book.status = 'wishlist';

  // Миграция contentTags → tags
  if (book.contentTags.length > 0 && book.tags.length === 0) {
    book.tags = [...book.contentTags];
  }
}

function blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(dataUrl) {
  try {
    const [header, data] = dataUrl.split(',');
    const mime = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  } catch { return null; }
}

export async function getDBSize() {
  if (!navigator.storage?.estimate) return 'N/A';
  const est = await navigator.storage.estimate();
  return `${((est.usage || 0) / (1024 * 1024)).toFixed(1)} МБ`;
}