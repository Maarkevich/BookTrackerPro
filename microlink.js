// ─────────────────────────────────────────────
// 📦 BookTrackerPro — microlink.js
// 🔖 v3.7.0 | 2026-08-09
// 📝 Microlink API:
//      — превью ссылок (контент-план)
//      — ГЛУБОКОЕ извлечение книги по ссылке на магазин
//        (html=true → локальный парсинг JSON-LD + OG + microdata)
//      — НОВОЕ: extractBookPreview() — окно предпросмотра
//        со ВСЕМИ найденными полями и ручным маппингом
//
//    Лимиты:
//      — Бесплатно: 25 запросов/день без ключа
//        (предохранитель приложения — 20)
//      — С ключом: pro.microlink.io + заголовок x-api-key
//
//    Новое в 3.7.0:
//      — resolveRedirects(): резолв коротких ссылок
//        (ozon.ru/t/..., bit.ly, clck.ru) перед запросом
//      — fetchWithRetry(): retry с exponential backoff
//        (3 попытки: 500ms → 1000ms → 2000ms)
//      — Каскад CORS-прокси: corsproxy.io → allorigins.win → codetabs
//        (фолбэк при недоступности Microlink)
//      — Улучшенная диагностика: getDiagnostics() возвращает
//        причину ошибки, остаток лимита, режим тарифа
//      — Очередь запросов при исчерпании лимита
//      — Защита от антибот-заглушек (Cloudflare/captcha)
//
//    Ключ задаётся в Настройках → «Microlink API».
//    app.js вызывает setMicrolinkApiKey() при старте и сохранении.
//
//    Кеш: IndexedDB store 'previews' (db.js v6), TTL 7 дней.
// ─────────────────────────────────────────────
import { openDB } from './db.js';

// ═══════════════════════════════════════════════
//  КОНФИГУРАЦИЯ
// ═══════════════════════════════════════════════
const MICROLINK_FREE = 'https://api.microlink.io';
const MICROLINK_PRO  = 'https://pro.microlink.io';
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 дней
const DAILY_LIMIT_FREE = 20;  // предохранитель (реально 25)
const DAILY_LIMIT_PRO = 1000;
const MAX_RETRIES = 3;
const MAX_REDIRECTS = 5;

// Каскад CORS-прокси для фолбэка
const PROXY_CHAIN = [
  (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];

let _dailyCount = 0;
let _dailyReset = startOfDay() + 86400000;
const _memCache = new Map();
let _apiKey = '';
// Очередь запросов при исчерпании лимита
const _pendingQueue = [];

function startOfDay() { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); }

// ═══════════════════════════════════════════════
//  0. API-КЛЮЧ
// ═══════════════════════════════════════════════
export function setMicrolinkApiKey(key) {
  const changed = _apiKey !== (key || '').trim();
  _apiKey = (key || '').trim();
  if (changed) {
    _dailyCount = 0;
    _dailyReset = startOfDay() + 86400000;
  }
}
export function getMicrolinkApiKey() { return _apiKey; }
function hasKey() { return _apiKey.length > 0; }
function baseUrl() { return hasKey() ? MICROLINK_PRO : MICROLINK_FREE; }
function dailyLimit() { return hasKey() ? DAILY_LIMIT_PRO : DAILY_LIMIT_FREE; }
function authHeaders() { return hasKey() ? { 'x-api-key': _apiKey } : {}; }

function canRequest() {
  if (Date.now() > _dailyReset) { _dailyCount = 0; _dailyReset = startOfDay() + 86400000; }
  return _dailyCount < dailyLimit();
}

// ═══════════════════════════════════════════════
//  1. РЕЗОЛВ КОРОТКИХ ССЫЛОК (НОВОЕ в v3.7.0)
// ═══════════════════════════════════════════════
// Короткие ссылки-редиректы, которые нужно резолвить
const SHORT_URL_PATTERNS = [
  /ozon\.ru\/t\//i,
  /bit\.ly\//i,
  /clck\.ru\//i,
  /goo\.gl\//i,
  /t\.co\//i,
  /tinyurl\.com\//i,
  /vk\.cc\//i,
  /s\.id\//i,
];

