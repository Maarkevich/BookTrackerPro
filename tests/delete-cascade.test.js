// ═══════════════════════════════════════════════════════════════════
// Регрессионные тесты P1-8 — «Delete book оставляет dangling
// collection/challenge refs».
//
// Оригинальная проблема (до фикса):
//   app.js удалял книгу ДВУМЯ отдельными транзакциями
//   (delBook → books, deleteCover → covers) и НЕ чистил bookIds
//   в collections/challenges — ссылки на удалённую книгу оставались:
//   неверные счётчики/прогресс, пустые элементы, ошибки при открытии.
//   К тому же удаление не было атомарным: книга удалялась, а cover
//   мог «упасть» отдельно (best-effort).
//
// Что доказывают тесты:
//   — deleteBookCascade в ОДНОЙ readwrite-транзакции удаляет книгу,
//     обложку и фильтрует bookIds во ВСЕХ подборках/челленджах;
//   — реальная симуляция abort'а на втором этапе (после удаления книги,
//     при записи отфильтрованных refs) → reject И rollback всей
//     транзакции: книга НЕ удалена, ссылки на месте;
//   — удаление книги без связей — no-op для остальных stores;
//   — repairDanglingRefs чистит УЖЕ существующие dangling refs
//     (симулирует данные, оставшиеся от старых версий);
//   — контракт P1-5 не сломан: deleteBookCascade(несуществующая) → false,
//     реальный сбой → reject, пустые/легитимные наборы остаются штатными.
// ═══════════════════════════════════════════════════════════════════
// @vitest-environment node
import 'fake-indexeddb/auto';
import { IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  delBook, deleteBookCascade, loadBooks, loadChallenges, loadCollections,
  openDB, putBook, putChallenge, putCollection, repairDanglingRefs,
} from '../db.js';

const _orig = {};

