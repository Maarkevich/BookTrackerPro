// ═══════════════════════════════════════════════════════════════════
// 🔖 3.9.1 — ЭТАП 5: универсальный extractor страницы.
//
// Принимает ответ endpoint Worker (worker/worker.js, /fetch) и формирует
// envelope §4 спецификации v3.9.1:
//   — исходный URL, канонический URL (без tracking-параметров), домен;
//   — HTTP-статус и финальный URL;
//   — title страницы;
//   — очищенный видимый текст;
//   — очищенный HTML основного содержимого;
//   — JSON-LD всех типов;
//   — Open Graph и прочие meta;
//   — изображения (url/alt/caption/размеры);
//   — ссылки страницы;
//   — найденные ISBN-кандидаты (с проверкой контрольной суммы);
//   — ценовые фрагменты с ближайшим текстовым контекстом;
//   — предупреждения о неполной/динамической странице.
//
// Правила §4:
//   — из очищенного содержимого удаляются script, style, навигация,
//     footer, реклама, рекомендации; отзывы покупателей НЕ смешиваются
//     с описанием (вырезаются из основного текста);
//   — HTML считается НЕДОВЕРЕННЫМ: extractor ничего не исполняет, только
//     разбирает и нормализует данные (AI отдельно инструктируется не
//     выполнять инструкции из страницы).
//
// Модуль — ЧИСТЫЙ (html → envelope), без сети и без IndexedDB: сеть —
// в worker/worker.js и ai.js. Использует DOMParser (браузер / jsdom).
// ═══════════════════════════════════════════════════════════════════
import { cleanISBN, validateISBN } from './isbn.js';

export const MAX_VISIBLE_TEXT = 20000; // символов видимого текста
export const MIN_TEXT_FOR_JS = 200;    // меньше → подозрение на SPA/JS
export const MAX_IMAGES = 40;
export const MAX_LINKS = 200;
export const MAX_PRICES = 60;

const TEXT_LIMIT_JSONLD = 500;

// Селекторы явного «мусора», не относящегося к описанию книги.
const REMOVE_SELECTORS = [
  'script', 'style', 'noscript', 'template', 'iframe', 'svg', 'canvas',
  'nav', 'footer', 'header', 'aside', 'form', 'input', 'button',
  'select', 'textarea', 'dialog', '[role="navigation"]', '[role="banner"]',
  '[role="contentinfo"]', '[role="complementary"]', '[aria-hidden="true"]',
];

// Классы/id мусорных блоков (навигация, реклама, рекомендации, отзывы).
// Границы [\s_-] не дают 'preview' попасть под 'review', 'header' — под 'ad'.
const SEP = '(^|[\\s_-])';
const END = '($|[\\s_-])';
const REMOVE_CLASS_RES = [
  new RegExp(SEP + 'nav(igation)?' + END, 'i'),
  new RegExp('navbar', 'i'),
  new RegExp(SEP + 'menu' + END, 'i'),
  new RegExp(SEP + 'footer' + END, 'i'),
  new RegExp(SEP + 'sidebar' + END, 'i'),
  new RegExp('breadcrumb', 'i'),
  new RegExp('cookie', 'i'),
  new RegExp(SEP + 'popup' + END, 'i'),
  new RegExp(SEP + 'modal' + END, 'i'),
  new RegExp(SEP + 'banner' + END, 'i'),
  new RegExp('advert', 'i'),
  new RegExp(SEP + 'ad' + END, 'i'),
  new RegExp(SEP + 'related' + END, 'i'),
  new RegExp('recommend', 'i'),
  new RegExp('similar', 'i'),
  new RegExp('carousel', 'i'),
  new RegExp('slider', 'i'),
  new RegExp(SEP + 'social' + END, 'i'),
  new RegExp(SEP + 'share' + END, 'i'),
  new RegExp('subscribe', 'i'),
  new RegExp('newsletter', 'i'),
  new RegExp('promo', 'i'),
  new RegExp(SEP + 'review(s)?' + END, 'i'),
  new RegExp('otzyv', 'i'),
  new RegExp('recenz', 'i'),
];

