// ═══════════════════════════════════════════════════════════════════
// Регрессионные тесты P2-1 — «Export скрывает read errors».
//
// Оригинальная проблема (до фикса):
//   — локальный getAll() внутри exportAll() превращал req.onerror
//     в `resolve([])`, поэтому сбой чтения любого store выглядел как
//     «пустой массив» и создавался якобы успешный backup с
//     потерянными данными;
//   — обработчик #set-export не имел try/catch, поэтому гарантированно
//     скачивал неполный файл и показывал «📤 Экспортировано».
//
// Что доказывают тесты:
//   — сбой чтения КАЖДОГО обязательного store (books/collections/
//     challenges/tags/covers) → exportAll() ОТКЛОНЯЕТСЯ (Promise rejects);
//   — сбой чтения settings (loadSettings) → экспорт ОТКЛОНЯЕТСЯ;
//   — то есть после `await exportAll()` строка download + success toast
//     в обработчике недостижима;
//   — контракт НЕ сломан: легитимный пустой экспорт отрабатывает штатно
//     (никаких null/[]-вместо-данных в полях backup нет, все ключи на месте).
// ═══════════════════════════════════════════════════════════════════
// @vitest-environment node
import 'fake-indexeddb/auto';
import { IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exportAll, openDB, putBook, saveSettings } from '../db.js';

// ── утилиты принудительного сбоя чтения IndexedDB ──
const _orig = {};

/** Следующие N вызовов store.getAll abort'ят свою транзакцию. */
function abortGetAll(times = 1) {
  const proto = IDBObjectStore.prototype;
  if (!_orig['getAll']) _orig['getAll'] = proto['getAll'];
  let remaining = times;
  proto['getAll'] = function (...args) {
    const res = _orig['getAll'].apply(this, args);
    if (remaining > 0) { remaining--; this.transaction.abort(); }
    return res;
  };
}

/** Следующий вызов store.get abort'ит транзакцию (settings). */
function abortGet(times = 1) {
  const proto = IDBObjectStore.prototype;
  if (!_orig['get']) _orig['get'] = proto['get'];
  let remaining = times;
  proto['get'] = function (...args) {
    const res = _orig['get'].apply(this, args);
    if (remaining > 0) { remaining--; this.transaction.abort(); }
    return res;
  };
}

function restoreProtos() {
  for (const [m, fn] of Object.entries(_orig)) IDBObjectStore.prototype[m] = fn;
  for (const key of Object.keys(_orig)) delete _orig[key];
}

async function clearDB() {
  const db = await openDB();
  const names = Array.from({ length: db.objectStoreNames.length }, (_, i) => db.objectStoreNames.item(i));
  await new Promise((resolve) => {
    const tx = db.transaction(names, 'readwrite');
    for (const st of names) tx.objectStore(st).clear();
    tx.oncomplete = resolve;
  });
}

const BOOK = (id, title = 'Книга') => ({ id, title, author: 'A', status: 'added' });

beforeEach(clearDB)
afterEach(restoreProtos)

// ═══════════════════════════════════════════════
//  СБОЙ ЧТЕНИЯ КАЖДОГО STORE → exportAll() ОТКЛОНЯЕТСЯ
// ═══════════════════════════════════════════════
describe('P2-1: сбой чтения store → Promise reject (не пустой backup)', () => {
  it('books: при abort чтения exportAll ОТКЛОНЯЕТСЯ — скачивание/success недостижимы', async () => {
    await putBook(BOOK('b1'));
    abortGetAll(1);
    await expect(exportAll()).rejects.toThrow();
  });

  it('collections: при abort чтения exportAll ОТКЛОНЯЕТСЯ', async () => {
    abortGetAll(2); // books ok, collections — сбой
    await expect(exportAll()).rejects.toThrow();
  });

  it('challenges: при abort чтения exportAll ОТКЛОНЯЕТСЯ', async () => {
    abortGetAll(3); // books, collections ok, challenges — сбой
    await expect(exportAll()).rejects.toThrow();
  });

  it('tags: при abort чтения exportAll ОТКЛОНЯЕТСЯ', async () => {
    abortGetAll(4); // …, tags — сбой
    await expect(exportAll()).rejects.toThrow();
  });

  it('covers: при abort чтения exportAll ОТКЛОНЯЕТСЯ', async () => {
    abortGetAll(5); // …, covers — сбой
    await expect(exportAll()).rejects.toThrow();
  });

  it('settings (loadSettings): при abort чтения exportAll ОТКЛОНЯЕТСЯ', async () => {
    abortGet(1);
    await expect(exportAll()).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════
//  СБОЙ ПРИ ЗАПОЛНЕННОЙ БД НЕ МАСКИРУЕТСЯ ПУСТОТОЙ
// ═══════════════════════════════════════════════
describe('P2-1: сбой при реальных данных не даёт «пустой» backup', () => {
  it('при данных в store и сбое чтения books НЕ возвращается backup с books:[]', async () => {
    await putBook(BOOK('b1'));
    abortGetAll(1);
    await expect(exportAll()).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════
//  КОНТРАКТ: легитимный экспорт работает штатно
// ═══════════════════════════════════════════════
describe('P2-1: контракт не сломан — легитимный экспорт полный', () => {
  it('пустая БД → exportAll возвращает все ключи с []/{} (не reject)', async () => {
    const data = await exportAll();
    expect(data).toBeTruthy();
    expect(data.app).toBe('BookTrackerPro');
    expect(data.version).toBe(1);
    expect(Array.isArray(data.books)).toBe(true);
    expect(Array.isArray(data.collections)).toBe(true);
    expect(Array.isArray(data.challenges)).toBe(true);
    expect(Array.isArray(data.tags)).toBe(true);
    expect(data.covers).toEqual([]);
    expect(typeof data.settings).toBe('object');
    expect(data.settings).not.toBeNull();
  });

  it('с данными → exportAll возвращает книги и настройки (round-trip)', async () => {
    await putBook(BOOK('b1', 'Война и мир'));
    await saveSettings({ confetti: true });
    const data = await exportAll();
    expect(data.books.map(b => b.id)).toEqual(['b1']);
    expect(data.books[0].title).toBe('Война и мир');
    expect(data.settings.confetti).toBe(true);
  });

  it('после отказа чтения экспорт ещё раз работает нормально (не «залипает»)', async () => {
    await putBook(BOOK('b1'));
    abortGetAll(1);
    await expect(exportAll()).rejects.toThrow();
    // прототип восстановлен → следующий экспорт успешен
    const data = await exportAll();
    expect(data.books.map(b => b.id)).toEqual(['b1']);
  });
});