function isShortUrl(url) {
  return SHORT_URL_PATTERNS.some(p => p.test(url));
}

/**
* Резолвит цепочку редиректов через HEAD-запросы.
* Короткие ссылки (ozon.ru/t/..., bit.ly) часто не парсятся
* Microlink напрямую — нужно получить финальный URL.
*
* @param {string} url — исходный URL
* @returns {Promise<string>} — финальный URL после редиректов
*/
export async function resolveRedirects(url) {
  if (!isShortUrl(url)) return url;

  let current = url;
  for (let i = 0; i < MAX_REDIRECTS; i++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const r = await fetch(current, {
        method: 'HEAD',
        redirect: 'follow',
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (r.url && r.url !== current) {
        current = r.url;
      } else {
        break;
      }
    } catch {
      break; // не удалось резолвить — используем что есть
    }
  }
  return current;
}

// ═══════════════════════════════════════════════
//  2. RETRY С EXPONENTIAL BACKOFF (НОВОЕ в v3.7.0)
// ═══════════════════════════════════════════════
/**
* fetch с таймаутом и retry с экспоненциальным backoff.
* Попытки: 500ms → 1000ms → 2000ms.
*
* @param {string} url
* @param {object} opts — параметры fetch
* @param {number} timeout — таймаут одного запроса (мс)
* @returns {Promise<Response>}
* @throws {Error} последняя ошибка после всех попыток
*/
async function fetchWithRetry(url, opts = {}, timeout = 15000) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      clearTimeout(timer);
      // 429 — rate limit, не ретраим (бессмысленно)
      if (res.status === 429) {
        throw Object.assign(new Error('Rate limit exceeded'), { status: 429 });
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res;
    } catch (e) {
      clearTimeout(timer);
      if (e.status === 429) throw e; // 429 — не ретраим
      lastErr = e;
      if (attempt < MAX_RETRIES) {
        // Экспоненциальный backoff: 500, 1000, 2000
        await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
      }
    }
  }
  throw lastErr;
}

// ═══════════════════════════════════════════════
//  3. КАСКАД CORS-ПРОКСИ (НОВОЕ в v3.7.0)
// ═══════════════════════════════════════════════
/**
* Фолбэк: запрашивает URL через цепочку CORS-прокси.
* Используется когда Microlink недоступен или исчерпан лимит.
* Возвращает HTML-строку или null.
*
* @param {string} url
* @returns {Promise<string|null>}
*/
async function fetchHtmlViaProxy(url) {
  for (const proxyFn of PROXY_CHAIN) {
    try {
      const proxyUrl = proxyFn(url);
      const r = await fetchWithRetry(proxyUrl, {
        headers: { 'Accept': 'text/html,application/xhtml+xml' },
      }, 10000);
      const text = await r.text();
      if (text && text.length > 100) return text;
    } catch { /* следующий прокси */ }
  }
  return null;
}

// ═══════════════════════════════════════════════
//  4. ПРЕВЬЮ ССЫЛКИ (для контент-плана, без html)
// ═══════════════════════════════════════════════
export async function fetchLinkPreview(url, opts = {}) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const key = url.toLowerCase();
  if (!opts.force) { const c = await getCached(key); if (c && !c.type) return c; }
  if (!canRequest()) { const c = await getCached(key); return c && !c.type ? c : null; }
  try {
    const r = await fetchWithRetry(`${baseUrl()}/?url=${encodeURIComponent(url)}`, {
      headers: authHeaders(),
    }, 10000);
    if (r.status === 429) { const c = await getCached(key); return c && !c.type ? c : null; }
    if (!r.ok) return null;
    const json = await r.json();
    if (json.status !== 'success' || !json.data) return null;
    _dailyCount++;
    const preview = normalize(json.data, url);
    await putCached(key, preview);
    return preview;
  } catch (e) { console.warn('[Microlink]', e.message); return null; }
}