const MAIN_SELECTORS = [
  'main', 'article', '[role="main"]',
  '[itemtype*="Book"]', '[itemtype*="Product"]',
  '#content', '#main', '#product', '.product-page', '.product-card',
  '.book-page', '.book-card', '.card-product',
];

const CURRENCY_MAP = {
  '₽': 'RUB', 'руб': 'RUB', 'р.': 'RUB', 'rub': 'RUB',
  '$': 'USD', 'usd': 'USD',
  '€': 'EUR', 'eur': 'EUR',
  '₸': 'KZT', 'тенге': 'KZT', 'kzt': 'KZT',
  '₴': 'UAH', 'грн': 'UAH', 'uah': 'UAH',
  '£': 'GBP', 'gbp': 'GBP',
};

// ═══════════════════════════════════════════════
//  URL: канонизация и удаление tracking
// ═══════════════════════════════════════════════
const TRACKING_PARAMS = [
  /^utm_/i, /^fbclid$/i, /^gclid$/i, /^yclid$/i, /^ymclid$/i, /^_openstat$/i,
  /^ref$/i, /^ref_/i, /^from$/i, /^from_/i, /^source$/i, /^spm$/i,
  /^mc_/i, /^pk_/i, /^trk_/i, /^roistat_/i, /^admitad/i, /^gad_source$/i,
  /^srsltid$/i, /^_ga$/i, /^_gl$/i,
];

/**
 * Удаляет партнёрские/tracking-параметры из URL (§2, §4).
 * @param {string} raw
 * @returns {string} — тот же URL без tracking-параметров (или исходный при ошибке)
 */
export function stripTracking(raw) {
  try {
    const u = new URL(raw);
    const drop = [];
    for (const key of u.searchParams.keys()) {
      if (TRACKING_PARAMS.some((re) => re.test(key))) drop.push(key);
    }
    for (const k of drop) u.searchParams.delete(k);
    u.hash = '';
    return u.toString();
  } catch {
    return raw || '';
  }
}

/**
 * Канонический URL: <link rel=canonical> → og:url → финальный → исходный,
 * затем снимаются tracking-параметры. Относительные резолвятся по base.
 * @param {Document} doc
 * @param {string} base
 * @param {string} finalUrl
 * @param {string} originalUrl
 * @returns {string}
 */
export function canonicalizeUrl(doc, base, finalUrl, originalUrl) {
  const link = doc.querySelector('link[rel="canonical"]')?.getAttribute('href')
    || doc.querySelector('meta[property="og:url"]')?.getAttribute('content')
    || finalUrl || originalUrl || '';
  if (!link) return '';
  try {
    return stripTracking(new URL(link, base).toString());
  } catch {
    return stripTracking(link);
  }
}

// ═══════════════════════════════════════════════
//  Очистка документа
// ═══════════════════════════════════════════════
function isJunkElement(el) {
  const id = el.getAttribute?.('id') || '';
  const cls = el.getAttribute?.('class') || '';
  if (!id && !cls) return false;
  return REMOVE_CLASS_RES.some((re) => re.test(id) || re.test(cls));
}

function removeJunk(root) {
  for (const sel of REMOVE_SELECTORS) {
    for (const el of Array.from(root.querySelectorAll(sel))) el.remove();
  }
  for (const el of Array.from(root.querySelectorAll('[id],[class]'))) {
    if (isJunkElement(el)) el.remove();
  }
}

/** Выбирает основной контейнер содержимого (наибольший по тексту). */
function pickMainContainer(doc) {
  let best = null;
  let bestLen = 0;
  for (const sel of MAIN_SELECTORS) {
    for (const el of Array.from(doc.querySelectorAll(sel))) {
      const len = (el.textContent || '').trim().length;
      if (len > bestLen) { best = el; bestLen = len; }
    }
  }
  if (best && bestLen > 200) return best;
  return doc.body || doc.documentElement;
}

