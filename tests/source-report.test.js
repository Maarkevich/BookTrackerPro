// ═══════════════════════════════════════════════════════════════════
// 🔖 3.9.5 — ЕДИНЫЙ ОТЧЁТ ОБ ИСТОЧНИКАХ (source report).
//
// Что доказывают тесты (реальная симуляция, без моков логики):
//   — buildSourceReportEntry: ok / partial / requires_js / captcha /
//     cloudflare / blocked (HTTP 403) / network_error / unsupported;
//   — домен/тип/название берутся из единого реестра sources.js;
//   — loadSourcePages больше НЕ пропускает недоступные страницы молча:
//     CAPTCHA/Cloudflare/сеть/чужой домен попадают в report;
//   — пригодные страницы (ok) попадают в pages и НЕ считаются ошибкой;
//   — renderSourceReport: экранирует XSS, не даёт javascript:-ссылке
//     попасть в href, добавляет rel="noopener noreferrer";
//   — лимит источников соблюдается (обрабатываются только первые N).
// ═══════════════════════════════════════════════════════════════════
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SOURCE_REPORT_STATUS, buildSourceReportEntry, renderSourceReport, loadSourcePages,
} from '../app.js';
import { extractPage } from '../extract.js';

const LITRES_URL = 'https://litres.ru/book/1';
const LONG_TEXT = 'Описание книги и характеристики издания. '.repeat(80); // > 1500 символов

const BOOK_HTML = `<html>
  <head>
    <title>Мастер и Маргарита</title>
    <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Book","name":"Мастер и Маргарита",
       "author":{"@type":"Person","name":"Михаил Булгаков"},"isbn":"9785170987658"}
    </script>
  </head>
  <body><main><h1>Мастер и Маргарита</h1><p>${LONG_TEXT}</p></main></body>
</html>`;

const CAPTCHA_HTML = `<html>
  <head><title>Ой!</title></head>
  <body><p>Подтвердите, что вы не робот</p>
  <div class="g-recaptcha" data-sitekey="x"></div></body>
</html>`;

const CLOUDFLARE_HTML = `<html>
  <head><title>Just a moment...</title></head>
  <body><p>Checking your browser before accessing litres.ru.</p></body>
</html>`;

/** Ответ endpoint Worker /fetch (см. worker/worker.js). */
function workerResponse({ url, html, status = 200, truncated = false, warnings = [], domain = '' }) {
  return {
    ok: true,
    url,
    finalUrl: url,
    domain: domain || new URL(url).hostname.toLowerCase(),
    status,
    contentType: 'text/html',
    html,
    truncated,
    redirected: false,
    warnings,
  };
}

function extract(url, html, opts = {}) {
  return extractPage(workerResponse({ url, html, ...opts }));
}

