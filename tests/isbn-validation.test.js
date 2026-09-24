// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { validateISBN, cleanISBN, isbn10to13, isRussianISBN, formatISBN } from '../isbn.js';

// ─────────────────────────────────────────────────────────────
// P2-11: ISBN-13 без книжного префикса 978/979.
// Раньше checkISBN13() принимал ЛЮБОЙ 13-значный код с корректной
// EAN-13 checksum — товарный штрихкод (например 4006381333931, валидный
// по checksum) мог ошибочно стать ISBN и запустить нерелевантный lookup.
// Теперь после checksum для ISBN-13 обязателен префикс 978 или 979.
// ISBN-10 не меняется.
// ─────────────────────────────────────────────────────────────

describe('P2-11: ISBN-13 требует префикс 978/979', () => {
  it('валидный 978 ISBN-13 принимается (чистый код)', () => {
    expect(validateISBN('9785170987658')).toBe(true);
  });

  it('валидный 978 ISBN-13 принимается (с дефисами — как печатает пользователь)', () => {
    expect(validateISBN('978-5-17-098765-8')).toBe(true);
  });

  it('валидный 979 ISBN-13 принимается', () => {
    // 9791090636071 — корректный ISBN-13 с префиксом 979
    expect(validateISBN('9791090636071')).toBe(true);
  });

  it('checksum-valid НЕ-книжный EAN-13 (GS1-префикс 400) ОТКЛОНЯЕТСЯ', () => {
    // 4006381333931 — корректная EAN-13 checksum (проверено), но не BOOKLAND
    expect(validateISBN('4006381333931')).toBe(false);
  });

  it('checksum-valid НЕ-книжный EAN-13 (GS1-префикс 590) ОТКЛОНЯЕТСЯ', () => {
    expect(validateISBN('5901234123457')).toBe(false);
  });

  it('неверная checksum отклоняется даже с префиксом 978', () => {
    expect(validateISBN('9785170987659')).toBe(false);
  });

  it('NaN в составе — отклоняется', () => {
    expect(validateISBN('97851A0987658')).toBe(false);
  });

  it('короткий/длинный код — отклоняется', () => {
    expect(validateISBN('9785170987')).toBe(false);
    expect(validateISBN('97851709876584')).toBe(false);
  });
});

describe('P2-11: ISBN-10 не затронут', () => {
  it('ISBN-10 с контрольной X принимается', () => {
    expect(validateISBN('517098765X')).toBe(true);
  });

  it('ISBN-10 с дефисами и строчным x принимается', () => {
    expect(validateISBN('5-17-098765-x')).toBe(true);
  });

  it('ISBN-10 без контрольной X (замена) принимается', () => {
    // 0306406152 — The Fellowship of the Ring (B&C, ISBN-10)
    expect(validateISBN('0306406152')).toBe(true);
  });

  it('неверный ISBN-10 отклоняется', () => {
    expect(validateISBN('0306406153')).toBe(false);
  });
});

describe('P2-11: контракты без регрессий', () => {
  it('cleanISBN нормализует разделители и регистр X', () => {
    expect(cleanISBN('978–5–17—098765–8')).toBe('9785170987658');
    expect(cleanISBN('5-17-098765-x')).toBe('517098765X');
  });

  it('isbn10to13 строит 13-значный с префиксом 978 и валидной checksum', () => {
    const r = isbn10to13('517098765X');
    expect(r).toBe('9785170987658');
    expect(validateISBN(r)).toBe(true);
  });

  it('isRussianISBN работает на 13-значный 978-5', () => {
    expect(isRussianISBN('978-5-17-098765-8')).toBe(true);
  });

  it('formatISBN форматирует 13- и 10-значные коды (существующая разбивка 3-1-3-5-1)', () => {
    expect(formatISBN('9785170987658')).toBe('978-5-170-98765-8');
    expect(formatISBN('517098765X')).toBe('5-170-98765-X');
  });
});