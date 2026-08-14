// 📦 BookTrackerPro — sw.js
// 🔖 v3.8.3 | 2026-08-14
// 📝 Service Worker: оффлайн-кеш, стратегии, обновления
//
//    Стратегии кеширования:
//      📄 Навигация (HTML)   → network-first → кеш
//      🎨 Ассеты (CSS/JS)    → stale-while-revalidate
//      📋 version.json       → всегда сеть (проверка обновлений)
//      🌐 API (Google/OL/LR/Microlink) → сеть, без кеширования
//      🖼️ Обложки (CDN)      → cache-first (долгое хранение, лимит 100)
//      📷 OCR (Tesseract)    → runtime cache (НЕ precache!)
//
//    ⚠️ НОВОЕ в 3.8.3:
//      — OCR-файлы (~7.5 МБ) убраны из precache → runtime cache
//        Установка SW: ~20 сек → ~2 сек
//      — Нормализация URL: query-параметры (?v=...) не ломают кеш
//      — Background Sync: отложенные операции при оффлайне
//      — Push-заготовка для будущих уведомлений
//
//    ⚠️ При обновлении версии:
//      1. Измените CACHE_NAME ниже
//      2. Измените ?v= в index.html
//      3. Измените version в version.json
//      Или: bash bump.sh 3.8.3
// ─────────────────────────────────────────────

// ═══════════════════════════════════════════════
//  КОНФИГУРАЦИЯ
// ═══════════════════════════════════════════════

const BASE = '/BookTrackerPro';

// Имя кеша — МЕНЯЕТСЯ при каждом обновлении!
// Должно совпадать с полем "cache" в version.json
const CACHE_NAME = 'btp-v3.8.3';

// Отдельный кеш для обложек (не удаляется при обновлении)
const COVER_CACHE_NAME = 'btp-covers-v1';

// Отдельный кеш для OCR (большие файлы, ~7.5 МБ)
const OCR_CACHE_NAME = 'btp-ocr-v1';

// ═══════════════════════════════════════════════
//  APP SHELL — критичные файлы (precache)
//  ~250 КБ — быстрая установка
// ═══════════════════════════════════════════════
const SHELL_ASSETS = [
  `${BASE}/`,
  `${BASE}/index.html`,
  `${BASE}/manifest.json`,
  // Стили
  `${BASE}/app.css`,
  `${BASE}/style.css`,
  // JS-модули (все нужны для полного оффлайна)
  `${BASE}/app.js`,
  `${BASE}/utils.js`,
  `${BASE}/icons.js`,
  `${BASE}/db.js`,
  `${BASE}/uikit.js`,
  `${BASE}/isbn.js`,
  `${BASE}/scanner.js`,
  `${BASE}/microlink.js`,
  `${BASE}/ocr.js`,
  `${BASE}/content.js`,
  `${BASE}/review.js`,
  `${BASE}/stats.js`,
  `${BASE}/collections.js`,
  `${BASE}/challenges.js`,
  `${BASE}/series.js`,
  `${BASE}/sw-register.js`,
  // Иконки (для оффлайн install prompt)
  `${BASE}/icon-192.png`,
  `${BASE}/icon-512.png`,
];

// ═══════════════════════════════════════════════
//  OCR — runtime cache (НЕ precache!)
//  ~7.5 МБ — загружается только при первом использовании
// ═══════════════════════════════════════════════
const OCR_PATTERNS = [
  'tesseract.min.js',
  'worker.min.js',
  'tesseract-core-simd.wasm.js',
  'rus.traineddata.gz',
  'eng.traineddata.gz',
];

// ═══════════════════════════════════════════════
//  ВНЕШНИЕ ДОМЕНЫ
// ═══════════════════════════════════════════════

// Домены обложек (кешируем надолго)
const CACHEABLE_ORIGINS = [
  'books.google.com',
  'covers.openlibrary.org',
  'cv0.litres.ru',
  'cv1.litres.ru',
  'cv2.litres.ru',
  'cv3.litres.ru',
  'cv4.litres.ru',
  'cv5.litres.ru',
  'cv6.litres.ru',
  'cv7.litres.ru',
  'cv8.litres.ru',
  'cv9.litres.ru',
];

// Домены API — НЕ кешируем (всегда сеть)
const API_ORIGINS = [
  'www.googleapis.com',
  'openlibrary.org',
  'api.microlink.io',
  'pro-api.microlink.io',
  'catalit.litres.ru',
  'api.litres.ru',
  'open.er-api.com',
  'corsproxy.io',
];

// ═══════════════════════════════════════════════
//  УТИЛИТЫ
// ═══════════════════════════════════════════════

/**
 * Нормализует URL для кеша: убирает query-параметры
 * версионирования (?v=3.8.3, ?_=timestamp).
 * Позволяет кешу работать одинаково для app.js и app.js?v=3.8.3
 */