/**
 * Очищает HTML основного содержимого и возвращает текст/HTML.
 * @param {Document} doc
 * @returns {{html: string, text: string, container: Element}}
 */
export function cleanContent(doc) {
  const container = pickMainContainer(doc).cloneNode(true);
  removeJunk(container);
  // Канонизация относительных ссылок не нужна в HTML — только в списках.
  const text = normalizeText(container.textContent || '');
  return {
    html: (container.innerHTML || '').trim().slice(0, MAX_VISIBLE_TEXT * 3),
    text: text.slice(0, MAX_VISIBLE_TEXT),
    container,
  };
}

/** Схлопывает пробелы/переводы строк, убирает NBSP. */
export function normalizeText(s) {
  return String(s || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .trim();
}

// ═══════════════════════════════════════════════
//  JSON-LD
// ═══════════════════════════════════════════════
/**
 * Собирает все JSON-LD объекты (с раскрытием @graph) из страницы.
 * @param {Document} doc
 * @returns {object[]}
 */
export function extractJsonLd(doc) {
  const out = [];
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const s of scripts) {
    const raw = (s.textContent || '').trim();
    if (!raw) continue;
    let parsed;
    try { parsed = JSON.parse(raw); } catch { continue; }
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(visit); return; }
      if (node['@graph']) visit(node['@graph']);
      const type = node['@type'];
      const types = Array.isArray(type) ? type : [type];
      if (types.some((t) => typeof t === 'string' && !t.startsWith('@'))) out.push(node);
    };
    visit(parsed);
  }
  return out;
}

/** Есть ли среди JSON-LD схема книги/товара. */
export function hasBookSchema(jsonLd) {
  const isBookType = (t) => typeof t === 'string' &&
    ['Book', 'Product', 'Audiobook', 'CreativeWork', 'BookSeries', 'Offer'].includes(t);
  return jsonLd.some((node) => {
    const type = node?.['@type'];
    return (Array.isArray(type) ? type : [type]).some(isBookType);
  });
}

// ═══════════════════════════════════════════════
//  meta (Open Graph и прочие)
// ═══════════════════════════════════════════════
/**
 * Собирает meta по property/name (первое значение каждого ключа).
 * @param {Document} doc
 * @returns {Record<string,string>}
 */
export function extractMeta(doc) {
  const meta = {};
  for (const m of doc.querySelectorAll('meta[property], meta[name]')) {
    const key = (m.getAttribute('property') || m.getAttribute('name') || '').trim();
    const content = (m.getAttribute('content') || '').trim();
    if (!key || !content || meta[key] !== undefined) continue;
    meta[key] = content;
  }
  return meta;
}

// ═══════════════════════════════════════════════
//  Изображения
// ═══════════════════════════════════════════════
/**
 * Изображения с alt/caption/размерами, абсолютные URL, дедупликация.
 * @param {Element} container
 * @param {string} base
 * @param {string} ogImage
 * @returns {Array<{url:string, alt:string, caption:string, width:number, height:number}>}
 */
export function extractImages(container, base, ogImage) {
  const out = [];
  const seen = new Set();
  const push = (url, alt, caption, width, height) => {
    const abs = absolutize(url, base);
    if (!abs || !/^https?:/i.test(abs) || seen.has(abs)) return;
    seen.add(abs);
    out.push({ url: abs, alt: alt || '', caption: caption || '', width: width || 0, height: height || 0 });
  };
  if (ogImage) push(ogImage, '', 'og:image', 0, 0);
  for (const img of container.querySelectorAll('img')) {
    if (out.length >= MAX_IMAGES) break;
    const src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-original');
    if (!src) continue;
    const fig = img.closest('figure');
    const cap = fig?.querySelector('figcaption')?.textContent?.trim() || '';
    push(src, img.getAttribute('alt') || '', cap,
      parseInt(img.getAttribute('width')) || img.naturalWidth || 0,
      parseInt(img.getAttribute('height')) || img.naturalHeight || 0);
  }
  return out;
}

