// @vitest-environment jsdom
// 🧪 P3-2 — Background Sync queue: наполнение очереди из офлайн-сохранения
// и обработка syncBookMetadata() в sw.js.
//
// Реальная симуляция на fake-indexeddb (без мокания самой логики):
//
//   A) maybeEnqueueOfflineSync() (вызывается из saveBookForm ПОСЛЕ успешной
//      записи книги):
//      — офлайн + валидный ISBN → запись в очереди {bookId, isbn}
//        + регистрация background sync tag 'sync-book-metadata';
//      — онлайн / без ISBN → ничего не создаётся;
//      — повторный вызов (повторное сохранение формы) → НЕ дублирует запись;
//      — сбой БД → false + console.warn + очередь пуста (best-effort,
//        книга уже сохранена — только потеря «досинхронизации», не данных).
//
//   B) syncBookMetadata() в sw.js (исполнение sw.js в vm-контексте,
//      как в activate-cache.test.js, но с реальным fake-indexeddb):
//      — успешный fetch → книга досинхронизирована (title/author/...),
//        pendingSync=false, элемент УДАЛЁН из очереди;
//      — fetch 503 → элемент ОСТАЁТСЯ в очереди для повторной попытки;
//      — офлайн в момент sync → очередь не тронута.

import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDB, putBook, putPendingSync, getPendingSync, loadBooks } from '../db.js';
import { maybeEnqueueOfflineSync } from '../app.js';
import * as dbjs from '../db.js';
import * as swreg from '../sw-register.js';

// jsdom-окружение vitest не сохраняет import.meta.url как file:// —
// читаем sw.js через process.cwd() (паттерн ocr-offline-prepare.test.js).
const SW_SOURCE = readFileSync(path.resolve(process.cwd(), 'sw.js'), 'utf8');
const VALID_ISBN = '9781566199094';

// ── helpers ─────────────────────────────────────────────
function setOnline(v) {
  Object.defineProperty(navigator, 'onLine', { value: v, configurable: true });
}

