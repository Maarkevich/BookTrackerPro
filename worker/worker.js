// ═══════════════════════════════════════════════════════════════════
// 🔖 3.9.1 — ЭТАП 4: универсальный endpoint Worker для страниц
//   российских книжных сайтов.
//
// Архитектурная роль (спецификация v3.9.1, §1, §3A, §4):
//   PWA → Cloudflare Worker → российский сайт / xKiro
//   Worker проверяет схему URL и разрешённый домен, получает страницу
//   и отдаёт сырой результат (HTML + статус + финальный URL), который
//   далее обрабатывает универсальный extractor (этап 5) и AI (этап 6).
//
// Возможности:
//   — OPTIONS /fetch и /v1/* → CORS-preflight;
//   — GET  /fetch?url=<page>   — получить страницу
//     POST /fetch {url:<page>} — то же самое (тело JSON)
//       валидация: только http/https и домен из allowlist;
//       ручной контроль редиректов: финальный домен тоже обязан быть
//       в allowlist (защита от увода на произвольный хост);
//       таймаут 15 сек; обрезка html до MAX_HTML_BYTES;
//       CAPTCHA/блокировка → PONЯТНОЕ состояние ошибки (HTTP 403);
//       не-HTML ответ → предупреждение; сетевой сбой → HTTP 502.
//   — /v1/* → прозрачный прокси на api.xkiro.com (пересылает метод,
//       body, Authorization): один Worker = CORS-прокси xKiro +
//       endpoint страниц (соответствует схеме §1).
//
// Безопасность:
//   — ключ НЕ хранится в коде: Authorization передаётся от клиента
//     прозрачно (только для /v1/*);
//   — /fetch не требует ключа, но ограничен allowlist доменов;
//   — запрещены локальные/частные адреса (localhost, 10/8, 192.168/16,
//     172.16/12, 127.0.0.1) — защита от SSRF.
//
// Деплой: worker/worker.js — готовый модуль для Cloudflare Workers
// (wrangler dev / wrangler deploy; name = booktrackerpro-endpoint).
// ═══════════════════════════════════════════════════════════════════

export const ALLOWED_DOMAINS = [
  'eksmo.ru',            // Эксмо
  'ast.ru',              // AST
  'mann-ivanov-ferber.ru', // МИФ
  'rosman.ru',           // Росмэн
  'litres.ru',           // ЛитРес
  'chitai-gorod.ru',     // Читай-город
  'bookvoed.ru',         // Буквоед
  'rsl.ru',              // РГБ
  'findbook.ru',         // FindBook
];

export const MAX_HTML_BYTES = 1_500_000;
export const FETCH_TIMEOUT_MS = 15_000;

const XKIRO_UPSTREAM = 'https://api.xkiro.com';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

const BLOCK_MARKERS = [
  'captcha', 'cloudflare', 'just a moment', 'access denied',
  'проверка браузера', 'доступ ограничен', 'robot check', 'verify you',
];

/** Нормализует host: нижний регистр, убирает ведущий www. */
export function normalizeHost(host) {
  return String(host || '').toLowerCase().replace(/^www\./, '');
}

/** Разрешён ли домен (точное совпадение или поддомен). */
export function isAllowedDomain(host) {
  const h = normalizeHost(host);
  if (!h) return false;
  return ALLOWED_DOMAINS.some((d) => h === d.toLowerCase() || h.endsWith('.' + d.toLowerCase()));
}

/**
 * Проверяет URL перед загрузкой: схема http/https, домен из allowlist,
 * отсутствие приватных адресов.
 * @param {string} raw
 * @returns {{ok: true, url: string}|{ok: false, error: string}}
 */
export function validatePageUrl(raw) {
  if (!raw || typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, error: 'URL страницы не указан.' };
  }
  let u;
  try { u = new URL(raw.trim()); } catch {
    return { ok: false, error: 'Некорректный URL страницы.' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, error: 'Разрешены только http(s) ссылки.' };
  }
  const host = normalizeHost(u.hostname);
  if (!isAllowedDomain(host)) {
    return { ok: false, error: 'Домен не входит в список разрешённых книжных источников.' };
  }
  if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') {
    return { ok: false, error: 'Локальные адреса недоступны.' };
  }
  if (/^(10\.|192\.168\.|127\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    return { ok: false, error: 'Приватные адреса недоступны.' };
  }
  return { ok: true, url: u.toString() };
}

/**
 * Признак CAPTCHA/блокировки по статусу и началу HTML.
 * @param {number} status
 * @param {string} html
 * @returns {boolean}
 */
export function detectBlocked(status, html) {
  if (status === 403 || status === 404 || status === 429) return true;
  const head = String(html || '').slice(0, 4000).toLowerCase();
  return BLOCK_MARKERS.some((m) => head.includes(m));
}

/**
 * Загружает страницу с таймаутом и ручным контролем редиректов.
 * @param {string} startUrl — уже провалидированный URL
 * @returns {Promise<{ok: true, status: number, html: string, finalUrl: string,
 *   contentType: string, truncated: boolean}
 *   | {ok: false, error: string, status?: number}>}
 */