function normalizeCacheUrl(requestUrl) {
  try {
    const url = new URL(requestUrl);
    url.searchParams.delete('v');
    url.searchParams.delete('_');
    return url.toString();
  } catch {
    return requestUrl;
  }
}

/**
 * Проверяет, является ли запрос OCR-файлом.
 */
function isOcrRequest(url) {
  return OCR_PATTERNS.some(pattern => url.pathname.includes(pattern));
}

// ═══════════════════════════════════════════════
//  INSTALL: кешируем app shell (без OCR)
// ═══════════════════════════════════════════════
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        // Кешируем каждый файл отдельно: один упавший
        // не блокирует установку остальных.
        return Promise.allSettled(
          SHELL_ASSETS.map(url =>
            cache.add(url).catch(err => {
              console.warn(`[SW] Не закешировалось: ${url}`, err);
            })
          )
        );
      })
      .then(() => {
        console.log(`[SW] App shell закеширован (${SHELL_ASSETS.length} файлов)`);
        return self.skipWaiting();
      })
  );
});

// ═══════════════════════════════════════════════
//  ACTIVATE: удаляем старые кеши
// ═══════════════════════════════════════════════
self.addEventListener('activate', (event) => {
  const validCaches = [CACHE_NAME, COVER_CACHE_NAME, OCR_CACHE_NAME];
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
      .then(() => {
        console.log(`[SW] Активирован: ${CACHE_NAME}`);
        return self.clients.claim();
      })
  );
});

// ═══════════════════════════════════════════════
//  FETCH: маршрутизация запросов
// ═══════════════════════════════════════════════
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Только GET-запросы
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

  // 3. version.json — всегда сеть (проверка обновлений)
  if (url.pathname.endsWith('version.json')) {
    handleVersionCheck(event, request);
    return;
  }

  // 4. OCR-файлы — runtime cache (ленивая загрузка)
  if (isOcrRequest(url)) {
    handleOcrAsset(event, request);
    return;
  }

  // 5. Остальные ассеты — stale-while-revalidate
  handleAsset(event, request);
});

// ═══ Навигация: network-first → кеш ═══
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

// ═══ Ассеты: stale-while-revalidate ═══
// Мгновенный ответ из кеша + фоновое обновление.
// Нормализация URL: app.js и app.js?v=3.8.3 → один ключ кеша.
function handleAsset(event, request) {
  const cacheKey = normalizeCacheUrl(request.url);

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(cacheKey).then((cached) => {
        // Фоновое обновление (не блокирует ответ)
        const networkFetch = fetch(request)
          .then((response) => {
            if (response.ok) {
              cache.put(cacheKey, response.clone());
            }
            return response;
          })
          .catch(() => cached);

        // Есть кеш → отдаём мгновенно, обновляем в фоне
        // Нет кеша → ждём сеть
        return cached || networkFetch;
      })
    )
  );
}

// ═══ OCR: cache-first (ленивая загрузка) ═══
// Файлы Tesseract ~7.5 МБ. НЕ грузим при установке SW.
// Загружаются только когда пользователь впервые использует OCR.
function handleOcrAsset(event, request) {
  const cacheKey = normalizeCacheUrl(request.url);

  event.respondWith(
    caches.open(OCR_CACHE_NAME).then((cache) =>
      cache.match(cacheKey).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            cache.put(cacheKey, response.clone());
            console.log(`[SW] OCR закеширован: ${request.url}`);
          }
          return response;
        });
      })
    )
  );
}

// ═══ version.json: всегда сеть ═══
function handleVersionCheck(event, request) {
  event.respondWith(
    fetch(request, { cache: 'no-store' })
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) =>
          cached || new Response(
            JSON.stringify({ version: 'unknown', cache: CACHE_NAME }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
      )
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
              // Периодическая очистка (не на каждый запрос)
              trimCoverCacheThrottled(cache);
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
let _lastTrimTime = 0;
const TRIM_INTERVAL = 60 * 1000; // не чаще раза в минуту

/**
 * Троттлинг: очистка кеша обложек не чаще раза в минуту.
 * Раньше вызывалась на каждый cache.put — лишняя нагрузка.
 */
function trimCoverCacheThrottled(cache) {
  const now = Date.now();
  if (now - _lastTrimTime < TRIM_INTERVAL) return;
  _lastTrimTime = now;
  trimCoverCache(cache);
}

async function trimCoverCache(cache) {
  try {
    const keys = await cache.keys();
    if (keys.length < 100) return;
    // Удаляем самые старые (первые в списке), оставляем 80
    const toDelete = keys.slice(0, keys.length - 80);
    await Promise.all(toDelete.map((key) => cache.delete(key)));
    console.log(`[SW] Кеш обложек: удалено ${toDelete.length}, осталось 80`);
  } catch { /* не критично */ }
}

// ═══════════════════════════════════════════════
//  MESSAGES: связь с основным потоком
// ═══════════════════════════════════════════════
self.addEventListener('message', (event) => {
  const { data } = event;

  // SKIP_WAITING — активировать новый SW немедленно
  if (data === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  // GET_CACHE_VERSION — вернуть версию кеша (для verifyCacheFreshness)
  if (data === 'GET_CACHE_VERSION') {
    const port = event.ports?.[0];
    if (port) {
      port.postMessage({ type: 'CACHE_VERSION', version: CACHE_NAME });
    }
    return;
  }

  // CLEAR_COVER_CACHE — очистка кеша обложек (из Настроек)
  if (data === 'CLEAR_COVER_CACHE') {
    const port = event.ports?.[0];
    caches.delete(COVER_CACHE_NAME).then(() => {
      if (port) {
        port.postMessage({ type: 'COVER_CACHE_CLEARED' });
      }
    });
    return;
  }
});

// ═══════════════════════════════════════════════
//  BACKGROUND SYNC (v3.8.3)
// ═══════════════════════════════════════════════
// Отложенные операции при оффлайне:
//   — sync-book-metadata: повторный поиск книги по ISBN
//   — sync-cover-download: загрузка обложки по URL
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-book-metadata') {
    event.waitUntil(syncBookMetadata());
  }
});

