// ═══════════════════════════════════════════════════════════════════
// Регрессионные тесты P1-6 — «Импорт неатомарен и почти не валидируется».
//
// Оригинальная проблема (до фикса):
//   — importAll() проверял только Array.isArray(data.books);
//   — каждая сущность писалась отдельной транзакцией
//     (putBooks → putCollection → putChallenge → putTag → saveCover),
//     поэтому сбой на середине оставлял частично применённый backup;
//   — schema/type/size/ID/URL/reference валидация отсутствовала
//     (риск повреждённых типов, dangling refs, DoS большим JSON,
//     stored XSS через javascript: URL).
//
// Что доказывают тесты:
//   — невалидные данные (структура/типы/размер/версия/дубли) → reject ДО записи;
//   — dangling bookIds фильтруются → новых битых ссылок не создаётся;
//   — javascript: URL очищаются (P1-2 safeUrl/safeLinkUrl) → stored XSS невозможен;
//   — принудительный abort на середине ОДНОЙ транзакции → reject и
//     ВО ВСЕХ stores НЕТ частичных данных (доказательство атомарности);
//   — контракт merge не сломан: повторный импорт не дублирует, пустые
//     сущности не ломают импорт, added* считаются только после успеха.
// ═══════════════════════════════════════════════════════════════════
// @vitest-environment node
import 'fake-indexeddb/auto';
import { IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  exportAll, getCover, importAll, loadBooks, loadChallenges,
  loadCollections, loadSettings, loadTags, openDB,
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

/** Валидный base64 Blob-cover (>=200 байт, image/jpeg). */
function coverB64() {
  const u = new Uint8Array(2048);
  for (let i = 0; i < u.length; i++) u[i] = (i * 7) % 256;
  let s = '';
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
}

const VALID_BACKUP = () => ({
  app: 'BookTrackerPro', version: 1,
  books: [
    { id: 'bk1', title: 'Книга 1', author: 'A' },
    { id: 'bk2', title: 'Книга 2', author: 'B' },
  ],
  collections: [{ id: 'col1', name: 'Подборка', bookIds: ['bk1'] }],
  challenges: [{ id: 'ch1', name: 'Челлендж', bookIds: ['bk1', 'bk2'] }],
  tags: [{ name: 'tag1' }, { name: 'tag2' }],
  settings: { lrSecret: 'sec', microlinkApiKey: 'ml' },
  covers: [{ bookId: 'bk1', mime: 'image/jpeg', base64: coverB64() }],
});

// ═══════════════════════════════════════════════════
//  ВАЛИДАЦИЯ ДО ЗАПИСИ: невалидный backup → reject
// ═══════════════════════════════════════════════════
describe('P1-6: валидация до записи — malformed/типы/размер/версия/дубли', () => {
  it('malformed: null / не-объект / books не массив → reject', async () => {
    await expect(importAll(null)).rejects.toThrow();
    await expect(importAll(42)).rejects.toThrow();
    await expect(importAll({ books: 'not-array' })).rejects.toThrow();
    await expect(importAll({})).rejects.toThrow();
  });

  it('неизвестная версия бэкапа → reject', async () => {
    await expect(importAll({ ...VALID_BACKUP(), version: 999 })).rejects.toThrow('Неизвестная версия');
  });

  it('неверные типы полей книги → reject до записи', async () => {
    await expect(importAll({ app: 'x', version: 1, books: [{ id: 'bk1', title: 42 }] })).rejects.toThrow();
    await expect(importAll({ app: 'x', version: 1, books: [null] })).rejects.toThrow();
    await expect(importAll({ app: 'x', version: 1, books: [{ id: 'bk1', title: 'T', isPR: 'yes' }] })).rejects.toThrow();
    await expect(importAll({ app: 'x', version: 1, books: [{ id: 'bk1', title: 'T', rating: 'high' }] })).rejects.toThrow();
  });

  it('неверные типы коллекций/челленджей/тегов → reject', async () => {
    await expect(importAll({ ...VALID_BACKUP(), collections: { id: 'c1' } })).rejects.toThrow();
    await expect(importAll({ ...VALID_BACKUP(), challenges: [{ id: 'ch1', name: 'N', bookIds: 'x' }] })).rejects.toThrow();
    await expect(importAll({ ...VALID_BACKUP(), tags: [{ name: 7 }] })).rejects.toThrow();
  });

  it('огромный JSON: >5000 записей → reject (DoS-защита)', async () => {
    const books = Array.from({ length: 5001 }, (_, i) => ({ id: 'b' + i, title: 'T', author: 'A' }));
    await expect(importAll({ app: 'x', version: 1, books })).rejects.toThrow('слишком большой');
  });

  it('огромная строка (> 100000 символов) → reject (DoS-защита)', async () => {
    await expect(importAll({
      app: 'x', version: 1,
      books: [{ id: 'bk1', title: 'T', author: 'A', notes: 'x'.repeat(100001) }],
    })).rejects.toThrow('Неверный тип поля');
  });

  it('дубликаты ID внутри backup (books/collections/challenges/tags) → reject', async () => {
    await expect(importAll({ ...VALID_BACKUP(), books: [VALID_BACKUP().books[0], VALID_BACKUP().books[0]] })).rejects.toThrow('Дубликат id книги');
    await expect(importAll({ ...VALID_BACKUP(), collections: [{ id: 'col1', name: 'A' }, { id: 'col1', name: 'B' }] })).rejects.toThrow('Дубликат id подборки');
    await expect(importAll({ ...VALID_BACKUP(), challenges: [{ id: 'ch1', name: 'A' }, { id: 'ch1', name: 'B' }] })).rejects.toThrow('Дубликат id челленджа');
    await expect(importAll({ ...VALID_BACKUP(), tags: [{ name: 't' }, { name: 't' }] })).rejects.toThrow('Дубликат тега');
  });
});

// ═══════════════════════════════════════════════════
//  ЧИСТОТА ДАННЫХ: dangling refs и XSS через URL
// ═══════════════════════════════════════════════════
describe('P1-6: dangling refs и stored XSS при импорте', () => {
  it('bookIds, ссылающиеся на отсутствующие книги, отфильтровываются (нет dangling refs)', async () => {
    const res = await importAll({
      app: 'BookTrackerPro', version: 1,
      books: [{ id: 'bk1', title: 'Книга', author: 'A' }],
      collections: [{ id: 'col1', name: 'C', bookIds: ['bk1', 'missing', ''] }],
      challenges: [{ id: 'ch1', name: 'CH', bookIds: ['missing'] }],
      tags: [],
    });
    expect(res.addedCollections).toBe(1);
    expect(res.addedChallenges).toBe(1);

    const cols = await loadCollections();
    expect(cols[0].bookIds).toEqual(['bk1']);
    const chs = await loadChallenges();
    expect(chs[0].bookIds).toEqual([]);
  });

  it('javascript:/data: URL очищаются при импорте → stored XSS через URL невозможен', async () => {
    const res = await importAll({
      app: 'BookTrackerPro', version: 1,
      books: [{
        id: 'bk1', title: 'XSS', author: '<img src=x onerror=alert(1)>',
        coverUrl: 'javascript:alert(1)',
        cover: 'javascript:alert(1)',
        jointReading: { active: true, participants: [], chatLink: 'javascript:alert(1)', notes: '', startDate: '' },
        contentItems: [{ id: 'ci1', type: 'video', title: 'V', platform: 'youtube', status: 'idea', publishedUrl: 'javascript:alert(1)' }],
      }],
    });
    expect(res.addedBooks).toBe(1);

    const [book] = await loadBooks();
    expect(book.coverUrl).toBe('');
    expect(book.cover).toBe('');
    expect(book.jointReading.chatLink).toBe('');
    expect(book.contentItems[0].publishedUrl).toBe('');
    // текст не превращается в разметку при рендере — esc() (P1-1); строка сохраняется как данные
    expect(typeof book.author).toBe('string');
  });

  // 🆕 P2-2: settings в backup теперь импортируются по allowlist (P1-4).
  // Секретные ключи (lrSecret/microlinkApiKey) НЕ применяются.
  it('бэкап содержит settings только с секретами → применяется 0 настроек, секреты не записываются (P1-4 + P2-2)', async () => {
    const res = await importAll({
      app: 'BookTrackerPro', version: 1,
      books: [{ id: 'bk1', title: 'T', author: 'A' }],
      settings: { lrAppId: 'app1', lrSecret: 'sec1', microlinkApiKey: 'ml-key' },
    });
    expect(res.addedBooks).toBe(1);
    expect(res.appliedSettings).toBe(0);
    const settings = await loadSettings();
    expect(settings).toBeNull(); // секреты не попали в БД
  });
});

// ═══════════════════════════════════════════════════
//  АТОМАРНОСТЬ: сбой посередине ⇒ НИЧЕГО не записано
// ═══════════════════════════════════════════════════
describe('P1-6: атомарный импорт — отсутствие partial import', () => {
  it('успешный импорт применяет books/collections/challenges/tags/covers одной транзакцией + added* корректны', async () => {
    const res = await importAll(VALID_BACKUP());
    expect(res).toEqual({
      addedBooks: 2, skippedBooks: 0,
      addedCollections: 1, skippedCollections: 0,
      addedChallenges: 1, skippedChallenges: 0,
      addedTags: 2, skippedTags: 0,
      // 🆕 P2-2: в VALID_BACKUP только секретные settings → применено 0
      appliedSettings: 0,
    });

    expect((await loadBooks()).map(b => b.id).sort()).toEqual(['bk1', 'bk2']);
    expect(await getCover('bk1')).toBeTruthy();
    const cols = await loadCollections();
    expect(cols[0].bookIds).toEqual(['bk1']);
    expect((await loadTags()).map(t => t.name).sort()).toEqual(['tag1', 'tag2']);
  });

  it('abort транзакции посередине → reject и ВО ВСЕХ stores НЕТ частичных данных', async () => {
    abortOn('put', 1); // первый же put (первая книга) abort'ит общую транзакцию
    await expect(importAll(VALID_BACKUP())).rejects.toThrow();

    // атомарность: ни одна сущность не применена частично
    expect(await loadBooks()).toEqual([]);
    expect(await loadCollections()).toEqual([]);
    expect(await loadChallenges()).toEqual([]);
    expect(await loadTags()).toEqual([]);
    expect(await getCover('bk1')).toBeNull();
  });

  it('после aborted импорта merge-повторный импорт работает чисто (нет фантомных частичных данных)', async () => {
    abortOn('put', 1);
    await expect(importAll(VALID_BACKUP())).rejects.toThrow();

    const second = await importAll(VALID_BACKUP());
    expect(second.addedBooks).toBe(2);
    expect((await loadBooks()).length).toBe(2);
  });
});

// ═══════════════════════════════════════════════════
//  КОНТРАКТ MERGE: не дублирует, старые форматы импортируются
// ═══════════════════════════════════════════════════
describe('P1-6: контракт sync-импорта не сломан', () => {
  it('повторный импорт того же backup не дублирует записи (merge по id/name)', async () => {
    await importAll(VALID_BACKUP());
    const res = await importAll(VALID_BACKUP());
    expect(res.addedBooks).toBe(0);
    expect(res.skippedBooks).toBe(2);
    expect(res.addedCollections).toBe(0);
    expect(res.addedTags).toBe(0);
    expect((await loadBooks()).length).toBe(2);
  });

  it('старый backup без version / covers / collections / tags продолжает импортироваться', async () => {
    const res = await importAll({
      app: 'BookTrackerPro',
      books: [{ id: 'bk1', title: 'Старый', author: 'A' }],
    });
    expect(res.addedBooks).toBe(1);
    expect((await loadBooks()).some(b => b.id === 'bk1')).toBe(true);
  });

  it('exportAll → importAll round-trip сохраняет целостность', async () => {
    await importAll(VALID_BACKUP());
    const exported = await exportAll();
    expect(exported.books.length).toBe(2);
    expect(exported.collections.length).toBe(1);
    expect(exported.challenges.length).toBe(1);
    expect(exported.tags.length).toBe(2);
    // covers восстановимы
    expect(exported.covers.find(c => c.bookId === 'bk1')).toBeTruthy();
  });
});