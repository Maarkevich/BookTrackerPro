// 📦 BookTrackerPro — sw-register.js
// 🔖 v3.8.2 | 2026-08-09
// 📝 Регистрация Service Worker + логика обновлений
//
//    Что делает:
//      1. Регистрирует sw.js (с повторной попыткой при неудаче)
//      2. Проверяет обновления (не чаще 1 раза в час)
//      3. Показывает баннер «Доступно обновление»
//      4. Перезагружает страницу после активации нового SW
//      5. Регистрирует periodic background sync
//      6. Индикатор онлайн/оффлайн
//      7. verifyCacheFreshness(): сверка версии кеша с version.json
//        и принудительное обновление при расхождении
//        (защита от «вечно старого кеша» после деплоя)
//
//    Поток обновления:
//      reg.update() → updatefound → installing →
//      installed (есть controller) → баннер →
//      «Обновить» → SKIP_WAITING → activate →
//      controllerchange → reload
//
//    Новое в 3.7.0:
//      — Повторная попытка регистрации SW при неудаче
//        (оффлайн при первом запуске больше не ломает PWA)
//      — Улучшенная обработка ошибок регистрации
//      — Логирование версии кеша при старте (для отладки)
// ─────────────────────────────────────────────

// ═══════════════════════════════════════════════
//  КОНФИГУРАЦИЯ
// ═══════════════════════════════════════════════

// Должен совпадать с BASE в sw.js
const BASE = '/BookTrackerPro';
const SW_PATH = `${BASE}/sw.js`;
const SW_SCOPE = `${BASE}/`;
const VERSION_URL = `${BASE}/version.json`;

// Интервал проверки обновлений (мс)
const UPDATE_CHECK_INTERVAL = 60 * 60 * 1000; // 1 час

// Максимум повторных попыток регистрации SW
const MAX_REGISTER_RETRIES = 3;

// ═══════════════════════════════════════════════
//  СОСТОЯНИЕ
// ═══════════════════════════════════════════════
let _registration = null;
let _lastUpdateCheck = 0;
let _updateBannerShown = false;
let _reloading = false;

// ═══════════════════════════════════════════════
//  1. РЕГИСТРАЦИЯ SERVICE WORKER
// ═══════════════════════════════════════════════

/**
* Регистрирует Service Worker.
* При неудаче (например, оффлайн при первом запуске) повторяет
* попытку до MAX_REGISTER_RETRIES раз с увеличивающейся задержкой.
*/
export async function registerSW() {
if (!('serviceWorker' in navigator)) {
console.warn('[SW] Service Worker не поддерживается');
return;
}

const isSecure = location.protocol === 'https:'
|| location.hostname === 'localhost'
|| location.hostname === '127.0.0.1';

if (!isSecure) {
console.warn('[SW] Нужен HTTPS или localhost');
return;
}

// Повторные попытки регистрации (защита от оффлайна при первом запуске)
let lastError = null;
for (let attempt = 1; attempt <= MAX_REGISTER_RETRIES; attempt++) {
try {
_registration = await navigator.serviceWorker.register(SW_PATH, { scope: SW_SCOPE });
console.log('[SW] Зарегистрирован, scope:', _registration.scope);

// Логируем версию кеша для отладки
getCacheVersion().then(v => {
if (v) console.log('[SW] Активная версия кеша:', v);
});

// Обнаружение нового SW
_registration.addEventListener('updatefound', () => {
const newWorker = _registration.installing;
if (!newWorker) return;

console.log('[SW] Найден новый Service Worker');

newWorker.addEventListener('statechange', () => {
// Новый SW установлен И есть активный контроллер → это обновление
if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
console.log('[SW] Новый SW готов к активации');
showUpdateBanner(newWorker);
}
});
});

// Перезагрузка после активации нового SW
navigator.serviceWorker.addEventListener('controllerchange', () => {
if (_reloading) return;
_reloading = true;
console.log('[SW] Контроллер изменился — перезагружаю');
window.location.reload();
});

setupPeriodicUpdateCheck();
setupPeriodicSync();

// Проверяем, нет ли уже ожидающего SW
if (_registration.waiting) {
showUpdateBanner(_registration.waiting);
}

// 🆕 v3.5.0+: сверка свежести кеша (чуть откладываем, чтобы не мешать старту)
setTimeout(() => verifyCacheFreshness(), 4000);

// Успешная регистрация — выходим из цикла
return;

} catch (error) {
lastError = error;
console.warn(`[SW] Попытка регистрации ${attempt}/${MAX_REGISTER_RETRIES} не удалась:`, error.message);

// Если это последняя попытка — выходим
if (attempt === MAX_REGISTER_RETRIES) break;

// Ждём перед следующей попыткой (экспоненциальная задержка)
await new Promise(r => setTimeout(r, 2000 * attempt));
}
}

