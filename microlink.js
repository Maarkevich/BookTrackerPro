// ─────────────────────────────────────────────
// 📦 BookTrackerPro — microlink.js
// 🔖 v3.4.2 | 2026-07-30
// 📝 Microlink API:
//      — превью ссылок (контент-план)
//      — ГЛУБОКОЕ извлечение книги по ссылке на магазин
//        (html=true → локальный парсинг JSON-LD + OG + microdata)
//
//    Бесплатно: 50 запросов/день без ключа.
//    Кеш: IndexedDB store 'previews' (db.js v5), TTL 7 дней.
// ─────────────────────────────────────────────

import { openDB } from './db.js';

const MICROLINK_API = 'https://api.microlink.io';
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const DAILY_LIMIT = 45;
let _dailyCount = 0;
let _dailyReset = startOfDay() + 86400000;
const _memCache = new Map();

function startOfDay() { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); }
function canRequest() {
  if (Date.now() > _dailyReset) { _dailyCount = 0; _dailyReset = startOfDay() + 86400000; }
  return _dailyCount < DAILY_LIMIT;
}

// ═══════════════════════════════════════════════
//  1. ПРЕВЬЮ ССЫЛКИ (для контент-плана, без html)
// ═══════════════════════════════════════════════
export async function fetchLinkPreview(url, opts = {}) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const key = url.toLowerCase();

  if (!opts.force) { const c = await getCached(key); if (c && !c.type) return c; }
  if (!canRequest()) { const c = await getCached(key); return c && !c.type ? c : null; }

  try {
    const r = await fetchT(`${MICROLINK_API}/?url=${encodeURIComponent(url)}`, 10000);
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
    return 'web';
  } catch { return 'web'; }
}

// ═══════════════════════════════════════════════
//  2. ГЛУБОКОЕ ИЗВЛЕЧЕНИЕ КНИГИ (html=true)
// ═══════════════════════════════════════════════
/**
 * Извлекает МАКСИМУМ данных книги со страницы магазина.
 * Запрашивает у Microlink отрендеренный HTML и парсит его локально:
 *   JSON-LD (schema.org) → Open Graph → microdata → дефолты Microlink.
 *
 * @param {string} url — ссылка на страницу книги
 * @param {{force?: boolean}} opts
 * @returns {Promise<object|null>} — формат, совместимый с fillFormFromResult
 */
export async function extractBookFromPage(url, opts = {}) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const key = 'book:' + url.toLowerCase();

  if (!opts.force) {
    const c = await getCached(key);
    if (c && c.type === 'book') return c.book;
  }
  if (!canRequest()) {
    const c = await getCached(key);
    return c && c.type === 'book' ? c.book : null;
  }

  try {
    const params = new URLSearchParams({
      url,
      html: 'true',          // ← ключевое: вернуть полный HTML
      waitForTimeout: '2000' // дать JS дорисоваться (ЛитРес — React)
    });
    const r = await fetchT(`${MICROLINK_API}/?${params}`, 20000);
    if (r.status === 429) { const c = await getCached(key); return c && c.type === 'book' ? c.book : null; }
    if (!r.ok) return null;
    const json = await r.json();
    if (json.status !== 'success' || !json.data) return null;
    _dailyCount++;

    const html = json.data.html || '';
    const book = parseBookHtml(html, json.data, url);

    if (book && book.title && !looksBlocked(html, book.title)) {
      await putCached(key, { type: 'book', book, cachedAt: Date.now() });
      return book;
    }
    return null;
  } catch (e) {
    console.warn('[Microlink] extractBook:', e.message);
    return null;
  }
}

// ─── Парсер HTML ───
function parseBookHtml(html, mlData, url) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const jsonLd = mapJsonLd(findJsonLdBook(doc));
  const og = extractOpenGraph(doc);
  const micro = extractMicrodata(doc);

  return mergeBookData(jsonLd, og, micro, mlData, url);
}

// ─── 2.1 JSON-LD (schema.org) — самый надёжный ───
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

function mapJsonLd(node) {
  if (!node) return {};
  const personName = (p) => {
    if (!p) return '';
    if (typeof p === 'string') return p;
    if (Array.isArray(p)) return p.map(personName).filter(Boolean).join(', ');
    return p.name || '';
  };

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

// ─── 2.2 Open Graph ───
function extractOpenGraph(doc) {
  const og = (prop) =>
    doc.querySelector(`meta[property="${prop}"]`)?.content ||
    doc.querySelector(`meta[name="${prop}"]`)?.content || '';

  let title = og('og:title');
  let author = og('book:author') || og('og:book:author') || og('article:author') || '';

  // Паттерн ЛитРес: «Название — Автор — купить...»
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

// ─── 2.3 Microdata (itemprop) ───
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

// ─── 2.4 Слияние с приоритетом ───
function mergeBookData(jsonLd, og, micro, mlData, url) {
  const pick = (...vals) => vals.find(v => v !== undefined && v !== null && v !== '' && v !== 0) || '';

  let title = pick(jsonLd.title, og.title, micro.title, mlData.title);
  let author = pick(jsonLd.author, og.author, micro.author, mlData.author);

  if (!author && title.includes(' — ')) {
    const parts = title.split(' — ');
    title = parts[0].trim();
    author = parts.slice(1).join(' — ').trim();
  }
  title = cleanStoreTitle(title);
  author = cleanStoreTitle(author);

  // publisher из OG — это часто сам магазин, а не издательство
  const publisher = pick(
    jsonLd.publisher,
    micro.publisher,
    (mlData.publisher && mlData.publisher !== og.siteName) ? mlData.publisher : ''
  );

  return {
    title,
    author,
    cover: pick(jsonLd.cover, og.cover, mlData.image?.url),
    description: pick(jsonLd.description, og.description, micro.description, mlData.description),
    genre: pick(jsonLd.genre, og.genre, micro.genre),
    publisher,
    publishedDate: pick(jsonLd.publishedDate, og.publishedDate),
    pageCount: jsonLd.pageCount || micro.pageCount || 0,
    isbn: pick(jsonLd.isbn, og.isbn, micro.isbn),
    // формат, совместимый с fillFormFromResult (app.js)
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
//  3. ПРОВЕРКА ДОСТУПНОСТИ (для Настроек)
// ═══════════════════════════════════════════════
export async function checkMicrolinkStatus() {
  try {
    const r = await fetchT(`${MICROLINK_API}/?url=https://example.com`, 6000);
    const remaining = r.headers.get('x-rate-limit-remaining');
    const json = await r.json().catch(() => null);
    return { ok: r.ok && json?.status === 'success', remaining: remaining || '?' };
  } catch (e) { return { ok: false, error: e.message || 'Нет подключения' }; }
}

// ═══════════════════════════════════════════════
//  4. КЕШ (IndexedDB + память)
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

// ═══════════════════════════════════════════════
//  5. УТИЛИТЫ
// ═══════════════════════════════════════════════
function fetchT(url, ms, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}