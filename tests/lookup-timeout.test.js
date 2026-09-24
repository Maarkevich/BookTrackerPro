// @vitest-environment node
import { describe, expect, it, vi, afterEach } from 'vitest';
import { fetchBookByIsbn } from '../isbn.js';
import { fetchT } from '../utils.js';

// ─────────────────────────────────────────────────────────────
// P2-13: Lookup can exceed minute / no cancellation.
// Каждый fetchT создавал ВНУТРЕННИЙ AbortController, а внешний
// signal/deadline по каскаду не передавался: sequential источники,
// прямой/proxy fallback и до трёх попыток на запрос суммарно могли
// занимать больше минуты, пользователь не мог отменить lookup,
// а поздний результат применялся в уже изменённый UI.
//
// Тесты реально симулируют зависшие endpoints (fetch не резолвится,
// но отклоняется при abort — как настоящий fetch по signal), общий
// deadline и отмену на каждом этапе каскада.
// ─────────────────────────────────────────────────────────────

const REQ_13 = '9785170987658';

const abortErr = () => { const e = new Error('aborted'); e.name = 'AbortError'; return e; };

/**
 * fetch, который НИКОГДА не резолвится сам, но отклоняется при
 * abort'е переданного signal (как настоящий fetch). Резолв возможен
 * только через resolveAfterMs (для кейса «поздний response»).
 */
function hangingFetch({ resolveAfterMs = null, resolveWith = null } = {}) {
  return vi.fn((url, init = {}) => new Promise((resolve, reject) => {
    const signal = init.signal;
    if (signal?.aborted) { reject(abortErr()); return; }
    const onAbort = () => { clearTimeout(t); reject(abortErr()); };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    const t = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (resolveAfterMs == null) return; // завис навсегда
      resolve(resolveWith instanceof Error ? (() => { throw resolveWith; })() : resolveWith);
    }, resolveAfterMs ?? 1e9);
  }));
}

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ═══════════════════════════════════════════════════
//  Общий deadline всего каскада
// ═══════════════════════════════════════════════════

describe('P2-13: общий deadline каскада', () => {
  it('Google висит вечно → каскад прерывается по deadlineMs, возвращает null быстро', async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal('fetch', fetchMock);

    const t0 = Date.now();
    const book = await fetchBookByIsbn(REQ_13, null, { deadlineMs: 100 });
    const elapsed = Date.now() - t0;

    expect(book).toBeNull();
    expect(elapsed).toBeLessThan(3000); // НЕ 8с таймаут + retries + backoff
  });

  it('deadline прерывает на позднем этапе (OL висит) — null, не ждём все источники', async () => {
    const fetchMock = vi.fn((url, init = {}) => {
      if (String(url).includes('googleapis')) return json({ items: [] }); // Google пусто
      return hangingFetch()(url, init); // всё остальное висит
    });
    vi.stubGlobal('fetch', fetchMock);

    const t0 = Date.now();
    const book = await fetchBookByIsbn(REQ_13, null, { deadlineMs: 100 });
    const elapsed = Date.now() - t0;

    expect(book).toBeNull();
    expect(elapsed).toBeLessThan(3000);
  });
});

// ═══════════════════════════════════════════════════
//  Внешний signal (кнопка «Отменить»)
// ═══════════════════════════════════════════════════

