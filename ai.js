// ═══════════════════════════════════════════════════════════════════
// 🔖 3.8.8 — AI-функциональность через API xKiro (https://docs.xkiro.com).
// 🔖 3.8.8: без новых сетевых изменений (обогащённая схема извлечения и
//   прозрачный предпросмотр — в app.js). Ниже — история изменений.
// 🔖 3.8.7: CORS. Прямые запросы из браузера к api.xkiro.com невозможны:
//   у API НЕТ заголовков Access-Control-Allow-* (проверено 2026-09-25).
//   Поэтому ai.js принимает настраиваемый baseUrl — URL CORS-прокси
//   (например Cloudflare Worker), который проксирует /v1/* в xKiro.
//   Если baseUrl пуст — используется напрямую api.xkiro.com (работает
//   только без браузерного CORS: локальный клиент, расширение, и т.п.).
//
// Модуль — ЧИСТЫЙ СЕТЕВОЙ КЛИЕНТ: без UI и без IndexedDB.
//   — настройки (ключ/модель/прокси) хранит приложение (app.js → db.js
//     settings, аналогично microlinkApiKey). Ключ НИКОГДА НЕ попадает
//     в исходный код и в localStorage — только в IndexedDB settings;
//   — все функции выбрасывают AiApiError с человекочитаемым сообщением;
//   — offline-first не нарушается: AI-фичи — единственные online-only
//     функции (ключ не задан → UI показывает подсказку, кнопки disabled).
//
// Эндпоинты (документация:
//   https://docs.xkiro.com/api/chat-completions/,
//   https://docs.xkiro.com/api/web-search/,
//   https://docs.xkiro.com/api/list-models/):
//   GET  /v1/models            → каталог моделей (по умолчанию chat)
//   POST /v1/chat/completions  → OpenAI-совместимый чат
//   POST /v1/search            → веб-поиск (модель xkiro/web-search)
// ═══════════════════════════════════════════════════════════════════

export const AI_BASE = 'https://api.xkiro.com';
export const AI_SEARCH_MODEL = 'xkiro/web-search';
export const AI_MODELS_MODALITY = 'chat'; // модели, доступные для chat/completions

/** Ошибка вызова xKiro API с «дружелюбным» текстом для UI. */
export class AiApiError extends Error {
  /**
   * @param {string} message — сообщение для пользователя
   * @param {object} [opts]
   * @param {number} [opts.status] — HTTP-статус (0 = сеть/CORS/нет ответа)
   * @param {string} [opts.code] — code ошибки от сервера (если пришёл)
   */
  constructor(message, { status = 0, code = '' } = {}) {
    super(message);
    this.name = 'AiApiError';
    this.status = status;
    this.code = code;
  }
}

/** Нормализует baseUrl: без хвостового слеша. */
function normalizeBase(baseUrl) {
  return String(baseUrl || AI_BASE).replace(/\/+$/, '');
}

/** Единый fetch с Bearer-авторизацией и разбором ошибок. */
async function requestJson(url, { method = 'GET', apiKey, body } = {}) {
  let resp;
  try {
    resp = await fetch(url, {
      method,
      headers: {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    // Сеть недоступна / CORS / DNS. У xKiro нет CORS-заголовков —
    // из обычного браузера прямой запрос будет заблокирован.
    throw new AiApiError(
      'Не удалось связаться с xKiro. Если приложение открыто в браузере — ' +
      'xKiro не поддерживает CORS: укажите URL CORS-прокси в Настройках → AI.',
      { status: 0 }
    );
  }

  if (!resp.ok) {
    let detail = '';
    let code = '';
    try {
      const j = await resp.json();
      detail = typeof j?.error?.message === 'string' ? j.error.message
             : typeof j?.message === 'string' ? j.message : '';
      code = typeof j?.error?.code === 'string' ? j.error.code
           : typeof j?.code === 'string' ? j.code : '';
    } catch { /* тело не JSON — не критично */ }
    const status = resp.status;
    if (status === 400) {
      throw new AiApiError(detail ? `xKiro: ${detail}` : 'xKiro: неверный запрос (HTTP 400).', { status, code });
    }
    if (status === 401 || status === 403) {
      throw new AiApiError(`Неверный API-ключ xKiro (HTTP ${status}).`, { status, code });
    }
    if (status === 402) {
      throw new AiApiError('Недостаточно средств на балансе xKiro.', { status, code });
    }
    if (status === 429) {
      throw new AiApiError('Слишком много запросов к xKiro. Подождите немного.', { status, code });
    }
    if (status === 502 && code === 'no_search_performed') {
      throw new AiApiError('Поиск xKiro не выполнился для этого запроса — переформулируйте.', { status, code });
    }
    if (status === 503) {
      throw new AiApiError('Сервис xKiro временно недоступен (HTTP 503). Повторите чуть позже.', { status, code });
    }
    if (status >= 500) {
      throw new AiApiError(
        detail ? `Сервис xKiro: ${detail} (HTTP ${status}).` : `Сервис xKiro временно недоступен (HTTP ${status}). Повторите позже.`,
        { status, code }
      );
    }
    throw new AiApiError(detail ? `Сервис xKiro: ${detail}` : `Ошибка сервиса xKiro (HTTP ${status}).`, { status, code });
  }

  return resp.json();
}

/**
 * Список доступных моделей (модальность chat, уже по умолчанию).
 * @param {string} apiKey
 * @param {object} [opts]
 * @param {string} [opts.baseUrl] — URL CORS-прокси (по умолчанию api.xkiro.com)
 * @returns {Promise<Array<{id: string, name?: string, description?: string, tier?: string}>>}
 */
export async function listModels(apiKey, { baseUrl = AI_BASE } = {}) {
  if (!apiKey) throw new AiApiError('Не задан API-ключ xKiro.');
  const json = await requestJson(
    `${normalizeBase(baseUrl)}/v1/models?modality=${encodeURIComponent(AI_MODELS_MODALITY)}`,
    { apiKey }
  );
  const raw = Array.isArray(json) ? json : (json?.data || json?.models || []);
  if (!Array.isArray(raw)) {
    throw new AiApiError('Сервис xKiro вернул неожиданный ответ при загрузке моделей.');
  }
  return raw
    .map((m) => ({
      id: String(m?.id ?? m?.model ?? m?.name ?? ''),
      name: typeof m?.display_name === 'string' ? m.display_name
          : typeof m?.name === 'string' ? m.name : '',
      description: typeof m?.description === 'string' ? m.description : '',
      tier: typeof m?.access_tier === 'string' ? m.access_tier : '',
      modality: typeof m?.modality === 'string' ? m.modality : '',
    }))
    .filter((m) => m.id);
}

/**
 * Вызов chat/completions (OpenAI-совместимый).
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.model — id модели (из listModels)
 * @param {Array<{role: string, content: string}>} opts.messages
 * @param {number} [opts.temperature]
 * @param {number} [opts.maxTokens]
 * @param {boolean} [opts.json] — response_format json_object
 * @param {string} [opts.baseUrl] — URL CORS-прокси (по умолчанию api.xkiro.com)
 * @returns {Promise<string>} — текст ответа модели
 */
export async function chatXkiro({
  apiKey, model, messages, temperature = 0.3, maxTokens = 1024, json = false, baseUrl = AI_BASE,
}) {
  if (!apiKey) throw new AiApiError('Не задан API-ключ xKiro.');
  if (!model) throw new AiApiError('Не выбрана AI-модель.');
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new AiApiError('Пустой запрос к AI.');
  }
  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };
  if (json) body.response_format = { type: 'json_object' };
  const jsonResp = await requestJson(`${normalizeBase(baseUrl)}/v1/chat/completions`, {
    method: 'POST', apiKey, body,
  });
  const content = jsonResp?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.length === 0) {
    throw new AiApiError('AI не вернул текст ответа.');
  }
  return content;
}