// Все попытки исчерпаны
console.error('[SW] Регистрация не удалась после всех попыток:', lastError);

// Даже без SW приложение работает — просто без оффлайн-кеша.
// Повторим регистрацию при следующем появлении сети.
window.addEventListener('online', async function retryOnOnline() {
window.removeEventListener('online', retryOnOnline);
try {
_registration = await navigator.serviceWorker.register(SW_PATH, { scope: SW_SCOPE });
console.log('[SW] Зарегистрирован после восстановления сети');
setupPeriodicUpdateCheck();
setupPeriodicSync();
setTimeout(() => verifyCacheFreshness(), 4000);
} catch (e) {
console.warn('[SW] Повторная регистрация не удалась:', e.message);
}
}, { once: true });
}

// ═══════════════════════════════════════════════
//  2. ПРОВЕРКА ОБНОВЛЕНИЙ
// ═══════════════════════════════════════════════

function setupPeriodicUpdateCheck() {
// При фокусе на вкладку
document.addEventListener('visibilitychange', () => {
if (document.visibilityState === 'visible') checkForUpdate();
});

// При восстановлении сети
window.addEventListener('online', () => checkForUpdate());

// Первая проверка через 10 секунд
setTimeout(() => checkForUpdate(), 10_000);
}

async function checkForUpdate() {
if (!_registration) return;

const now = Date.now();
if (now - _lastUpdateCheck < UPDATE_CHECK_INTERVAL) return;
_lastUpdateCheck = now;

try {
await _registration.update();
console.log('[SW] Проверка обновления выполнена');
} catch (error) {
console.warn('[SW] Проверка обновления не удалась:', error.message);
}
}

// ═══════════════════════════════════════════════
//  3. СВЕЖЕСТЬ КЕША (v3.5.0+)
// ═══════════════════════════════════════════════

/**
* Сверяет ожидаемую версию кеша (поле cache в version.json)
* с фактической версией активного SW. При расхождении —
* принудительно запрашивает обновление.
*
* Защищает от сценария, когда деплой уже содержит новый CACHE_NAME,
* но браузер продолжает использовать старый SW со старым кешем
* (например, после долгой работы в фоне или пропуска обновления).
*/
async function verifyCacheFreshness() {
if (!_registration) return;

try {
// cache-busting, чтобы гарантированно получить свежий version.json
const r = await fetch(`${VERSION_URL}?_=${Date.now()}`, { cache: 'no-store' });
if (!r.ok) return;

const meta = await r.json();
const expected = meta.cache;
if (!expected) return;

const actual = await getCacheVersion();

if (actual && actual !== expected) {
console.log(`[SW] Кеш устарел (${actual} → ${expected}) — запрашиваю обновление`);
_lastUpdateCheck = 0; // сброс троттлинга
await _registration.update();
}
} catch (e) {
console.warn('[SW] Проверка свежести кеша не удалась:', e.message);
}
}

// ═══════════════════════════════════════════════
//  4. БАННЕР ОБНОВЛЕНИЯ
// ═══════════════════════════════════════════════

function showUpdateBanner(worker) {
if (_updateBannerShown) return;
_updateBannerShown = true;

const banner = document.getElementById('update-banner');

if (!banner) {
createUpdateBanner(worker);
return;
}

banner.classList.remove('hidden');

const applyBtn = document.getElementById('update-apply');
if (applyBtn) {
const newBtn = applyBtn.cloneNode(true);
applyBtn.parentNode.replaceChild(newBtn, applyBtn);
newBtn.addEventListener('click', () => {
activateNewWorker(worker);
banner.classList.add('hidden');
});
}

const dismissBtn = document.getElementById('update-dismiss');
if (dismissBtn) {
const newBtn = dismissBtn.cloneNode(true);
dismissBtn.parentNode.replaceChild(newBtn, dismissBtn);
newBtn.addEventListener('click', () => {
banner.classList.add('hidden');
_updateBannerShown = false;
});
}
}

