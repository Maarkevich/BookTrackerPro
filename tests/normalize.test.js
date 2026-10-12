// ═══════════════════════════════════════════════════════════════════
// 🔖 3.9.1 — ЭТАП 6: AI-нормализация, кандидаты, конфликты (§3–§9).
//
// Что доказывают тесты (реальные данные, без моков логики):
//   — normalizeAiResult: сырой ответ модели (и новая §6-схема, и legacy
//     плоская) приводится к канонической схеме; мусор/выдумка не проходит:
//     пустое остаётся пустым, цены без amount отбрасываются, тип цены и
//     источника валидируются, ISBN чистится;
//   — кандидаты цен/обложек дедуплицируются; обложка из book.coverUrl
//     попадает в coverCandidates;
//   — detectConflicts: расхождение значений источников → conflict с
//     выбранным по большинству, НЕ угадывание (§6);
//   — ISBN — главный ключ (§3): источник с несовпадающим ISBN не
//     подтверждён, partitionSourcesByIsbn делит подтверждённые/отклонённые;
//   — toPreviewData: плоские поля + блоки конфликтов/источников/обложек;
//   — applyNormalizedToBook: только отмеченные поля; ровно одна цена с
//     метаданными источника (§8); источники сохраняются (§9); обложка —
//     выбранный кандидат (§10); контракт «легитимные null/[]/0» цел.
// ═══════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import {
  AI_NORMALIZE_SYSTEM,
  normalizeAiResult,
  normalizeBook,
  normalizePriceCandidate,
  normalizeCoverCandidate,
  normalizeSource,
  sourceTypeByDomain,
  isRussianSourceUrl,
  detectConflicts,
  isbnEquivalent,
  isConfirmedSource,
  partitionSourcesByIsbn,
  toPreviewData,
  applyNormalizedToBook,
} from '../normalize.js';

const NOW = '2026-10-12T00:00:00.000Z';
const ISBN13 = '9785170987658';
const ISBN13B = '9780306406157';
const ISBN10B = '0306406152';

