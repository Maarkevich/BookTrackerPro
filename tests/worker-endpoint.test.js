// ═══════════════════════════════════════════════════════════════════
// 🔖 3.9.1 — ЭТАП 4: тесты универсального endpoint Worker.
//
// Что симулируется (РЕАЛЬНЫЕ вызовы через worker.fetch(request) и
// vi.stubGlobal('fetch', ...)):
//   — валидация схемы (http/https) и allowlist доменов российских
//     книжных сайтов (Эксмо, AST, МИФ, Росмэн, ЛитРес, Читай-город,
//     Буквоед, РГБ, FindBook);
//   — приватные/локальные адреса отклоняются (SSRF-защита);
//   — редиректы: след только по разрешённым доменам; увод на чужой
//     домен → отклонение; слишком много редиректов → отклонение;
//   — таймаут и сетевые сбои → понятная ошибка (не голая exception);
//   — CAPTCHA/блокировка (403/404/markers) → ошибка 403 «CAPTCHA»;
//   — не-HTML ответ → ошибка; HTML обрезается до лимита;
//   — POST /fetch и GET /fetch?url= работают; OPTIONS → CORS;
//   — /v1/* прозрачный прокси на api.xkiro.com (Authorization/body/статус);
//   — контракт безопасности: в worker/worker.js НЕТ захардкоженных ключей.
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, {
  ALLOWED_DOMAINS, MAX_HTML_BYTES, validatePageUrl, isAllowedDomain, detectBlocked, normalizeHost,
} from '../worker/worker.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubUpstream(impl) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