function createUpdateBanner(worker) {
const banner = document.createElement('div');
banner.className = 'update-banner';
banner.innerHTML = `
<span>↻ Доступна новая версия</span>
<button class="btn-small" id="dyn-update-apply">Обновить</button>
<button class="icon-btn" id="dyn-update-dismiss" style="width:28px;height:28px;padding:4px;flex-shrink:0"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
`;
document.body.appendChild(banner);

banner.querySelector('#dyn-update-apply').addEventListener('click', () => {
activateNewWorker(worker);
banner.remove();
});

banner.querySelector('#dyn-update-dismiss').addEventListener('click', () => {
banner.remove();
_updateBannerShown = false;
});
}

function activateNewWorker(worker) {
console.log('[SW] Активирую новый Service Worker');
worker.postMessage('SKIP_WAITING');
}

// ═══════════════════════════════════════════════
//  5. PERIODIC BACKGROUND SYNC
// ═══════════════════════════════════════════════

async function setupPeriodicSync() {
if (!_registration) return;

try {
const status = await navigator.permissions?.query({ name: 'periodic-background-sync' });
if (status?.state !== 'granted') {
console.log('[SW] Periodic sync не разрешён');
return;
}

await _registration.periodicSync.register('btp-update-check', {
minInterval: 24 * 60 * 60 * 1000 // раз в 24 часа
});
console.log('[SW] Periodic sync зарегистрирован');
} catch (error) {
console.log('[SW] Periodic sync недоступен:', error.message);
}
}

// ═══════════════════════════════════════════════
//  6. УПРАВЛЕНИЕ КЕШЕМ
// ═══════════════════════════════════════════════

/**
* Возвращает версию кеша активного SW (CACHE_NAME из sw.js).
* Используется для сверки свежести.
*/
export async function getCacheVersion() {
if (!navigator.serviceWorker?.controller) return null;

return new Promise((resolve) => {
const channel = new MessageChannel();
channel.port1.onmessage = (event) => {
if (event.data?.type === 'CACHE_VERSION') resolve(event.data.version);
};
navigator.serviceWorker.controller.postMessage('GET_CACHE_VERSION', [channel.port2]);
// Таймаут на случай, если SW не ответит
setTimeout(() => resolve(null), 2000);
});
}

/**
* Очищает кеш обложек (COVER_CACHE_NAME в sw.js).
* Используется в Настройках → «Очистить кеш обложек».
*/
export async function clearCoverCache() {
if (!navigator.serviceWorker?.controller) return false;

return new Promise((resolve) => {
const channel = new MessageChannel();
channel.port1.onmessage = (event) => {
if (event.data?.type === 'COVER_CACHE_CLEARED') resolve(true);
};
navigator.serviceWorker.controller.postMessage('CLEAR_COVER_CACHE', [channel.port2]);
setTimeout(() => resolve(false), 3000);
});
}

/**
* Принудительная проверка обновлений (сбрасывает троттлинг).
* Вызывается по Ctrl+Shift+R.
*/
export async function forceCheckUpdate() {
if (!_registration) return false;

try {
_lastUpdateCheck = 0; // сброс троттлинга
await _registration.update();
return true;
} catch {
return false;
}
}

// ═══════════════════════════════════════════════
//  7. ОНЛАЙН / ОФФЛАЙН ИНДИКАТОР
// ═══════════════════════════════════════════════

export function setupOnlineIndicator(showToast) {
window.addEventListener('offline', () => {
showToast('📴 Нет подключения — работаю оффлайн', 'info');
});

window.addEventListener('online', () => {
showToast('🟢 Подключение восстановлено', 'success');
});
}

// ═══════════════════════════════════════════════
//  8. ГОРЯЧИЕ КЛАВИШИ
// ═══════════════════════════════════════════════

//  Ctrl+Shift+R (Cmd+Shift+R на Mac) — принудительная проверка обновлений
if (typeof document !== 'undefined') {
document.addEventListener('keydown', (e) => {
if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'R') {
e.preventDefault();
forceCheckUpdate().then((ok) => {
if (ok) console.log('[SW] Принудительная проверка обновления');
});
}
});
}
// ─────────────────────────────────────────────