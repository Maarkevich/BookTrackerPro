// ─────────────────────────────────────────────
// 📦 BookTrackerPro — utils.js
// 🔖 v3.8.1 | 2026-08-12
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

export function esc(s) {
  const div = document.createElement('div');
  div.textContent = s == null ? '' : String(s);
  return div.innerHTML;
}

// ═══════════════════════════════════════════════
//  2. ДЕБАУНС / ТРОТТЛИНГ
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
//  3. FETCH С ТАЙМАУТОМ И РЕТРАЯМИ
// ═══════════════════════════════════════════════

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
//  4. ТОСТ-УВЕДОМЛЕНИЕ
// ═══════════════════════════════════════════════

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
//  6. СКЛОНЕНИЕ РУССКИХ СЛОВ
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
//  7. ГЕНЕРАЦИЯ ID
// ═══════════════════════════════════════════════

export function generateId(prefix = 'id') {
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 8);
  return prefix + '_' + ts + '_' + rnd;
}

// ═══════════════════════════════════════════════
//  8. РАЗНОЕ
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