function htmlResponse(html, status = 200, contentType = 'text/html; charset=utf-8') {
  return new Response(html, {
    status,
    headers: { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' },
  });
}

function jsonUpstream(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function callFetch(urlOrReq, init) {
  const req = typeof urlOrReq === 'string' ? new Request(urlOrReq, init) : urlOrReq;
  return worker.fetch(req, {}, {});
}

describe('validatePageUrl / isAllowedDomain', () => {
  it('все 9 источников спецификации в allowlist (Эксмо, AST, МИФ, Росмэн, ЛитРес, Читай-город, Буквоед, РГБ, FindBook)', () => {
    expect(ALLOWED_DOMAINS).toContain('eksmo.ru');
    expect(ALLOWED_DOMAINS).toContain('ast.ru');
    expect(ALLOWED_DOMAINS).toContain('mann-ivanov-ferber.ru');
    expect(ALLOWED_DOMAINS).toContain('rosman.ru');
    expect(ALLOWED_DOMAINS).toContain('litres.ru');
    expect(ALLOWED_DOMAINS).toContain('chitai-gorod.ru');
    expect(ALLOWED_DOMAINS).toContain('bookvoed.ru');
    expect(ALLOWED_DOMAINS).toContain('rsl.ru');
    expect(ALLOWED_DOMAINS).toContain('findbook.ru');
    expect(ALLOWED_DOMAINS).toHaveLength(9);
  });

  it('domains принимаются с www и поддоменами; чужие — нет', () => {
    expect(isAllowedDomain('litres.ru')).toBe(true);
    expect(isAllowedDomain('www.litres.ru')).toBe(true);
    expect(isAllowedDomain('cdn.litres.ru')).toBe(true);
    expect(isAllowedDomain('eksmo.ru')).toBe(true);
    expect(isAllowedDomain('ozon.ru')).toBe(false);
    expect(isAllowedDomain('litres.ru.evil.com')).toBe(false);
    expect(isAllowedDomain('')).toBe(false);
    expect(normalizeHost('WWW.LitRes.RU')).toBe('litres.ru');
  });

  it('валидный https-URL проходит', () => {
    expect(validatePageUrl('https://litres.ru/book/x')).toEqual({
      ok: true, url: 'https://litres.ru/book/x',
    });
    expect(validatePageUrl('http://eksmo.ru/katalog/1').ok).toBe(true);
  });

  it('не-http схемы отклоняются (javascript:, ftp:, data:, файловый путь)', () => {
    for (const bad of ['javascript:alert(1)', 'ftp://litres.ru/x', 'data:text/html,hi', 'file:///etc/passwd', '']) {
      expect(validatePageUrl(bad).ok, bad).toBe(false);
    }
  });

  it('неразрешённый домен отклоняется; некорректный URL отклоняется', () => {
    expect(validatePageUrl('https://ozon.ru/book/x')).toMatchObject({ ok: false });
    expect(validatePageUrl('https://malware.example.com')).toMatchObject({ ok: false });
    expect(validatePageUrl('не ссылка')).toMatchObject({ ok: false });
    expect(validatePageUrl(null)).toMatchObject({ ok: false });
  });

  it('локальные/приватные адреса отклоняются (SSRF)', () => {
    expect(validatePageUrl('https://localhost/book').ok).toBe(false);
    expect(validatePageUrl('https://127.0.0.1/x').ok).toBe(false);
    expect(validatePageUrl('https://192.168.1.1/x').ok).toBe(false);
    expect(validatePageUrl('https://10.0.0.5/x').ok).toBe(false);
    expect(validatePageUrl('https://172.16.0.1/x').ok).toBe(false);
    expect(validatePageUrl('https://0.0.0.0/x').ok).toBe(false);
  });
});

describe('detectBlocked', () => {
  it('статусы 403/404/429 → блокировка', () => {
    expect(detectBlocked(403, '<html>ok</html>')).toBe(true);
    expect(detectBlocked(404, '<html>not found</html>')).toBe(true);
    expect(detectBlocked(429, '<html>slow down</html>')).toBe(true);
    expect(detectBlocked(200, '<html>ok</html>')).toBe(false);
  });

  it('маркеры CAPTCHA/Cloudflare в начале HTML → блокировка', () => {
    expect(detectBlocked(200, '<html><body>' + 'x'.repeat(100) + ' captcha required</body></html>')).toBe(true);
    expect(detectBlocked(200, '<html>Just a moment... verifying you are human</html>')).toBe(true);
    expect(detectBlocked(200, '<html>доступ ограничен</html>')).toBe(true);
    expect(detectBlocked(200, '<html>Проверка браузера</html>')).toBe(true);
    expect(detectBlocked(200, '<html>Успейте купить книгу</html>')).toBe(false);
  });
});

describe('/fetch через worker.fetch (реальная симуляция сетевых сбоев)', () => {
  it('успешная загрузка книги с LitРес → envelope с html/домен/статус', async () => {
    const html = '<html><head><title>Книга</title></head><body><h1>Мастер и Маргарита</h1></body></html>';
    stubUpstream(() => htmlResponse(html));
    const res = await callFetch('https://worker.example.com/fetch?url=https%3A%2F%2Flitres.ru%2Fbook%2Fx');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.html).toBe(html);
    expect(data.domain).toBe('litres.ru');
    expect(data.status).toBe(200);
    expect(data.finalUrl).toBe('https://litres.ru/book/x');
    expect(data.url).toBe('https://litres.ru/book/x');
    expect(data.warnings).toEqual([]);
  });

  it('POST /fetch с телом {url} — то же самое', async () => {
    stubUpstream(() => htmlResponse('<html>книга</html>'));
    const res = await callFetch('https://worker.example.com/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://bookvoed.ru/product/x' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).domain).toBe('bookvoed.ru');
  });

  it('неразрешённый домен → 400, fetch на источник НЕ вызывается', async () => {
    const fn = stubUpstream(() => htmlResponse('<html>x</html>'));
    const res = await callFetch('https://worker.example.com/fetch?url=https%3A%2F%2Fozon.ru%2Fx');
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/домен/i);
    expect(fn).not.toHaveBeenCalled();
  });

  it('javascript:/file: схема → 400 без network', async () => {
    const fn = stubUpstream(() => htmlResponse('<html>x</html>'));
    const res = await callFetch('https://worker.example.com/fetch?url=javascript%3Aalert(1)');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/http/i);
    expect(fn).not.toHaveBeenCalled();
  });

  it('пустой/отсутствующий url → 400', async () => {
    const res = await callFetch('https://worker.example.com/fetch');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/URL/i);
  });

  it('сетевой сбой (fetch бросает TypeError) → 502 «Источник недоступен»', async () => {
    stubUpstream(() => { throw new TypeError('Failed to fetch'); });
    const res = await callFetch('https://worker.example.com/fetch?url=https%3A%2F%2Feksmo.ru%2Fbook%2F1');
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/Источник недоступен/i);
  });

  it('HTTP 500 от источника → ошибка (не сырой ответ)', async () => {
    stubUpstream(() => htmlResponse('<html>server error</html>', 500));
    const res = await callFetch('https://worker.example.com/fetch?url=https%3A%2F%2Feksmo.ru%2Fbook%2F1');
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBeTruthy();
  });

  it('CAPTCHA/блокировка (403) → понятная ошибка 403', async () => {
    stubUpstream(() => htmlResponse('<html>Just a moment...</html>'));
    const res = await callFetch('https://worker.example.com/fetch?url=https%3A%2F%2Fchitai-gorod.ru%2Fx');
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/CAPTCHA|блокировка/i);
  });

  it('не-HTML ответ (JSON/картинка) → ошибка', async () => {
    stubUpstream(() => htmlResponse('{"a":1}', 200, 'application/json'));
    const res = await callFetch('https://worker.example.com/fetch?url=https%3A%2F%2Frsl.ru%2Fx');
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/не является HTML/i);
  });

  it('HTML обрезается до MAX_HTML_BYTES с флагом truncated', async () => {
    const big = '<html>' + 'a'.repeat(MAX_HTML_BYTES + 50_000) + '</html>';
    stubUpstream(() => htmlResponse(big));
    const res = await callFetch('https://worker.example.com/fetch?url=https%3A%2F%2Fbookvoed.ru%2Fx');
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.html.length).toBeLessThanOrEqual(MAX_HTML_BYTES);
    expect(data.truncated).toBe(true);
    expect(data.warnings.join()).toMatch(/обреза/i);
  });

  it('редирект на разрешённый домен → следует и отдаёт финальный URL', async () => {
    stubUpstream(async (url, init) => {
      expect(init?.redirect).toBe('manual');
      if (String(url) === 'https://litres.ru/start') {
        return new Response(null, { status: 301, headers: { 'Location': 'https://www.litres.ru/final' } });
      }
      return htmlResponse('<html><h1>финал</h1></html>');
    });
    const res = await callFetch('https://worker.example.com/fetch?url=https%3A%2F%2Flitres.ru%2Fstart');
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.finalUrl).toBe('https://www.litres.ru/final');
    expect(data.html).toContain('финал');
    expect(data.warnings.join()).toMatch(/редирект/i);
  });

  it('редирект на НЕразрешённый домен → отклонение, до чужого сайта fetch НЕ доходит', async () => {
    const hits = [];
    stubUpstream(async (url) => {
      hits.push(String(url));
      if (hits.length === 1) {
        return new Response(null, { status: 302, headers: { 'Location': 'https://evil.example.com/phish' } });
      }
      return htmlResponse('<html>phish</html>');
    });
    const res = await callFetch('https://worker.example.com/fetch?url=https%3A%2F%2Frosman.ru%2Fx');
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/редирект/i);
    expect(hits).toHaveLength(1);
  });

  it('цепочка из 6+ редиректов → «Слишком много редиректов»', async () => {
    stubUpstream(() => {
      return new Response(null, { status: 302, headers: { 'Location': 'https://ast.ru/loop' } });
    });
    const res = await callFetch('https://worker.example.com/fetch?url=https%3A%2F%2Fast.ru%2Fx');
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/Слишком много редиректов/i);
  });

  it('OPTIONS → 204 с CORS-заголовками', async () => {
    const res = await callFetch('https://worker.example.com/fetch', { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Headers')).toMatch(/Authorization/);
  });

  it('неизвестный маршрут → 404', async () => {
    const res = await callFetch('https://worker.example.com/anything', { method: 'GET' });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/маршрут/i);
  });
});