async function resetDb() {
  // Без deleteDatabase: sw-соединения (openDbFromSW в vm) не закрываются,
  // и deleteDatabase блокировался бы навсегда (onblocked).
  const db = await openDB();
  const names = Array.from(db.objectStoreNames);
  await new Promise((resolve, reject) => {
    const tx = db.transaction(names, 'readwrite');
    for (const n of names) tx.objectStore(n).clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Исполняет sw.js в vm-контексте и возвращает sync-обработчик +
 * рантайм-зависимости (fetch, navigator), как в activate-cache.test.js.
 */
function loadSW({ onLine = true, fetchImpl } = {}) {
  const listeners = {};
  const selfMock = {
    location: { origin: 'http://localhost' },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => {},
    clients: { claim: () => Promise.resolve(), matchAll: () => Promise.resolve([]) },
    registration: { update: () => Promise.resolve() },
  };
  const sandbox = {
    self: selfMock,
    caches: { keys: async () => [], delete: async () => true, open: async () => ({}) },
    // реальный fake-indexeddb: sw открывает ту же БД, что и db.js
    indexedDB: globalThis.indexedDB,
    fetch: fetchImpl || (async () => ({ ok: true, json: async () => ({ items: [] }) })),
    Response,
    URL,
    console,
    navigator: { onLine },
    location: { protocol: 'https:', hostname: 'localhost' },
    document: undefined,
    window: {},
    MessageChannel: class {
      constructor() { this.port1 = { onmessage: null, postMessage() {} }; this.port2 = { postMessage() {} }; }
    },
    setTimeout,
    clearTimeout,
    Promise,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SW_SOURCE, sandbox, { filename: 'sw.js' });

  if (!listeners.sync) throw new Error('sync listener не зарегистрирован');

  function runSync(tag = 'sync-book-metadata') {
    let promise = null;
    const event = { tag, waitUntil: (p) => { promise = p; } };
    listeners.sync(event);
    return promise;
  }

  return { runSync };
}

function okGoogleResponse(volumeInfo) {
  return { ok: true, json: async () => ({ items: [{ volumeInfo }] }) };
}

beforeEach(async () => {
  setOnline(true);
  await resetDb();
});

afterEach(() => {
  vi.restoreAllMocks();
  setOnline(true);
});

describe('P3-2: maybeEnqueueOfflineSync — наполнение очереди (offline book metadata sync)', () => {
  it('офлайн + ISBN → запись в очереди + регистрация background sync', async () => {
    setOnline(false);
    const regSpy = vi.spyOn(swreg, 'registerPendingSync').mockResolvedValue(true);

    const result = await maybeEnqueueOfflineSync({ id: 'b1', isbn: VALID_ISBN });

    expect(result).toBe(true);
    expect(regSpy).toHaveBeenCalledWith('sync-book-metadata');
    const queue = await getPendingSync();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ id: 'ps_b1', bookId: 'b1', isbn: VALID_ISBN });
  });

  it('идемпотентность: повторный вызов для той же книги не дублирует запись', async () => {
    setOnline(false);
    const regSpy = vi.spyOn(swreg, 'registerPendingSync').mockResolvedValue(true);

    await maybeEnqueueOfflineSync({ id: 'b1', isbn: VALID_ISBN });
    const again = await maybeEnqueueOfflineSync({ id: 'b1', isbn: VALID_ISBN });

    expect(again).toBe(true);
    expect(await getPendingSync()).toHaveLength(1);
    expect(regSpy).toHaveBeenCalledTimes(1);
  });

  it('онлайн → ничего не создаётся', async () => {
    const regSpy = vi.spyOn(swreg, 'registerPendingSync').mockResolvedValue(true);
    setOnline(true);

    const result = await maybeEnqueueOfflineSync({ id: 'b1', isbn: VALID_ISBN });

    expect(result).toBe(false);
    expect(regSpy).not.toHaveBeenCalled();
    expect(await getPendingSync()).toEqual([]);
  });

  it('офлайн, но без валидного ISBN → ничего не создаётся', async () => {
    setOnline(false);
    const regSpy = vi.spyOn(swreg, 'registerPendingSync').mockResolvedValue(true);

    expect(await maybeEnqueueOfflineSync({ id: 'b1', isbn: '' })).toBe(false);
    expect(await maybeEnqueueOfflineSync({ id: 'b2', isbn: '1111111111111' })).toBe(false);

    expect(regSpy).not.toHaveBeenCalled();
    expect(await getPendingSync()).toEqual([]);
  });

  it('сбой БД → false + console.warn, очередь пуста, sync НЕ регистрируется (книга уже сохранена)', async () => {
    setOnline(false);
    const regSpy = vi.spyOn(swreg, 'registerPendingSync').mockResolvedValue(true);
    // app.js вызывает getPendingSync через namespace-импорт — спай доходит;
    // внутренний вызов openDB внутри db.js недостижим через vi.spyOn
    // (локальное связывание) — для сбоя достаточно чтения очереди.
    const psSpy = vi.spyOn(dbjs, 'getPendingSync').mockRejectedValue(new Error('DB read failed'));
    const putSpy = vi.spyOn(dbjs, 'putPendingSync').mockResolvedValue(true);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await maybeEnqueueOfflineSync({ id: 'b1', isbn: VALID_ISBN });

    expect(result).toBe(false);
    expect(psSpy).toHaveBeenCalled();
    expect(putSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    expect(regSpy).not.toHaveBeenCalled();

    vi.restoreAllMocks();
    setOnline(false); // снова offline для валидности гейта
    // после восстановления БД запись создаётся — очередь не была «замусорена»
    expect(await maybeEnqueueOfflineSync({ id: 'b1', isbn: VALID_ISBN })).toBe(true);
  });
});

describe('P3-2: syncBookMetadata() в sw.js — обработка очереди', () => {
  it('успешный fetch → книга досинхронизирована, pendingSync=false, элемент удалён', async () => {
    await putBook({ id: 'b1', title: 'Старая', author: '', status: 'added', isbn: VALID_ISBN, pendingSync: true });
    await putPendingSync({ id: 'ps_b1', bookId: 'b1', isbn: VALID_ISBN });

    const sw = loadSW({
      fetchImpl: async () => okGoogleResponse({
        title: 'Новое название', authors: ['Автор'], pageCount: 222,
        publisher: 'Изд', publishedDate: '2020', description: 'Описание',
      }),
    });

    await sw.runSync();

    const books = await loadBooks();
    expect(books.find((b) => b.id === 'b1')).toMatchObject({
      title: 'Новое название', author: 'Автор', pageCount: 222,
      publisher: 'Изд', publishedDate: '2020', description: 'Описание',
      pendingSync: false,
    });
    expect(await getPendingSync()).toEqual([]);
  });

  it('fetch 503 → элемент ОСТАЁТСЯ в очереди, успешный элемент удаляется', async () => {
    await putBook({ id: 'b1', title: 'A', status: 'added', isbn: VALID_ISBN, pendingSync: true });
    await putBook({ id: 'b2', title: 'B', status: 'added', isbn: '1566199093', pendingSync: true });
    await putPendingSync({ id: 'ps_b1', bookId: 'b1', isbn: VALID_ISBN });
    await putPendingSync({ id: 'ps_b2', bookId: 'b2', isbn: '1566199093' });

    let calls = 0;
    const sw = loadSW({
      fetchImpl: async () => {
        calls += 1;
        return calls === 1
          ? okGoogleResponse({ title: 'Обновлённая A', authors: ['Автор A'] })
          : { ok: false }; // сбой для второго элемента
      },
    });

    await sw.runSync();

    const books = await loadBooks();
    expect(books.find((b) => b.id === 'b1').title).toBe('Обновлённая A');
    expect(books.find((b) => b.id === 'b2').title).toBe('B');

    // удалён только успешно обработанный элемент
    const queue = await getPendingSync();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ id: 'ps_b2', bookId: 'b2' });
  });

  it('офлайн в момент sync → очередь не тронута (сеть ещё не восстановлена)', async () => {
    await putBook({ id: 'b1', title: 'A', status: 'added', isbn: VALID_ISBN, pendingSync: true });
    await putPendingSync({ id: 'ps_b1', bookId: 'b1', isbn: VALID_ISBN });

    const sw = loadSW({ onLine: false });

    await sw.runSync();

    expect(await getPendingSync()).toHaveLength(1);
    expect((await loadBooks()).find((b) => b.id === 'b1')).toMatchObject({ title: 'A', pendingSync: true });
  });
});