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
//  1.1 БЕЗОПАСНЫЕ URL (🆕 P1-1)
// ═══════════════════════════════════════════════

/**
 * Валидирует URL для вставки в src/href (рендер).
 * Разрешены только http:, https: и blob: (блокируются
 * javascript:, data:, vbscript:, file: и прочие схемы).
 * Возвращает нормализованный URL (спецсимволы, включая кавычки
 * и пробелы, percent-кодируются) или '' если URL небезопасен.
 *
 * SSRF-защита (private IP) сюда НЕ переносится: в контексте
 * рендера запрос выполняет браузер пользователя, а не сервер.
 * Для API-запросов остаётся sanitizeUrl() в microlink.js.
 *
 * @param {*} url — значение пользователя
 * @returns {string} — безопасный URL или ''
 */
export function safeUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    const proto = parsed.protocol;
    if (proto === 'http:' || proto === 'https:' || proto === 'blob:') {
      return parsed.href;
    }
  } catch { /* невалидный URL → '' */ }
  return '';
}

/**
 * Валидирует пользовательскую ВНЕШНЮЮ ссылку для href и для
 * сохранения в IndexedDB (publishedUrl, chatLink).
 * Отличие от safeUrl(): blob: НЕ разрешён — обложки и внутренние
 * объекты приложения не должны открываться как пользовательские ссылки.
 * Разрешены только http: и https: (javascript:, data:, file:,
 * vbscript:, custom: и blob: → '').
 *
 * @param {*} url — значение пользователя
 * @returns {string} — безопасный http(s) URL или ''
 */
export function safeLinkUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href;
    }
  } catch { /* невалидный URL → '' */ }
  return '';
}

/**
 * Экранирует строку для вставки в ДВОЙНЫЕ КАВЫЧКИ атрибута
 * value="..."/data-*="...". esc() не экранирует " → добавляем.
 * Защищает prefill-поля форм (coverUrl, chatLink, publishedUrl).
 *
 * @param {*} s — любое значение
 * @returns {string}
 */
