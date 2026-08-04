// ============================================================
//  BookTrackerPro — utils.js (v3.6.0)
//  Общие утилиты без зависимостей. Разрывает циклические
//  импорты: новые модули (uikit, microlink) берут esc /
//  showToast / debounce / fetchT отсюда, не импортируя app.js.
//  app.js реэкспортирует эти функции, поэтому старые модули
//  (content, series, review и т.д.) продолжают работать без правок.
// ============================================================

/** Экранирование HTML. Безопасно для вставки в innerHTML. */
export function esc(s) {
  const div = document.createElement('div');
  div.textContent = s == null ? '' : String(s);
  return div.innerHTML;
}

/** Debounce: откладывает вызов fn, пока пауза < ms. */
export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/**
 * fetch с таймаутом и ретраями.
 * Возвращает Response; бросает последнюю ошибку после всех попыток.
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
      if (attempt < retries) await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr;
}

/**
 * Тост-уведомление. Элемент ищется по id="toast" в index.html.
 * Авто-скрытие через 2.6 c. Повторный вызов перезапускает таймер.
 */
export function showToast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2600);
}

/** Формат ISO-даты (yyyy-mm-dd) из Date. Локальное время. */
export function toISODate(d) {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/** Парс ISO-даты (yyyy-mm-dd) в Date (локальный). null если пусто/битая. */
export function fromISODate(iso) {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return isNaN(d) ? null : d;
}