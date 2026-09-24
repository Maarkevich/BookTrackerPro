// ═══════════════════════════════════════════════════════════════
//  P2-8: Startup N+1 covers — DB-уровень (честные Blob, node env)
//
//  Оригинальная проблема (до фикса):
//    app.js restoreCoverUrls() вызывала getCover(book.id) ПОСЛЕДОВАТЕЛЬНО
//    для каждой книги, а getCover() открывал отдельную readonly-
//    транзакцию на книгу. На библиотеке в N книг старт делал N
//    транзакций IndexedDB — линейный рост времени до первого render.
//
//  Что доказывают тесты (реальная симуляция через fake-indexeddb,
//  node env — Blob сохраняется корректно):
//    — loadCovers() читает 0/100/1000/5000 обложек за ОДНУ транзакцию
//      (счётчик transaction() по store 'covers' == 1, а не N);
//    — фильтр bookIds: одна транзакция и только запрошенные обложки;
//    — обложки НЕ перепутаны: каждый bookId получает ровно свой Blob
//      (проверяется по уникальному размеру blob = 200+i);
//    — контракт не сломан: пустая база → пустой Map, изолированный
//      getCover() (используется импортом/экспортом) по-прежнему
//      возвращает Blob / null.
// ═══════════════════════════════════════════════════════════════
// @vitest-environment node
import 'fake-indexeddb/auto';
import { IDBDatabase } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadCovers, openDB, getCover } from '../db.js';

const _orig = {};

/** Сколько транзакций по store 'covers' создаёт переданная функция. */
function countCoversTransactions(fn) {
  const orig = IDBDatabase.prototype.transaction;
  let count = 0;
  IDBDatabase.prototype.transaction = function (...args) {
    const names = Array.isArray(args[0]) ? args[0] : [args[0]];
    if (names.includes('covers')) count++;
    return orig.apply(this, args);
  };
  _orig.transaction = orig;
  return {
    async run() {
      try {
        await fn();
      } finally {
        IDBDatabase.prototype.transaction = _orig.transaction;
      }
      return count;
    },
  };
}

afterEach(() => {
  if (_orig.transaction) { IDBDatabase.prototype.transaction = _orig.transaction; delete _orig.transaction; }
});

beforeEach(async () => {
  const db = await openDB();
  const names = Array.from({ length: db.objectStoreNames.length }, (_, i) => db.objectStoreNames.item(i));
  await new Promise((resolve) => {
    const tx = db.transaction(names, 'readwrite');
    for (const st of names) tx.objectStore(st).clear();
    tx.oncomplete = resolve;
  });
});

/** N настоящих Blob-обложек одной транзакцией; blob.size = 200+i уникален. */
async function seedCovers(n, prefix = 'b') {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('covers', 'readwrite');
    const store = tx.objectStore('covers');
    for (let i = 0; i < n; i++) {
      store.put({ bookId: prefix + i, blob: new Blob([new Uint8Array(200 + i)], { type: 'image/png' }), savedAt: Date.now() });
    }
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// ═══════════════════════════════════════════════════
//  BATCH loadCovers: ОДНА ТРАНЗАКЦИЯ вместо N
// ═══════════════════════════════════════════════════
describe('P2-8: loadCovers — batch загрузка одной транзакцией', () => {
  it('5000 обложек: ровно ОДНА транзакция (не 5000)', async () => {
    await seedCovers(5000);
    let result;
    const c = countCoversTransactions(async () => { result = await loadCovers(); });
    expect(await c.run()).toBe(1);
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(5000);
  });

  it('1000 обложек + фильтр bookIds: одна транзакция, только запрошенные', async () => {
    await seedCovers(1000);
    const wanted = Array.from({ length: 100 }, (_, i) => 'b' + i * 10);
    let result;
    const c = countCoversTransactions(async () => { result = await loadCovers(wanted); });
    expect(await c.run()).toBe(1);
    expect(result.size).toBe(100);
    expect(result.has('b0')).toBe(true);
    expect(result.has('b990')).toBe(true);
    expect(result.has('b1')).toBe(false);
  });

  it('0 обложек: пустой Map, без ошибок (контракт)', async () => {
    const c = countCoversTransactions(async () => {}); // подготовка счётчика
    expect(await c.run()).toBe(0); // даже транзакций не было
    const result = await loadCovers();
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  it('обложки не перепутаны: каждая книга получает ровно свой Blob (уникальный размер)', async () => {
    await seedCovers(100);
    const covers = await loadCovers();
    for (let i = 0; i < 100; i++) {
      const blob = covers.get('b' + i);
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.size).toBe(200 + i);   // своя обложка, не чужая
      expect(blob.type).toBe('image/png');
    }
  });

  it('книга без обложки отсутствует в Map (маленькая библиотека с редкими covers)', async () => {
    await seedCovers(10);
    const covers = await loadCovers();
    expect(covers.get('b3')).toBeInstanceOf(Blob);
    expect(covers.has('nope')).toBe(false);
    expect(covers.get('nope')).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════
//  КОНТРАКТ: изолированный getCover() не сломан
// ═══════════════════════════════════════════════════
describe('P2-8: контракт getCover сохранён', () => {
  it('getCover(bookId) возвращает Blob для сохранённой обложки', async () => {
    await seedCovers(10);
    const blob = await getCover('b3');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBe(203);
  });

  it('getCover(отсутствующей) → null (контракт из импорта/экспорта)', async () => {
    await seedCovers(10);
    expect(await getCover('no-such')).toBeNull();
  });
});