describe('normalizeAiResult: единая схема §6', () => {
  it('нормализует полный ответ модели и чистит ISBN', () => {
    const r = normalizeAiResult({
      book: {
        title: '  Мастер и Маргарита ',
        author: 'Булгаков',
        isbn: '978-5-17-098765-8',
        publisher: 'АСТ',
        publishedDate: '2005',
        pageCount: '480',
        series: 'Русская классика',
        seriesNumber: '2',
        seriesTotal: '12',
        description: 'Роман',
        coverUrl: 'https://cdn.example.com/mim.jpg',
      },
      priceCandidates: [
        { amount: 599.456, currency: 'rub', type: 'paper', source: 'Читай-город', label: 'Печатная', url: 'https://chitai-gorod.ru/x' },
        { amount: 0, currency: 'RUB', type: 'ebook' },
        { amount: 349, currency: 'RUB', type: 'инопланетный' },
      ],
      coverCandidates: [
        { url: 'https://cdn.example.com/mim.jpg', source: 'АСТ' },
        { url: 'https://cdn.example.com/mim.jpg', source: 'дубль' },
        { url: 'notaurl' },
      ],
      sources: ['https://www.litres.ru/book/x', { url: 'https://eksmo.ru/book/y', type: 'publisher', domain: 'eksmo.ru' }],
      warnings: ['нет данных о страницах', ''],
      confidence: 82,
    }, { now: NOW });

    expect(r.book.title).toBe('Мастер и Маргарита');
    expect(r.book.isbn).toBe('9785170987658');
    expect(r.book.pageCount).toBe(480);
    expect(r.book.seriesNumber).toBe(2);
    expect(r.book.seriesTotal).toBe(12);
    expect(r.book.coverUrl).toBe('https://cdn.example.com/mim.jpg');

    // цены: округление, uppercase валюты, отброс amount<=0, невалидный тип → unknown
    expect(r.priceCandidates).toHaveLength(2);
    expect(r.priceCandidates[0]).toMatchObject({ amount: 599.46, currency: 'RUB', type: 'paper', source: 'Читай-город', label: 'Печатная' });
    expect(r.priceCandidates[1]).toMatchObject({ amount: 349, currency: 'RUB', type: 'unknown' });
    expect(r.priceCandidates[0].collectedAt).toBe(NOW);

    // обложки: дедуп, не-URL отброшен
    expect(r.coverCandidates).toHaveLength(1);
    expect(r.coverCandidates[0].url).toBe('https://cdn.example.com/mim.jpg');

    // источники: строки и объекты, тип по домену
    expect(r.sources.map((s) => s.url)).toEqual(['https://www.litres.ru/book/x', 'https://eksmo.ru/book/y']);
    expect(r.sources[0].type).toBe('shop');
    expect(r.sources[1].type).toBe('publisher');
    expect(r.sources[0].fetchedAt).toBe(NOW);

    expect(r.warnings).toEqual(['нет данных о страницах']);
    expect(r.confidence).toBeCloseTo(0.82, 5);
    expect(r.conflicts).toEqual([]);
    expect(Array.isArray(r.priceOffers)).toBe(false);
  });

  it('понимает legacy-плоский ответ (priceAmount/coverUrl/priceOffers)', () => {
    const r = normalizeAiResult({
      title: 'Т', priceAmount: 450, priceCurrency: 'eur', coverUrl: 'https://x/c.jpg',
      sourceUrls: ['https://findbook.ru/b'],
    });
    expect(r.book.title).toBe('Т');
    expect(r.priceCandidates[0]).toMatchObject({ amount: 450, currency: 'EUR' });
    expect(r.coverCandidates[0].url).toBe('https://x/c.jpg');
    expect(r.sources[0].type).toBe('catalog');
  });

  it('контракт: пустой ответ → пустые значения, confidence 0, никаких исключений', () => {
    const r = normalizeAiResult();
    expect(r.book.title).toBe('');
    expect(r.book.pageCount).toBe(0);
    expect(r.book.seriesNumber).toBeNull();
    expect(r.priceCandidates).toEqual([]);
    expect(r.coverCandidates).toEqual([]);
    expect(r.sources).toEqual([]);
    expect(r.conflicts).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.confidence).toBe(0);
  });

  it('confidence вне диапазона зажимается в 0..1', () => {
    expect(normalizeAiResult({ confidence: -5 }).confidence).toBe(0);
    expect(normalizeAiResult({ confidence: 500 }).confidence).toBe(1);
  });
});

describe('кандидаты: цена, обложка, источник', () => {
  it('normalizePriceCandidate отбрасывает не-числа и не-http url', () => {
    expect(normalizePriceCandidate(null)).toBeNull();
    expect(normalizePriceCandidate({ amount: 'abc' })).toBeNull();
    expect(normalizePriceCandidate({ amount: 100, url: 'javascript:alert(1)' }).url).toBe('');
  });

  it('normalizeCoverCandidate требует http(s)', () => {
    expect(normalizeCoverCandidate('blob:xyz')).toBeNull();
    expect(normalizeCoverCandidate({ url: 'https://x/c.jpg', width: '120' }).width).toBe(120);
  });

  it('normalizeSource вычисляет домен и тип, сохраняет originalUrl', () => {
    const s = normalizeSource({ url: 'https://chitai-gorod.ru/book/1', originalUrl: 'https://chitai-gorod.ru/book/1?utm_source=x' });
    expect(s.domain).toBe('chitai-gorod.ru');
    expect(s.type).toBe('shop');
    expect(s.originalUrl).toContain('utm_source');
    expect(s.status).toBe('ok');
  });

  it('sourceTypeByDomain / isRussianSourceUrl', () => {
    expect(sourceTypeByDomain('www.ast.ru')).toBe('publisher');
    expect(sourceTypeByDomain('rsl.ru')).toBe('library');
    expect(sourceTypeByDomain('unknown.com')).toBe('catalog');
    expect(isRussianSourceUrl('https://amazon.com/x')).toBe(false);
    expect(isRussianSourceUrl('https://www.bookvoed.ru/x')).toBe(true);
  });

  it('normalizeBook валидирует ISBN; невалидный сохраняется очищенным', () => {
    expect(normalizeBook({ isbn: '978-5-17-098765-8' }).isbn).toBe(ISBN13);
    expect(normalizeBook({ isbn: '123' }).isbn).toBe('123');
    expect(normalizeBook({ year: '1999' }).publishedDate).toBe('1999');
  });
});