describe('/v1/* — прозрачный прокси на api.xkiro.com', () => {
  it('POST /v1/chat/completions: Authorization, тело и статус пробрасываются', async () => {
    const fn = stubUpstream(() => jsonUpstream({ choices: [{ message: { content: 'ok' } }] }));
    const res = await callFetch('https://worker.example.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer sk-test-123' },
      body: JSON.stringify({ model: 'x', messages: [] }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ choices: [{ message: { content: 'ok' } }] });
    const [targetUrl, init] = fn.mock.calls[0];
    expect(String(targetUrl)).toBe('https://api.xkiro.com/v1/chat/completions');
    expect(init.headers.get('Authorization')).toBe('Bearer sk-test-123');
    expect(init.method).toBe('POST');
  });

  it('статус ошибки xKiro (401) пробрасывается клиенту', async () => {
    stubUpstream(() => jsonUpstream({ error: { message: 'bad key', code: 'auth' } }, 401));
    const res = await callFetch('https://worker.example.com/v1/models', { method: 'GET' });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error.code).toBe('auth');
  });

  it('сетевой сбой при обращении к xKiro → 502 с понятной ошибкой', async () => {
    stubUpstream(() => { throw new TypeError('Failed to fetch'); });
    const res = await callFetch('https://worker.example.com/v1/search', { method: 'POST', body: '{}' });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/xKiro/i);
  });
});

