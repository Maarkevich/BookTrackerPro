// ═══════════════════════════════════════════════════════════════════
// Регрессионные тесты P1-5 — «IndexedDB errors маскируются как успех».
//
// Оригинальная проблема (до фикса):
//   — request.onerror / tx.onerror разрешали `[]`/`null`/`false`,
//     поэтому сбой IndexedDB неотличим от «пусто»/«не найдено»;
//   — UI (saveBookForm, delete, статусы, теги, подборки, контент,
//     отзывы, импорт) игнорировал результат и показывал success toast,
//     а при abort транзакции Promise вообще зависал (нет onabort).
//
// Что доказывают тесты:
//   — принудительный abort транзакции (запись) → ПРОМИС ОТКЛОНЁН,
//     а не `false`/`true`; значит после `await write()` в UI строка
//     success toast недостижима;
//   — принудительный abort чтения → ПРОМИС ОТКЛОНЁН, а не `[]`/`null`;
//   — легитимные случаи «не найдено / пусто» по-прежнему НЕ считаются
//     ошибкой: get* → null, update* → false, load* с пустым store → [].
// ═══════════════════════════════════════════════════════════════════
// @vitest-environment node
import 'fake-indexeddb/auto';
import { IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addBookToChallenge, addBookToCollection, addContentToBook,
  changeBookStatus, delBook, delCollection, delTag,
  getBook, getCover, getPendingSync, importAll, loadBooks, loadChallenges,
  loadCollections, loadSettings, loadTags, openDB,
  putBook, putBooks, putChallenge, putCollection, putTag,
  removeContentFromBook, saveCover, saveReviewForBook, saveSettings,
  updateContentInBook,
} from '../db.js';

// ── утилиты принудительного сбоя IndexedDB через fake-indexeddb ──
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

const BOOK = (id, title = 'Книга') => ({ id, title, author: 'A', status: 'added' });

/** Валидный Blob-cover для saveCover (>=200 байт, image/jpeg). */
function coverBlob() {
  return new Blob([new Uint8Array(300).fill(1)], { type: 'image/jpeg' });
}

beforeEach(clearDB)
afterEach(restoreProtos)