describe('конфликты §6', () => {
  it('расхождение title/publisher → conflict, chosen по большинству', () => {
    const entries = [
      { source: 'eksmo.ru', fields: { title: 'Тихий Дон', publisher: 'Эксмо', isbn: ISBN13 } },
      { source: 'ast.ru', fields: { title: 'Тихий Дон', publisher: 'АСТ', isbn: ISBN13 } },
      { source: 'litres.ru', fields: { title: 'Тихий Дон', publisher: 'Эксмо', isbn: ISBN13 } },
    ];
    const conflicts = detectConflicts(entries);
    const publisher = conflicts.find((c) => c.field === 'publisher');
    expect(publisher).toBeTruthy();
    expect(publisher.chosen).toBe('Эксмо');
    expect(publisher.values.map((v) => v.value)).toEqual(['Эксмо', 'АСТ']);
    expect(conflicts.find((c) => c.field === 'title')).toBeUndefined();
  });

  it('одинаковые значения не создают конфликт; пустые игнорируются', () => {
    const conflicts = detectConflicts([
      { source: 'a', fields: { title: 'Книга', author: '' } },
      { source: 'b', fields: { title: 'Книга' } },
    ]);
    expect(conflicts).toEqual([]);
  });
});

describe('ISBN как главный ключ §3', () => {
  it('isbnEquivalent сопоставляет ISBN-10 и ISBN-13', () => {
    expect(isbnEquivalent(ISBN13B, ISBN10B)).toBe(true);
    expect(isbnEquivalent(ISBN13, ISBN10B)).toBe(false);
    expect(isbnEquivalent('', ISBN10B)).toBe(false);
  });

  it('isConfirmedSource: нет запроса → подтверждён; нет ISBN источника → нет', () => {
    expect(isConfirmedSource('', { isbn: ISBN13 })).toBe(true);
    expect(isConfirmedSource(ISBN13, { isbn: '978-5-17-098765-8' })).toBe(true);
    expect(isConfirmedSource(ISBN13, { isbn: ISBN13B })).toBe(false);
    expect(isConfirmedSource(ISBN13, { fields: {} })).toBe(false);
  });

  it('partitionSourcesByIsbn делит источники', () => {
    const { confirmed, rejected } = partitionSourcesByIsbn(ISBN13, [
      { url: 'a', isbn: ISBN13 },
      { url: 'b', isbn: ISBN13B },
      { url: 'c' },
    ]);
    expect(confirmed.map((s) => s.url)).toEqual(['a']);
    expect(rejected.map((s) => s.url)).toEqual(['b', 'c']);
  });
});

