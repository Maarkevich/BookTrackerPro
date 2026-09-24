// ═══════════════════════════════════════════════════════════════
//  P2-5: Formatted ISBN search not normalized
//  Сохранённый ISBN и поисковая строка сравниваются без общей
//  нормализации: ввод с дефисами/пробелами/en/em dash/X не находил
//  нормализованную запись и наоборот → ложное «ничего не найдено».
//
//  Тест реально воспроизводит проблему через ЕДИНСТВЕННУЮ активную
//  реализацию поиска — matchesBook() из app.js (search.js мёртв).
// ═══════════════════════════════════════════════════════════════
// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { matchesBook } from '../app.js';

// Книга сохранена через cleanISBN() — нормализованная (как кладёт форма):
const CLEAN_ISBN13 = '9785170987658';
// Книга с ISBN-10, контрольный символ X в верхнем регистре:
const CLEAN_ISBN10 = '517098765X';

function makeBook(overrides = {}) {
  return {
    title: 'Тёмная башня',
    author: 'Стивен Кинг',
    isbn: CLEAN_ISBN13,
    genre: 'Фэнтези',
    publisher: 'АСТ',
    series: '',
    tags: [],
    tropes: [],
    ...overrides,
  };
}

describe('P2-5: поиск ISBN с форматированием (matchesBook из app.js)', () => {
  it('ISBN-13 с дефисами находит нормализованную запись', () => {
    expect(matchesBook(makeBook(), '978-5-17-098765-8')).toBe(true);
  });

  it('ISBN-13 с пробелами находит нормализованную запись', () => {
    expect(matchesBook(makeBook(), '978 5 17 098765 8')).toBe(true);
  });

  it('ISBN-13 с en dash (U+2013) находит нормализованную запись', () => {
    expect(matchesBook(makeBook(), '978–5–17–098765–8')).toBe(true);
  });

  it('ISBN-13 с em dash (U+2014) находит нормализованную запись', () => {
    expect(matchesBook(makeBook(), '978—5—17—098765—8')).toBe(true);
  });

  it('ISBN-13 чистыми цифрами находит нормализованную запись (контракт)', () => {
    expect(matchesBook(makeBook(), '9785170987658')).toBe(true);
  });

  it('ISBN-10 с X: ввод с дефисами и строчным x находит запись', () => {
    const book = makeBook({ isbn: CLEAN_ISBN10 });
    expect(matchesBook(book, '5-17-098765-x')).toBe(true);
  });

  it('ISBN-10 с X: ввод с пробелами находит запись', () => {
    const book = makeBook({ isbn: CLEAN_ISBN10 });
    expect(matchesBook(book, '517 098765 x')).toBe(true);
  });

  it('ISBN-10: чистые цифры с X находят запись (контракт)', () => {
    const book = makeBook({ isbn: CLEAN_ISBN10 });
    expect(matchesBook(book, '517098765X')).toBe(true);
  });

  it('обратная сторона: чистый ввод находит ФОРМАТИРОВАННУЮ запись в БД', () => {
    // В БД могла лечь "сырая" строка с разделителями (импорт/старые данные)
    const book = makeBook({ isbn: '978-5-17-098765-8' });
    expect(matchesBook(book, '9785170987658')).toBe(true);
  });

  it('частичный ISBN-ввод (начало с дефисами) находит запись', () => {
    expect(matchesBook(makeBook(), '978-5-17')).toBe(true);
  });

  it('контракт: обычный поиск по названию/автору не сломан', () => {
    expect(matchesBook(makeBook(), 'тёмная')).toBe(true);
    expect(matchesBook(makeBook(), 'кинг')).toBe(true);
    expect(matchesBook(makeBook(), 'фэнтези')).toBe(true);
  });

  it('контракт: отсутствующий ISBN не даёт ложных совпадений', () => {
    const book = makeBook({ isbn: '', title: 'Другая книга', author: '' });
    expect(matchesBook(book, '978-5-17-098765-8')).toBe(false);
  });

  it('контракт: чужой ISBN не находится (введён другой номер)', () => {
    const book = makeBook({ isbn: '9785000000001', title: 'Другая', author: '' });
    expect(matchesBook(book, '978-5-17-098765-8')).toBe(false);
  });

  it('контракт: короткий числовой запрос не ломает ISBN-поиск (подстрока)', () => {
    // не ISBN-подобный запрос (длина < 4) — работает старая подстрока
    expect(matchesBook(makeBook(), '0987658')).toBe(true);
  });
});