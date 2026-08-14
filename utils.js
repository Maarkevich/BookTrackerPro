// 📦 BookTrackerPro — utils.js
// 🔖 v3.8.3 | 2026-08-14
// 📝 Общие утилиты без зависимостей.
//
//    Назначение:
//      Разрывает циклические импорты — все модули
//      берут esc / showToast / debounce / fetchT отсюда,
//      не импортируя app.js.
//
//    Правила:
//      — Ноль импортов из модулей проекта.
//      — Только браузерные API.
//      — Любой модуль может безопасно импортировать utils.js.
//
//    Новое в 3.8.3:
//      — trackOverlay / untrackOverlay — перенесены из app.js
//        (разрыв цикла app.js ↔ challenges.js / collections.js)
//      — formatPrice / convertToDefault — перенесены из app.js
//        (разрыв цикла app.js ↔ stats.js)
//      — sanitizeColor() — валидация CSS-значений против CSS-injection
//      — consumePoppingState / popTopOverlay / hasOverlays —
//        публичный API для управления back-стеком
//
//    Сохранено из 3.7.0:
//      — formatDateRu / formatShortDate — форматирование дат
//      — pluralize — склонение русских слов
//      — generateId — генерация уникальных ID
//      — sleep — асинхронная задержка
//      — fetchT: экспоненциальный backoff ретраев
// ─────────────────────────────────────────────

// ═══════════════════════════════════════════════
//  1. ЭКРАНИРОВАНИЕ HTML
// ═══════════════════════════════════════════════

/**
 * Экранирует строку для безопасной вставки в HTML.
 * Защита от XSS: < > & " ' → HTML-entities.
 * @param {*} s — любое значение (будет приведено к строке)
 * @returns {string}
 */
export function esc(s) {
  const div = document.createElement('div');
  div.textContent = s == null ? '' : String(s);
  return div.innerHTML;
}

// ═══════════════════════════════════════════════
//  2. ВАЛИДАЦИЯ CSS-ЗНАЧЕНИЙ (🆕 v3.8.3)
// ═══════════════════════════════════════════════

/**
 * Валидирует CSS-значение цвета.
 * Защита от CSS-injection через пользовательские данные
 * (например, tag.color из IndexedDB).
 *
 * Разрешены: #hex, rgb(), rgba(), hsl(), hsla(), var(--*)
 * Всё остальное → fallback.
 *
 * @param {string} value — проверяемое значение
 * @param {string} fallback — безопасный fallback
 * @returns {string}
 */
export function sanitizeColor(value, fallback = 'var(--text-secondary)') {
  if (!value || typeof value !== 'string') return fallback;
  const v = value.trim();
  // #abc, #aabbcc, #aabbccdd
  if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return v;
  // rgb(...), rgba(...)
  if (/^rgba?\([\d\s,.%]+\)$/.test(v)) return v;
  // hsl(...), hsla(...)
  if (/^hsla?\([\d\s,.%deg]+\)$/.test(v)) return v;
  // var(--custom-property)
  if (/^var\(--[a-zA-Z0-9_-]+\)$/.test(v)) return v;
  return fallback;
}

// ═══════════════════════════════════════════════
//  3. ДЕБАУНС / ТРОТТЛИНГ / ЗАДЕРЖКА
// ═══════════════════════════════════════════════

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ═══════════════════════════════════════════════
//  4. FETCH С ТАЙМАУТОМ И РЕТРАЯМИ
// ═══════════════════════════════════════════════

/**
 * fetch с таймаутом и retry (экспоненциальный backoff).
 * Попытки: 400ms → 800ms → 1600ms.
 *
 * @param {string} url
 * @param {object} opts — параметры fetch
 * @param {number} timeout — таймаут одного запроса (мс)
 * @param {number} retries — количество повторных попыток
 * @returns {Promise<Response>}
 * @throws {Error} последняя ошибка после всех попыток
 */
export async function fetchT(url, opts = {}, timeout = 15000, retries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt < retries) {
        await sleep(400 * Math.pow(2, attempt));
      }
    }
  }
  throw lastErr;
}

// ═══════════════════════════════════════════════
//  5. ТОСТ-УВЕДОМЛЕНИЕ
// ═══════════════════════════════════════════════

/**
 * Показывает тост-уведомление.
 * Элемент #toast должен иметь role="status" aria-live="polite"
 * для доступности (screen readers).
 *
 * @param {string} msg — текст уведомления
 * @param {'info'|'success'|'error'} type — тип (влияет на цвет)
 */
export function showToast(msg, type = 'info') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast ' + type + ' show';
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3000);
}

// ═══════════════════════════════════════════════
//  6. УТИЛИТЫ ДАТ
// ═══════════════════════════════════════════════

