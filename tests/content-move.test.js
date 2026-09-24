// ═══════════════════════════════════════════════════════════════════
// Регрессионные тесты P1-7 — «Перенос content между books неатомарен».
//
// Оригинальная проблема (до фикса):
//   content.js при смене книги контента выполнял ДВЕ отдельные операции:
//   removeContentFromBook(oldBook) + addContentToBook(newBook) —
//   две независимые транзакции. Сбой между ними оставлял элемент
//   одновременно в двух книгах либо ни в одной.
//
// Что доказывают тесты:
//   — moveContentItem() переносит элемент ОДНОЙ транзакцией по store books;
//   — принудительный abort на втором put (target) → reject И ROLLBACK
//     первого put (source): элемент остаётся в исходной книге,
//     в target ничего не появляется;
//   — легитимные no-op/«не найдено» возвращают false и НЕ трогают данные:
//     перенос в ту же книгу, отсутствующая source, отсутствующая target;
//   — конфликт ID в target не дублирует элемент (replace по id);
//   — совместно с P1-5: реальный сбой IDB → reject, а не «успех».
// ═══════════════════════════════════════════════════════════════════
// @vitest-environment node
import 'fake-indexeddb/auto';
import { IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  loadBooks, moveContentItem, openDB, putBook,
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

const ITEM = (id, extra = {}) => ({ id, type: 'quote', title: 'Цитата', platform: 'youtube', status: 'idea', ...extra });

const bookWithContent = (id, title, items) => ({
  id, title, author: 'A', status: 'added', contentItems: items,
});

async function itemIds(bookId) {
  const books = await loadBooks();
  return ((books.find(b => b.id === bookId) || {}).contentItems || []).map(c => c.id);
}

// ═══════════════════════════════════════════════════
//  УСПЕШНЫЙ ПЕРЕНОС / NO-OP / NOT FOUND
// ═══════════════════════════════════════════════════
describe('P1-7: базовый контракт moveContentItem()', () => {
  it('успешный перенос: элемент удаляется из source и появляется в target (одна операция)', async () => {
    await putBook(bookWithContent('b1', 'Источник', [ITEM('ci1', { title: 'Старая' }), ITEM('ci2')]));
    await putBook(bookWithContent('b2', 'Приёмник', []));

    const ok = await moveContentItem('b1', 'b2', 'ci1', ITEM('ci1', { title: 'Новая', status: 'planned' }));
    expect(ok).toBe(true);

    const books = await loadBooks();
    const src = books.find(b => b.id === 'b1');
    const dst = books.find(b => b.id === 'b2');
    expect(src.contentItems.map(c => c.id)).toEqual(['ci2']);
    expect(dst.contentItems.map(c => c.id)).toEqual(['ci1']);
    expect(dst.contentItems[0]).toMatchObject({ id: 'ci1', title: 'Новая', status: 'planned' });
  });

  it('перенос без contentData: переносится существующий элемент как есть', async () => {
    await putBook(bookWithContent('b1', 'Источник', [ITEM('ci1', { notes: 'x' })]));
    await putBook(bookWithContent('b2', 'Приёмник', []));

    expect(await moveContentItem('b1', 'b2', 'ci1')).toBe(true);
    expect(await itemIds('b1')).toEqual([]);
    expect(await itemIds('b2')).toEqual(['ci1']);
  });

  it('перенос в ту же книгу → false (no-op), данные не меняются', async () => {
    await putBook(bookWithContent('b1', 'Книга', [ITEM('ci1')]));
    expect(await moveContentItem('b1', 'b1', 'ci1')).toBe(false);
    expect(await itemIds('b1')).toEqual(['ci1']);
  });

  it('отсутствующая source-книга → false (не reject), target не тронут', async () => {
    await putBook(bookWithContent('b2', 'Приёмник', []));
    expect(await moveContentItem('nope', 'b2', 'ci1')).toBe(false);
    expect(await itemIds('b2')).toEqual([]);
  });

  it('отсутствующий элемент в source → false (не reject)', async () => {
    await putBook(bookWithContent('b1', 'Источник', [ITEM('ci1')]));
    await putBook(bookWithContent('b2', 'Приёмник', []));
    expect(await moveContentItem('b1', 'b2', 'missing')).toBe(false);
    expect(await itemIds('b1')).toEqual(['ci1']);
    expect(await itemIds('b2')).toEqual([]);
  });

  it('отсутствующая target-книга (не «__no_book__») → false, source НЕ изменён', async () => {
    await putBook(bookWithContent('b1', 'Источник', [ITEM('ci1')]));
    expect(await moveContentItem('b1', 'nope', 'ci1')).toBe(false);
    expect(await itemIds('b1')).toEqual(['ci1']);
  });
});

// ═══════════════════════════════════════════════════
//  КОНФЛИКТ ID / СПЕЦ-КНИГА БЕЗ КНИГИ
// ═══════════════════════════════════════════════════
describe('P1-7: конфликт ID и перенос в «__no_book__»', () => {
  it('конфликт ID в target: элемент заменяется, дубликат не создаётся', async () => {
    await putBook(bookWithContent('b1', 'Источник', [ITEM('ci1', { title: 'V1' })]));
    await putBook(bookWithContent('b2', 'Приёмник', [ITEM('ci1', { title: 'Старый' }), ITEM('ci9')]));

    expect(await moveContentItem('b1', 'b2', 'ci1', ITEM('ci1', { title: 'V2' }))).toBe(true);

    const books = await loadBooks();
    const src = books.find(b => b.id === 'b1');
    const dst = books.find(b => b.id === 'b2');
    expect(src.contentItems.map(c => c.id)).toEqual([]);
    const dstCi1 = dst.contentItems.filter(c => c.id === 'ci1');
    expect(dstCi1.length).toBe(1); // ровно один экземпляр — не дубликат
    expect(dstCi1[0].title).toBe('V2');
    // порядок после replace по id: stale ci1 был удалён, новый добавлен в конец
    expect(dst.contentItems.map(c => c.id).sort()).toEqual(['ci1', 'ci9']);
  });

  it('перенос в «__no_book__»: спец-книга создаётся атомарно, если её ещё нет', async () => {
    await putBook(bookWithContent('b1', 'Источник', [ITEM('ci1')]));
    expect(await moveContentItem('b1', '__no_book__', 'ci1')).toBe(true);
    expect(await itemIds('b1')).toEqual([]);
    expect(await itemIds('__no_book__')).toEqual(['ci1']);
  });
});

// ═══════════════════════════════════════════════════
//  АТОМАРНОСТЬ: abort между put ⇒ ROLLBACK обоих put
// ═══════════════════════════════════════════════════
describe('P1-7: атомарность — при сбое нет double-set и потери элемента', () => {
  it('abort на ВТОРОМ put (target) → reject, ROLLBACK первого put: элемент остаётся в source', async () => {
    await putBook(bookWithContent('b1', 'Источник', [ITEM('ci1')]));
    await putBook(bookWithContent('b2', 'Приёмник', []));

    // первый put — source (уже выполнен внутри tx), второй put — target → abort
    abortOn('put', 2);
    await expect(moveContentItem('b1', 'b2', 'ci1', ITEM('ci1'))).rejects.toThrow();

    // rollback: source не потерял элемент, target пуст — элемент ни в двух, ни ни в одной
    const books = await loadBooks();
    const src = books.find(b => b.id === 'b1');
    const dst = books.find(b => b.id === 'b2');
    expect(src.contentItems.map(c => c.id)).toEqual(['ci1']);
    expect(dst.contentItems.map(c => c.id)).toEqual([]);
  });

  it('abort на ПЕРВОМ put (source) → reject, ничего не записано', async () => {
    await putBook(bookWithContent('b1', 'Источник', [ITEM('ci1')]));
    await putBook(bookWithContent('b2', 'Приёмник', []));

    abortOn('put', 1);
    await expect(moveContentItem('b1', 'b2', 'ci1', ITEM('ci1'))).rejects.toThrow();

    expect(await itemIds('b1')).toEqual(['ci1']);
    expect(await itemIds('b2')).toEqual([]);
  });

  it('после abort повторный перенос работает корректно (состояние БД консистентно)', async () => {
    await putBook(bookWithContent('b1', 'Источник', [ITEM('ci1')]));
    await putBook(bookWithContent('b2', 'Приёмник', []));

    abortOn('put', 2);
    await expect(moveContentItem('b1', 'b2', 'ci1')).rejects.toThrow();

    // патч прототипа — только для симуляции сбоя; в реальной БД его нет.
    // Восстанавливаем оригинал, чтобы следующий перенос работал штатно.
    restoreProtos();

    const ok = await moveContentItem('b1', 'b2', 'ci1');
    expect(ok).toBe(true);
    expect(await itemIds('b1')).toEqual([]);
    expect(await itemIds('b2')).toEqual(['ci1']);
  });
});