function normalize(data, url) {
  return {
    url,
    title: data.title || '', description: data.description || '',
    image: data.image?.url || '', logo: data.logo?.url || '',
    publisher: data.publisher || '', author: data.author || '',
    date: data.date || '', lang: data.lang || '',
    source: detectSource(url), cachedAt: Date.now(),
  };
}

function detectSource(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube';
    if (host.includes('tiktok.com')) return 'tiktok';
    if (host.includes('t.me') || host.includes('telegram')) return 'telegram';
    if (host.includes('vk.com') || host.includes('vk.ru')) return 'vk';
    if (host.includes('dzen.ru')) return 'dzen';
    if (host.includes('instagram.com')) return 'instagram';
    if (host.includes('pinterest.')) return 'pinterest';
    if (host.includes('threads.net')) return 'threads';
    if (host.includes('litres.ru')) return 'litres';
    if (host.includes('book24')) return 'book24';
    if (host.includes('ozon')) return 'ozon';
    return 'web';
  } catch { return 'web'; }
}

// ═══════════════════════════════════════════════
//  5. ПОЛНЫЙ ПРЕДПРОСМОТР (v3.6.0, улучшено в v3.7.0)
// ═══════════════════════════════════════════════
/**
* Извлекает МАКСИМУМ данных со страницы магазина и возвращает
* как готовый объект, так и полный список найденных полей
* для окна предпросмотра с ручным маппингом.
*
* v3.7.0: резолвит короткие ссылки, retry с backoff,
* фолбэк через CORS-прокси при недоступности Microlink.
*
* @param {string} url — ссылка на страницу книги
* @param {{force?: boolean}} opts
* @returns {Promise<{merged: object, fields: Array, url: string, source: string}|null>}
*/
export async function extractBookPreview(url, opts = {}) {
  if (!url || !/^https?:\/\//i.test(url)) return null;

  // v3.7.0: резолвим короткие ссылки
  let resolvedUrl = url;
  if (isShortUrl(url)) {
    resolvedUrl = await resolveRedirects(url);
  }

  const key = 'book:' + resolvedUrl.toLowerCase();
  if (!opts.force) {
    const c = await getCached(key);
    if (c && c.type === 'book') return { merged: c.book, fields: c.fields || [], url: resolvedUrl, source: detectSource(resolvedUrl) };
  }
  if (!canRequest()) {
    const c = await getCached(key);
    return c && c.type === 'book' ? { merged: c.book, fields: c.fields || [], url: resolvedUrl, source: detectSource(resolvedUrl) } : null;
  }
  try {
    const params = new URLSearchParams({
      url: resolvedUrl,
      html: 'true',
      waitForTimeout: '2000'
    });
    const r = await fetchWithRetry(`${baseUrl()}/?${params}`, {
      headers: authHeaders(),
    }, 20000);
    if (r.status === 429) {
      const c = await getCached(key);
      return c && c.type === 'book' ? { merged: c.book, fields: c.fields || [], url: resolvedUrl, source: detectSource(resolvedUrl) } : null;
    }
    if (!r.ok) return null;
    const json = await r.json();
    if (json.status !== 'success' || !json.data) return null;
    _dailyCount++;
    const html = json.data.html || '';
    const { book, fields } = parseBookHtmlFull(html, json.data, resolvedUrl);
    if (book && book.title && !looksBlocked(html, book.title)) {
      await putCached(key, { type: 'book', book, fields, cachedAt: Date.now() });
      return { merged: book, fields, url: resolvedUrl, source: detectSource(resolvedUrl) };
    }
    return null;
  } catch (e) {
    console.warn('[Microlink] extractBookPreview:', e.message);
    // v3.7.0: фолбэк через CORS-прокси
    return await extractBookViaProxy(resolvedUrl);
  }
}

/**
* Фолбэк: извлечение книги через CORS-прокси (без Microlink).
* Используется при недоступности Microlink или исчерпании лимита.
*/
async function extractBookViaProxy(url) {
  try {
    const html = await fetchHtmlViaProxy(url);
    if (!html) return null;
    const { book, fields } = parseBookHtmlFull(html, null, url);
    if (book && book.title && !looksBlocked(html, book.title)) {
      const key = 'book:' + url.toLowerCase();
      await putCached(key, { type: 'book', book, fields, cachedAt: Date.now() });
      return { merged: book, fields, url, source: detectSource(url) };
    }
  } catch (e) {
    console.warn('[Microlink] proxy fallback failed:', e.message);
  }
  return null;
}

/**
* Обёртка: возвращает только готовый объект книги.
* Совместимо с isbn.js fetchBookFromUrl.
*/
export async function extractBookFromPage(url, opts = {}) {
  const full = await extractBookPreview(url, opts);
  return full ? full.merged : null;
}

// ═══════════════════════════════════════════════
//  6. ПАРСЕР HTML (полный: merged + fields)
// ═══════════════════════════════════════════════
function parseBookHtmlFull(html, mlData, url) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const jsonLdNode = findJsonLdBook(doc);
  const jsonLd = mapJsonLd(jsonLdNode);
  const og = extractOpenGraph(doc);
  const micro = extractMicrodata(doc);
  const merged = mergeBookData(jsonLd, og, micro, mlData, url);
  // Собираем ВСЕ найденные поля для предпросмотра
  const fields = [
    ...collectJsonLdFields(jsonLdNode),
    ...collectOpenGraphFields(doc),
    ...collectMicrodataFields(doc),
    ...(mlData ? collectMicrolinkFields(mlData) : []),
  ];
  fields.forEach((f, i) => { f.id = `f${i}`; });
  return { book: merged, fields };
}

