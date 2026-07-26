// ─────────────────────────────────────────────
// 📦 BookTrackerPro — sw.js
// 🔖 v3.3.0 | 2026-07-25
// 📝 Service Worker: полный оффлайн
//
//    Стратегии кеширования:
//      📄 Навигация (HTML)   → network-first → кеш
//      🎨 Ассеты (CSS/JS)    → cache-first + фоновое обновление
//      📋 version.json       → всегда сеть (проверка обновлений)
//      🌐 API (Google/OL/LR) → сеть, без кеширования
//      🖼️ Обложки (CDN)      → cache-first (долгое хранение)
//      📷 OCR (Tesseract)    → precache (полный оффлайн)
//
// ⚠️ При обновлении версии:
//    1. Измените CACHE_NAME ниже
//    2. Измените ?v= в index.html
//    3. Измените version в version.json
//    Или: bash bump.sh 3.4.0
// ─────────────────────────────────────────────

// ═══════════════════════════════════════════════
//  КОНФИГУРАЦИЯ
// ═══════════════════════════════════════════════

// Имя кеша — МЕНЯЕТСЯ при каждом обновлении!
const CACHE_NAME = 'btp-v3.3.0';

// Базовый путь (GitHub Pages: /BookTrackerPro; свой домен: '')
const BASE = '/BookTrackerPro';

// App shell — критичные файлы (кешируются при установке)
const SHELL_ASSETS = [
  `${BASE}/`,
  `${BASE}/index.html`,
  `${BASE}/app.css`,
  `${BASE}/app.js`,
  `${BASE}/db.js`,
  `${BASE}/isbn.js`,
  `${BASE}/scanner.js`,
  `${BASE}/content.js`,
  `${BASE}/review.js`,
  `${BASE}/stats.js`,
  `${BASE}/collections.js`,
  `${BASE}/challenges.js`,
  `${BASE}/series.js`,
  `${BASE}/ocr.js`,
  `${BASE}/sw-register.js`,
  `${BASE}/manifest.json`,
  `${BASE}/version.json`,
  `${BASE}/icon-192.png`,
  `${BASE}/icon-512.png`,
];

// OCR (Tesseract) — большие файлы, кешируются для полного оффлайна
// Суммарно ~7.5 МБ. Без них OCR не будет работать без интернета.
const OCR_ASSETS = [
  `${BASE}/tesseract.min.js`,
  `${BASE}/worker.min.js`,
  `${BASE}/tesseract-core-simd.wasm.js`,
  `${BASE}/rus.traineddata.gz`,
  // Раскомментируйте, если скачали английский:
  // `${BASE}/eng.traineddata.gz`,
];

// Домены обложек (кешируем надолго)
const CACHEABLE_ORIGINS = [
  'books.google.com',
  'covers.openlibrary.org',
  'cv0.litres.ru', 'cv1.litres.ru', 'cv2.litres.ru', 'cv3.litres.ru',
  'cv4.litres.ru', 'cv5.litres.ru', 'cv6.litres.ru', 'cv7.litres.ru',
  'cv8.litres.ru', 'cv9.litres.ru',
];

// Домены API — НЕ кешируем (всегда сеть)
const API_ORIGINS = [
  'www.googleapis.com',
  'openlibrary.org',
  'catalit.litres.ru',
  'api.litres.ru',
  'open.er-api.com', // курсы валют
];

// Отдельный кеш для обложек
const COVER_CACHE_NAME = 'btp-covers-v1';

