// ═══════════════════════════════════════════════════════════════════
// Регрессионные тесты P2-3 — «Duplicate IDs внутри backup».
//
// Проблема (из AUDIT): дубликаты ID/name входного backup проходили
// как новые записи — Set существующих не обновлялся во время
// фильтрации newBooks/newCols/newChallenges/newTags, из-за чего более
// поздняя запись молча перезаписывала раннюю, а summary added* был
// неверным.
//
// Минимальное решение (реализовано в importAll): уникальность ключей
// входного backup валидируется ДО транзакции (validateImport* c seen
// Set) и файл ОТКЛОНЯЕТСЯ целиком.
//
// Что доказывают тесты:
//   — 2 и 3 одинаковых book/collection/challenge ID → reject;
//   — 2 и 3 одинаковых tag name → reject;
//   — case policy tags: 'T' и 't' — РАЗНЫЕ теги (keyPath name
//     case-sensitive), импорт не отклоняется, оба записываются;
//   — при отказе на дубле НИЧЕГО из файла не записано
//     (включая уникальные книги) — validate до транзакции;
//   — файл с дублем id, где часть id уже существует в БД,
//     всё равно отклоняется (битый файл ≠ sync);
//   — summary корректны для чистого файла без дублей.
// ═══════════════════════════════════════════════════════════════════
// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importAll, loadBooks, loadCollections, loadChallenges, loadTags, openDB, putBook } from '../db.js';

async function clearDB() {
  const db = await openDB();
  const names = Array.from({ length: db.objectStoreNames.length }, (_, i) => db.objectStoreNames.item(i));
  await new Promise((resolve) => {
    const tx = db.transaction(names, 'readwrite');
    for (const st of names) tx.objectStore(st).clear();
    tx.oncomplete = resolve;
  });
}

const BOOK = (id, title = 'Книга') => ({ id, title, author: 'A' });
const COLS = (id, name = 'C') => ({ id, name, bookIds: [] });
const CHS = (id, name = 'CH') => ({ id, name, bookIds: [] });
const TAGS = (name) => ({ name });

const MIN_BACKUP = (books = [], cols = [], chs = [], tags = [], settings = {}) => ({
  app: 'BookTrackerPro',
  version: 1,
  books, collections: cols, challenges: chs, tags, settings, covers: [],
});

beforeEach(clearDB)

// ═══════════════════════════════════════════════
//  ДУБЛИКАТЫ ID → файл ОТКЛОНЯЕТСЯ ДО ЗАПИСИ
// ═══════════════════════════════════════════════
describe('P2-3: дубликаты ID внутри backup → reject', () => {
  it('две одинаковые книги → reject', async () => {
    await expect(importAll(MIN_BACKUP([BOOK('b1'), BOOK('b1')]))).rejects.toThrow('Дубликат id книги');
  });

  it('три одинаковые книги → reject', async () => {
    await expect(importAll(MIN_BACKUP([BOOK('b1'), BOOK('b2'), BOOK('b1')]))).rejects.toThrow('Дубликат id книги');
  });

  it('две одинаковые подборки → reject', async () => {
    await expect(importAll(MIN_BACKUP([BOOK('b1')], [COLS('c1'), COLS('c1')]))).rejects.toThrow('Дубликат id подборки');
  });

  it('три одинаковых челленджа → reject', async () => {
    await expect(importAll(MIN_BACKUP([BOOK('b1')], [], [CHS('ch1'), CHS('ch1'), CHS('ch1')]))).rejects.toThrow('Дубликат id челленджа');
  });

  it('два одинаковых тега → reject', async () => {
    await expect(importAll(MIN_BACKUP([], [], [], [TAGS('t'), TAGS('t')]))).rejects.toThrow('Дубликат тега');
  });

  it('множественный дубль тегов (t, T, t) → reject по точному повтору', async () => {
    await expect(importAll(MIN_BACKUP([], [], [], [TAGS('t'), TAGS('T'), TAGS('t')]))).rejects.toThrow('Дубликат тега');
  });

  it('файл с дублем id, где часть id уже есть в БД → reject (битый файл ≠ sync)', async () => {
    await putBook(BOOK('b1', 'Существующая'));
    await expect(importAll(MIN_BACKUP([BOOK('b1'), BOOK('b1')]))).rejects.toThrow('Дубликат id книги');
    // существующая книга не тронута
    const books = await loadBooks();
    expect(books.map(b => b.id)).toEqual(['b1']);
    expect(books[0].title).toBe('Существующая');
  });
});

// ═══════════════════════════════════════════════
//  ОТКАЗ НА ДУБЛЕ ⇒ НИЧЕГО НЕ ЗАПИСАНО (атомарность)
// ═══════════════════════════════════════════════
describe('P2-3: отказ на дубле не оставляет partial import', () => {
  it('уникальная книга + дубль других записей ⇒ reject и НИ ОДНОЙ новой записи', async () => {
    const backup = MIN_BACKUP(
      [BOOK('b1'), BOOK('b2')],
      [],
      [CHS('ch1'), CHS('ch1')], // дубль челленджа — валидация после книг
    );
    await expect(importAll(backup)).rejects.toThrow('Дубликат id челленджа');
    // b1/b2 НЕ записаны — reject произошёл ДО транзакции
    expect(await loadBooks()).toEqual([]);
    expect(await loadChallenges()).toEqual([]);
  });
});

// ═══════════════════════════════════════════════
//  CASE POLICY ДЛЯ ТЕГОВ + КОНТРАКТ ИТОГОВ
// ═══════════════════════════════════════════════
describe('P2-3: case policy tags и корректные summary без дублей', () => {
  it("теги 'T' и 't' — РАЗНЫЕ (case-sensitive keyPath name), импорт успешен", async () => {
    const res = await importAll(MIN_BACKUP([BOOK('b1')], [], [], [TAGS('T'), TAGS('t')]));
    expect(res.addedTags).toBe(2);
    const tags = await loadTags();
    expect(tags.map(t => t.name).sort()).toEqual(['T', 't']);
  });

  it('чистый файл без дублей: summary added* и persisted OK', async () => {
    const res = await importAll(MIN_BACKUP(
      [BOOK('b1'), BOOK('b2')],
      [COLS('c1')],
      [CHS('ch1')],
      [TAGS('t1'), TAGS('t2')],
    ));
    expect(res.addedBooks).toBe(2);
    expect(res.addedCollections).toBe(1);
    expect(res.addedChallenges).toBe(1);
    expect(res.addedTags).toBe(2);
    expect((await loadBooks()).map(b => b.id).sort()).toEqual(['b1', 'b2']);
    expect(await loadCollections()).toHaveLength(1);
    expect(await loadChallenges()).toHaveLength(1);
    expect(await loadTags()).toHaveLength(2);
  });

  it('повторный импорт чистого файла (merge): дублей не создаётся', async () => {
    const backup = MIN_BACKUP([BOOK('b1')], [COLS('c1')], [CHS('ch1')], [TAGS('t1')]);
    await importAll(backup);
    const res = await importAll(backup);
    expect(res.addedBooks).toBe(0);
    expect(res.skippedBooks).toBe(1);
    expect((await loadBooks()).length).toBe(1);
  });
});