// ─── 6.1 JSON-LD (schema.org) — самый надёжный ───
function findJsonLdBook(doc) {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const s of scripts) {
    let parsed;
    try { parsed = JSON.parse(s.textContent); } catch { continue; }
    const found = searchJsonLd(parsed);
    if (found) return found;
  }
  return null;
}

function searchJsonLd(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const item of node) { const f = searchJsonLd(item); if (f) return f; }
    return null;
  }
  if (node['@graph']) { const f = searchJsonLd(node['@graph']); if (f) return f; }
  const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
  if (types.some(t => ['Book','Product','CreativeWork','Audiobook'].includes(t))) return node;
  return null;
}

/** Маппинг известных полей JSON-LD → целевые поля книги */
const JSONLD_FIELD_MAP = {
  name:            { label: 'Название',        target: 'title' },
  alternateName:   { label: 'Альтерн. название', target: null },
  author:          { label: 'Автор',           target: 'author' },
  illustrator:     { label: 'Иллюстратор',      target: null },
  translator:      { label: 'Переводчик',       target: null },
  editor:          { label: 'Редактор',         target: null },
  publisher:       { label: 'Издательство',     target: 'publisher' },
  datePublished:   { label: 'Дата публикации',  target: 'publishedDate' },
  dateCreated:     { label: 'Дата создания',    target: null },
  isbn:            { label: 'ISBN',            target: 'isbn' },
  sku:             { label: 'Артикул (SKU)',    target: 'isbn' },
  gtin:            { label: 'GTIN',            target: null },
  numberOfPages:   { label: 'Кол-во страниц',   target: 'pageCount' },
  genre:           { label: 'Жанр',            target: 'genre' },
  about:           { label: 'Тема',            target: 'genre' },
  keywords:        { label: 'Ключевые слова',   target: null },
  description:     { label: 'Описание',        target: 'description' },
  image:           { label: 'Изображение',      target: 'cover' },
  url:             { label: 'URL',             target: null },
  bookFormat:      { label: 'Формат книги',     target: null },
  bookEdition:     { label: 'Издание',         target: null },
  inLanguage:      { label: 'Язык',            target: null },
  typicalAgeRange: { label: 'Возраст',         target: 'ageRating' },
  contentRating:   { label: 'Возрастной рейтинг', target: 'ageRating' },
  award:           { label: 'Награды',         target: null },
};

