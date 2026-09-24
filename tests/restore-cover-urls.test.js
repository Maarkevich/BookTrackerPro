// ═══════════════════════════════════════════════════════════════
//  P2-8: Startup N+1 covers — app.js restoreCoverUrls (jsdom env)
//
//  Здесь проверяется СТАРТОВЫЙ ПУТЬ app.js: restoreCoverUrls() раньше
//  вызывала getCover() на каждую книгу → N транзакций на старте.
//  Теперь она вызывает loadCovers() один раз (batch).
//
//  jsdom-ограничение fake-indexeddb: настоящий Blob клонируется в {},
//  поэтому для проверки МАППИНГА «какая книга получила какую обложку»
//  в store кладутся имитации blob с уникальным size — loadCovers()
//  возвращает их как есть, а подменённый URL.createObjectURL кодирует
//  size в url. Перепутанная обложка дала бы другой url.
//
//  Проверки:
//    — 1000 книг: ровно ОДНА транзакция covers (счётчик), все книги
//      получили url, соответствующий ИХ обложке (не чужой);
//    — книга без обложки: coverUrl не выставляется / устаревший blob:
//      очищается; внешняя https-ссылка не трогается;
//    — кэш _coverUrlCache: повторный restoreCoverUrls — 0 транзакций
//      и те же url (object URL не плодятся).
// ═══════════════════════════════════════════════════════════════
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBDatabase } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDB } from '../db.js';
import { restoreCoverUrls } from '../app.js';

const origCreate = URL.createObjectURL;
const _orig = {};

beforeEach(async () => {
  const db = await openDB();
  const names = Array.from({ length: db.objectStoreNames.length }, (_, i) => db.objectStoreNames.item(i));
  await new Promise((resolve) => {
    const tx = db.transaction(names, 'readwrite');
    for (const st of names) tx.objectStore(st).clear();
    tx.oncomplete = resolve;
  });
  URL.createObjectURL = (blob) => 'blob:test-' + ((blob && blob.size !== undefined) ? blob.size : 'none');
  URL.revokeObjectURL = () => {};
});

afterEach(() => {
  URL.createObjectURL = origCreate;
  if (_orig.transaction) { IDBDatabase.prototype.transaction = _orig.transaction; delete _orig.transaction; }
});

/** N имитаций blob (уникальный size 200+i) одной транзакцией. */
async function seedCovers(n, prefix = 'b') {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('covers', 'readwrite');
    const store = tx.objectStore('covers');
    for (let i = 0; i < n; i++) {
      store.put({ bookId: prefix + i, blob: { size: 200 + i, type: 'image/png' }, savedAt: Date.now() });
    }
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function countCoversTransactions(fn) {
  const orig = IDBDatabase.prototype.transaction;
  let count = 0;
  IDBDatabase.prototype.transaction = function (...args) {
    const names = Array.isArray(args[0]) ? args[0] : [args[0]];
    if (names.includes('covers')) count++;
    return orig.apply(this, args);
  };
  _orig.transaction = orig;
  try {
    await fn();
  } finally {
    IDBDatabase.prototype.transaction = orig;
  }
  return count;
}

const makeBook = (id, coverUrl = '') => ({
  id, title: 'Книга ' + id, author: 'A', status: 'added',
  dateAdded: '2026-01-01T00:00:00.000Z', coverUrl,
});

describe('P2-8: restoreCoverUrls — batch на старте (app.js)', () => {
  it('1000 книг: ОДНА транзакция (не 1000), каждая книга получает свою обложку', async () => {
    await seedCovers(1000);
    const books = Array.from({ length: 1000 }, (_, i) => makeBook('b' + i));
    const txs = await countCoversTransactions(async () => {
      await restoreCoverUrls(books);
    });
    // Раньше здесь было 1000 транзакций getCover; теперь — одна loadCovers.
    expect(txs).toBe(1);
    for (let i = 0; i < 1000; i++) {
      expect(books[i].coverUrl).toBe('blob:test-' + (200 + i));
    }
  });

  it('книга БЕЗ локальной обложки: coverUrl не выставляется, устаревший blob: очищается, внешняя ссылка не трогается', async () => {
    await seedCovers(1);
    const books = [
      makeBook('k0', 'blob:устаревшая-обложка'),
      makeBook('k1', 'https://example.com/cover.jpg'),
      makeBook('k2'),
    ];
    await restoreCoverUrls(books);
    expect(books[0].coverUrl).toBe('');                                  // мёртвая blob:-ссылка очищена
    expect(books[1].coverUrl).toBe('https://example.com/cover.jpg');     // внешняя не тронута
    expect(books[2].coverUrl).toBe('');                                  // нет обложки — пусто
  });

  it('кэш: повторный вызов — 0 транзакций и те же url (object URL не плодятся)', async () => {
    await seedCovers(50, 'c'); // обложки ровно для книг c0..c49, иначе кэш не заполнится
    const books = Array.from({ length: 50 }, (_, i) => makeBook('c' + i));
    const first = await countCoversTransactions(async () => restoreCoverUrls(books));
    const urlsAfterFirst = books.map((b) => b.coverUrl);
    const second = await countCoversTransactions(async () => restoreCoverUrls(books));
    expect(first).toBe(1);
    expect(second).toBe(0); // всё из кэша — ни одной транзакции
    expect(books.map((b) => b.coverUrl)).toEqual(urlsAfterFirst);
  });

  it('0 книг / пустой список: не падает и не открывает транзакций', async () => {
    await seedCovers(10);
    const txs = await countCoversTransactions(async () => {
      await restoreCoverUrls([]);
    });
    expect(txs).toBe(0);
    await expect(restoreCoverUrls(undefined)).resolves.toBeUndefined();
  });
});