describe('клиентская fetchPageViaWorker (ai.js)', () => {
  it('POST /fetch с телом {url}, baseUrl подставляется; envelope возвращается', async () => {
    const fn = vi.fn(() => new Response(JSON.stringify({
      ok: true, url: 'https://litres.ru/x', finalUrl: 'https://litres.ru/x', domain: 'litres.ru',
      status: 200, contentType: 'text/html', html: '<html>x</html>',
      truncated: false, redirected: false, warnings: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fn);
    const mod = await import('../ai.js');
    const data = await mod.fetchPageViaWorker({ url: 'https://litres.ru/x', baseUrl: 'https://worker.example.com/' });
    expect(data.domain).toBe('litres.ru');
    const [calledUrl, init] = fn.mock.calls[0];
    expect(calledUrl).toBe('https://worker.example.com/fetch');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body).url).toBe('https://litres.ru/x');
  });

  it('ошибка Worker (400/403/502) → AiApiError с деталями и HTTP-статусом', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Response(JSON.stringify({ ok: false, error: 'Домен не входит в список разрешённых' }), { status: 400 })));
    const mod = await import('../ai.js');
    await expect(mod.fetchPageViaWorker({ url: 'https://ozon.ru/x' })).rejects.toMatchObject({
      name: 'AiApiError',
      status: 400,
      message: expect.stringContaining('Домен не входит'),
    });
  });

  it('пустой url → AiApiError без сети', async () => {
    const fn = vi.fn();
    vi.stubGlobal('fetch', fn);
    const mod = await import('../ai.js');
    await expect(mod.fetchPageViaWorker({ url: '  ' })).rejects.toThrow('Пустой URL');
    expect(fn).not.toHaveBeenCalled();
  });

  it('сетевой сбой → AiApiError с подсказкой про настройки', async () => {
    vi.stubGlobal('fetch', vi.fn(() => { throw new TypeError('Failed to fetch'); }));
    const mod = await import('../ai.js');
    await expect(mod.fetchPageViaWorker({ url: 'https://eksmo.ru/x' })).rejects.toMatchObject({
      status: 0,
      message: expect.stringContaining('endpoint Worker'),
    });
  });
});

describe('контракт безопасности: секретов в коде нет', () => {
  it('worker/worker.js не содержит захардкоженных ключей/токенов', () => {
    const src = readFileSync(new URL('../worker/worker.js', import.meta.url), 'utf8');
    expect(src.match(/sk-[A-Za-z0-9]{8,}/)).toBeNull();
    expect(src.match(/[A-Za-z0-9_-]{40,}/)).toBeNull();
    expect(src).not.toContain('Bearer sk-');
  });
});