// @vitest-environment node
import { describe, expect, it, vi, afterEach } from 'vitest';
import { fetchBookByIsbn } from '../isbn.js';

// ─────────────────────────────────────────────────────────────
// P2-12: API result may mismatch ISBN.
// Раньше tryGoogleBooks() брал data.items[0] без сверки identifiers,
// а tryLitresSearch() падал на arts[0] при отсутствии exact match.
// Из-за этого форма могла заполниться метаданными ДРУГОЙ книги.
// Теперь metadata принимается только при совпадении ISBN-13
// или эквивалентного ISBN-10 (isbnMatches). Cover-only отдельно.
//
// Тесты реально гоняют fetchBookByIsbn() с замоканным глобальным
// fetch: первый результат API не совпадает, совпадает только второй.
// ─────────────────────────────────────────────────────────────

// Запрошенный ISBN — 13-значный (эквивалент ISBN-10: 517098765X):
const REQ_13 = '9785170987658';
const REQ_10 = '517098765X';
// Чужой, но консистентный ISBN-10/13 (Флокс… неважно — просто не то):
const OTHER_13 = '9780306406157';
const OTHER_10 = '0306406152';

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json' },
});

/**
 * Собирает mock fetch по маршрутам.
 * @param {Record<string, (init) => Response>} routes — key: подстрока URL
 */
