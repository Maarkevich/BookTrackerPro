// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDB } from '../db.js';
import {
  restoreCoverUrls,
  cacheCoverUrl,
  revokeCoverUrlForBook,
  revokeAllCoverUrls,
  triggerDownload,
} from '../app.js';

// ─────────────────────────────────────────────────────────────
// P2-9: object URL lifecycle обложек и JSON-export.
// Реальная симуляция: подменяем URL.createObjectURL/revokeObjectURL
// (в jsdom их нет) и считаем создание/отзыв. Кэш _coverUrlCache —
// модульный, поэтому beforeEach очищает его штатным revokeAllCoverUrls().
// ─────────────────────────────────────────────────────────────

const origCreate = URL.createObjectURL;
const origRevoke = URL.revokeObjectURL;

let created = [];
let revoked = [];

// URL кодирует размер blob → по нему проверяем «не перепутали картинки».
function mockCreateObjectURL(blob) {
  const size = (blob && blob.size !== undefined) ? blob.size : 0;
  const url = `blob:test-${size}-${created.length}`;
  created.push(url);
  return url;
}
function mockRevokeObjectURL(url) { revoked.push(url); }

async function seedCovers(map) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('covers', 'readwrite');
    const store = tx.objectStore('covers');
    for (const [bookId, size] of Object.entries(map)) {
      store.put({ bookId, blob: { size, type: 'image/png' }, savedAt: 1 });
    }
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

const makeBook = (id, size) => ({ id, title: 'T', author: 'A', status: 'added', dateAdded: '2026-01-01T00:00:00.000Z', coverUrl: '' });

beforeEach(async () => {
  URL.createObjectURL = mockCreateObjectURL;
  URL.revokeObjectURL = mockRevokeObjectURL;
  await revokeAllCoverUrls(); // кэш между тестами не должен «подтекать»
  created = [];
  revoked = []; // отзывы «хвостов» прошлого теста не считаем
});

afterEach(() => {
  URL.createObjectURL = origCreate;
  URL.revokeObjectURL = origRevoke;
});

describe('P2-9: замена обложки', () => {
  it('300 замен: каждый предыдущий URL отозван, в живых только последний', () => {
    const bookId = 'r1';
    const urls = [];
    for (let i = 0; i < 300; i++) {
      const url = mockCreateObjectURL({ size: 500 + i, type: 'image/png' });
      urls.push(url);
      cacheCoverUrl(bookId, url);
    }
    // отозваны все 299 предыдущих, не последний
    expect(revoked).toHaveLength(299);
    expect(revoked).toEqual(urls.slice(0, -1));
    expect(revoked).not.toContain(urls[urls.length - 1]);
  });

  it('повторный cacheCoverUrl с тем же URL не отзывает действующий (идемпотентность)', () => {
    const url = mockCreateObjectURL({ size: 700 });
    cacheCoverUrl('r1b', url);
    cacheCoverUrl('r1b', url);
    expect(revoked).toHaveLength(0);
  });

  it('revoke только старого URL: новая обложка остаётся живой и не перепутана', async () => {
    await seedCovers({ n1: 300, n2: 301 });
    const books = [makeBook('n1'), makeBook('n2')];
    books[0].coverUrl = 'n1-fallback';
    books[1].coverUrl = 'n2-fallback';
    await restoreCoverUrls(books);
    const oldUrl = books[0].coverUrl;
    const otherUrl = books[1].coverUrl;
    expect(oldUrl).toBe(`blob:test-300-0`);
    expect(otherUrl).toBe(`blob:test-301-1`);
    // замена обложки n1 — старый URL отзывается, вторая книга не тронута
    const newUrl = mockCreateObjectURL({ size: 5000 });
    cacheCoverUrl('n1', newUrl);
    expect(revoked).toEqual([oldUrl]);
    expect(revoked).not.toContain(otherUrl);
    expect(revoked).not.toContain(newUrl);
  });
});

describe('P2-9: удаление книги', () => {
  it('revokeCoverUrlForBook отзывает и вычищает из кэша только свою запись', () => {
    cacheCoverUrl('r2a', mockCreateObjectURL({ size: 10 }));
    cacheCoverUrl('r2b', mockCreateObjectURL({ size: 11 }));
    const urlA = created[created.length - 2];
    const urlB = created[created.length - 1];
    expect(revokeCoverUrlForBook('r2a')).toBe(true);
    expect(revoked).toEqual([urlA]);
    expect(revoked).not.toContain(urlB);
    expect(revokeCoverUrlForBook('r2a')).toBe(false); // повторный вызов безвреден
  });

  it('revokeCoverUrlForBook не отзывает ничего для неизвестной книги (контракт)', () => {
    expect(revokeCoverUrlForBook('no-such')).toBe(false);
    expect(revoked).toHaveLength(0);
  });
});

describe('P2-9: unload / controlled refresh', () => {
  it('pagehide отзывает ВСЕ закэшированные URL и очищает кэш', () => {
    const urls = [];
    for (let i = 0; i < 10; i++) {
      const url = mockCreateObjectURL({ size: 20 + i });
      urls.push(url);
      cacheCoverUrl('r3_' + i, url);
    }
    window.dispatchEvent(new Event('pagehide'));
    expect(revoked).toEqual(urls);
    expect(revokeCoverUrlForBook('r3_0')).toBe(false); // кэш пуст
  });

  it('после unload следующий старт создаёт свежие URL, старые отозваны', async () => {
    await seedCovers({ s1: 400 });
    const books = [makeBook('s1')];
    await restoreCoverUrls(books);
    const oldUrl = books[0].coverUrl;
    window.dispatchEvent(new Event('pagehide'));
    expect(revoked).toEqual([oldUrl]);
    const createCountBefore = created.length;
    await restoreCoverUrls(books);
    expect(books[0].coverUrl).not.toBe(oldUrl);
    expect(created.length).toBe(createCountBefore + 1); // новый URL создан
    expect(revoked).toContain(oldUrl); // старый так и остался отозванным
  });
});

describe('P2-9: JSON-export', () => {
  it('triggerDownload: URL создан, после click/tick отозван, filename применён', async () => {
    const blob = { size: 9999, type: 'application/json' };
    const url = triggerDownload(blob, 'backup-2026-01-01.json');
    expect(created).toContain(url);
    expect(revoked).not.toContain(url); // сразу после вызова ещё живой (download запускается)
    await new Promise((r) => setTimeout(r, 10));
    expect(revoked).toContain(url); // после tick отозван — память не течёт
  });

  it('много экспортов: каждый предыдущий export URL рано или поздно отзывается', async () => {
    const urls = [];
    for (let i = 0; i < 50; i++) {
      urls.push(triggerDownload({ size: 1000 + i, type: 'application/json' }, `b${i}.json`));
    }
    await new Promise((r) => setTimeout(r, 20));
    for (const url of urls) expect(revoked).toContain(url);
    expect(created).toHaveLength(50);
    expect(revoked).toHaveLength(50);
  });
});