function collectJsonLdFields(node) {
  const fields = [];
  if (!node) return fields;
  const SKIP = new Set(['@context','@type','@id','potentialAction','sameAs','workExample','mainEntityOfPage']);
  const push = (key, value, target) => {
    if (value === undefined || value === null || value === '') return;
    const s = String(value).trim();
    if (!s) return;
    const meta = JSONLD_FIELD_MAP[key] || { label: key, target: null };
    fields.push({
      source: 'json-ld',
      key,
      label: meta.label,
      value: s.length > 500 ? s.slice(0, 500) + '…' : s,
      target: target !== undefined ? target : meta.target,
    });
  };
  for (const [key, raw] of Object.entries(node)) {
    if (SKIP.has(key)) continue;
    if (key === 'offers') {
      const offer = Array.isArray(raw) ? raw[0] : raw;
      if (offer) {
        if (offer.price) push('price', `${offer.price} ${offer.priceCurrency || ''}`, 'price');
        if (offer.availability) push('availability', offer.availability.split('/').pop(), null);
      }
      continue;
    }
    if (key === 'aggregateRating') {
      if (raw?.ratingValue) push('rating', raw.ratingValue, 'rating');
      if (raw?.reviewCount) push('reviewCount', raw.reviewCount, null);
      continue;
    }
    if (key === 'isPartOf') {
      const part = Array.isArray(raw) ? raw[0] : raw;
      if (part?.name) push('series', part.name + (part.position ? ` #${part.position}` : ''), 'series');
      continue;
    }
    if (key === 'author' || key === 'publisher' || key === 'editor' ||
        key === 'illustrator' || key === 'translator' || key === 'contributor') {
      push(key, personName(raw));
      continue;
    }
    if (key === 'image') { push(key, imageUrl(raw)); continue; }
    if (key === 'genre' || key === 'about' || key === 'keywords') { push(key, firstOf(raw)); continue; }
    const v = readableValue(raw);
    if (v) push(key, v);
  }
  return fields;
}

function readableValue(raw) {
  if (raw === undefined || raw === null) return '';
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  if (Array.isArray(raw)) return readableValue(raw[0]);
  if (typeof raw === 'object') {
    if (raw.name) return String(raw.name);
    if (raw['@value']) return String(raw['@value']);
    return '';
  }
  return '';
}

function mapJsonLd(node) {
  if (!node) return {};
  let price = null;
  const offer = node.offers ? (Array.isArray(node.offers) ? node.offers[0] : node.offers) : null;
  if (offer && offer.price) {
    price = { amount: parseFloat(offer.price) || 0, currency: mapCurrency(offer.priceCurrency) };
  }
  let series = null;
  if (node.isPartOf) {
    const part = Array.isArray(node.isPartOf) ? node.isPartOf[0] : node.isPartOf;
    if (part?.name) series = { name: part.name, number: part.position || null };
  }
  return {
    title: node.name || '',
    author: personName(node.author),
    isbn: cleanIsbn(node.isbn || node.sku),
    publisher: personName(node.publisher),
    publishedDate: node.datePublished ? String(node.datePublished).slice(0,4) : '',
    genre: firstOf(node.genre) || firstOf(node.about?.name) || '',
    pageCount: parseInt(node.numberOfPages) || 0,
    description: stripTags(node.description || ''),
    cover: imageUrl(node.image),
    price,
    series,
    ageRating: node.typicalAgeRange || node.contentRating || '',
    rating: node.aggregateRating?.ratingValue ? parseFloat(node.aggregateRating.ratingValue) : 0,
  };
}

