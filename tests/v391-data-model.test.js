// ═══════════════════════════════════════════════════════════════════
// Регрессионные тесты v3.9.1 — модель данных книги и правила импорта.
//
// Проверяют на РЕАЛЬНЫХ функциях db.js (fake-indexeddb):
//   ensureBookFields / importAll / exportAll / loadBooks / saveCover / getCover.
//
// Покрытие (спецификация v3.9.1, §6/§8/§13/§16):
//   — ensureBookFields добавляет sale/sources/расширенную price по умолчанию;
//   — доверенные значения sale/sources/price préservируются;
//   — не-доверенные priceOffers/sources/URL санитизируются (http(s), типы цен);
//   — импорт: ISBN — дополнительная проверка на дубль (другой id, тот же ISBN);
//   — импорт: отсутствующая локальная обложка дополняется; хорошая НЕ затирается;
//   — контракт не сломан: легитимные пустые значения (null/undefined/[])
//     остаются штатными.
// ═══════════════════════════════════════════════════════════════════
// @vitest-environment node
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  exportAll, ensureBookFields, getCover, importAll,
  loadBooks, openDB, saveCover, isValidCoverBlob,
  changeBookStatus, putBook, getBook,
} from '../db.js';

async function clearDB() {
  const db = await openDB();
  const names = Array.from({ length: db.objectStoreNames.length }, (_, i) => db.objectStoreNames.item(i));
  await new Promise((resolve) => {
    const tx = db.transaction(names, 'readwrite');
    for (const st of names) tx.objectStore(st).clear();
    tx.oncomplete = resolve;
  });
}
beforeEach(clearDB);

/** Валидный base64 Blob-cover (>=200 байт, image/jpeg). */
function coverB64() {
  const u = new Uint8Array(2048);
  for (let i = 0; i < u.length; i++) u[i] = (i * 7) % 256;
  let s = '';
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
}

describe('v3.9.1: ensureBookFields — новые поля по умолчанию (db.js)', () => {
  it('продажа sale{amount,currency,date,note} добавляется по умолчанию', () => {
    const book = ensureBookFields({ id: 'b1', title: 'К', author: 'A' });
    expect(book.sale).toEqual({ amount: 0, currency: 'RUB', date: '', note: '' });
  });

  it('существующая sale сохраняет значения, недостающие ключи дополняются', () => {
    const book = ensureBookFields({
      id: 'b2', title: 'К', author: 'A',
      sale: { amount: 1500, currency: 'RUB', date: '2026-10-01' },
    });
    expect(book.sale.amount).toBe(1500);
    expect(book.sale.currency).toBe('RUB');
    expect(book.sale.date).toBe('2026-10-01');
    expect(book.sale.note).toBe('');
  });

  it('отрицательная сумма продажи санитизируется в 0 (легитимный 0 сохраняется)', () => {
    const a = ensureBookFields({ id: 'b3', title: 'К', author: 'A', sale: { amount: -5, currency: 'RUB' } });
    expect(a.sale.amount).toBe(0);
    const b = ensureBookFields({ id: 'b4', title: 'К', author: 'A', sale: { amount: 0, currency: 'RUB' } });
    expect(b.sale.amount).toBe(0);
  });

  it('sources нормализуются: url/domain/type/fetchedAt/status/поля', () => {
    const book = ensureBookFields({
      id: 'b5', title: 'К', author: 'A',
      sources: [{
        url: 'javascript:alert(1)',
        type: 'publisher',
        fields: ['title', 'price'],
        warnings: ['ok'],
      }],
    });
    expect(book.sources).toHaveLength(0); // javascript:url отсекается safeLinkUrl

    const good = ensureBookFields({
      id: 'b6', title: 'К', author: 'A',
      sources: [{ url: 'https://litres.ru/book/1/', domain: 'litres.ru', type: 'shop', fetchedAt: '2026-10-01T00:00:00Z', status: 'ok', fields: ['title'], warnings: [], conflicts: [] }],
    });
    expect(good.sources).toHaveLength(1);
    expect(good.sources[0].type).toBe('shop');
    expect(good.sources[0].url).toBe('https://litres.ru/book/1/');
  });

  it('неизвестный тип источника приводится к cейфному дефолту catalog', () => {
    const book = ensureBookFields({
      id: 'b7', title: 'К', author: 'A',
      sources: [{ url: 'https://e.ru/', type: 'mystery' }],
    });
    expect(book.sources[0].type).toBe('catalog');
  });

  it('price расширяется source/label/type/url/collectedAt, недопустимый тип → unknown', () => {
    const book = ensureBookFields({
      id: 'b8', title: 'К', author: 'A',
      price: { amount: 599, currency: 'RUB', type: 'paper', source: 'ЛитРес' },
    });
    expect(book.price).toMatchObject({ amount: 599, currency: 'RUB', type: 'paper', source: 'ЛитРес' });
    expect(book.price.label).toBe('');
    expect(book.price.url).toBe('');
    expect(book.price.collectedAt).toBe('');
    const weird = ensureBookFields({
      id: 'b9', title: 'К', author: 'A',
      price: { amount: 100, currency: 'RUB', type: 'hard-cover' },
    });
    expect(weird.price.type).toBe('unknown');
  });

  it('priceOffers санитизируются: amount>0, валюта, тип из списка, дубли убираются, url безопасен', () => {
    const book = ensureBookFields({
      id: 'b10', title: 'К', author: 'A',
      priceOffers: [
        { amount: 500, currency: 'rub', type: 'ebook', source: 'ЛитРес', url: 'https://litres.ru/e/1' },
        { amount: 500, currency: 'RUB', type: 'ebook', source: 'ЛитРес', url: 'https://litres.ru/e/1' },
        { amount: 0, currency: 'RUB', type: 'paper', source: 'нет цены' },
      ],
    });
    expect(book.priceOffers).toHaveLength(1);
    expect(book.priceOffers[0].currency).toBe('RUB');
    expect(book.priceOffers[0].type).toBe('ebook');
  });
});