async function fetchPage(startUrl) {
  let url = startUrl;
  let redirected = false;
  for (let hop = 0; hop <= 5; hop++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    let resp;
    try {
      resp = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: ctrl.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; BookTrackerPro/3.9.1; +https://github.com/Maarkevich/BookTrackerPro)',
          'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.5',
        },
      });
    } catch (e) {
      clearTimeout(timer);
      if (e?.name === 'AbortError') {
        return { ok: false, error: 'Источник не отвечает (таймаут).' };
      }
      return { ok: false, error: 'Источник недоступен.' };
    }
    clearTimeout(timer);

    const status = resp.status;
    const loc = resp.headers.get('location') || resp.headers.get('Location');
    if (status >= 300 && status < 400 && loc) {
      redirected = true;
      try {
        const next = new URL(loc, url).toString();
        const check = validatePageUrl(next);
        if (!check.ok) {
          return { ok: false, error: 'Редирект вёл на запрещённый домен.' };
        }
        url = next;
        continue;
      } catch {
        return { ok: false, error: 'Некорректный редирект источника.' };
      }
    }

    if (status >= 500) {
      return { ok: false, error: `Источник вернул ошибку сервера (HTTP ${status}).` };
    }

    const contentType = resp.headers.get('content-type') || '';
    let text = '';
    let truncated = false;
    try {
      const buf = await resp.arrayBuffer();
      text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
      if (text.length > MAX_HTML_BYTES) {
        text = text.slice(0, MAX_HTML_BYTES);
        truncated = true;
      }
    } catch {
      return { ok: false, error: 'Не удалось прочитать страницу.' };
    }

    if (detectBlocked(status, text)) {
      return { ok: false, error: 'Сайт запросил подтверждение (CAPTCHA/блокировка).', status: 403 };
    }

    if (!/text\/(html|xml)|application\/(xhtml|html|xml)/i.test(contentType)) {
      return { ok: false, error: 'Страница не является HTML-документом.' };
    }

    return { ok: true, status, html: text, finalUrl: url, contentType, truncated, redirected };
  }
  return { ok: false, error: 'Слишком много редиректов.' };
}

/** JSON-ответ с CORS-заголовками. */
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

/** Ответ для OPTIONS-preflight. */
function preflight() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Обработчик /fetch (GET ?url= или POST {url}). */
async function handleFetch(request) {
  let raw = '';
  if (request.method === 'GET') {
    raw = new URL(request.url).searchParams.get('url') || '';
  } else if (request.method === 'POST') {
    try {
      const body = await request.json();
      raw = typeof body?.url === 'string' ? body.url : '';
    } catch {
      return json({ ok: false, error: 'Некорректное JSON-тело запроса.' }, 400);
    }
  } else {
    return json({ ok: false, error: 'Метод не поддерживается.' }, 405);
  }

  const v = validatePageUrl(raw);
  if (!v.ok) return json({ ok: false, error: v.error }, 400);

  const page = await fetchPage(v.url);
  if (!page.ok) {
    return json({ ok: false, error: page.error }, page.status || 502);
  }

  const warnings = [];
  if (page.truncated) warnings.push('Страница обрезана до лимита размера.');
  if (page.redirected) warnings.push('Были редиректы — сохранён финальный URL.');
  if (!/text\/html/i.test(page.contentType)) warnings.push('Ответ не является HTML — данные могут быть неполными.');

  return json({
    ok: true,
    url: v.url,
    finalUrl: page.finalUrl,
    domain: normalizeHost(new URL(page.finalUrl).hostname),
    status: page.status,
    contentType: page.contentType,
    html: page.html,
    truncated: page.truncated,
    redirected: page.redirected,
    warnings,
  });
}

/** Прокси /v1/* → api.xkiro.com (прозрачно: метод, body, Authorization). */
async function handleXkiroProxy(request) {
  const u = new URL(request.url);
  const target = XKIRO_UPSTREAM + u.pathname + u.search;
  const headers = new Headers();
  const auth = request.headers.get('authorization');
  const ctype = request.headers.get('content-type');
  const accept = request.headers.get('accept');
  if (auth) headers.set('Authorization', auth);
  if (ctype) headers.set('Content-Type', ctype);
  headers.set('Accept', accept || 'application/json');

  let body;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    try { body = await request.arrayBuffer(); } catch { body = undefined; }
  }

  let resp;
  try {
    resp = await fetch(target, { method: request.method, headers, body });
  } catch {
    return json({ ok: false, error: 'Не удалось связаться с xKiro (CORS/сеть).' }, 502);
  }

  const data = await resp.json().catch(() => null);
  return json(data === null ? { ok: false, error: 'xKiro вернул не-JSON ответ.' } : data, resp.status);
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return preflight();
    const u = new URL(request.url);
    if (u.pathname === '/fetch' || u.pathname === '/fetch/') return handleFetch(request);
    if (u.pathname.startsWith('/v1/')) return handleXkiroProxy(request);
    return json({ ok: false, error: 'Неизвестный маршрут: используйте /fetch или /v1/*.' }, 404);
  },
};