// ─── 6.2 Open Graph ───
const OG_FIELD_MAP = {
  'og:title':               { label: 'Заголовок (OG)',     target: 'title' },
  'og:description':         { label: 'Описание (OG)',      target: 'description' },
  'og:image':               { label: 'Изображение (OG)',   target: 'cover' },
  'og:site_name':           { label: 'Сайт',              target: null },
  'og:type':                { label: 'Тип (OG)',          target: null },
  'og:url':                 { label: 'URL (OG)',          target: null },
  'og:locale':              { label: 'Локаль',            target: null },
  'book:author':            { label: 'Автор (book)',      target: 'author' },
  'og:book:author':         { label: 'Автор (OG book)',   target: 'author' },
  'article:author':         { label: 'Автор (article)',   target: 'author' },
  'book:isbn':              { label: 'ISBN (book)',       target: 'isbn' },
  'books:isbn':             { label: 'ISBN (books)',      target: 'isbn' },
  'book:tag':               { label: 'Тег (book)',        target: 'genre' },
  'article:tag':            { label: 'Тег (article)',     target: 'genre' },
  'book:release_date':      { label: 'Дата выхода (book)', target: 'publishedDate' },
  'product:release_date':   { label: 'Дата выхода',       target: 'publishedDate' },
  'product:price:amount':   { label: 'Цена',              target: 'price' },
  'og:price:amount':        { label: 'Цена (OG)',         target: 'price' },
  'product:price:currency': { label: 'Валюта',            target: null },
  'twitter:title':          { label: 'Заголовок (Twitter)', target: 'title' },
  'twitter:description':    { label: 'Описание (Twitter)',  target: 'description' },
  'twitter:image':          { label: 'Изображение (Twitter)', target: 'cover' },
  'description':            { label: 'Описание (meta)',    target: 'description' },
  'keywords':               { label: 'Ключевые слова (meta)', target: null },
};

function extractOpenGraph(doc) {
  const og = (prop) =>
    doc.querySelector(`meta[property="${prop}"]`)?.content ||
    doc.querySelector(`meta[name="${prop}"]`)?.content || '';
  let title = og('og:title');
  let author = og('book:author') || og('og:book:author') || og('article:author') || '';
  if (title.includes(' — ') && !author) {
    const parts = title.split(' — ');
    title = parts[0].trim();
    author = parts[1]?.trim() || '';
  }
  let price = null;
  const pAmount = og('product:price:amount') || og('og:price:amount') || og('books:price:amount');
  const pCurrency = og('product:price:currency') || og('og:price:currency') || og('books:price:currency');
  if (pAmount) price = { amount: parseFloat(pAmount) || 0, currency: mapCurrency(pCurrency) };
  return {
    title: cleanStoreTitle(title),
    author: cleanStoreTitle(author),
    description: og('og:description'),
    cover: og('og:image'),
    isbn: cleanIsbn(og('book:isbn') || og('books:isbn')),
    publishedDate: (og('book:release_date') || og('product:release_date') || '').slice(0,4),
    genre: og('book:tag') || og('article:tag') || '',
    price,
    siteName: og('og:site_name'),
  };
}

function collectOpenGraphFields(doc) {
  const fields = [];
  const seen = new Set();
  const metas = doc.querySelectorAll('meta[property], meta[name]');
  for (const m of metas) {
    const prop = m.getAttribute('property') || m.getAttribute('name');
    const content = (m.getAttribute('content') || '').trim();
    if (!prop || !content) continue;
    if (seen.has(prop)) continue;
    seen.add(prop);
    const meta = OG_FIELD_MAP[prop] || { label: prop, target: null };
    fields.push({
      source: 'open-graph',
      key: prop,
      label: meta.label,
      value: content.length > 500 ? content.slice(0, 500) + '…' : content,
      target: meta.target,
    });
  }
  return fields;
}

// ─── 6.3 Microdata (itemprop) ───
function extractMicrodata(doc) {
  const get = (sel) => doc.querySelector(sel)?.textContent?.trim() || '';
  return {
    title: get('[itemprop="name"]'),
    author: get('[itemprop="author"]'),
    publisher: get('[itemprop="publisher"]'),
    genre: get('[itemprop="genre"]'),
    pageCount: parseInt(get('[itemprop="numberOfPages"]')) || 0,
    isbn: cleanIsbn(get('[itemprop="isbn"]')),
    description: stripTags(get('[itemprop="description"]')),
  };
}