describe('v3.9.1: importAll — ISBN как дополнительная проверка дубля (db.js)', () => {
  it('книга с другим id и тем же ISBN не дублируется (skippedBooks=1)', async () => {
    await importAll({
      app: 'BookTrackerPro', version: 1,
      books: [{ id: 'local-1', title: 'Оригинал', author: 'A', isbn: '978-5-04-123456-7' }],
    });
    const res = await importAll({
      app: 'BookTrackerPro', version: 1,
      books: [{ id: 'import-1', title: 'Оригинал', author: 'A', isbn: '9785041234567' }],
    });
    expect(res.addedBooks).toBe(0);
    expect(res.skippedBooks).toBe(1);
    const books = await loadBooks();
    expect(books).toHaveLength(1);
    expect(books[0].id).toBe('local-1');
  });

  it('ISBN дедуп не ломает добавление книги без ISBN и книг с новым ISBN', async () => {
    await importAll({
      app: 'BookTrackerPro', version: 1,
      books: [{ id: 'a', title: 'Без ISBN', author: 'A' }],
    });
    const res = await importAll({
      app: 'BookTrackerPro', version: 1,
      books: [
        { id: 'b', title: 'Новая без ISBN', author: 'B' },
        { id: 'c', title: 'Новая с ISBN', author: 'C', isbn: '978-5-04-000000-1' },
      ],
    });
    expect(res.addedBooks).toBe(2);
    const books = await loadBooks();
    expect(books).toHaveLength(3);
  });
});

describe('v3.9.1: importAll — дополнение отсутствующей обложки (db.js)', () => {
  it('существующая книга без локальной обложки дополняется импортированной', async () => {
    await importAll({
      app: 'BookTrackerPro', version: 1,
      books: [{ id: 'bk-no-cover', title: 'Без обложки', author: 'A' }],
    });
    expect(await getCover('bk-no-cover')).toBeNull();

    const res = await importAll({
      app: 'BookTrackerPro', version: 1,
      books: [{ id: 'bk-no-cover', title: 'Без обложки', author: 'A' }],
      covers: [{ bookId: 'bk-no-cover', mime: 'image/jpeg', base64: coverB64() }],
    });
    expect(res.addedBooks).toBe(0); // по id книга НЕ дублируется
    const cover = await getCover('bk-no-cover');
    expect(isValidCoverBlob(cover)).toBe(true);
  });

  it('хорошая локальная обложка не затирается импортированной пустой', async () => {
    await importAll({
      app: 'BookTrackerPro', version: 1,
      books: [{ id: 'bk-with', title: 'С обложкой', author: 'A' }],
    });
    await saveCover('bk-with', new Blob([new Uint8Array(4096).fill(9)], { type: 'image/jpeg' }));

    await importAll({
      app: 'BookTrackerPro', version: 1,
      books: [{ id: 'bk-with', title: 'С обложкой', author: 'A' }],
      covers: [],
    });
    const cover = await getCover('bk-with');
    expect(isValidCoverBlob(cover)).toBe(true);
  });

  it('новая книга получает обложку из импорта (старый контракт сохранён)', async () => {
    const res = await importAll({
      app: 'BookTrackerPro', version: 1,
      books: [{ id: 'brand-new', title: 'Новая', author: 'A' }],
      covers: [{ bookId: 'brand-new', mime: 'image/jpeg', base64: coverB64() }],
    });
    expect(res.addedBooks).toBe(1);
    const cover = await getCover('brand-new');
    expect(isValidCoverBlob(cover)).toBe(true);
  });
});

