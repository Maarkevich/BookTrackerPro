// ═══════════════════════════════════════════════════════════════════
// Регрессионные тесты P2-4 — «Blocked IDB upgrade = endless skeleton».
//
// Оригинальная проблема (до фикса):
//   — openDB().request.onblocked делал только console.warn и НЕ завершал
//     Promise → init() навсегда ждал, #skeleton оставался, UI выглядел
//     зависшим; пользователю не говорилось закрыть другую вкладку.
//
// Что доказывают тесты (реальная симуляция через fake-indexeddb):
//   — удерживается открытое соединение старой версии («другая вкладка»:
//     то же приложение, открытое в другой вкладке на версии 1 — БД
//     создаётся с реальной схемой книги v1, как её создала бы db.js;
//     вкладка НЕ закрывается на versionchange — реалистичный «залипший» таб);
//   — затем openDB() требует upgrade 1→6 → fake-indexeddb генерирует
//     событие blocked на запросе upgrade;
//   — при blocked openDB() ОТКЛОНЯЕТСЯ с DBBlockedError (Promise завершается,
//     а не висит — skeleton не остаётся);
//   — reject не оставляет «протухший» _db: после того как пользователь
//     закрыл другую вкладку, повторный openDB() успешен (запрос попадает
//     в FIFO-очередь fake-indexeddb ПОСЛЕ осиротевшего запроса, который
//     завершает upgrade с полной схемой);
//   — retry-поток как после кнопки «Повторить» (window.location.reload()):
//     vi.resetModules() + повторный openDB() → БД функциональна (putBook);
//   — контракт: обычный openDB() без блокировки работает как раньше.
// ═══════════════════════════════════════════════════════════════════
// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const DB_NAME = 'book-tracker-pro'; // должен совпадать с DB_NAME в db.js
const DB_VER = 6;                    // должен совпадать с DB_VER в db.js

/** Текущий (перезагруженный) модуль db.js. */
let dbModule = null;

/** Открытые соединения текущего теста — закрываем все в afterEach. */
let heldConns = new Set();

/** Перезагрузка модуля db.js: имитация reload страницы (кнопка «Повторить»). */
async function reloadApp() {
  vi.resetModules();
  dbModule = await import('../db.js');
  return dbModule;
}

/** Удаляет БД (все соединения предыдущего теста уже закрыты в afterEach). */
async function deleteDatabase() {
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error || new Error('deleteDatabase failed'));
    req.onblocked = () => reject(new Error('deleteDatabase blocked — остались открытые соединения'));
  });
}

/**
 * Открытое «старое» соединение — эмуляция второй вкладки со старой версией
 * БД. ВАЖНО (первопричина P2-4 в тестах): «другая вкладка» — это то же
 * приложение, открытое раньше, поэтому БД создаётся с реальной схемой версии
 * `version` (как её создала бы db.js на той версии), НЕ пустой. Если открыть
 * пустую БД, миграция db.js упадёт на tx.objectStore('books') → abort.
 * Вкладка НЕ закрывается на versionchange («залипший» таб).
 */
async function holdOldConnection(version) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, version);
    req.onupgradeneeded = () => {
      // реальная схема приложения на требуемой версии (см. upgrader db.js)
      const db = req.result;
      const tx = req.transaction;
      if (version >= 1) {
        if (!db.objectStoreNames.contains('books')) {
          const books = db.createObjectStore('books', { keyPath: 'id' });
          books.createIndex('status', 'status', { unique: false });
          books.createIndex('updatedAt', 'updatedAt', { unique: false });
          books.createIndex('dateAdded', 'dateAdded', { unique: false });
          books.createIndex('titleAuthor', ['title', 'author'], { unique: false });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'id' });
        }
      }
      if (version >= 2 && !db.objectStoreNames.contains('covers')) {
        db.createObjectStore('covers', { keyPath: 'bookId' });
      }
      if (version >= 3) {
        const books = tx.objectStore('books');
        if (!books.indexNames.contains('isPR')) books.createIndex('isPR', 'isPR', { unique: false });
        if (!books.indexNames.contains('blogStatus')) books.createIndex('blogStatus', 'blogStatus', { unique: false });
        if (!books.indexNames.contains('genre')) books.createIndex('genre', 'genre', { unique: false });
      }
      if (version >= 4) {
        if (!db.objectStoreNames.contains('collections')) db.createObjectStore('collections', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('challenges')) {
          const ch = db.createObjectStore('challenges', { keyPath: 'id' });
          ch.createIndex('status', 'status', { unique: false });
        }
        if (!db.objectStoreNames.contains('tags')) db.createObjectStore('tags', { keyPath: 'name' });
        const books = tx.objectStore('books');
        if (!books.indexNames.contains('series')) books.createIndex('series', 'series', { unique: false });
        if (!books.indexNames.contains('dateFinished')) books.createIndex('dateFinished', 'dateFinished', { unique: false });
      }
      if (version >= 5 && !db.objectStoreNames.contains('previews')) {
        const previews = db.createObjectStore('previews', { keyPath: 'id' });
        previews.createIndex('cachedAt', 'cachedAt', { unique: false });
      }
      if (version >= 6 && !db.objectStoreNames.contains('pending-sync')) {
        db.createObjectStore('pending-sync', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // не закрываемся на versionchange → upgrade от openDB() блокируется
      db.onversionchange = () => {};
      heldConns.add(db);
      resolve(db);
    };
    req.onerror = () => reject(req.error || new Error('hold open failed'));
    req.onblocked = () => {};
  });
}

