// ─────────────────────────────────────────────
// 📦 BookTrackerPro — sw-register.js
// 🔖 v3.2.0 | 2026-07-24
// 📝 Регистрация Service Worker + логика обновлений
//
//    Что делает:
//      1. Регистрирует sw.js
//      2. Проверяет обновления (не чаще 1 раза в час)
//      3. Показывает баннер «Доступно обновление»
//      4. Перезагружает страницу после активации нового SW
//      5. Регистрирует periodic background sync
//      6. Управляет баннером установки PWA
//
//    Поток обновления:
//      reg.update() → updatefound → installing →
//      installed (есть controller) → баннер →
//      пользователь жмёт «Обновить» → SKIP_WAITING →
//      activate → controllerchange → reload
// ─────────────────────────────────────────────

// ═══════════════════════════════════════════════
//  КОНФИГУРАЦИЯ
// ═══════════════════════════════════════════════

// Путь к sw.js (совпадает с BASE в sw.js)
const SW_PATH = '/BookTrackerPro/sw.js';
const SW_SCOPE = '/BookTrackerPro/';

// Интервал проверки обновлений (мс)
const UPDATE_CHECK_INTERVAL = 60 * 60 * 1000; // 1 час

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
 * Вызывается один раз при старте приложения (из app.js).
 */
export async function registerSW() {
  // Проверяем поддержку
  if (!('serviceWorker' in navigator)) {
    console.warn('[SW] Service Worker не поддерживается');
    return;
  }

  // Только HTTPS или localhost
  const isSecure = location.protocol === 'https:'
    || location.hostname === 'localhost'
    || location.hostname === '127.0.0.1';

  if (!isSecure) {
    console.warn('[SW] Нужен HTTPS или localhost');
    return;
  }

  try {
    _registration = await navigator.serviceWorker.register(SW_PATH, {
      scope: SW_SCOPE
    });

    console.log('[SW] Зарегистрирован, scope:', _registration.scope);

    // ── Обнаружение нового SW ──
    _registration.addEventListener('updatefound', () => {
      const newWorker = _registration.installing;
      if (!newWorker) return;

      console.log('[SW] Найден новый Service Worker');

      newWorker.addEventListener('statechange', () => {
        // Новый SW установлен И есть активный контроллер
        // → значит это обновление, а не первая установка
        if (newWorker.state === 'installed'
            && navigator.serviceWorker.controller) {
          console.log('[SW] Новый SW готов к активации');
          showUpdateBanner(newWorker);
        }
      });
    });

    // ── Перезагрузка после активации нового SW ──
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (_reloading) return;
      _reloading = true;
      console.log('[SW] Контроллер изменился — перезагружаю');
      window.location.reload();
    });

    // ── Периодическая проверка обновлений ──
    setupPeriodicUpdateCheck();

    // ── Periodic Background Sync (Chrome Android) ──
    setupPeriodicSync();

    // ── Проверяем, нет ли ожидающего SW ──
    if (_registration.waiting) {
      showUpdateBanner(_registration.waiting);
    }

  } catch (error) {
    console.error('[SW] Ошибка регистрации:', error);
  }
}

// ═══════════════════════════════════════════════
//  2. ПРОВЕРКА ОБНОВЛЕНИЙ
// ═══════════════════════════════════════════════

/**
 * Проверяет обновления SW.
 * Вызывается при фокусе на вкладку, но не чаще 1 раза в час.
 */
function setupPeriodicUpdateCheck() {
  // При каждом фокусе на вкладку
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkForUpdate();
    }
  });

  // При онлайн-событии
  window.addEventListener('online', () => {
    checkForUpdate();
  });

  // Первая проверка через 10 секунд после загрузки
  setTimeout(() => checkForUpdate(), 10_000);
}

/**
 * Проверяет, есть ли новая версия SW.
 * Троттлинг: не чаще UPDATE_CHECK_INTERVAL.
 */
async function checkForUpdate() {
  if (!_registration) return;

  const now = Date.now();
  if (now - _lastUpdateCheck < UPDATE_CHECK_INTERVAL) return;
  _lastUpdateCheck = now;

  try {
    await _registration.update();
    console.log('[SW] Проверка обновления выполнена');
  } catch (error) {
    // Оффлайн или ошибка сети — не критично
    console.warn('[SW] Проверка обновления не удалась:', error.message);
  }
}

// ═══════════════════════════════════════════════
//  3. БАННЕР ОБНОВЛЕНИЯ
// ═══════════════════════════════════════════════

/**
 * Показывает баннер «Доступно обновление».
 * @param {ServiceWorker} worker — ожидающий SW
 */
