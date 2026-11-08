// ═══════════════════════════════════════════════════════════════════
// 🔖 3.9.4 — SOURCE REGISTRY: единый реестр книжных источников.
//
// Модуль — ЧИСТЫЙ (без сети, без DOM, без IndexedDB). Один источник
// истины для доменов, которые приложение считает книжными:
//   — normalize.js: sourceTypeByDomain() / isRussianSourceUrl();
//   — app.js: фильтрация результатов поиска и загрузка страниц;
//   — worker/worker.js: ALLOWED_DOMAINS (синхронность проверяется тестом);
//   — будущий Search Orchestrator / Source Report / manual-flow.
//
// Типы (совпадают с db.SOURCE_TYPES):
//   publisher — издательство,
//   shop      — магазин,
//   library   — библиотека,
//   catalog   — каталог/агрегатор.
//
// Домен матчится точно или как поддомен (cdn.litres.ru → litres.ru).
// Неизвестный домен НЕ является книжным источником: isRegisteredSource()
// возвращает false, а sourceTypeFor() даёт безопасный fallback 'catalog'
// (обратная совместимость с прежним sourceTypeByDomain).
// ═══════════════════════════════════════════════════════════════════

/**
 * @typedef {'publisher'|'shop'|'library'|'catalog'} SourceType
 * @typedef {{domain:string, type:SourceType, label:string}} SourceEntry
 */

/** @type {ReadonlyArray<Readonly<SourceEntry>>} */
export const SOURCE_REGISTRY = Object.freeze([
  Object.freeze({ domain: 'eksmo.ru', type: 'publisher', label: 'Эксмо' }),
  Object.freeze({ domain: 'ast.ru', type: 'publisher', label: 'АСТ' }),
  Object.freeze({ domain: 'mann-ivanov-ferber.ru', type: 'publisher', label: 'МИФ' }),
  Object.freeze({ domain: 'rosman.ru', type: 'publisher', label: 'Росмэн' }),
  Object.freeze({ domain: 'litres.ru', type: 'shop', label: 'ЛитРес' }),
  Object.freeze({ domain: 'chitai-gorod.ru', type: 'shop', label: 'Читай-город' }),
  Object.freeze({ domain: 'bookvoed.ru', type: 'shop', label: 'Буквоед' }),
  Object.freeze({ domain: 'rsl.ru', type: 'library', label: 'РГБ' }),
  Object.freeze({ domain: 'findbook.ru', type: 'catalog', label: 'FindBook' }),
]);

const SOURCE_TYPES = new Set(['publisher', 'shop', 'library', 'catalog']);

/**
 * Нормализует домен/URL до host без www и порта.
 * Принимает 'https://www.LitRes.ru/book', 'litres.ru:443', 'www.litres.ru'.
 * @param {string} value
 * @returns {string}
 */
export function normalizeSourceHost(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return raw
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
      .split(/[/?#]/)[0]
      .replace(/:\d+$/, '')
      .toLowerCase()
      .replace(/^www\./, '');
  }
}

/**
 * Запись реестра для домена/URL (точное совпадение или поддомен).
 * При пересечении доменов выбирается самый длинный (самый точный).
 * @param {string} value — домен или URL
 * @returns {SourceEntry|null}
 */
export function getSourceEntry(value) {
  const host = normalizeSourceHost(value);
  if (!host) return null;
  let best = null;
  for (const entry of SOURCE_REGISTRY) {
    if (host === entry.domain || host.endsWith('.' + entry.domain)) {
      if (!best || entry.domain.length > best.domain.length) best = entry;
    }
  }
  return best || null;
}

/** Домен входит в реестр книжных источников? */
export function isRegisteredSource(value) {
  return Boolean(getSourceEntry(value));
}

/**
 * Тип источника по домену/URL. Неизвестный домен → 'catalog'
 * (безопасный fallback, обратная совместимость).
 * @returns {SourceType}
 */
export function sourceTypeFor(value) {
  return getSourceEntry(value)?.type || 'catalog';
}

/** Человекочитаемое название источника ('' для неизвестного). */
export function sourceLabelFor(value) {
  return getSourceEntry(value)?.label || '';
}

/** Копия списка источников (для UI/report; реестр защищён от мутации). */
export function listSources() {
  return SOURCE_REGISTRY.map((entry) => ({ ...entry }));
}

/** Домены реестра (для сверки с allowlist Worker). */
export function sourceDomains() {
  return SOURCE_REGISTRY.map((entry) => entry.domain);
}

/** Валиден ли тип источника (для report/импорта). */
export function isValidSourceType(type) {
  return SOURCE_TYPES.has(type);
}