describe('v3.9.1: контракт не сломан (db.js)', () => {
  it('exportAll переносит sale/sources/расширенную price в JSON', async () => {
    const book = ensureBookFields({
      id: 'full', title: 'Полная', author: 'A',
      isbn: '9785041111111',
      price: { amount: 649, currency: 'RUB', type: 'paper', source: 'Читай-город', url: 'https://chitai-gorod.ru/b/1' },
      sale: { amount: 900, currency: 'RUB', date: '2026-10-05', note: 'Продано на Авито' },
      sources: [{ url: 'https://chitai-gorod.ru/b/1', domain: 'chitai-gorod.ru', type: 'shop' }],
    });
    await importAll({ app: 'BookTrackerPro', version: 1, books: [book], covers: [] });

    const data = await exportAll();
    const exported = data.books.find(b => b.id === 'full');
    expect(exported.sale).toEqual({ amount: 900, currency: 'RUB', date: '2026-10-05', note: 'Продано на Авито' });
    expect(exported.sources).toHaveLength(1);
    expect(exported.price.type).toBe('paper');
    expect(exported.price.label).toBe('');
  });

  it('старая книга без новых полей проходит ensureBookFields без ошибок', () => {
    const book = ensureBookFields({
      id: 'legacy', title: 'Старая', author: 'A',
      price: { amount: 300, currency: 'RUB' },
    });
    expect(book.sale).toBeDefined();
    expect(book.sources).toEqual([]);
    expect(book.priceOffers).toEqual([]);
    expect(book.price.collectedAt).toBe('');
  });
});

describe('v3.9.1 §13: быстрая продажа через changeBookStatus(bookId, newStatus, sale)', () => {
  it('с sale: статус сменён, sale сохранён, дата подставлена, если пуста', async () => {
    await putBook(ensureBookFields({ id: 's1', title: 'К', author: 'A', status: 'added' }));
    const result = await changeBookStatus('s1', 'sold', { amount: 1500, currency: 'RUB', date: '', note: 'Авито' });
    expect(result.book.status).toBe('sold');
    expect(result.book.sale.amount).toBe(1500);
    expect(result.book.sale.currency).toBe('RUB');
    expect(result.book.sale.note).toBe('Авито');
    expect(result.book.sale.date).toBe(new Date().toISOString().slice(0, 10));
    const fromDb = await getBook('s1');
    expect(fromDb.sale.amount).toBe(1500);
  });

  it('без sale (из dropdown «Без полей»): sale по умолчанию, дата продажи = сегодня', async () => {
    await putBook(ensureBookFields({ id: 's2', title: 'К', author: 'A', status: 'reading' }));
    const result = await changeBookStatus('s2', 'sold');
    expect(result.book.status).toBe('sold');
    expect(result.book.sale).toEqual({
      amount: 0,
      currency: 'RUB',
      date: new Date().toISOString().slice(0, 10),
      note: '',
    });
  });

  it('sale с отрицательной/нечисловой суммой нормализуется в 0', async () => {
    await putBook(ensureBookFields({ id: 's3', title: 'К', author: 'A', status: 'added' }));
    const result = await changeBookStatus('s3', 'sold', { amount: -100, currency: 'RUB' });
    expect(result.book.sale.amount).toBe(0);
  });

  it('существующий sale остаётся, если новый не передан (переход на другой статус не трогает sale)', async () => {
    await putBook(ensureBookFields({
      id: 's4', title: 'К', author: 'A', status: 'sold',
      sale: { amount: 900, currency: 'USD', date: '2026-09-01', note: 'Старая' },
    }));
    const result = await changeBookStatus('s4', 'added');
    expect(result.book.status).toBe('added');
    expect(result.book.sale.amount).toBe(900); // данные продажи не стираются переходом
  });

  it('несуществующая книга → null (контракт dropdown)', async () => {
    expect(await changeBookStatus('nope', 'sold', { amount: 10 })).toBeNull();
  });
});