// ═══════════════════════════════════════════════
//  ЗАПИСЬ: abort транзакции → reject, а не false/true
// ═══════════════════════════════════════════════
describe('P1-5: write failures НЕ маскируются (reject, а не boolean)', () => {
  it('putBook: при abort транзакции ПРОМИС ОТКЛОНЁН — saveBookForm не может показать «✅ Книга добавлена»', async () => {
    abortOn('put');
    await expect(putBook(BOOK('b1'))).rejects.toThrow();
  });

  it('putBooks: при abort ПРОМИС ОТКЛОНЁН — importAll не вернёт «добавлено»', async () => {
    abortOn('put');
    await expect(putBooks([BOOK('b1'), BOOK('b2')])).rejects.toThrow();
  });

  it('delBook: при abort ПРОМИС ОТКЛОНЁН — delete-обработчик не покажет «🗑️ Книга удалена»', async () => {
    await putBook(BOOK('b1'));
    abortOn('delete');
    await expect(delBook('b1')).rejects.toThrow();
  });

  it('saveSettings: при abort ПРОМИС ОТКЛОНЁН — настройки не «сохраняются» молча', async () => {
    abortOn('put');
    await expect(saveSettings({ confetti: true })).rejects.toThrow();
  });

  it('saveCover: при abort ПРОМИС ОТКЛОНЁН', async () => {
    abortOn('put');
    await expect(saveCover('b1', coverBlob())).rejects.toThrow();
  });

  it('putCollection / putChallenge / putTag: при abort ПРОМИСЫ ОТКЛОНЕНЫ', async () => {
    abortOn('put', 3);
    await expect(putCollection({ id: 'c1', name: 'C' })).rejects.toThrow();
    await expect(putChallenge({ id: 'ch1', name: 'CH' })).rejects.toThrow();
    await expect(putTag({ name: 't1' })).rejects.toThrow();
  });

  it('delCollection / delTag: при abort ПРОМИСЫ ОТКЛОНЕНЫ', async () => {
    abortOn('delete', 2);
    await expect(delCollection('c1')).rejects.toThrow();
    await expect(delTag('t1')).rejects.toThrow();
  });

  it('addContentToBook / updateContentInBook / removeContentFromBook / saveReviewForBook: при abort ПРОМИСЫ ОТКЛОНЕНЫ', async () => {
    await putBook({ ...BOOK('b1'), contentItems: [{ id: 'ci1', type: 'unboxing' }] });
    const item = { id: 'ci2', type: 'quote' };
    abortOn('put', 4);
    await expect(addContentToBook('b1', item)).rejects.toThrow();
    await expect(updateContentInBook('b1', 'ci1', { notes: 'x' })).rejects.toThrow();
    await expect(removeContentFromBook('b1', 'ci1')).rejects.toThrow();
    await expect(saveReviewForBook('b1', { rating: 5 })).rejects.toThrow();
  });

  it('addBookToCollection / addBookToChallenge: при abort ПРОМИСЫ ОТКЛОНЕНЫ', async () => {
    await putCollection({ id: 'c1', name: 'C', bookIds: [] });
    await putChallenge({ id: 'ch1', name: 'CH', bookIds: [] });
    abortOn('put', 2);
    await expect(addBookToCollection('c1', 'b1')).rejects.toThrow();
    await expect(addBookToChallenge('ch1', 'b1')).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════
//  ЧТЕНИЕ: запрос отклонён → reject, а не []/null
// ═══════════════════════════════════════════════
describe('P1-5: read failures НЕ маскируются (reject, а не []/null)', () => {
  it('loadBooks: при abort чтения ПРОМИС ОТКЛОНЁН — init/refreshData не рисует «успешно пусто»', async () => {
    abortOn('getAll');
    await expect(loadBooks()).rejects.toThrow();
  });

  it('loadCollections / loadChallenges / loadTags / getPendingSync: при abort ПРОМИСЫ ОТКЛОНЕНЫ', async () => {
    abortOn('getAll', 4);
    await expect(loadCollections()).rejects.toThrow();
    await expect(loadChallenges()).rejects.toThrow();
    await expect(loadTags()).rejects.toThrow();
    await expect(getPendingSync()).rejects.toThrow();
  });

  it('loadSettings: при abort ПРОМИС ОТКЛОНЁН', async () => {
    abortOn('get');
    await expect(loadSettings()).rejects.toThrow();
  });

  it('getBook / getCover: при abort ПРОМИСЫ ОТКЛОНЕНЫ', async () => {
    abortOn('get', 2);
    await expect(getBook('b1')).rejects.toThrow();
    await expect(getCover('b1')).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════
//  ПРИЛОЖЕНИЕ: реальные операции не «сообщают об успехе»
// ═══════════════════════════════════════════════
describe('P1-5: приложение не сообщает об успехе при сбое IndexedDB', () => {
  it('changeBookStatus: при abort записи ПРОМИС ОТКЛОНЁН → success toast недостижим', async () => {
    await putBook(BOOK('b1'));
    abortOn('put');
    await expect(changeBookStatus('b1', 'reading')).rejects.toThrow();
  });

  it('importAll: при abort записи ПРОМИС ОТКЛОНЁН → обработчик показывает ошибку, а не «📥 Добавлено: N»', async () => {
    abortOn('put');
    const backup = {
      app: 'BookTrackerPro', version: 1,
      books: [BOOK('b1'), BOOK('b2')], collections: [], challenges: [], tags: [], settings: {}, covers: [],
    };
    await expect(importAll(backup)).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════
//  КОНТРАКТ: легитимные «не найдено/пусто» НЕ ошибки
// ═══════════════════════════════════════════════
describe('P1-5: контракт не сломан — «not found»/пусто остаются штатными', () => {
  it('getBook отсутствующего ключа → null (не reject)', async () => {
    expect(await getBook('nope')).toBeNull();
  });

  it('getCover отсутствующей обложки → null (не reject)', async () => {
    expect(await getCover('nope')).toBeNull();
  });

  it('loadBooks с пустым store → [] (не reject)', async () => {
    expect(await loadBooks()).toEqual([]);
  });

  it('updateContentInBook отсутствующего контента → false (не reject), а существующего → true', async () => {
    await putBook({ ...BOOK('b1'), contentItems: [{ id: 'ci1', type: 'unboxing' }] });
    expect(await updateContentInBook('b1', 'missing', { notes: 'x' })).toBe(false);
    expect(await updateContentInBook('b1', 'ci1', { notes: 'x' })).toBe(true);
  });

  it('addContentToBook отсутствующей книги → false (не reject)', async () => {
    expect(await addContentToBook('nope', { id: 'ci1', type: 'quote' })).toBe(false);
  });

  it('putBook и успешные операции по-прежнему работают (round-trip после сбоев)', async () => {
    abortOn('put');
    await expect(putBook(BOOK('b1'))).rejects.toThrow();
    expect(await putBook(BOOK('b1'))).toBe(true);
    const books = await loadBooks();
    expect(books.map(b => b.id)).toEqual(['b1']);
  });
});