// ═══════════════════════════════════════════════
//  Ссылки
// ═══════════════════════════════════════════════
/**
 * Абсолютные http(s)-ссылки страницы.
 * @param {Element} container
 * @param {string} base
 * @returns {Array<{href:string, text:string}>}
 */
export function extractLinks(container, base) {
  const out = [];
  const seen = new Set();
  for (const a of container.querySelectorAll('a[href]')) {
    if (out.length >= MAX_LINKS) break;
    const href = absolutize(a.getAttribute('href'), base);
    if (!href || !/^https?:/i.test(href) || seen.has(href)) continue;
    seen.add(href);
    out.push({ href, text: (a.textContent || '').trim().slice(0, 200) });
  }
  return out;
}

// ═══════════════════════════════════════════════
//  ISBN-кандидаты
// ═══════════════════════════════════════════════
const ISBN10_RE = /\b(?:\d[\s-]?){9}[\dXx]\b/g;
const ISBN13_RE = /\b97[89][\s-]?(?:\d[\s-]?){9}\d\b/g;

/**
 * Находит ISBN-кандидаты в тексте, meta и JSON-LD; проверяет checksum.
 * @param {string} text
 * @param {Record<string,string>} meta
 * @param {object[]} jsonLd
 * @returns {string[]} — уникальные валидные ISBN
 */
export function findIsbnCandidates(text, meta, jsonLd) {
  const found = new Set();
  const add = (raw) => {
    const s = cleanISBN(raw);
    if (validateISBN(s)) found.add(s);
  };

  const corpus = String(text || '');
  for (const re of [ISBN13_RE, ISBN10_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(corpus)) !== null) add(m[0]);
  }

  for (const key of ['book:isbn', 'books:isbn', 'isbn', 'citation_isbn']) {
    if (meta[key]) add(meta[key]);
  }

  for (const node of jsonLd) {
    for (const key of ['isbn', 'sku', 'gtin13', 'gtin']) {
      const v = node?.[key];
      if (typeof v === 'string') add(v);
    }
  }
  return Array.from(found);
}

// ═══════════════════════════════════════════════
//  Ценовые фрагменты
// ═══════════════════════════════════════════════
const PRICE_RE = new RegExp(
  '(?:' +
    '(?:₽|\\$|€|£|₸|₴)\\s?(\\d[\\d\\s.,]*\\d|\\d)' +        // $12.99 / ₽ 1 234
    '|(\\d[\\d\\s.,]*\\d|\\d)\\s?(?:₽|руб\\w*|р\\.|\\$|€|£|₸|тенге|грн|UAH|USD|EUR|RUB|KZT|GBP)' +
  ')',
  'gi'
);

function inferPriceType(context) {
  const c = context.toLowerCase();
  if (/электрон|e-?book|digital|digitalbook|цифров/.test(c)) return 'ebook';
  if (/аудио|audio|аудиокниг|mp3/.test(c)) return 'audio';
  if (/бумаж|печат|тверд|мягк|перепл|облож|буквал|paper|print|hardcover|paperback/.test(c)) return 'paper';
  return 'unknown';
}

function currencyFromToken(token) {
  const t = token.toLowerCase().replace(/\s+/g, '');
  for (const [k, v] of Object.entries(CURRENCY_MAP)) {
    if (t === k.toLowerCase() || t.startsWith(k.toLowerCase())) return v;
  }
  return 'RUB';
}

/**
 * Ценовые фрагменты с ближайшим контекстом и типом (§4, §8).
 * @param {Element} container
 * @returns {Array<{amount:number, currency:string, raw:string, context:string, type:string}>}
 */