export function toISODate(d) {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

export function fromISODate(iso) {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return isNaN(d.getTime()) ? null : d;
}

export function formatDateRu(dateStr) {
  const d = typeof dateStr === 'string' ? fromISODate(dateStr) : dateStr;
  if (!d) return '';
  try {
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch { return ''; }
}

export function formatShortDate(dateStr) {
  const d = typeof dateStr === 'string' ? fromISODate(dateStr) : dateStr;
  if (!d) return '';
  try {
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  } catch { return ''; }
}

// ═══════════════════════════════════════════════
//  7. СКЛОНЕНИЕ РУССКИХ СЛОВ
// ═══════════════════════════════════════════════

export function pluralize(n, one, few, many) {
  const abs = Math.abs(n) % 100;
  const d = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (d > 1 && d < 5) return few;
  if (d === 1) return one;
  return many;
}

// ═══════════════════════════════════════════════
//  8. ГЕНЕРАЦИЯ ID
// ═══════════════════════════════════════════════

export function generateId(prefix = 'id') {
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 8);
  return prefix + '_' + ts + '_' + rnd;
}

// ═══════════════════════════════════════════════
//  9. РАЗНОЕ
// ═══════════════════════════════════════════════

export function truncate(s, max = 80) {
  if (!s || s.length <= max) return s || '';
  return s.slice(0, max - 1) + '…';
}

export function toInt(v, def = 0) {
  const n = parseInt(v, 10);
  return isNaN(n) ? def : n;
}

export function toFloat(v, def = 0) {
  const n = parseFloat(v);
  return isNaN(n) ? def : n;
}

// ═══════════════════════════════════════════════
//  10. ЦЕНА (🆕 v3.8.3: перенесено из app.js)
// ═══════════════════════════════════════════════

// Мини-словарь символов валют (без импорта из db.js)
const CURRENCY_SYMBOLS = {
  RUB: '₽', USD: '$', EUR: '€', KZT: '₸', UAH: '₴', GBP: '£'
};

/**
 * Форматирует цену для отображения.
 * @param {{ amount: number, currency: string }} price
 * @returns {string} — например "1 299 ₽"
 */
export function formatPrice(price) {
  if (!price || !price.amount) return '';
  const sym = CURRENCY_SYMBOLS[price.currency] || '₽';
  return `${price.amount.toLocaleString('ru')} ${sym}`;
}

/**
 * Конвертирует цену в валюту по умолчанию.
 * @param {{ amount: number, currency: string }} price
 * @param {object} settings — { defaultCurrency, exchangeRates }
 * @returns {{ amount: number, currency: string }|null}
 */
export function convertToDefault(price, settings) {
  if (!price || !price.amount) return null;
  const rates = settings.exchangeRates || {};
  const toRub = price.currency === 'RUB'
    ? price.amount
    : price.amount * (rates[price.currency] || 1);
  const def = settings.defaultCurrency || 'RUB';
  if (def === 'RUB') return { amount: Math.round(toRub), currency: 'RUB' };
  return { amount: Math.round(toRub / (rates[def] || 1)), currency: def };
}

// ═══════════════════════════════════════════════
//  11. BACK-СТЕК ОВЕРЛЕЕВ (🆕 v3.8.3: перенесено из app.js)
// ═══════════════════════════════════════════════
//
//  Разрыв циклического импорта:
//    БЫЛО:  challenges.js → app.js (trackOverlay) → challenges.js  ❌
//    СТАЛО: challenges.js → utils.js (trackOverlay)  ✅
//
//  app.js использует consumePoppingState / popTopOverlay
//  в setupBackGesture() вместо прямого доступа к _backStack.

let _backStack = [];
let _poppingState = false;

/**
 * Регистрирует открытый оверлей в back-стеке
 * и пушит состояние в History API.
 * @param {HTMLElement} el
 */
export function trackOverlay(el) {
  _backStack.push(el);
  try { history.pushState({ btpOverlay: true }, ''); } catch (e) {}
}

/**
 * Убирает оверлей из back-стека и вызывает history.back().
 * @param {HTMLElement} el
 */
export function untrackOverlay(el) {
  const idx = _backStack.lastIndexOf(el);
  if (idx < 0) return;
  _backStack.splice(idx, 1);
  _poppingState = true;
  try { history.back(); } catch (e) {}
}

/**
 * Проверяет и сбрасывает флаг "программного" popstate.
 * Вызывается в обработчике popstate в app.js.
 * @returns {boolean} — true если это был программный back
 */
export function consumePoppingState() {
  if (_poppingState) {
    _poppingState = false;
    return true;
  }
  return false;
}

/**
 * Извлекает верхний оверлей из стека.
 * @returns {HTMLElement|null}
 */
export function popTopOverlay() {
  return _backStack.length > 0 ? _backStack.pop() : null;
}

/**
 * Есть ли открытые оверлеи в стеке.
 * @returns {boolean}
 */
export function hasOverlays() {
  return _backStack.length > 0;
}

/**
 * Пушит sentinel-состояние для жеста «назад».
 */
export function pushSentinel() {
  try { history.pushState({ btpSentinel: true }, ''); } catch (e) {}
}