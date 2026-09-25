// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { applyStatusTransition, changeBookStatus, putBook, getBook, BOOK_STATUSES } from '../db.js';

// изменение: путь dropdown (changeBookStatus) берёт «сегодня» из реальных
// часов, путь формы — из параметра NOW. Фиксируем системные часы на Date,
// иначе тест разъезжается на сутки при смене реальной даты.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-24T12:00:00.000Z'));
});
afterAll(() => {
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────
// P2-10: единая семантика перехода статуса.
// Раньше dropdown (changeBookStatus) и форма (saveBookForm) по-разному
// выставляли dateStarted/dateFinished/readingDays, confetti и rating prompt.
// Теперь оба пути вызывают applyStatusTransition — тест проверяет
// матрицу всех переходов и идентичность результатов обоих путей.
// ─────────────────────────────────────────────────────────────

const NOW = '2026-09-24T12:00:00.000Z';
const TODAY = '2026-09-24';
const START_10D = '2026-09-14'; // 10 дней до TODAY → readingDays = 10

// «Путь формы»: как saveBookForm строит bookData и вызывает переход.
function formStatusTransition(ex, newStatus) {
  const bookData = {
    id: ex.id,
    status: newStatus,
    dateStarted: ex.dateStarted || '',
    dateFinished: ex.dateFinished || '',
    readingDays: ex.readingDays,
    review: ex.review || {},
  };
  let statusFx = { confetti: false, askRating: false };
  if (ex.status !== newStatus) statusFx = applyStatusTransition(bookData, ex.status, newStatus, NOW);
  return { book: bookData, statusFx };
}

// «Путь dropdown»: как changeBookStatus (через реальный IndexedDB).
async function dropdownStatusTransition(ex, newStatus) {
  await putBook({ ...ex });
  const result = await changeBookStatus(ex.id, newStatus);
  return { book: result.book, statusFx: { confetti: result.confetti, askRating: result.askRating } };
}

function makeBook(status, overrides = {}) {
  return {
    id: 'book_' + status + '_' + Math.random().toString(36).slice(2, 7),
    title: 'Тест', author: 'A', status,
    dateStarted: (status === 'reading' || status === 'finished') ? START_10D : '',
    dateFinished: status === 'finished' ? '2026-09-20' : '',
    readingDays: status === 'finished' ? 6 : undefined,
    review: {},
    ...overrides,
  };
}

describe('P2-10: applyStatusTransition — единые правила', () => {
  it('переход в reading: dateStarted ставится сегодня, если пуст (эталон)', () => {
    const book = makeBook('added');
    const fx = applyStatusTransition(book, 'added', 'reading', NOW);
    expect(book.dateStarted).toBe(TODAY);
    expect(fx.confetti).toBe(false);
    expect(fx.askRating).toBe(false);
  });

  it('переход в reading НЕ затирает существующий dateStarted', () => {
    const book = makeBook('paused', { dateStarted: '2026-08-01' });
    applyStatusTransition(book, 'paused', 'reading', NOW);
    expect(book.dateStarted).toBe('2026-08-01');
  });

  it('переход в finished: dateFinished сегодня (если пуст), readingDays расcчитан, confetti+rating', () => {
    const book = makeBook('reading', { dateFinished: '' });
    const fx = applyStatusTransition(book, 'reading', 'finished', NOW);
    expect(book.dateFinished).toBe(TODAY);
    expect(book.readingDays).toBe(10); // 2026-09-14 → 2026-09-24
    expect(fx.confetti).toBe(true);
    expect(fx.askRating).toBe(true); // review пустой
  });

  it('переход в finished с уже проставленным rating: rating prompt отсутствует', () => {
    const book = makeBook('reading', { review: { rating: 4 } });
    const fx = applyStatusTransition(book, 'reading', 'finished', NOW);
    expect(fx.confetti).toBe(true);
    expect(fx.askRating).toBe(false); // rating > 0 → не спрашиваем
  });

  it('переход в dropped: dateFinished сегодня, askRating=true, без confetti', () => {
    const book = makeBook('reading', { dateFinished: '' });
    const fx = applyStatusTransition(book, 'reading', 'dropped', NOW);
    expect(book.dateFinished).toBe(TODAY);
    expect(fx.askRating).toBe(true);
    expect(fx.confetti).toBe(false);
  });

  it('уход из finished: dateFinished и readingDays очищаются', () => {
    const book = makeBook('finished');
    applyStatusTransition(book, 'finished', 'added', NOW);
    expect(book.dateFinished).toBe('');
    expect(book.readingDays).toBeUndefined();
  });

  it('статус без перехода (old === new) — no-op: ничего не меняет, эффектов нет', () => {
    const book = makeBook('finished');
    const snapshot = { ...book, dateFinished: book.dateFinished, readingDays: book.readingDays };
    const fx = applyStatusTransition(book, 'finished', 'finished', NOW);
    expect(book).toEqual(snapshot);
    expect(fx.confetti).toBe(false);
    expect(fx.askRating).toBe(false);
  });

  it('null-книга — контракт: {confetti:false, askRating:false} без падений', () => {
    expect(applyStatusTransition(null, 'added', 'finished', NOW)).toEqual({ confetti: false, askRating: false });
  });
});

describe('P2-10: матрица переходов 6×6', () => {
  const STATUSES = Object.keys(BOOK_STATUSES); // wishlist, added, reading, paused, finished, dropped

  it('все пары old→new дают идентичную книгу и флаги через форму и через dropdown', async () => {
    for (const old of STATUSES) {
      for (const next of STATUSES) {
        // стартовая книга для обоих путей — одинаковая
        const seed = makeBook(old);
        const viaForm = formStatusTransition(seed, next);
        const viaDropdown = await dropdownStatusTransition(makeBook(old), next);

        const key = `${old} → ${next}`;
        expect(viaForm.book.dateStarted, key + ' dateStarted').toBe(viaDropdown.book.dateStarted);
        expect(viaForm.book.dateFinished, key + ' dateFinished').toBe(viaDropdown.book.dateFinished);
        expect(viaForm.book.readingDays, key + ' readingDays').toBe(viaDropdown.book.readingDays);
        expect(viaForm.statusFx.confetti, key + ' confetti').toBe(viaDropdown.statusFx.confetti);
        expect(viaForm.statusFx.askRating, key + ' askRating').toBe(viaDropdown.statusFx.askRating);
        expect(viaDropdown.book.status, key + ' status').toBe(next);
      }
    }
  });

  it('повторное сохранение формы уже-finished книги НЕ даёт confetti (раньше срабатывал)', () => {
    // симуляция: книга в форме со статусом finished, статус не менялся → перехода нет
    const ex = makeBook('finished');
    const fx = formStatusTransition(ex, 'finished');
    expect(fx.statusFx.confetti).toBe(false);
    expect(fx.statusFx.askRating).toBe(false);
    expect(fx.book.readingDays).toBe(ex.readingDays); // не пересчитывается зря
  });
});