/**
 * Веб-поиск через xKiro (модель xkiro/web-search).
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.query
 * @param {number} [opts.maxResults]
 * @param {string} [opts.baseUrl] — URL CORS-прокси (по умолчанию api.xkiro.com)
 * @returns {Promise<Array<{title: string, url: string, snippet: string, source: string,
 *   publicationDate: string, favicon: string, thumbnail: string}>>}
 */
export async function searchXkiro({ apiKey, query, maxResults = 5, baseUrl = AI_BASE }) {
  if (!apiKey) throw new AiApiError('Не задан API-ключ xKiro.');
  if (!query || !String(query).trim()) throw new AiApiError('Пустой поисковый запрос.');
  const jsonResp = await requestJson(`${normalizeBase(baseUrl)}/v1/search`, {
    method: 'POST', apiKey,
    body: { model: AI_SEARCH_MODEL, query: String(query).trim(), max_results: maxResults },
  });
  const raw = Array.isArray(jsonResp) ? jsonResp : (jsonResp?.results || jsonResp?.data || []);
  if (!Array.isArray(raw)) {
    throw new AiApiError('Сервис xKiro вернул неожиданный ответ при поиске.');
  }
  // 🔖 3.8.7: реальные поля ответа — publishedDate / faviconUrl / thumbnailUrl.
  return raw.map((r) => ({
    title: String(r?.title ?? ''),
    url: String(r?.url ?? ''),
    snippet: String(r?.snippet ?? r?.description ?? ''),
    source: String(r?.source ?? r?.site ?? ''),
    publicationDate: String(r?.publishedDate ?? r?.publicationDate ?? r?.date ?? ''),
    favicon: String(r?.faviconUrl ?? r?.favicon ?? ''),
    thumbnail: String(r?.thumbnailUrl ?? r?.thumbnail ?? ''),
  })).filter((r) => r.title || r.url);
}

/**
 * Достаёт JSON из ответа LLM: снимает markdown-ограждения ```json ... ```,
 * при необходимости вырезает сбалансированный JSON из окружающего текста.
 * @param {string} text
 * @returns {any|null}
 */
export function extractJson(text) {
  if (!text) return null;
  let s = String(text).trim();
  if (!s) return null;

  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) s = fence[1].trim();

  try { return JSON.parse(s); } catch { /* пробуем ниже */ }

  const first = s.indexOf('{');
  const firstArr = s.indexOf('[');
  if (first === -1 && firstArr === -1) return null;
  const start = first === -1 ? firstArr : (firstArr === -1 ? first : Math.min(first, firstArr));
  const candidate = s.slice(start);

  // ищем последнюю закрывающую скобку и парсим обрезанный кусок
  const isObj = candidate[0] === '{';
  const last = candidate.lastIndexOf(isObj ? '}' : ']');
  if (last === -1) return null;
  try { return JSON.parse(candidate.slice(0, last + 1)); } catch { return null; }
}

/** Есть ли настроенный ключ (для UI-контроля). */
export function isAiConfigured(settings) {
  return Boolean(settings?.xkiroApiKey);
}