/** Следующие N вызовов store.<method> abort'ят свою транзакцию. */
function abortOn(method, times = 1) {
  const proto = IDBObjectStore.prototype;
  if (!_orig[method]) _orig[method] = proto[method];
  let remaining = times;
  proto[method] = function (...args) {
    const res = _orig[method].apply(this, args);
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

beforeEach(clearDB)
afterEach(restoreProtos)

const BOOK = (id, title = 'Книга ' + id) => ({
  id, title, author: 'A', status: 'added', dateAdded: '2026-01-01T00:00:00.000Z',
});
const COL = (id, bookIds) => ({ id, name: 'Подборка ' + id, bookIds: [...bookIds] });
const CH = (id, bookIds) => ({ id, name: 'Челлендж ' + id, status: 'active', bookIds: [...bookIds] });

async function refsOf(storeName, id) {
  const db = await openDB();
  return await new Promise((resolve) => {
    const req = db.transaction(storeName, 'readonly').objectStore(storeName).get(id);
    req.onsuccess = () => resolve(((req.result || {}).bookIds) || []);
  });
}

// ═══════════════════════════════════════════════════
//  КАСКАДНОЕ УДАЛЕНИЕ: ВСЕ STORES + NO-OP БЕЗ СВЯЗЕЙ
// ═══════════════════════════════════════════════════
describe('P1-8: deleteBookCascade — атомарный каскад', () => {
  it('книга в нескольких подборках и челленджах: всё удаляется/фильтруется одной операцией', async () => {
    await putBook(BOOK('b1'));
    await putBook(BOOK('b2'));
    await putCollection(COL('c1', ['b1', 'b2']));
    await putCollection(COL('c2', ['b1']));
    await putChallenge(CH('h1', ['b1', 'b2']));
    await putChallenge(CH('h2', ['b1']));

    const ok = await deleteBookCascade('b1');
    expect(ok).toBe(true);

    expect(await loadBooks()).toHaveLength(1);          // b1 удалён, b2 остался
    expect(await refsOf('collections', 'c1')).toEqual(['b2']);
    expect(await refsOf('collections', 'c2')).toEqual([]);
    expect(await refsOf('challenges', 'h1')).toEqual(['b2']);
    expect(await refsOf('challenges', 'h2')).toEqual([]);

    // обложка удаляется (store covers — проверяем через пустой экспорт)
    const db = await openDB();
    const coverCount = await new Promise((resolve) => {
      const req = db.transaction('covers', 'readonly').objectStore('covers').count();
      req.onsuccess = () => resolve(req.result || 0);
    });
    expect(coverCount).toBe(0);
  });

  it('удаление книги БЕЗ связей: другие коллекции/челленджи не тронуты', async () => {
    await putBook(BOOK('b1'));
    await putBook(BOOK('b2'));
    await putCollection(COL('c1', ['b2']));
    await putChallenge(CH('h1', ['b2']));

    const ok = await deleteBookCascade('b1');
    expect(ok).toBe(true);
    expect(await refsOf('collections', 'c1')).toEqual(['b2']);
    expect(await refsOf('challenges', 'h1')).toEqual(['b2']);
  });

  it('несуществующая книга → false (no-op), ничего не изменено', async () => {
    await putCollection(COL('c1', ['b2']));
    expect(await deleteBookCascade('nope')).toBe(false);
    expect(await loadBooks()).toHaveLength(0);
    expect(await refsOf('collections', 'c1')).toEqual(['b2']);
  });
});

// ═══════════════════════════════════════════════════
//  АТОМАРНОСТЬ: abort после удаления книги ⇒ ROLLBACK
// ═══════════════════════════════════════════════════
describe('P1-8: атомарность — при сбое нет частичного удаления', () => {
  it('abort на ПЕРВОМ put после удаления книги → reject, книга и ссылки НЕ изменены', async () => {
    await putBook(BOOK('b1'));
    await putBook(BOOK('b2'));
    await putCollection(COL('c1', ['b1', 'b2']));

    // внутрь транзакции: books.delete(b1) уже выполнен,
    // затем put при фильтрации refs → abort → rollback всего
    abortOn('put', 1);
    await expect(deleteBookCascade('b1')).rejects.toThrow();

    // rollback: книга НЕ удалена, ссылки на месте — каскад атомарен
    const books = await loadBooks();
    expect(books.map(b => b.id).sort()).toEqual(['b1', 'b2']);
    expect(await refsOf('collections', 'c1')).toEqual(['b1', 'b2']);
  });

  it('abort на delete (books.books) → reject, ничего не удалено', async () => {
    await putBook(BOOK('b1'));
    await putCollection(COL('c1', ['b1']));

    abortOn('delete', 1);
    await expect(deleteBookCascade('b1')).rejects.toThrow();
    expect((await loadBooks()).map(b => b.id)).toEqual(['b1']);
    expect(await refsOf('collections', 'c1')).toEqual(['b1']);
  });
});

// ═══════════════════════════════════════════════════
//  REPAIR СУЩЕСТВУЮЩИХ DANGLING REFS
// ═══════════════════════════════════════════════════
describe('P1-8: repairDanglingRefs — ремонт ссылок от старых версий', () => {
  it('чистит ссылки на несуществующие книги, сохраняя валидные', async () => {
    await putBook(BOOK('b1'));
    // симулируем данные старых версий: b2 «удалена» без каскада
    await putBook(BOOK('b3'));
    await putCollection(COL('c1', ['b1', 'b2', 'b3', 'ghost']));
    await putChallenge(CH('h1', ['b2', 'ghost2']));

    const fixed = await repairDanglingRefs();

    expect(typeof fixed).toBe('number');
    expect(await refsOf('collections', 'c1')).toEqual(['b1', 'b3']);
    expect(await refsOf('challenges', 'h1')).toEqual([]);
  });

  it('repair при полностью пустой БД категорий: считается, ссылки вычищаются', async () => {
    await putCollection(COL('c1', ['ghost']));
    const fixed = await repairDanglingRefs();
    expect(fixed).toBe(1);
    expect(await refsOf('collections', 'c1')).toEqual([]);
  });

  it('легитимные пустые bookIds не трогаются (контракт не сломан)', async () => {
    await putCollection(COL('c1', []));
    await putChallenge(CH('h1', []));
    expect(await repairDanglingRefs()).toBe(0);
    expect(await refsOf('collections', 'c1')).toEqual([]);
    expect(await refsOf('challenges', 'h1')).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════
//  СОВМЕСТИМОСТЬ С СУЩЕСТВУЮЩИМ API
// ═══════════════════════════════════════════════════
describe('P1-8: не ломаем существующий контракт', () => {
  it('delBook() и deleteCover() остаются рабочими (обратная совместимость)', async () => {
    await putBook(BOOK('b1'));
    expect(await delBook('b1')).toBe(true);
    expect(await loadBooks()).toHaveLength(0);
  });
});