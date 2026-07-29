// ─────────────────────────────────────────────
// 📦 BookTrackerPro — microlink.js
// 🔖 v3.4.0 | 2026-07-29
// 📝 Microlink API: превью ссылок + извлечение
//    данных книг со страниц магазинов
//
//    Бесплатно: 50 запросов/день без ключа.
//    Docs: https://microlink.io/docs/api
//
//    Использование:
//      — content.js  → превью publishedUrl (YouTube/TikTok/Telegram...)
//      — app.js      → «Вставить ссылку на книгу» в форме
//      — isbn.js     → фолбэк извлечения данных с ЛитРес
//      — Настройки   → проверка доступности
//
//    Кеш: IndexedDB store 'previews' (db.js v5) + память.
//    Повторные URL не тратят дневной лимит.
// ─────────────────────────────────────────────

import { openDB } from './db.js';

const MICROLINK_API = 'https://api.microlink.io';

// TTL кеша превью — 7 дней
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

// Дневной лимит (запас от 50, чтобы не упереться в 429)
const DAILY_LIMIT = 45;
let _dailyCount = 0;
let _dailyReset = startOfDay() + 86400000;

// Кеш в памяти на текущую сессию
const _memCache = new Map();

function startOfDay() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function canRequest() {
  if (Date.now() > _dailyReset) {
    _dailyCount = 0;
    _dailyReset = startOfDay() + 86400000;
  }
  return _dailyCount < DAILY_LIMIT;
}

// ═══════════════════════════════════════════════
//  1. ПРЕВЬЮ ССЫЛКИ (метаданные страницы)
// ═══════════════════════════════════════════════

/**
 * Извлекает метаданные страницы: title, description, image, publisher...
 * Сначала кеш, затем Microlink.
 *
 * @param {string} url
 * @param {{force?: boolean}} opts — force игнорирует кеш (но не лимит)
 * @returns {Promise<object|null>}
 */
export async function fetchLinkPreview(url, opts = {}) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const key = url.toLowerCase();

  // 1. Кеш
  if (!opts.force) {
    const cached = await getCached(key);
    if (cached) return cached;
  }

  // 2. Лимит — если исчерпан, возвращаем кеш даже при force
  if (!canRequest()) {
    return getCached(key);
  }

  // 3. Запрос к Microlink
  try {
    const r = await fetchT(
      `${MICROLINK_API}/?url=${encodeURIComponent(url)}`,
      10000
    );
    if (r.status === 429) {
      console.warn('[Microlink] Rate limit (429) — использую кеш');
      return getCached(key);
    }
    if (!r.ok) return null;

    const json = await r.json();
    if (json.status !== 'success' || !json.data) return null;

    _dailyCount++;
    const preview = normalize(json.data, url);
    await putCached(key, preview);
    return preview;
  } catch (e) {
    console.warn('[Microlink] Ошибка:', e.message);
    return null;
  }
}

/**
 * Приводит ответ Microlink к единому формату.
 */
function normalize(data, url) {
  return {
    url,
    title: data.title || '',
    description: data.description || '',
    image: data.image?.url || '',
    imageWidth: data.image?.width || 0,
    imageHeight: data.image?.height || 0,
    logo: data.logo?.url || '',
    publisher: data.publisher || '',
    author: data.author || '',
    date: data.date || '',
    lang: data.lang || '',
    source: detectSource(url),
    cachedAt: Date.now(),
  };
}

/**
 * Определяет площадку по URL (для иконки в контент-плане).
 */
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
  } catch {
    return 'web';
  }
}

// ═══════════════════════════════════════════════
//  2. ИЗВЛЕЧЕНИЕ КНИГИ СО СТРАНИЦЫ МАГАЗИНА
// ═══════════════════════════════════════════════

/**
 * Извлекает данные книги со страницы ЛитРес / Book24 / Ozon и т.п.
 * Microlink выступает как CORS-прокси + парсер OG-тегов и JSON-LD.
 *
 * @param {string} url — ссылка на страницу книги
 * @returns {Promise<object|null>} — формат как в isbn.js (source: 'microlink')
 */
export async function extractBookFromPage(url) {
  const p = await fetchLinkPreview(url, { force: true });
  if (!p || !p.title) return null;

  let title = p.title;
  let author = p.author || '';

  // Магазины часто пишут «Название — Автор» в og:title
  if (!author && title.includes(' — ')) {
    const parts = title.split(' — ');
    title = parts[0].trim();
    author = parts.slice(1).join(' — ').trim();
  }

  // Отрезаем хвосты типа «— купить на ЛитРес»
  const tail = /\s*[—–-]\s*(купить|скачать|читать|слушать|заказать).*$/i;
  title = title.replace(tail, '').trim();
  author = author.replace(tail, '').trim();

  // Для магазинов publisher из OG — это сам магазин, а не издательство
  const isStore = ['litres', 'web'].includes(p.source) === false;
  const publisher = p.source === 'web' ? p.publisher : '';

  return {
    title,
    author,
    cover: p.image,
    description: p.description,
    genre: '',
    publisher,
    publishedDate: p.date ? String(p.date).slice(0, 4) : '',
    pageCount: 0,
    isbn: '',
    source: 'microlink',
    litresUrl: url,
    // подавляем неиспользуемую переменную
    _isStore: isStore,
  };
}

// ═══════════════════════════════════════════════
//  3. ПРОВЕРКА ДОСТУПНОСТИ (для Настроек)
// ═══════════════════════════════════════════════

/**
 * Проверяет, отвечает ли Microlink, и сколько запросов осталось.
 * @returns {Promise<{ok: boolean, remaining?: string, error?: string}>}
 */
export async function checkMicrolinkStatus() {
  try {
    const r = await fetchT(`${MICROLINK_API}/?url=https://example.com`, 6000);
    const remaining = r.headers.get('x-rate-limit-remaining');
    const json = await r.json().catch(() => null);
    return {
      ok: r.ok && json?.status === 'success',
      remaining: remaining || '?',
    };
  } catch (e) {
    return { ok: false, error: e.message || 'Нет подключения' };
  }
}

// ═══════════════════════════════════════════════
//  4. КЕШ (IndexedDB + память)
// ═══════════════════════════════════════════════

async function getCached(key) {
  // Память
  if (_memCache.has(key)) {
    const item = _memCache.get(key);
    if (Date.now() - item.cachedAt < CACHE_TTL) return item;
    _memCache.delete(key);
  }
  // IndexedDB
  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains('previews')) return null;
    return await new Promise((resolve) => {
      const req = db.transaction('previews', 'readonly')
        .objectStore('previews').get(key);
      req.onsuccess = () => {
        const item = req.result;
        if (item && Date.now() - item.cachedAt < CACHE_TTL) {
          _memCache.set(key, item);
          resolve(item);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function putCached(key, preview) {
  _memCache.set(key, preview);
  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains('previews')) return;
    const tx = db.transaction('previews', 'readwrite');
    tx.objectStore('previews').put({ ...preview, id: key });
  } catch {
    /* кеш — не критично */
  }
}

/**
 * Очищает кеш превью (для Настроек → «Данные»).
 */
export async function clearPreviewCache() {
  _memCache.clear();
  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains('previews')) return;
    await new Promise((resolve) => {
      const tx = db.transaction('previews', 'readwrite');
      tx.objectStore('previews').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* ignore */ }
}

// ═══════════════════════════════════════════════
//  5. УТИЛИТЫ
// ═══════════════════════════════════════════════

function fetchT(url, ms, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal })
    .finally(() => clearTimeout(timer));
}