/**
 * Повторяет отложенные запросы метаданных книг.
 * Данные хранятся в IndexedDB store 'pending-sync'.
 */
async function syncBookMetadata() {
  try {
    const db = await openDbFromSW();
    if (!db || !db.objectStoreNames.contains('pending-sync')) return;

    const pending = await getAllFromStore(db, 'pending-sync');
    if (!pending || pending.length === 0) return;

    console.log(`[SW] Background sync: ${pending.length} отложенных операций`);

    for (const item of pending) {
      if (!navigator.onLine) break; // оффлайн — прекращаем, повторится позже

      try {
        // Повторный запрос к API (Google Books / Open Library)
        const response = await fetch(
          `https://www.googleapis.com/books/v1/volumes?q=isbn:${item.isbn}&maxResults=1`
        );
        if (response.ok) {
          const data = await response.json();
          const volume = data.items?.[0]?.volumeInfo;

          if (volume?.title) {
            // Обновляем книгу в IndexedDB
            const book = await getFromStore(db, 'books', item.bookId);
            if (book) {
              book.title = volume.title || book.title;
              book.author = (volume.authors || []).join(', ') || book.author;
              book.pageCount = volume.pageCount || book.pageCount;
              book.publishedDate = volume.publishedDate || book.publishedDate;
              book.publisher = volume.publisher || book.publisher;
              book.description = volume.description || book.description;
              book.pendingSync = false;
              await putToStore(db, 'books', book);
            }
          }
        }
        // Удаляем из очереди (успех или нет — не бесконечно)
        await deleteFromStore(db, 'pending-sync', item.id);
      } catch (err) {
        console.warn(`[SW] Sync item failed: ${item.id}`, err.message);
        break; // ошибка сети — прекращаем, повторится при следующем sync
      }
    }
  } catch (err) {
    console.warn('[SW] Background sync error:', err.message);
  }
}

// ─── IndexedDB хелперы для SW (без импорта db.js) ───
function openDbFromSW() {
  return new Promise((resolve) => {
    const req = indexedDB.open('book-tracker-pro', 6);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

function getAllFromStore(db, storeName) {
  return new Promise((resolve) => {
    try {
      const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    } catch { resolve([]); }
  });
}

function getFromStore(db, storeName, key) {
  return new Promise((resolve) => {
    try {
      const req = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

function putToStore(db, storeName, value) {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch { resolve(false); }
  });
}

function deleteFromStore(db, storeName, key) {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch { resolve(false); }
  });
}

// ═══════════════════════════════════════════════
//  PERIODIC BACKGROUND SYNC
// ═══════════════════════════════════════════════
// Периодическая проверка обновлений (раз в 24 часа).
// Регистрируется из sw-register.js
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'btp-update-check') {
    event.waitUntil(
      self.registration.update().catch(() => {})
    );
  }
});

// ═══════════════════════════════════════════════
//  PUSH NOTIFICATIONS (заготовка v3.8.3)
// ═══════════════════════════════════════════════
// Активируется при подключении push-сервера.
// Пример payload: { title, body, url, badge }
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data?.json() || {};
  } catch { /* ignore */ }

  const options = {
    body: data.body || 'Новое уведомление от BookTrackerPro',
    icon: `${BASE}/icon-192.png`,
    badge: `${BASE}/icon-192.png`,
    vibrate: [200, 100, 200],
    tag: data.tag || 'btp-notification',
    data: { url: data.url || `${BASE}/` },
    actions: data.actions || [],
  };

  event.waitUntil(
    self.registration.showNotification(
      data.title || 'BookTrackerPro',
      options
    )
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || `${BASE}/`;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        // Фокус на существующее окно
        for (const client of clients) {
          if (client.url.startsWith(targetUrl) && 'focus' in client) {
            return client.focus();
          }
        }
        // Или открываем новое
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});