function mockFetch(routes, fallback = () => json({})) {
  const fn = vi.fn(async (url, init) => {
    const u = String(url);
    for (const [needle, handler] of Object.entries(routes)) {
      if (u.includes(needle)) return handler(init);
    }
    return fallback(init);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** ЛитРес: первый запрос создаёт SID, второй возвращает arts. */
function litresHandler(arts) {
  return (init) => {
    const body = new URLSearchParams(String(init?.body)).get('jdata');
    const func = body ? JSON.parse(body).requests?.[0]?.func : null;
    if (func === 'w_create_sid') return json({ auth: { sid: 'test-sid' } });
    if (func === 'r_search_arts') return json({ success: true, req: { arts } });
    return json({});
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ═══════════════════════════════════════════════════
//  Google Books: сверка identifiers
// ═══════════════════════════════════════════════════

describe('P2-12: Google Books — сверка items с запрошенным ISBN', () => {
  it('первый результат НЕ совпадает, второй совпадает → берётся второй', async () => {
    const itemOther = {
      id: 'x1', volumeInfo: {
        title: 'Другая книга', authors: ['Автор А'],
        industryIdentifiers: [{ type: 'ISBN_13', identifier: OTHER_13 }],
      },
    };
    const itemMatch = {
      id: 'x2', volumeInfo: {
        title: 'Нужная книга', subtitle: 'Том 1', authors: ['Автор Б'],
        industryIdentifiers: [{ type: 'ISBN_13', identifier: REQ_13 }],
      },
    };
    mockFetch({ googleapis: () => json({ items: [itemOther, itemMatch] }) });

    const book = await fetchBookByIsbn(REQ_13);
    expect(book).not.toBeNull();
    expect(book.title).toBe('Нужная книга. Том 1');
    expect(book.author).toBe('Автор Б');
    expect(book.source).toBe('google');
    expect(book.isbn).toBe(REQ_13);
  });

  it('только НЕсовпадающие результаты → каскад отклоняет Google (null)', async () => {
    mockFetch({ googleapis: () => json({ items: [
      { id: 'x1', volumeInfo: { title: 'A', industryIdentifiers: [{ type: 'ISBN_13', identifier: OTHER_13 }] } },
    ] }) });

    // Open Library / ЛитРес / cover — пустые, чтобы изолировать Google:
    const book = await fetchBookByIsbn(REQ_13);
    expect(book).toBeNull();
  });

  it('результат БЕЗ identifiers не принимается (нечем сверить)', async () => {
    mockFetch({ googleapis: () => json({ items: [
      { id: 'x1', volumeInfo: { title: 'Нет ISBN вообще', authors: ['X'] } },
    ] }) });
    const book = await fetchBookByIsbn(REQ_13);
    expect(book).toBeNull();
  });

  it('идентификатор ISBN-10 эквивалентен запрошенному ISBN-13', async () => {
    mockFetch({ googleapis: () => json({ items: [
      { id: 'x1', volumeInfo: {
        title: 'Нужная книга',
        industryIdentifiers: [{ type: 'ISBN_10', identifier: REQ_10 }],
      } },
    ] }) });
    const book = await fetchBookByIsbn(REQ_13);
    expect(book).not.toBeNull();
    expect(book.source).toBe('google');
  });

  it('идентификатор ДРУГОГО ISBN-10 не проходит (эквивалентность строгая)', async () => {
    mockFetch({ googleapis: () => json({ items: [
      { id: 'x1', volumeInfo: {
        title: 'Другая',
        industryIdentifiers: [{ type: 'ISBN_10', identifier: OTHER_10 }],
      } },
    ] }) });
    const book = await fetchBookByIsbn(REQ_13);
    expect(book).toBeNull();
  });
});

// ═══════════════════════════════════════════════════
//  Open Library: ключ запроса — точное совпадение
// ═══════════════════════════════════════════════════

describe('P2-12: Open Library — bibkeys-ключ точный', () => {
  it('OL по ключу ISBN: вернёт данные без сверки (contract)', async () => {
    mockFetch({
      googleapis: () => json({ items: [
        { id: 'x1', volumeInfo: { title: 'Неверная', industryIdentifiers: [{ type: 'ISBN_13', identifier: OTHER_13 }] } },
      ] }),
      'openlibrary.org/api/books': () => json({
        [`ISBN:${REQ_13}`]: { title: 'Нужная из OL', authors: [{ name: 'Автор OL' }] },
      }),
    });
    const book = await fetchBookByIsbn(REQ_13);
    expect(book).not.toBeNull();
    expect(book.source).toBe('openlibrary');
    expect(book.title).toBe('Нужная из OL');
  });
});

// ═══════════════════════════════════════════════════
//  ЛитРес: только точный ISBN, без fallback на arts[0]
// ═══════════════════════════════════════════════════

describe('P2-12: ЛитРес — никакого arts[0] без exact match', () => {
  it('первый арт чужой, второй совпадает → берётся совпавший', async () => {
    mockFetch({
      googleapis: () => json({ items: [] }),
      'openlibrary.org/api/books': () => json({}),
      catalit: litresHandler([
        { id: 111, title: 'Чужая книга', persons: [], isbn: OTHER_13 },
        { id: 222, title: 'Нужная ЛитРес', persons: [], isbn: REQ_13 },
      ]),
    });
    const book = await fetchBookByIsbn(REQ_13);
    expect(book).not.toBeNull();
    expect(book.source).toBe('litres');
    expect(book.title).toBe('Нужная ЛитРес');
    expect(book.litresId).toBe(222);
  });

  it('НЕТ совпадающего ISBN → ЛитРес отклоняется (раньше был arts[0])', async () => {
    mockFetch({
      googleapis: () => json({ items: [] }),
      'openlibrary.org/api/books': () => json({}),
      catalit: litresHandler([
        { id: 111, title: 'Чужая книга №1', persons: [], isbn: OTHER_13 },
        { id: 222, title: 'Чужая книга №2', persons: [], isbn: OTHER_10 },
      ]),
    });
    const book = await fetchBookByIsbn(REQ_13);
    expect(book).toBeNull();
  });

  it('арт с совпадающим ISBN-10 принимается (эквивалентность)', async () => {
    mockFetch({
      googleapis: () => json({ items: [] }),
      'openlibrary.org/api/books': () => json({}),
      catalit: litresHandler([
        { id: 333, title: 'Нужная через ISBN-10', persons: [], isbn: REQ_10 },
      ]),
    });
    const book = await fetchBookByIsbn(REQ_13);
    expect(book).not.toBeNull();
    expect(book.source).toBe('litres');
    expect(book.litresId).toBe(333);
  });
});

// ═══════════════════════════════════════════════════
//  Контракты: без регрессий
// ═══════════════════════════════════════════════════

describe('P2-12: контракты без регрессий', () => {
  it('обычный успешный lookup через Google Books не сломан', async () => {
    mockFetch({ googleapis: () => json({ items: [
      { id: 'x1', volumeInfo: {
        title: 'Книга', authors: ['aa', 'bb'], categories: ['Фэнтези'],
        industryIdentifiers: [{ type: 'ISBN_13', identifier: REQ_13 }],
      } },
    ] }) });
    const book = await fetchBookByIsbn(REQ_10); // запрос ISBN-10
    expect(book?.source).toBe('google');
    expect(book.author).toBe('aa, bb');
  });

  it('все источники пустые → null, без исключений', async () => {
    mockFetch({
      googleapis: () => json({ items: [] }),
      'openlibrary.org/api/books': () => json({}),
      catalit: litresHandler([]),
      'covers.openlibrary.org': () => new Response('', { status: 404 }),
    });
    const book = await fetchBookByIsbn(REQ_13);
    expect(book).toBeNull();
  });

  it('сетевой сбой на всех источниках → null (не глотает ошибку наружу)', async () => {
    mockFetch({}, () => new Response('', { status: 500 }));
    const book = await fetchBookByIsbn(REQ_13);
    expect(book).toBeNull();
  });
});