function showUpdateBanner(worker) {
  if (_updateBannerShown) return;
  _updateBannerShown = true;

  const banner = document.getElementById('update-banner');
  if (!banner) {
    // Если баннера нет в DOM — создаём
    createUpdateBanner(worker);
    return;
  }

  banner.classList.remove('hidden');

  // Кнопка «Обновить»
  const applyBtn = document.getElementById('update-apply');
  if (applyBtn) {
    // Убираем старых слушателей (клонирование)
    const newBtn = applyBtn.cloneNode(true);
    applyBtn.parentNode.replaceChild(newBtn, applyBtn);

    newBtn.addEventListener('click', () => {
      activateNewWorker(worker);
      banner.classList.add('hidden');
    });
  }

  // Кнопка «Позже»
  const dismissBtn = document.getElementById('update-dismiss');
  if (dismissBtn) {
    const newBtn = dismissBtn.cloneNode(true);
    dismissBtn.parentNode.replaceChild(newBtn, dismissBtn);

    newBtn.addEventListener('click', () => {
      banner.classList.add('hidden');
      _updateBannerShown = false; // можно показать снова
    });
  }
}

/**
 * Создаёт баннер обновления динамически
 * (если его нет в index.html).
 */
function createUpdateBanner(worker) {
  const banner = document.createElement('div');
  banner.className = 'update-banner';
  banner.innerHTML = `
    <span>🔄 Доступна новая версия</span>
    <button class="btn-small" id="dyn-update-apply">Обновить</button>
    <button class="icon-btn" id="dyn-update-dismiss"
            style="width:28px;height:28px;font-size:0.9rem">✕</button>
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

/**
 * Активирует новый SW (пропускает ожидание).
 * @param {ServiceWorker} worker
 */
function activateNewWorker(worker) {
  console.log('[SW] Активирую новый Service Worker');
  worker.postMessage('SKIP_WAITING');
}

// ═══════════════════════════════════════════════
//  4. PERIODIC BACKGROUND SYNC
// ═══════════════════════════════════════════════
//  Только Chrome на Android.
//  Периодически обновляет кеш в фоне.

async function setupPeriodicSync() {
  if (!_registration) return;

  try {
    // Проверяем поддержку
    const status = await navigator.permissions?.query({
      name: 'periodic-background-sync'
    });

    if (status?.state !== 'granted') {
      console.log('[SW] Periodic sync не разрешён');
      return;
    }

    await _registration.periodicSync.register('btp-update-check', {
      minInterval: 24 * 60 * 60 * 1000 // раз в 24 часа
    });

    console.log('[SW] Periodic sync зарегистрирован');
  } catch (error) {
    // Не поддерживается или не разрешено
    console.log('[SW] Periodic sync недоступен:', error.message);
  }
}

// ═══════════════════════════════════════════════
//  5. УПРАВЛЕНИЕ КЕШЕМ
// ═══════════════════════════════════════════════

/**
 * Возвращает текущую версию кеша от SW.
 * @returns {Promise<string|null>}
 */
export async function getCacheVersion() {
  if (!navigator.serviceWorker?.controller) return null;

  return new Promise((resolve) => {
    const channel = new MessageChannel();

    channel.port1.onmessage = (event) => {
      if (event.data?.type === 'CACHE_VERSION') {
        resolve(event.data.version);
      }
    };

    navigator.serviceWorker.controller.postMessage(
      'GET_CACHE_VERSION',
      [channel.port2]
    );

    // Таймаут
    setTimeout(() => resolve(null), 2000);
  });
}

/**
 * Очищает кеш обложек (через SW).
 * @returns {Promise<boolean>}
 */
export async function clearCoverCache() {
  if (!navigator.serviceWorker?.controller) return false;

  return new Promise((resolve) => {
    const channel = new MessageChannel();

    channel.port1.onmessage = (event) => {
      if (event.data?.type === 'COVER_CACHE_CLEARED') {
        resolve(true);
      }
    };

    navigator.serviceWorker.controller.postMessage(
      'CLEAR_COVER_CACHE',
      [channel.port2]
    );

    setTimeout(() => resolve(false), 3000);
  });
}

/**
 * Принудительная проверка обновлений
 * (для кнопки в настройках).
 */
export async function forceCheckUpdate() {
  if (!_registration) return false;

  try {
    _lastUpdateCheck = 0; // сбрасываем троттлинг
    await _registration.update();
    return true;
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════
//  6. ОНЛАЙН / ОФФЛАЙН ИНДИКАТОР
// ═══════════════════════════════════════════════

/**
 * Подписывается на события онлайн/оффлайн.
 * Показывает тост при потере/восстановлении связи.
 * @param {function} showToast — функция из app.js
 */
export function setupOnlineIndicator(showToast) {
  window.addEventListener('offline', () => {
    showToast('📴 Нет подключения — работаю оффлайн', 'info');
  });

  window.addEventListener('online', () => {
    showToast('🟢 Подключение восстановлено', 'success');
  });
}

// ═══════════════════════════════════════════════
//  7. ПРОВЕРКА ПРИ ГОРЯЧИХ КЛАВИШАХ
// ═══════════════════════════════════════════════
//  Ctrl+Shift+R — принудительное обновление

if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (e) => {
    // Ctrl+Shift+R или Cmd+Shift+R
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'R') {
      e.preventDefault();
      forceCheckUpdate().then((ok) => {
        if (ok) {
          console.log('[SW] Принудительная проверка обновления');
        }
      });
    }
  });
}