export function escAttr(s) {
  return esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Привязывает обработчики 'error' к обложкам с атрибутом
 * data-cover-fallback: скрывает сломанные картинки.
 * Заменяет inline onerror="this.style.display='none'"
 * (нужно для CSP без 'unsafe-inline').
 *
 * @param {HTMLElement} scope — контейнер после innerHTML
 */
export function applyCoverFallback(scope) {
  if (!scope || typeof scope.querySelectorAll !== 'function') return;
  scope.querySelectorAll('img[data-cover-fallback]').forEach(img => {
    if (img.dataset.coverFallbackBound) return;
    img.dataset.coverFallbackBound = '1';
    img.addEventListener('error', () => {
      img.style.display = 'none';
    });
  });
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
 * @param {AbortSignal|null} signal — 🆕 P2-13 внешний сигнал отмены:
 *   пробрасывается во все попытки; прерывает backoff-ожидание;
 *   при abort бросается ошибка с name === 'AbortError'.
 * @returns {Promise<Response>}
 * @throws {Error} последняя ошибка после всех попыток
 */
export async function fetchT(url, opts = {}, timeout = 15000, retries = 2, signal = null) {
  const abortErr = () => { const e = new Error('aborted'); e.name = 'AbortError'; return e; };
  if (signal?.aborted) throw abortErr();
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const onExtAbort = () => ctrl.abort();
    if (signal) signal.addEventListener('abort', onExtAbort, { once: true });
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onExtAbort);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res;
    } catch (e) {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onExtAbort);
      if (signal?.aborted) throw abortErr();
      lastErr = e;
      if (attempt < retries) {
        await sleep(400 * Math.pow(2, attempt));
        if (signal?.aborted) throw abortErr();
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
//
//  🆕 P2-17: единый lifecycle оверлеев поверх back-стека:
//    — scroll-lock через refcount (_scrollLocks), а не ручной overflow;
//    — focus capture/restore (prevFocus в метаданных элемента);
//    — focus trap (Tab/Shift+Tab не выходит за пределы верхнего оверлея);
//    — closeTopOverlay() — программное закрытие верхнего (Escape/backdrop);
//    — releaseOverlay(el) — снятие без history.back() (pagehide и т.п.).

let _backStack = [];            // открытые оверлеи (HTMLElement[])
let _overlayMeta = new Map();   // el → { onClose, prevFocus }
let _poppingState = false;
let _scrollLocks = 0;           // refcount блокировки скролла body
let _trapBound = false;
let _suppressBack = false;      // 🆕 P2-17: «жест назад» уже выполняется браузером
                                // (popstate), поэтому onClose не должен звать
                                // history.back() повторно (иначе двойная навигация).

// ── scroll-lock с refcount: корректно для вложенных оверлеев ──
function lockBodyScroll() {
  _scrollLocks++;
  document.body.style.overflow = 'hidden';
}
function unlockBodyScroll() {
  _scrollLocks = Math.max(0, _scrollLocks - 1);
  if (_scrollLocks === 0) document.body.style.overflow = '';
}

// ── focus capture/restore ──
function captureFocus(el) {
  const prev = document.activeElement;
  if (!_overlayMeta.has(el)) _overlayMeta.set(el, { onClose: null, prevFocus: null });
  _overlayMeta.get(el).prevFocus = (prev && prev !== document.body) ? prev : null;
}
function restoreFocus(el) {
  const meta = _overlayMeta.get(el);
  if (!meta) return;
  const prev = meta.prevFocus;
  if (prev && typeof prev.focus === 'function' && document.contains(prev)) {
    try { prev.focus(); } catch (e) {}
  }
}

// ── focus trap (Tab / Shift+Tab) ──
function getFocusables(root) {
  const sel = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  return [...root.querySelectorAll(sel)].filter(el => {
    if (el.disabled) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (el.closest('.hidden')) return false;
    return true;
  });
}
function onOverlayKeydown(e) {
  if (_backStack.length === 0) return;
  const top = _backStack[_backStack.length - 1];
  const focusable = getFocusables(top);
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const inside = top.contains(document.activeElement);
  if (e.shiftKey) {
    if (!inside || document.activeElement === first) {
      e.preventDefault();
      last.focus();
    }
  } else if (!inside || document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
function bindTrap() {
  if (_trapBound) return;
  document.addEventListener('keydown', onOverlayKeydown);
  _trapBound = true;
}
function unbindTrap() {
  if (!_trapBound) return;
  document.removeEventListener('keydown', onOverlayKeydown);
  _trapBound = false;
}

/**
 * Регистрирует открытый оверлей в back-стеке, блокирует скролл
 * (refcount), захватывает фокус и пушит состояние в History API.
 * @param {HTMLElement} el
 * @param {object} [opts] — { onClose }
 */
export function trackOverlay(el, opts = {}) {
  _backStack.push(el);
  if (!_overlayMeta.has(el)) {
    _overlayMeta.set(el, { onClose: opts.onClose || null, prevFocus: null });
  } else {
    _overlayMeta.get(el).onClose = opts.onClose || _overlayMeta.get(el).onClose;
  }
  captureFocus(el);
  lockBodyScroll();
  bindTrap();
  try { history.pushState({ btpOverlay: true }, ''); } catch (e) {}
}

/** Внутренний cleanup: метаданные, фокус, refcount, trap. */
function releaseOverlayInternal(el) {
  const meta = _overlayMeta.get(el);
  if (meta) {
    restoreFocus(el);
    _overlayMeta.delete(el);
  }
  unlockBodyScroll();
  if (_backStack.length === 0) unbindTrap();
}

/**
 * Убирает оверлей из back-стека и вызывает history.back().
 * @param {HTMLElement} el
 */
export function untrackOverlay(el) {
  const idx = _backStack.lastIndexOf(el);
  if (idx < 0) return;
  _backStack.splice(idx, 1);
  releaseOverlayInternal(el);
  // 🆕 P2-17: если «жест назад» уже обрабатывается браузером (popstate от
  // системной кнопки), не дублируем навигацию — иначе двойной back.
  if (_suppressBack) return;
  _poppingState = true;
  try { history.back(); } catch (e) {}
}

/**
 * Полный release оверлея БЕЗ history.back().
 * Используется, когда навигацию делает сам браузер (pagehide и т.п.).
 * @param {HTMLElement} el
 */
export function releaseOverlay(el) {
  const idx = _backStack.lastIndexOf(el);
  if (idx < 0) return;
  _backStack.splice(idx, 1);
  releaseOverlayInternal(el);
}

/**
 * Закрывает верхний оверлей С ПОДАВЛЕННЫМ history.back():
 * навигацию для жеста «назад» уже выполнил браузер (попstate),
 * поэтому onClose не должен звать history.back() повторно.
 * Используется в обработчике popstate (setupBackGesture в app.js).
 * @returns {HTMLElement|null}
 */
export function closeTopOverlayForBack() {
  _suppressBack = true;
  try {
    return closeTopOverlay();
  } finally {
    _suppressBack = false;
  }
}

/**
 * Программно закрывает верхний оверлей:
 * вызывает его onClose (если задан), иначе — fallback.
 * Если onClose не снял элемент из стека (не вызвал untrackOverlay),
 * — страховка снимает его без history.back().
 * Возвращает закрытый элемент или null.
 */
export function closeTopOverlay() {
  const top = _backStack[_backStack.length - 1];
  if (!top) return null;
  const meta = _overlayMeta.get(top);
  if (meta && typeof meta.onClose === 'function') {
    meta.onClose();
    // 🆕 P2-17: страховка — если onClose не сделал untrackOverlay,
    // убираем верхний из стека штатно (без history.back(): вызов уже
    // обработан и повторная навигация не нужна).
    const idx = _backStack.lastIndexOf(top);
    if (idx >= 0) {
      _backStack.splice(idx, 1);
      releaseOverlayInternal(top);
    }
  } else {
    top.classList.add('hidden');
    untrackOverlay(top);
  }
  return top;
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
 * Извлекает верхний оверлей из стека (жест «назад»).
 * Снимает scroll-lock и восстанавливает фокус.
 * @returns {HTMLElement|null}
 */
export function popTopOverlay() {
  if (_backStack.length === 0) return null;
  const el = _backStack.pop();
  releaseOverlayInternal(el);
  return el;
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

/**
 * Делает кликабельный div (карточку) достижимым с клавиатуры:
 * tabindex="0", role="button", Enter/Space эмулируют клик по САМОМУ элементу.
 * Срабатывает только когда фокус стоит на карточке, поэтому вложенные кнопки,
 * ссылки и инпуты получают собственные клавиши без двойной активации.
 * Enter срабатывает на keydown, Space — на keydown+keyup (стандартное поведение).
 *
 * 🆕 P2-18: единая keyboard-доступность кликабельных карточек.
 *
 * @param {HTMLElement} el
 * @param {object} [opts] — { label } → aria-label
 */
export function makeCardKeyboardAccessible(el, opts = {}) {
  if (!el || el._cardKb) return;
  el._cardKb = true;
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  if (opts.label) el.setAttribute('aria-label', opts.label);

  el.addEventListener('keydown', (e) => {
    if (document.activeElement !== el) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      el.click();
    } else if (e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      el._kbSpacePending = true;
    }
  });
  el.addEventListener('keyup', (e) => {
    if (e.key === ' ' && el._kbSpacePending) {
      el._kbSpacePending = false;
      if (document.activeElement === el) {
        e.preventDefault();
        e.stopPropagation();
        el.click();
      }
    }
  });
  el.addEventListener('blur', () => { el._kbSpacePending = false; });
}