describe('toPreviewData §7', () => {
  it('готовит плоские поля, кандидатов и подтверждённые источники', () => {
    const result = normalizeAiResult({
      book: { title: 'Книга', isbn: ISBN13 },
      priceCandidates: [{ amount: 500, currency: 'RUB', type: 'paper' }, { amount: 200, currency: 'RUB', type: 'ebook' }],
      coverCandidates: [{ url: 'https://x/c.jpg' }],
      sources: [{ url: 'https://eksmo.ru/a', isbn: ISBN13 }, { url: 'https://ast.ru/b', isbn: ISBN13B }],
    }, { now: NOW });
    const p = toPreviewData(result, { queryIsbn: ISBN13 });
    expect(p.title).toBe('Книга');
    expect(p.priceAmount).toBe(500);
    expect(p.coverUrl).toBe('https://x/c.jpg');
    expect(p.priceOffers).toHaveLength(2);
    expect(p.confirmedSources).toEqual(['https://eksmo.ru/a']);
    expect(p.rejectedSources).toEqual(['https://ast.ru/b']);
    expect(p.sourceUrls).toEqual(['https://eksmo.ru/a', 'https://ast.ru/b']);
  });
});

describe('applyNormalizedToBook §7–§10', () => {
  it('применяет только отмеченные поля, ровно одну цену и сохраняет источники', () => {
    const result = normalizeAiResult({
      book: { title: 'Книга', author: 'Автор', genre: 'Роман', isbn: ISBN13, pageCount: 300, series: 'С', seriesNumber: 3, seriesTotal: 9 },
      priceCandidates: [
        { amount: 700, currency: 'RUB', type: 'paper', source: 'ЧГ', label: 'Печатная', url: 'https://chitai-gorod.ru/x' },
        { amount: 300, currency: 'RUB', type: 'ebook', source: 'Литрес' },
      ],
      sources: [{ url: 'https://eksmo.ru/a', isbn: ISBN13 }],
      coverCandidates: [{ url: 'https://x/c1.jpg' }, { url: 'https://x/c2.jpg' }],
    }, { now: NOW });

    const book = {};
    applyNormalizedToBook(book, result, {
      chosen: { title: true, author: true, price: true, cover: true },
      priceIndex: 1, coverIndex: 1,
    });

    expect(book.title).toBe('Книга');
    expect(book.author).toBe('Автор');
    expect(book.genre).toBeUndefined();
    expect(book.series).toBeUndefined();
    expect(book.price).toEqual({
      amount: 300, currency: 'RUB', source: 'Литрес', label: '', type: 'ebook', url: '', collectedAt: NOW,
    });
    expect(book.priceOffers).toHaveLength(2);
    expect(book.sources).toHaveLength(1);
    expect(book.cover).toBe('https://x/c2.jpg');
    expect(book.coverUrl).toBe('https://x/c2.jpg');
  });

  it('manualPrice переопределяет выбранного кандидата', () => {
    const result = normalizeAiResult({ book: { title: 'Т' }, priceCandidates: [{ amount: 100, currency: 'RUB' }] }, { now: NOW });
    const book = {};
    applyNormalizedToBook(book, result, { chosen: { price: true }, manualPrice: { amount: 555, currency: 'rub', label: 'Вручную' } });
    expect(book.price.amount).toBe(555);
    expect(book.price.currency).toBe('RUB');
    expect(book.price.label).toBe('Вручную');
  });

  it('без кандидатов цена пустая (легитимный 0, не выдумка)', () => {
    const result = normalizeAiResult({ book: { title: 'Т' } }, { now: NOW });
    const book = {};
    applyNormalizedToBook(book, result, { chosen: { price: true } });
    expect(book.price).toMatchObject({ amount: 0, currency: 'RUB', type: 'unknown' });
  });
});

describe('AI_NORMALIZE_SYSTEM (контракт промпта §6)', () => {
  it('содержит схему, запрет выдумывания и защиту от инъекций со страниц', () => {
    for (const key of ['"book"', '"priceCandidates"', '"coverCandidates"', '"sources"', '"conflicts"', '"confidence"']) {
      expect(AI_NORMALIZE_SYSTEM).toContain(key);
    }
    expect(AI_NORMALIZE_SYSTEM).toContain('ничего не выдумывай');
    expect(AI_NORMALIZE_SYSTEM).toContain('НЕДОВЕРЕННЫЙ');
  });
});