/** Стаб global fetch: Worker отвечает успешным JSON-envelope. */
function stubWorker(payload) {
  const fn = vi.fn(async () => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('buildSourceReportEntry — статусы источника', () => {
  it('нормальная книга с JSON-LD → ok, usable, без ручного flow', () => {
    const page = extract(LITRES_URL, BOOK_HTML);
    const entry = buildSourceReportEntry({ url: LITRES_URL }, { page });
    expect(entry).toMatchObject({
      url: LITRES_URL,
      domain: 'litres.ru',
      type: 'shop',
      label: 'ЛитРес',
      status: 'ok',
      usable: true,
      needsManual: false,
    });
    expect(entry.reason).toBe('');
  });

  it('CAPTCHA → captcha, usable=false, needsManual', () => {
    const page = extract(LITRES_URL, CAPTCHA_HTML);
    const entry = buildSourceReportEntry({ url: LITRES_URL }, { page });
    expect(entry.status).toBe('captcha');
    expect(entry.usable).toBe(false);
    expect(entry.needsManual).toBe(true);
    expect(entry.reason).toMatch(/CAPTCHA/i);
  });

  it('Cloudflare challenge → cloudflare, usable=false', () => {
    const page = extract(LITRES_URL, CLOUDFLARE_HTML);
    const entry = buildSourceReportEntry({ url: LITRES_URL }, { page });
    expect(entry.status).toBe('cloudflare');
    expect(entry.usable).toBe(false);
    expect(entry.reason).toMatch(/Cloudflare/i);
  });

  it('HTTP 403 при нормальной разметке → blocked с кодом статуса', () => {
    const page = extract(LITRES_URL, BOOK_HTML, { status: 403 });
    const entry = buildSourceReportEntry({ url: LITRES_URL }, { page });
    expect(entry.status).toBe('blocked');
    expect(entry.httpStatus).toBe(403);
    expect(entry.usable).toBe(false);
    expect(entry.reason).toContain('403');
  });

  it('сетевая ошибка → network_error с понятной причиной', () => {
    const error = new Error('Не удалось связаться с endpoint Worker.');
    error.status = 0;
    const entry = buildSourceReportEntry({ url: LITRES_URL }, { error });
    expect(entry.status).toBe('network_error');
    expect(entry.httpStatus).toBe(0);
    expect(entry.usable).toBe(false);
    expect(entry.needsManual).toBe(true);
    expect(entry.reason).toMatch(/endpoint Worker/i);
  });

  it('HTTP 403 от Worker с CAPTCHA-сообщением → blocked, а не network_error', () => {
    const error = new Error('Endpoint Worker вернул ошибку (HTTP 403): CAPTCHA/блокировка');
    error.status = 403;
    const entry = buildSourceReportEntry({ url: LITRES_URL }, { error });
    expect(entry.status).toBe('blocked');
    expect(entry.httpStatus).toBe(403);
    expect(entry.reason).toMatch(/CAPTCHA/i);
  });

  it('домен вне реестра → unsupported, но домен всё равно показан', () => {
    const entry = buildSourceReportEntry({ url: 'https://ozon.ru/book/1' }, { unsupported: true });
    expect(entry.status).toBe('unsupported');
    expect(entry.domain).toBe('ozon.ru');
    expect(entry.label).toBe('ozon.ru');
    expect(entry.usable).toBe(false);
    expect(entry.needsManual).toBe(true);
    expect(entry.reason).toMatch(/вне списка/i);
  });

  it('контракт статусов не ломает легитимные значения', () => {
    expect(Object.keys(SOURCE_REPORT_STATUS)).toEqual([
      'ok', 'partial', 'requires_js', 'captcha', 'cloudflare', 'blocked',
      'network_error', 'unsupported',
    ]);
    expect(SOURCE_REPORT_STATUS.ok.usable).toBeUndefined(); // справочник не путается с записью
    expect(SOURCE_REPORT_STATUS.blocked.tone).toBe('bad');
  });
});

describe('loadSourcePages — недоступные источники не исчезают', () => {
  it('CAPTCHA-страница: pages пуст, но report содержит причину', async () => {
    const fetchMock = stubWorker(workerResponse({ url: LITRES_URL, html: CAPTCHA_HTML }));
    const { pages, report } = await loadSourcePages([{ url: LITRES_URL }], 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(pages).toHaveLength(0);
    expect(report).toHaveLength(1);
    expect(report[0]).toMatchObject({
      url: LITRES_URL, domain: 'litres.ru', type: 'shop', label: 'ЛитРес',
      status: 'captcha', usable: false, needsManual: true,
    });
    expect(report[0].reason).toMatch(/CAPTCHA/i);
  });

  it('успешная страница: pages содержит страницу, report — ok', async () => {
    stubWorker(workerResponse({ url: LITRES_URL, html: BOOK_HTML }));
    const { pages, report } = await loadSourcePages([{ url: LITRES_URL }], 1);
    expect(pages).toHaveLength(1);
    expect(pages[0].isbnCandidates).toContain('9785170987658');
    expect(report).toHaveLength(1);
    expect(report[0]).toMatchObject({ status: 'ok', usable: true, needsManual: false });
  });

  it('сетевой сбой: report фиксирует network_error, исключение не пробрасывается', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const { pages, report } = await loadSourcePages([{ url: LITRES_URL }], 1);
    expect(pages).toHaveLength(0);
    expect(report).toHaveLength(1);
    expect(report[0].status).toBe('network_error');
    expect(report[0].usable).toBe(false);
    expect(report[0].reason).toBeTruthy();
  });

  it('домен вне реестра: Worker не вызывается, report = unsupported', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { pages, report } = await loadSourcePages([{ url: 'https://ozon.ru/book/1' }], 1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(pages).toHaveLength(0);
    expect(report[0]).toMatchObject({ domain: 'ozon.ru', status: 'unsupported', needsManual: true });
  });

  it('лимит: обрабатываются только первые N результатов', async () => {
    const fetchMock = stubWorker(workerResponse({ url: LITRES_URL, html: BOOK_HTML }));
    const { report } = await loadSourcePages([
      { url: LITRES_URL },
      { url: 'https://eksmo.ru/book/2' },
    ], 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(report).toHaveLength(1);
    expect(report[0].url).toBe(LITRES_URL);
  });

  it('пустой список источников не ломает контракт', async () => {
    const { pages, report } = await loadSourcePages([], 4);
    expect(pages).toEqual([]);
    expect(report).toEqual([]);
  });
});

describe('renderSourceReport — безопасный HTML отчёта', () => {
  it('экранирует XSS в причине и названии источника', () => {
    const html = renderSourceReport([{
      url: 'https://eksmo.ru/book/1',
      domain: 'eksmo.ru',
      type: 'publisher',
      label: '<img src=x onerror=alert(1)>',
      status: 'blocked',
      httpStatus: 403,
      usable: false,
      needsManual: true,
      reason: '<script>alert("xss")</script>',
      warnings: [],
    }]);
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;img src=x');
    expect(html).toContain('&lt;script&gt;');
  });

  it('не пропускает javascript:-URL в href', () => {
    const html = renderSourceReport([{
      url: 'javascript:alert(1)',
      domain: 'evil.example',
      label: 'evil',
      status: 'blocked',
      usable: false,
      needsManual: true,
      reason: 'blocked',
    }]);
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('href="javascript');
  });

  it('добавляет безопасную внешнюю ссылку и rel=noopener noreferrer', () => {
    const html = renderSourceReport([{
      url: 'https://litres.ru/book/1',
      domain: 'litres.ru',
      type: 'shop',
      label: 'ЛитРес',
      status: 'captcha',
      usable: false,
      needsManual: true,
      reason: 'Требуется проверка CAPTCHA.',
    }]);
    expect(html).toContain('href="https://litres.ru/book/1"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('открыть');
    expect(html).toContain('1 источник(ов) недоступны автоматически');
  });

  it('пустой отчёт → пустая строка (не вставляет пустой блок)', () => {
    expect(renderSourceReport([])).toBe('');
    expect(renderSourceReport(null)).toBe('');
  });
});