export function findPriceCandidates(container) {
  const out = [];
  const seen = new Set();
  const walker = container.ownerDocument.createTreeWalker(container, 4 /* TEXT_NODE */);
  let node;
  while ((node = walker.nextNode())) {
    const text = node.nodeValue || '';
    if (!/\d/.test(text) || text.length > 400) continue;
    const parentContext = (node.parentElement?.textContent || text).trim();
    PRICE_RE.lastIndex = 0;
    let m;
    while ((m = PRICE_RE.exec(text)) !== null) {
      const raw = m[0];
      const numStr = (m[1] || m[2] || '').replace(/\s/g, '').replace(/,(\d{1,2})$/, '.$1').replace(/,/g, '');
      const amount = parseFloat(numStr);
      if (!isFinite(amount) || amount <= 0) continue;
      const currency = currencyFromToken(raw.replace(/[\d\s.,]/g, '') || 'RUB');
      const idx = Math.max(0, m.index - 60);
      const context = normalizeText(parentContext.slice(idx, m.index + raw.length + 60)).slice(0, 200);
      const key = `${amount}|${currency}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ amount, currency, raw: raw.trim(), context, type: inferPriceType(context) });
      if (out.length >= MAX_PRICES) return out;
    }
  }
  return out;
}

// ═══════════════════════════════════════════════
//  Главная функция
// ═══════════════════════════════════════════════
function absolutize(url, base) {
  if (!url) return '';
  try { return new URL(url, base || undefined).toString(); } catch { return ''; }
}

/**
 * Формирует универсальный envelope (§4) из ответа Worker.
 * @param {object} worker — ответ endpoint Worker
 *   ({url, finalUrl, domain, status, contentType, html, truncated, warnings})
 * @returns {object} envelope для AI-нормализации (этап 6)
 */
export function extractPage(worker = {}) {
  if (typeof DOMParser === 'undefined') {
    throw new Error('extractPage требует DOM (DOMParser) — вызывается в браузере/клиентском extractor.');
  }
  const htmlRaw = String(worker.html || '');
  const base = worker.finalUrl || worker.url || '';
  const doc = new DOMParser().parseFromString(htmlRaw, 'text/html');

  const meta = extractMeta(doc);
  const jsonLd = extractJsonLd(doc);
  const canonicalUrl = canonicalizeUrl(doc, base, worker.finalUrl, worker.url);
  const domain = worker.domain || (base ? safeHost(base) : '');

  const title = normalizeText(doc.title || meta['og:title'] || '').slice(0, 500);

  const { html: cleanHtml, text, container } = cleanContent(doc);

  const ogImage = meta['og:image'] || meta['twitter:image'] || '';
  const images = extractImages(container, base, ogImage);
  const links = extractLinks(container, base);
  const isbnCandidates = findIsbnCandidates(text, meta, jsonLd);
  const priceCandidates = findPriceCandidates(container);

  const warnings = [...(Array.isArray(worker.warnings) ? worker.warnings : [])];
  const requiresJs = text.length < MIN_TEXT_FOR_JS || (text.length < 600 && !hasBookSchema(jsonLd) && !meta['og:title']);
  if (requiresJs) {
    warnings.push('Страница содержит мало данных — возможно, содержимое подгружается JavaScript.');
  }
  if (worker.truncated) warnings.push('HTML был обрезан по лимиту размера — часть данных могла не попасть.');
  if (!title) warnings.push('Не удалось определить заголовок страницы.');
  if (jsonLd.length === 0) warnings.push('На странице нет JSON-LD — данные могут быть неполными.');

  return {
    url: worker.url || '',
    canonicalUrl,
    domain,
    status: worker.status ?? 0,
    finalUrl: worker.finalUrl || worker.url || '',
    title,
    text,
    html: cleanHtml,
    jsonLd,
    hasBookSchema: hasBookSchema(jsonLd),
    meta,
    images,
    links,
    isbnCandidates,
    priceCandidates,
    requiresJs,
    warnings,
    extractedAt: new Date().toISOString(),
  };
}

function safeHost(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}