describe('P2-13: отмена через внешний AbortSignal', () => {
  it('signal aborted ДО вызова → null без единого сетевого запроса', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const ac = new AbortController();
    ac.abort();

    const book = await fetchBookByIsbn(REQ_13, null, { signal: ac.signal });
    expect(book).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('отмена во время висящего Google → null быстро', async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal('fetch', fetchMock);
    const ac = new AbortController();

    const p = fetchBookByIsbn(REQ_13, null, { signal: ac.signal });
    setTimeout(() => ac.abort(), 50); // «Отменить» в UI
    const t0 = Date.now();
    const book = await p;
    const elapsed = Date.now() - t0;

    expect(book).toBeNull();
    expect(elapsed).toBeLessThan(2000);
  });

  it('отмена в момент висящего ЛитРеса → null, каскад не продолжается', async () => {
    let catalitStarted = null;
    const started = new Promise(r => { catalitStarted = r; });
    const fetchMock = vi.fn((url, init = {}) => {
      if (String(url).includes('googleapis')) return json({ items: [] }); // пусто
      if (String(url).includes('openlibrary.org/api/books')) return json({}); // пусто
      if (String(url).includes('catalit')) { catalitStarted(); } // ЛитРес завис
      return hangingFetch()(url, init);
    });
    vi.stubGlobal('fetch', fetchMock);
    const ac = new AbortController();

    const p = fetchBookByIsbn(REQ_13, null, { signal: ac.signal });
    await started; // ЛитРес уже запрошен
    ac.abort();
    const book = await p;
    expect(book).toBeNull();
  });

  it('поздний response после отмены НЕ применяется (null, не книга)', async () => {
    // Google отдаст результат, но ПОЗЖЕ abort'а — как будто пользователь
    // уже закрыл overlay; результат не должен попасть в приложение.
    let release;
    const gate = new Promise(r => { release = r; });
    const fetchMock = vi.fn((url, init = {}) => {
      if (String(url).includes('googleapis')) {
        return new Promise((resolve, reject) => {
          const signal = init.signal;
          if (signal?.aborted) { reject(abortErr()); return; }
          const onAbort = () => { reject(abortErr()); };
          signal?.addEventListener('abort', onAbort, { once: true });
          gate.then(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve(json({ items: [{
              id: 'x1', volumeInfo: {
                title: 'Поздняя книга',
                industryIdentifiers: [{ type: 'ISBN_13', identifier: REQ_13 }],
              },
            }] }));
          });
        });
      }
      return hangingFetch()(url, init);
    });
    vi.stubGlobal('fetch', fetchMock);
    const ac = new AbortController();

    const p = fetchBookByIsbn(REQ_13, null, { signal: ac.signal });
    ac.abort(); // пользователь отменил
    release();  // теперь «поздний» ответ приходит
    const book = await p;
    expect(book).toBeNull(); // поздний результат отброшен
  });
});

// ═══════════════════════════════════════════════════
//  fetchT: внешний signal прерывает retry/backoff
// ═══════════════════════════════════════════════════

describe('P2-13: fetchT уважает внешний signal', () => {
  it('abort во время backoff прерывает retry → AbortError, без лишних попыток', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(() => {
      calls++;
      return Promise.reject(new TypeError('network down'));
    }));
    const ac = new AbortController();

    const p = fetchT('https://example.test/', {}, 8000, 2, ac.signal).catch(e => e);
    setTimeout(() => ac.abort(), 30); // пользователь отменил во время backoff
    const err = await p;

    expect(err.name).toBe('AbortError');
    expect(calls).toBeLessThan(3); // retries не отработали полностью
  });

  it('signal aborted до вызова → немедленный AbortError, fetch не вызван', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const ac = new AbortController();
    ac.abort();

    await expect(fetchT('https://example.test/', {}, 8000, 2, ac.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('контракт: fetchT без signal работает как раньше (ok)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 200 }))));
    const res = await fetchT('https://example.test/');
    expect(res.ok).toBe(true);
  });

  it('контракт: не-ok при наличие сигнала отклоняется обычной ошибкой', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('', { status: 500 }))));
    await expect(fetchT('https://example.test/', {}, 8000, 0, new AbortController().signal))
      .rejects.toThrow('HTTP 500');
  });
});

// ═══════════════════════════════════════════════════
//  Контракт: lookup без opts не сломан (P2-12 регрессия)
// ═══════════════════════════════════════════════════

describe('P2-13: контракты без регрессий', () => {
  it('успешный lookup без opts работает и возвращает книгу Google', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (String(url).includes('googleapis')) {
        return Promise.resolve(json({ items: [{
          id: 'x1', volumeInfo: {
            title: 'Нужная', authors: ['А'],
            industryIdentifiers: [{ type: 'ISBN_13', identifier: REQ_13 }],
          },
        }] }));
      }
      return Promise.resolve(json({}));
    }));

    const book = await fetchBookByIsbn(REQ_13);
    expect(book).not.toBeNull();
    expect(book.source).toBe('google');
  });
});