// ═══════════════════════════════════════════════
//  INSTALL: кешируем app shell + OCR
// ═══════════════════════════════════════════════

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        // Кешируем каждый файл отдельно: один упавший
        // не блокирует установку остальных.
        // OCR-файлы большие — качаются параллельно.
        return Promise.allSettled(
          [...SHELL_ASSETS, ...OCR_ASSETS].map(url =>
            cache.add(url).catch(err => {
              console.warn(`[SW] Не закешировалось: ${url}`, err);
            })
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

// ═══════════════════════════════════════════════
//  ACTIVATE: удаляем старые кеши
// ═══════════════════════════════════════════════

self.addEventListener('activate', (event) => {
  const validCaches = [CACHE_NAME, COVER_CACHE_NAME];

  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !validCaches.includes(key))
            .map((key) => {
              console.log(`[SW] Удаляю старый кеш: ${key}`);
              return caches.delete(key);
            })
        )
      )
      .then(() => self.clients.claim())
  );
});

// ═══════════════════════════════════════════════
//  FETCH: маршрутизация запросов
// ═══════════════════════════════════════════════

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 1. Чужие домены
  if (url.origin !== self.location.origin) {
    handleExternalRequest(event, url);
    return;
  }

  // 2. Навигация (HTML)
  if (request.mode === 'navigate') {
    handleNavigation(event, request);
    return;
  }

  // 3. version.json — всегда сеть
  if (url.pathname.endsWith('version.json')) {
    handleVersionCheck(event, request);
    return;
  }

  // 4. Остальные ассеты
  handleAsset(event, request);
});

// ═══ Навигация: network-first ═══
function handleNavigation(event, request) {
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) =>
          cached || caches.match(`${BASE}/index.html`)
        )
      )
  );
}

// ═══ version.json: network-first ═══
function handleVersionCheck(event, request) {
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
}

// ═══ Ассеты: cache-first + revalidate ═══
function handleAsset(event, request) {
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
}

// ═══ Внешние запросы ═══
function handleExternalRequest(event, url) {
  const hostname = url.hostname;

  // API: только сеть, без кеширования
  if (API_ORIGINS.some((origin) => hostname.includes(origin))) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(
          JSON.stringify({ error: 'offline', message: 'Нет подключения к интернету' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    return;
  }

  // Обложки: cache-first (долгое хранение)
  if (CACHEABLE_ORIGINS.some((origin) => hostname.includes(origin))) {
    event.respondWith(
      caches.open(COVER_CACHE_NAME).then((cache) =>
        cache.match(event.request).then((cached) => {
          if (cached) return cached;
          return fetch(event.request).then((response) => {
            if (response.ok) {
              cache.put(event.request, response.clone());
              trimCoverCache(cache);
            }
            return response;
          });
        })
      )
    );
    return;
  }

  // Остальные внешние: сеть без кеширования
  event.respondWith(
    fetch(event.request).catch(() => new Response('', { status: 503 }))
  );
}

// ═══════════════════════════════════════════════
//  ОГРАНИЧЕНИЕ КЕША ОБЛОЖЕК
// ═══════════════════════════════════════════════

async function trimCoverCache(cache) {
  try {
    const keys = await cache.keys();
    if (keys.length < 100) return;
    const toDelete = keys.slice(0, keys.length - 80);
    await Promise.all(toDelete.map((key) => cache.delete(key)));
  } catch { /* не критично */ }
}

// ═══════════════════════════════════════════════
//  MESSAGES: управление от клиента
// ═══════════════════════════════════════════════

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (event.data === 'GET_CACHE_VERSION') {
    event.source?.postMessage({ type: 'CACHE_VERSION', version: CACHE_NAME });
    return;
  }

  if (event.data === 'CLEAR_COVER_CACHE') {
    caches.delete(COVER_CACHE_NAME).then(() => {
      event.source?.postMessage({ type: 'COVER_CACHE_CLEARED' });
    });
    return;
  }
});

// ═══════════════════════════════════════════════
//  PERIODIC BACKGROUND SYNC (Chrome Android)
// ═══════════════════════════════════════════════

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'btp-update-check') {
    event.waitUntil(
      fetch(`${BASE}/version.json`)
        .then((r) => r.json())
        .then((data) => console.log(`[SW] Periodic check: v${data.version}`))
        .catch(() => { /* оффлайн */ })
    );
  }
});