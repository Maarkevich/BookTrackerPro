// ═══════════════════════════════════════════════════════════════════
// Регрессионные тесты P1-3 — экспорт/импорт Blob-обложек.
// Проверяют РЕАЛЬНЫЕ функции db.js через fake-indexeddb:
//   exportAll/importAll/saveCover/getCover/loadBooks/putBook.
//
// Окружение node: Blob-обложки в IDB клонируются нативным
// structuredClone; jsdom-овый Blob им не сериализуется (plain object).
// DOM этот тест-файл не использует.
//
// Покрытие:
//   - Blob-обложка попадает в поле covers[] экспорта (base64);
//   - байты Blob переживают base64-раундтрип;
//   - importAll восстанавливает Blob в covers store;
//   - после импорта обложка снова доступна (getCover/isValidCoverBlob);
//   - экспорт/импорт без обложек продолжает работать;
//   - внешний https-cover не превращается в base64;
//   - старый бэкап (без поля covers[]) импортируется;
//   - повреждённый base64 не ломает весь импорт.
// ═══════════════════════════════════════════════════════════════════
// @vitest-environment node
import 'fake-indexeddb/auto';
import { beforeEach, describe, it, expect } from 'vitest';
import {
  exportAll, importAll, saveCover, getCover, isValidCoverBlob,
  loadBooks, putBook, openDB,
} from '../db.js';

const MIME = 'image/jpeg';

// ── helpers для сравнения байтов ────────────────────────────────────
function bytesToBinary(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}
function b64FromBytes(bytes) { return btoa(bytesToBinary(bytes)); }
function makeJpegBlob(len = 4096) {
  const u = new Uint8Array(len);
  for (let i = 0; i < len; i++) u[i] = (i * 31) % 256;
  return new Blob([u], { type: MIME });
}

// чистим все store между тестами
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

describe('P1-3: exportAll() — Blob-обложки в бэкапе (db.js)', () => {
  it('локальная обложка попадает в data.covers[] как base64+mime', async () => {
    const blob = makeJpegBlob();
    await saveCover('bk1', blob);

    const data = await exportAll();
    expect(Array.isArray(data.covers)).toBe(true);
    const cover = data.covers.find(c => c.bookId === 'bk1');
    expect(cover).toBeTruthy();
    expect(cover.mime).toBe(MIME);
    expect(typeof cover.base64).toBe('string');
    expect(cover.base64.length).toBeGreaterThan(0);
  });

  it('байты Blob переживают base64-раундтрип (blob → base64 → blob)', async () => {
    const blob = makeJpegBlob(8192);
    await saveCover('bk2', blob);

    const data = await exportAll();
    const cover = data.covers.find(c => c.bookId === 'bk2');

    // base64 декодируем обратно и сверяем с исходными байтами
    const bin = atob(cover.base64);
    const restored = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) restored[i] = bin.charCodeAt(i);
    const original = new Uint8Array(await blob.arrayBuffer());
    expect(restored).toEqual(original);
    expect(cover.base64).toBe(b64FromBytes(original));
  });

  it('экспорт книги без локальной обложки работает: covers[] пуст', async () => {
    await putBook({ id: 'bk3', title: 'Без обложки', author: 'A' });

    const data = await exportAll();
    expect(data.books.find(b => b.id === 'bk3')).toBeTruthy();
    expect(data.covers).toEqual([]);
  });

  it('внешний https-cover не превращается в base64 (остаётся текстом)', async () => {
    await putBook({
      id: 'bk4', title: 'Внешняя', author: 'A',
      cover: 'https://example.com/cover.jpg',
      coverUrl: 'https://example.com/cover.jpg',
    });

    const data = await exportAll();
    expect(data.covers).toEqual([]);
    const exported = data.books.find(b => b.id === 'bk4');
    expect(exported.cover).toBe('https://example.com/cover.jpg');
    expect(exported.coverUrl).toBe('https://example.com/cover.jpg');
  });
});

describe('P1-3: importAll() — восстановление Blob-обложек (db.js)', () => {
  it('base64 корректно восстанавливается в Blob и сохраняется в covers store', async () => {
    const original = new Uint8Array(2048);
    for (let i = 0; i < original.length; i++) original[i] = (i * 7) % 256;
    const b64 = b64FromBytes(original);

    const res = await importAll({
      app: 'BookTrackerPro', version: 1,
      books: [{ id: 'bk5', title: 'С обложкой', author: 'A' }],
      covers: [{ bookId: 'bk5', mime: MIME, base64: b64 }],
    });
    expect(res.addedBooks).toBe(1);

    const cover = await getCover('bk5');
    expect(cover).toBeTruthy();
    expect(isValidCoverBlob(cover)).toBe(true);
    expect(cover.type).toBe(MIME);
    const restored = new Uint8Array(await cover.arrayBuffer());
    expect(restored).toEqual(original);
  });

  it('после импорта обложка доступна: getCover + loadBooks', async () => {
    const blob = makeJpegBlob();
    const b64 = b64FromBytes(new Uint8Array(await blob.arrayBuffer()));

    await importAll({
      app: 'BookTrackerPro', version: 1,
      books: [{ id: 'bk6', title: 'Книга', author: 'A' }],
      covers: [{ bookId: 'bk6', mime: MIME, base64: b64 }],
    });

    const cover = await getCover('bk6');
    expect(isValidCoverBlob(cover)).toBe(true);
    const books = await loadBooks();
    expect(books.find(b => b.id === 'bk6')).toBeTruthy();
  });

  it('старый бэкап без поля covers[] продолжает импортироваться', async () => {
    const res = await importAll({
      app: 'BookTrackerPro', version: 1,
      books: [{ id: 'bk7', title: 'Старый формат', author: 'A' }],
      collections: [],
    });
    expect(res.addedBooks).toBe(1);
    const books = await loadBooks();
    expect(books.some(b => b.id === 'bk7')).toBe(true);
  });

  it('повреждённый/некорректный base64 не ломает весь импорт', async () => {
    const goodB64 = b64FromBytes(new Uint8Array([1, 2, 3].concat(new Array(2000).fill(9))));

    const res = await importAll({
      app: 'BookTrackerPro', version: 1,
      books: [
        { id: 'bk8', title: 'С битой обложкой', author: 'A' },
        { id: 'bk9', title: 'С валидной обложкой', author: 'B' },
      ],
      covers: [
        { bookId: 'bk8', mime: MIME, base64: '@@@this-is-not-base64@@@' },
        { bookId: 'bk9', mime: MIME, base64: goodB64 },
      ],
    });

    // обе книги импортированы, битая обложка молча пропущена
    expect(res.addedBooks).toBe(2);
    expect(await getCover('bk8')).toBeNull();
    const ok = await getCover('bk9');
    expect(ok).toBeTruthy();
    expect(isValidCoverBlob(ok)).toBe(true);
  });

  it('импорт внешнего https-cover не трогает URL и не создаёт base64', async () => {
    const res = await importAll({
      app: 'BookTrackerPro', version: 1,
      books: [{
        id: 'bk10', title: 'Внешняя 2', author: 'A',
        cover: 'http://example.com/x.jpg',
        coverUrl: 'http://example.com/x.jpg',
      }],
      covers: [],
    });
    expect(res.addedBooks).toBe(1);
    const books = await loadBooks();
    const book = books.find(b => b.id === 'bk10');
    expect(book.coverUrl).toBe('http://example.com/x.jpg');
    expect(book.cover).toBe('http://example.com/x.jpg');
    expect(await getCover('bk10')).toBeNull();
  });
});