function collectMicrodataFields(doc) {
  const fields = [];
  const seen = new Set();
  const items = doc.querySelectorAll('[itemprop]');
  for (const el of items) {
    const prop = el.getAttribute('itemprop');
    if (!prop || seen.has(prop)) continue;
    seen.add(prop);
    const content = (el.textContent || '').trim();
    if (!content) continue;
    const meta = JSONLD_FIELD_MAP[prop] || { label: prop, target: null };
    fields.push({
      source: 'microdata',
      key: prop,
      label: meta.label + ' (itemprop)',
      value: content.length > 500 ? content.slice(0, 500) + '…' : content,
      target: meta.target,
    });
  }
  return fields;
}

// ─── 6.4 Дефолты Microlink ───
function collectMicrolinkFields(mlData) {
  const fields = [];
  const push = (key, label, value, target) => {
    if (!value) return;
    fields.push({ source: 'microlink', key, label, value: String(value), target });
  };
  if (mlData?.title) push('title', 'Заголовок (Microlink)', mlData.title, 'title');
  if (mlData?.description) push('description', 'Описание (Microlink)', mlData.description, 'description');
  if (mlData?.image?.url) push('image', 'Изображение (Microlink)', mlData.image.url, 'cover');
  if (mlData?.author) push('author', 'Автор (Microlink)', mlData.author, 'author');
  if (mlData?.publisher) push('publisher', 'Издатель/сайт (Microlink)', mlData.publisher, null);
  if (mlData?.date) push('date', 'Дата (Microlink)', mlData.date, null);
  if (mlData?.lang) push('lang', 'Язык (Microlink)', mlData.lang, null);
  return fields;
}

// ─── 6.5 Слияние с приоритетом ───
function mergeBookData(jsonLd, og, micro, mlData, url) {
  const pick = (...vals) => vals.find(v => v !== undefined && v !== null && v !== '' && v !== 0) || '';
  let title = pick(jsonLd.title, og.title, micro.title, mlData?.title);
  let author = pick(jsonLd.author, og.author, micro.author, mlData?.author);
  if (!author && title.includes(' — ')) {
    const parts = title.split(' — ');
    title = parts[0].trim();
    author = parts.slice(1).join(' — ').trim();
  }
  title = cleanStoreTitle(title);
  author = cleanStoreTitle(author);
  const publisher = pick(
    jsonLd.publisher,
    micro.publisher,
    (mlData?.publisher && mlData.publisher !== og.siteName) ? mlData.publisher : ''
  );
  return {
    title,
    author,
    cover: pick(jsonLd.cover, og.cover, mlData?.image?.url),
    description: pick(jsonLd.description, og.description, micro.description, mlData?.description),
    genre: pick(jsonLd.genre, og.genre, micro.genre),
    publisher,
    publishedDate: pick(jsonLd.publishedDate, og.publishedDate),
    pageCount: jsonLd.pageCount || micro.pageCount || 0,
    isbn: pick(jsonLd.isbn, og.isbn, micro.isbn),
    litresMinAge: normalizeAge(jsonLd.ageRating),
    litresSeries: jsonLd.series ? [jsonLd.series] : [],
    price: jsonLd.price || og.price || null,
    litresRating: jsonLd.rating || 0,
    source: 'microlink',
    litresUrl: url,
  };
}

