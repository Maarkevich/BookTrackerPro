// ─────────────────────────────────────────────
// 📦 BookTrackerPro — utils.js
// 🔖 v3.7.0 | 2026-08-07
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
//    Новое в 3.7.0:
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
 * Экранирует строку для безопасной вставки в innerHTML.
 * @param {*} s — любое значение, null/undefined → пустая строка
 * @returns {string} безопасный HTML
 */
export function esc(s) {
  const div = document.createElement('div');
  div.textContent = s == null ? '' : String(s);
  return div.innerHTML;
}

// ═══════════════════════════════════════════════
//  2. ДЕБАУНС / ТРОТТЛИНГ
// ═══════════════════════════════════════════════

/**
 * Откладывает вызов fn, пока пауза между вызовами < ms.
 * @param {Function} fn
 * @param {number} ms — задержка в мс
 * @returns {Function} обёрнутая функция
 */
export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Асинхронная задержка.
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ═══════════════════════════════════════════════
//  3. FETCH С ТАЙМАУТОМ И РЕТРАЯМИ
// ═══════════════════════════════════════════════

/**
 * fetch с таймаутом и экспоненциальным backoff ретраями.
 * Бросает последнюю ошибку после всех попыток.
 *
 * @param {string} url
 * @param {object} opts — параметры fetch (method, headers, body…)
 * @param {number} timeout — таймаут одного запроса (мс), по умолчанию 15 000
 * @param {number} retries — число повторных попыток, по умолчанию 2
 * @returns {Promise<Response>}
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
        // Экспоненциальный backoff: 400 мс, 800 мс, 1600 мс…
        await sleep(400 * Math.pow(2, attempt));
      }
    }
  }
  throw lastErr;
}

// ═══════════════════════════════════════════════
//  4. ТОСТ-УВЕДОМЛЕНИЕ
// ═══════════════════════════════════════════════

/**
 * Показывает тост-уведомление. Ищет элемент #toast в DOM.
 * Авто-скрытие через 2.6 с. Повторный вызов перезапускает таймер.
 *
 * @param {string} msg — текст сообщения
 * @param {'info'|'success'|'error'} [type='info'] — тип (влияет на цвет рамки)
 */
export function showToast(msg, type = 'info') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast ' + type + ' show';
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2600);
}

// ═══════════════════════════════════════════════
//  5. УТИЛИТЫ ДАТ
// ═══════════════════════════════════════════════

/**
 * Дата → ISO-строка yyyy-mm-dd (локальное время).
 * @param {Date} d
 * @returns {string}
 */
export function toISODate(d) {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/**
 * ISO-строка yyyy-mm-dd → Date (локальное время) или null.
 * @param {string} iso
 * @returns {Date|null}
 */
export function fromISODate(iso) {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Полная русская дата: «7 августа 2026».
 * @param {string|Date} dateStr — ISO-строка или Date
 * @returns {string}
 */
export function formatDateRu(dateStr) {
  const d = typeof dateStr === 'string' ? fromISODate(dateStr) : dateStr;
  if (!d) return '';
  try {
    return d.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

/**
 * Короткая русская дата: «7 авг».
 * @param {string|Date} dateStr — ISO-строка или Date
 * @returns {string}
 */
export function formatShortDate(dateStr) {
  const d = typeof dateStr === 'string' ? fromISODate(dateStr) : dateStr;
  if (!d) return '';
  try {
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}

// ═══════════════════════════════════════════════
//  6. СКЛОНЕНИЕ РУССКИХ СЛОВ
// ═══════════════════════════════════════════════

/**
 * Склонение: pluralize(5, 'книга', 'книги', 'книг') → 'книг'.
 * @param {number} n
 * @param {string} one  — 1 (книга)
 * @param {string} few  — 2–4 (книги)
 * @param {string} many — 5+ (книг)
 * @returns {string}
 */
export function pluralize(n, one, few, many) {
  const abs = Math.abs(n) % 100;
  const d = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (d > 1 && d < 5) return few;
  if (d === 1) return one;
  return many;
}

// ═══════════════════════════════════════════════
//  7. ГЕНЕРАЦИЯ ID
// ═══════════════════════════════════════════════

/**
 * Уникальный ID с префиксом: generateId('book') → 'book_1723036800000_a3f2x9'.
 * @param {string} [prefix='id']
 * @returns {string}
 */
export function generateId(prefix = 'id') {
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 8);
  return prefix + '_' + ts + '_' + rnd;
}

// ═══════════════════════════════════════════════
//  8. РАЗНОЕ
// ═══════════════════════════════════════════════

/**
 * Обрезает строку с многоточием.
 * @param {string} s
 * @param {number} max — максимальная длина
 * @returns {string}
 */
export function truncate(s, max = 80) {
  if (!s || s.length <= max) return s || '';
  return s.slice(0, max - 1) + '…';
}

/**
 * Безопасный parseInt с дефолтом.
 * @param {*} v
 * @param {number} [def=0]
 * @returns {number}
 */
export function toInt(v, def = 0) {
  const n = parseInt(v, 10);
  return isNaN(n) ? def : n;
}

/**
 * Безопасный parseFloat с дефолтом.
 * @param {*} v
 * @param {number} [def=0]
 * @returns {number}
 */
export function toFloat(v, def = 0) {
  const n = parseFloat(v);
  return isNaN(n) ? def : n;
}