/** Дожидаемся, пока осиротевший запрос завершит upgrade: опрашиваем
 *  indexedDB.databases() (как в браузере — версия вернётся только ПОСЛЕ
 *  фиксации versionchange-транзакции). */
async function waitForVersionUpgrade(name, targetVersion, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const dbs = await indexedDB.databases();
    const db = dbs.find((d) => d.name === name);
    if (db && db.version >= targetVersion) return db.version;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error('waitForUpgrade: база не поднялась до версии ' + targetVersion);
}

beforeEach(async () => {
  await deleteDatabase();
  await reloadApp();
});

afterEach(async () => {
  // закрываем все соединения, открытые тестом (в т.ч. удержанную «вкладку»)
  for (const conn of heldConns) {
    try { conn.close(); } catch { /* уже закрыто */ }
  }
  heldConns.clear();
  // даём queueTask (setImmediate) внутри fake-indexeddb завершиться
  await new Promise((r) => setTimeout(r, 30));
});

// ═══════════════════════════════════════════════
//  BLOCKED: openDB ОТКЛОНЯЕТСЯ, а не зависает
// ═══════════════════════════════════════════════
describe('P2-4: blocked upgrade → Promise reject с DBBlockedError (не skeleton навсегда)', () => {
  it('openDB() при открытой «зависшей» старой вкладке → ОТКЛОНЯЕТСЯ с DBBlockedError (Promise не висит)', async () => {
    await holdOldConnection(1); // «другая вкладка» на версии 1
    const { openDB, DBBlockedError } = dbModule;
    // openDB() требует upgrade 1→6 → запрос получает событие blocked
    await expect(openDB()).rejects.toBeInstanceOf(DBBlockedError);
  });

  it('сообщение ошибки объясняет пользователю действие (закрыть другие вкладки)', async () => {
    await holdOldConnection(1);
    const { openDB } = dbModule;
    await expect(openDB()).rejects.toThrow(/закройте другие вкладки/i);
  });

  it('повторный вызов openDB() после reject не возвращает «протухший» кэш — после снятия блокировки база открывается заново', async () => {
    const oldConn = await holdOldConnection(1);
    const { openDB, DBBlockedError } = dbModule;
    await expect(openDB()).rejects.toBeInstanceOf(DBBlockedError);
    // reject не оставил _db — повторный вызов (после того как пользователь
    // закрыл другую вкладку) стартует честное открытие, а не мёртвый кэш.
    oldConn.close();
    // осиротевший запрос в FIFO-очереди fake-indexeddb сначала завершит
    // upgrade 1→6 (с полной схемой), затем наш запрос просто откроет v6.
    const db = await openDB();
    expect(db).toBeTruthy();
    expect(db.version).toBe(DB_VER);
    heldConns.add(db);
  });
});

// ═══════════════════════════════════════════════
//  RETRY FLOW: закрыта старая вкладка → openDB успешен
// ═══════════════════════════════════════════════
describe('P2-4: retry после закрытия старой вкладки → база открывается и работает', () => {
  it('после закрытия старой вкладки openDB() УСПЕШЕН и БД функциональна (поток кнопки «Повторить» = reload)', async () => {
    const oldConn = await holdOldConnection(1);
    const { openDB, DBBlockedError } = dbModule;
    await expect(openDB()).rejects.toBeInstanceOf(DBBlockedError);
    oldConn.close(); // «пользователь закрыл другую вкладку»

    // осиротевший запрос из отклонённого openDB() завершает upgrade 1→6
    // асинхронно в FIFO-очереди fake-indexeddb. Ждём фиксации версии.
    await waitForVersionUpgrade(DB_NAME, DB_VER);

    // «Повторить» в app.js = window.location.reload(): сбрасываем модуль.
    await reloadApp();

    const db = await dbModule.openDB();
    expect(db).toBeTruthy();
    expect(db.version).toBe(DB_VER);
    heldConns.add(db);

    // БД реально работает: запись + чтение (осиротевший запрос выполнил
    // обновление схемы из db.js — все store созданы)
    await dbModule.putBook({ id: 'b1', title: 'Книга', author: 'A' });
    const books = await dbModule.loadBooks();
    expect(books.map((b) => b.id)).toEqual(['b1']);
  });
});

// ═══════════════════════════════════════════════
//  КОНТРАКТ: обычный openDB не сломан
// ═══════════════════════════════════════════════
describe('P2-4: контракт не сломан — обычный openDB в пустой среде работает', () => {
  it('нет других вкладок → openDB() успешен, версия корректная', async () => {
    const { openDB } = dbModule;
    const db = await openDB();
    expect(db).toBeTruthy();
    expect(db.version).toBe(DB_VER);
    heldConns.add(db);

    await dbModule.putBook({ id: 'b1', title: 'Книга', author: 'A' });
    expect((await dbModule.loadBooks()).length).toBe(1);
  });
});