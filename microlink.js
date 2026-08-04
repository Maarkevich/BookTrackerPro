// ─────────────────────────────────────────────
// 📦 BookTrackerPro — microlink.js
// 🔖 v3.6.0 | 2026-08-04
// 📝 Microlink API:
//      — превью ссылок (контент-план)
//      — ГЛУБОКОЕ извлечение книги по ссылке на магазин
//        (html=true → локальный парсинг JSON-LD + OG + microdata)
//      — НОВОЕ: extractBookPreview() — извлечение ВСЕХ найденных
//        полей для окна предпросмотра с ручным маппингом
//
//    Лимиты:
//      — Бесплатно: 25 запросов/день без ключа
//        (предохранитель приложения — 20)
//      — С ключом: pro.microlink.io + заголовок x-api-key
//
//    Ключ задаётся в Настройках → «Microlink API».
//    app.js вызывает setMicrolinkApiKey() при старте и сохранении.
//
//    Кеш: IndexedDB store 'previews' (db.js v5), TTL 7 дней.
// ─────────────────────────────────────────────
import { openDB } from './db.js';

// ═══════════════════════════════════════════════
//  КОНФИГУРАЦИЯ
// ═══════════════════════════════════════════════
const MICROLINK_FREE = 'https://api.microlink.io';
const MICROLINK_PRO  = 'https://pro.microlink.io';
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const DAILY_LIMIT_FREE = 20;
const DAILY_LIMIT_PRO = 1000;

let _dailyCount = 0;
let _dailyReset = startOfDay() + 86400000;
const _memCache = new Map();
let _apiKey = '';

function startOfDay() { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); }

// ═══════════════════════════════════════════════
//  0. API-КЛЮЧ
// ═══════════════════════════════════════════════
export function setMicrolinkApiKey(key) {
_apiKey = (key || '').trim();
_dailyCount = 0;
_dailyReset = startOfDay() + 86400000;
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
async function microlinkFetch(path, timeout) {
return fetchT(`${baseUrl()}${path}`, timeout, { headers: authHeaders() });
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
const r = await microlinkFetch(`/?url=${encodeURIComponent(url)}`, 10000);
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
//  2. ГЛУБОКОЕ ИЗВЛЕЧЕНИЕ КНИГИ (html=true)
//     Возвращает ТОЛЬКО готовый объект (для isbn.js)
// ═══════════════════════════════════════════════
export async function extractBookFromPage(url, opts = {}) {
const full = await extractBookPreview(url, opts);
return full ? full.merged : null;
}

// ═══════════════════════════════════════════════
//  3. ПОЛНЫЙ ПРЕДПРОСМОТР (НОВОЕ в v3.6.0)
//     Возвращает { merged, fields, url, source }
//     fields — ВСЕ найденные поля для ручного маппинга
// ═══════════════════════════════════════════════
/**
* Извлекает МАКСИМУМ данных со страницы магазина и возвращает
* как готовый объект, так и полный список найденных полей.
*
* @param {string} url — ссылка на страницу книги
* @param {{force?: boolean}} opts
* @returns {Promise<{merged: object, fields: Array, url: string, source: string}|null>}
*/
export async function extractBookPreview(url, opts = {}) {
if (!url || !/^https?:\/\//i.test(url)) return null;
const key = 'book:' + url.toLowerCase();

if (!opts.force) {
const c = await getCached(key);
if (c && c.type === 'book') return { merged: c.book, fields: c.fields || [], url, source: detectSource(url) };
}
if (!canRequest()) {
const c = await getCached(key);
return c && c.type === 'book' ? { merged: c.book, fields: c.fields || [], url, source: detectSource(url) } : null;
}
try {
const params = new URLSearchParams({
url,
html: 'true',
waitForTimeout: '2000'
});
const r = await microlinkFetch(`/?${params}`, 20000);
if (r.status === 429) {
const c = await getCached(key);
return c && c.type === 'book' ? { merged: c.book, fields: c.fields || [], url, source: detectSource(url) } : null;
}
if (!r.ok) return null;
const json = await r.json();
if (json.status !== 'success' || !json.data) return null;
_dailyCount++;

const html = json.data.html || '';
const { book, fields } = parseBookHtmlFull(html, json.data, url);

if (book && book.title && !looksBlocked(html, book.title)) {
await putCached(key, { type: 'book', book, fields, cachedAt: Date.now() });
return { merged: book, fields, url, source: detectSource(url) };
}
return null;
} catch (e) {
console.warn('[Microlink] extractBookPreview:', e.message);
return null;
}
}

// ═══════════════════════════════════════════════
//  4. ПАРСЕР HTML (полный: merged + fields)
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
...collectMicrolinkFields(mlData),
];

// Нумеруем для стабильных ключей в UI
fields.forEach((f, i) => { f.id = `f${i}`; });

return { book: merged, fields };
}

// ─── 4.1 JSON-LD ───
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

/** Собирает ВСЕ поля JSON-LD узла для предпросмотра */
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

// Специальная обработка составных объектов
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
if (key === 'image') {
push(key, imageUrl(raw));
continue;
}
if (key === 'genre' || key === 'about' || key === 'keywords') {
push(key, firstOf(raw));
continue;
}

// Примитивы и простые массивы
const v = readableValue(raw);
if (v) push(key, v);
}
return fields;
}

/** Читает значение произвольного JSON-LD поля в строку */
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

// ─── 4.2 Open Graph ───
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

/** Собирает ВСЕ meta-теги (OG + book + twitter + обычные) для предпросмотра */
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

// ─── 4.3 Microdata (itemprop) ───
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

/** Собирает ВСЕ itemprop-элементы для предпросмотра */
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

// ─── 4.4 Дефолты Microlink ───
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

// ─── 4.5 Слияние с приоритетом ───
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
//  5. ПРОВЕРКА ДОСТУПНОСТИ (для Настроек)
// ═══════════════════════════════════════════════
export async function checkMicrolinkStatus(apiKey) {
const prevKey = _apiKey;
if (apiKey !== undefined) _apiKey = (apiKey || '').trim();
try {
const r = await microlinkFetch('/?url=https://example.com', 6000);
const remaining = r.headers.get('x-rate-limit-remaining');
const json = await r.json().catch(() => null);
return {
ok: r.ok && json?.status === 'success',
remaining: remaining || '?',
mode: hasKey() ? 'pro' : 'free',
};
} catch (e) {
return { ok: false, error: e.message || 'Нет подключения', mode: hasKey() ? 'pro' : 'free' };
} finally {
if (apiKey !== undefined) _apiKey = prevKey;
}
}

// ═══════════════════════════════════════════════
//  6. КЕШ (IndexedDB + память)
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
//  7. УТИЛИТЫ
// ═══════════════════════════════════════════════
function fetchT(url, ms, opts = {}) {
const ctrl = new AbortController();
const timer = setTimeout(() => ctrl.abort(), ms);
return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}