// ─── Хелперы ───
const BLOCK_MARKERS = ['captcha','cloudflare','access denied','just a moment','проверка браузера','robot check'];
function looksBlocked(html, title) {
  const t = (title || '').toLowerCase();
  if (BLOCK_MARKERS.some(m => t.includes(m))) return true;
  return !title && /captcha|cloudflare|just a moment/i.test(html.slice(0, 3000));
}
function cleanStoreTitle(s) {
  if (!s) return '';
  return String(s).replace(/\s*[—–-]\s*(купить|скачать|читать|слушать|заказать|смотреть).*$/i, '').trim();
}
function cleanIsbn(s) {
  return String(s || '').replace(/^isbn[:\s]*/i, '').replace(/[\s-]/g, '').toUpperCase();
}
function mapCurrency(code) {
  const c = String(code || '').toUpperCase();
  return ['RUB','USD','EUR','KZT','UAH','GBP'].includes(c) ? c : 'RUB';
}
function normalizeAge(s) {
  if (!s) return '';
  const m = String(s).match(/(\d+)/);
  return m ? m[1] : '';
}
function personName(p) {
  if (!p) return '';
  if (typeof p === 'string') return p;
  if (Array.isArray(p)) return p.map(personName).filter(Boolean).join(', ');
  return p.name || '';
}
function imageUrl(img) {
  if (!img) return '';
  if (typeof img === 'string') return img;
  if (Array.isArray(img)) return imageUrl(img[0]);
  return img.url || '';
}
function firstOf(v) {
  if (!v) return '';
  if (Array.isArray(v)) return firstOf(v[0]);
  if (typeof v === 'object') return v.name || '';
  return String(v);
}
function stripTags(s) {
  if (!s) return '';
  const div = document.createElement('div');
  div.innerHTML = s;
  return div.textContent || '';
}

// ═══════════════════════════════════════════════
//  7. ДИАГНОСТИКА (НОВОЕ в v3.7.0)
// ═══════════════════════════════════════════════
/**
* Проверяет работоспособность Microlink и возвращает
* подробную диагностику для отображения в Настройках.
*
* @param {string} [apiKey] — опционально переопределить ключ
* @returns {Promise<{ok, remaining, mode, error?, reason?}>}
*/
export async function checkMicrolinkStatus(apiKey) {
  const prevKey = _apiKey;
  if (apiKey !== undefined) _apiKey = (apiKey || '').trim();
  try {
    const r = await fetchWithRetry(`${baseUrl()}/?url=https://example.com`, {
      headers: authHeaders(),
    }, 6000);
    const remaining = r.headers.get('x-rate-limit-remaining');
    const json = await r.json().catch(() => null);
    return {
      ok: r.ok && json?.status === 'success',
      remaining: remaining || '?',
      mode: hasKey() ? 'pro' : 'free',
    };
  } catch (e) {
    let reason = e.message || 'Нет подключения';
    if (e.status === 429) reason = 'Лимит запросов исчерпан';
    else if (e.name === 'AbortError') reason = 'Таймаут запроса';
    return { ok: false, error: reason, mode: hasKey() ? 'pro' : 'free' };
  } finally {
    if (apiKey !== undefined) _apiKey = prevKey;
  }
}

/**
* Возвращает текущее состояние лимита для отображения в UI.
* @returns {{used, limit, mode, resetAt}}
*/
export function getDiagnostics() {
  return {
    used: _dailyCount,
    limit: dailyLimit(),
    mode: hasKey() ? 'pro' : 'free',
    resetAt: new Date(_dailyReset).toLocaleTimeString('ru-RU'),
  };
}

// ═══════════════════════════════════════════════
//  8. КЕШ (IndexedDB + память)
// ═══════════════════════════════════════════════
async function getCached(key) {
  if (_memCache.has(key)) {
    const item = _memCache.get(key);
    if (Date.now() - item.cachedAt < CACHE_TTL) return item;
    _memCache.delete(key);
  }
  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains('previews')) return null;
    return await new Promise((resolve) => {
      const req = db.transaction('previews','readonly').objectStore('previews').get(key);
      req.onsuccess = () => {
        const item = req.result;
        if (item && Date.now() - item.cachedAt < CACHE_TTL) { _memCache.set(key, item); resolve(item); }
        else resolve(null);
      };
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

async function putCached(key, value) {
  _memCache.set(key, value);
  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains('previews')) return;
    db.transaction('previews','readwrite').objectStore('previews').put({ ...value, id: key });
  } catch { /* не критично */ }
}

export async function clearPreviewCache() {
  _memCache.clear();
  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains('previews')) return;
    await new Promise((resolve) => {
      const tx = db.transaction('previews','readwrite');
      tx.objectStore('previews').clear();
      tx.oncomplete = () => resolve(); tx.onerror = () => resolve();
    });
  } catch { /* ignore */ }
}