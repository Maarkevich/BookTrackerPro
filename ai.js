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

/** Возможности провайдеров. Отсутствующая возможность не должна считаться ошибкой сети. */
export const AI_PROVIDER_CAPABILITIES = Object.freeze({
  xkiro: Object.freeze({ models: true, chat: true, json: true, search: true, pageFetch: true }),
  'openai-compatible': Object.freeze({ models: true, chat: true, json: true, search: false, pageFetch: false }),
  ollama: Object.freeze({ models: true, chat: true, json: true, search: false, pageFetch: false }),
  anthropic: Object.freeze({ models: true, chat: true, json: false, search: false, pageFetch: false }),
  gemini: Object.freeze({ models: true, chat: true, json: true, search: false, pageFetch: false }),
  'custom-http': Object.freeze({ models: false, chat: true, json: false, search: false, pageFetch: false }),
});

/** Endpoint по умолчанию для провайдеров с собственным API-протоколом. */
export const AI_PROVIDER_DEFAULT_ENDPOINTS = Object.freeze({
  xkiro: AI_BASE,
  ollama: 'http://localhost:11434',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com',
});

/** Ошибка вызова AI API с «дружелюбным» текстом для UI. */
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

/** Ошибка фасада с указанием провайдера и операции. */
export class AiProviderError extends AiApiError {
  constructor(message, {
    provider = 'unknown', operation = '', status = 0, code = '', retryable = false, cause,
  } = {}) {
    super(message, { status, code });
    this.name = 'AiProviderError';
    this.provider = provider;
    this.operation = operation;
    this.retryable = Boolean(retryable);
    if (cause) this.cause = cause;
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

function providerLabel(provider) {
  const labels = {
    xkiro: 'xKiro',
    'openai-compatible': 'OpenAI-compatible',
    ollama: 'Ollama',
    anthropic: 'Anthropic',
    gemini: 'Google Gemini',
    'custom-http': 'Custom HTTP',
  };
  return labels[provider] || provider || 'AI-провайдер';
}

function normalizeProviderBase(endpoint, fallback) {
  return String(endpoint || fallback).replace(/\/+$/, '');
}

const API_VERSION_SUFFIXES = ['/v1beta', '/v1'];

/**
 * Собирает URL из base + path. Если base уже содержит версию API
 * (/v1 или /v1beta), она не дублируется.
 */
function providerEndpoint(base, path) {
  const normalizedBase = normalizeProviderBase(base, '');
  for (const suffix of API_VERSION_SUFFIXES) {
    if (normalizedBase.toLowerCase().endsWith(suffix) && path.startsWith(`${suffix}/`)) {
      return normalizedBase + path.slice(suffix.length);
    }
  }
  return normalizedBase + path;
}

function normalizeProviderMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new AiProviderError('Пустой запрос к AI.', { operation: 'chat' });
  }
  return messages.map((message) => ({
    role: String(message?.role || 'user'),
    content: typeof message?.content === 'string' ? message.content : String(message?.content ?? ''),
  }));
}

function providerHeaders(profile, hasBody = false) {
  const provider = profile.provider || 'openai-compatible';
  const headers = {
    Accept: 'application/json',
    ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
  };
  if (provider === 'anthropic') {
    if (profile.apiKey) headers['x-api-key'] = profile.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    // Anthropic требует этот заголовок для запросов из браузера.
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  } else if (provider === 'gemini') {
    // Ключ передаётся заголовком, а НЕ query-параметром: не попадает в логи URL.
    if (profile.apiKey) headers['x-goog-api-key'] = profile.apiKey;
  } else if (profile.apiKey) {
    headers.Authorization = `Bearer ${profile.apiKey}`;
  }
  return headers;
}

async function requestProviderJson(profile, path, {
  method = 'GET', body, operation = 'request', signal,
} = {}) {
  const provider = profile.provider || 'openai-compatible';
  const url = providerEndpoint(profile.endpoint, path);
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: providerHeaders(profile, body !== undefined),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (cause) {
    throw new AiProviderError(
      `${providerLabel(provider)} недоступен. Проверьте соединение и endpoint.`,
      { provider, operation, status: 0, retryable: true, cause }
    );
  }

  let payload = null;
  try { payload = await response.json(); } catch { /* общий ответ ниже */ }
  if (!response.ok) {
    const detail = typeof payload?.error?.message === 'string' ? payload.error.message
      : typeof payload?.message === 'string' ? payload.message : '';
    const status = response.status;
    const retryable = status === 408 || status === 429 || status >= 500;
    const suffix = detail ? `: ${detail}` : ` (HTTP ${status})`;
    throw new AiProviderError(
      `${providerLabel(provider)}: ошибка запроса${suffix}`,
      { provider, operation, status, code: payload?.error?.code || payload?.code || '', retryable }
    );
  }
  if (payload === null) {
    throw new AiProviderError(`${providerLabel(provider)} вернул некорректный JSON.`, {
      provider, operation, status: response.status,
    });
  }
  return payload;
}

function normalizeProviderModels(json) {
  const raw = Array.isArray(json) ? json : (json?.data || json?.models || []);
  if (!Array.isArray(raw)) return [];
  return raw.map((model) => ({
    id: String(model?.id ?? model?.model ?? model?.name ?? ''),
    name: typeof model?.display_name === 'string' ? model.display_name
      : typeof model?.name === 'string' ? model.name : '',
    description: typeof model?.description === 'string' ? model.description : '',
    tier: typeof model?.access_tier === 'string' ? model.access_tier : '',
    modality: typeof model?.modality === 'string' ? model.modality : '',
  })).filter((model) => model.id);
}

function normalizeCompletionText(json) {
  const content = json?.choices?.[0]?.message?.content ?? json?.choices?.[0]?.text;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter((part) => part?.type === 'text' || typeof part?.text === 'string')
      .map((part) => typeof part === 'string' ? part : part.text).join('');
  }
  return '';
}

/** Gemini возвращает модели как {name: 'models/...', displayName, description}. */
function normalizeGeminiModels(json) {
  const raw = Array.isArray(json?.models) ? json.models : [];
  return raw
    .filter((model) => {
      const methods = model?.supportedGenerationMethods;
      return !Array.isArray(methods) || methods.includes('generateContent');
    })
    .map((model) => ({
      id: String(model?.name || '').replace(/^models\//, ''),
      name: typeof model?.displayName === 'string' ? model.displayName : '',
      description: typeof model?.description === 'string' ? model.description : '',
      tier: '',
      modality: 'chat',
    }))
    .filter((model) => model.id);
}

function normalizeProviderModelsFor(provider, json) {
  return provider === 'gemini' ? normalizeGeminiModels(json) : normalizeProviderModels(json);
}

function providerModelsPath(provider) {
  return provider === 'gemini' ? '/v1beta/models' : '/v1/models';
}

function mergeSameRole(messages) {
  const merged = [];
  for (const message of messages) {
    const last = merged[merged.length - 1];
    if (last && last.role === message.role) last.content += `\n\n${message.content}`;
    else merged.push({ ...message });
  }
  return merged;
}

/** Anthropic и Gemini принимают system-инструкции отдельным полем. */
function splitSystemMessages(messages) {
  const system = [];
  const rest = [];
  for (const message of messages) {
    if (message.role === 'system') system.push(message.content);
    else rest.push({ role: message.role === 'assistant' ? 'assistant' : 'user', content: message.content });
  }
  return { system: system.join('\n\n'), messages: mergeSameRole(rest) };
}

/**
 * Строит URL и тело chat-запроса под конкретный провайдер.
 * OpenAI-compatible/Ollama — /v1/chat/completions, Anthropic — /v1/messages,
 * Gemini — /v1beta/models/{model}:generateContent.
 */
function buildProviderChatRequest(provider, profile, {
  messages, temperature, maxTokens, json,
}) {
  const normalized = normalizeProviderMessages(messages);

  if (provider === 'anthropic') {
    const { system, messages: chat } = splitSystemMessages(normalized);
    if (chat.length === 0) chat.push({ role: 'user', content: 'Продолжи.' });
    if (chat[0].role !== 'user') chat.unshift({ role: 'user', content: 'Продолжи.' });
    const body = {
      model: profile.model,
      max_tokens: maxTokens,
      messages: chat,
      temperature,
    };
    if (system) body.system = system;
    return { path: '/v1/messages', body };
  }

  if (provider === 'gemini') {
    const { system, messages: chat } = splitSystemMessages(normalized);
    const contents = chat.map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    }));
    if (contents.length === 0) contents.push({ role: 'user', parts: [{ text: 'Продолжи.' }] });
    if (contents[0].role !== 'user') contents.unshift({ role: 'user', parts: [{ text: 'Продолжи.' }] });
    const generationConfig = { temperature, maxOutputTokens: maxTokens };
    if (json) generationConfig.responseMimeType = 'application/json';
    const body = { contents, generationConfig };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    const modelId = String(profile.model || '').replace(/^models\//, '');
    // Кодируем только сегменты пути: tunedModels/<id> должен сохранить слеш.
    const modelPath = modelId.split('/').map((segment) => encodeURIComponent(segment)).join('/');
    return { path: `/v1beta/models/${modelPath}:generateContent`, body };
  }

  const body = {
    model: profile.model,
    messages: normalized,
    temperature,
    max_tokens: maxTokens,
  };
  if (json) body.response_format = { type: 'json_object' };
  return { path: '/v1/chat/completions', body };
}

/** Извлекает текст ответа из формата конкретного провайдера. */
function normalizeProviderCompletionText(provider, json) {
  if (provider === 'anthropic') {
    const parts = Array.isArray(json?.content) ? json.content : [];
    return parts
      .filter((part) => part?.type === 'text' || typeof part?.text === 'string')
      .map((part) => typeof part === 'string' ? part : String(part.text ?? ''))
      .join('');
  }
  if (provider === 'gemini') {
    const parts = json?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return '';
    return parts.filter((part) => typeof part?.text === 'string').map((part) => part.text).join('');
  }
  return normalizeCompletionText(json);
}

/** Причина пустого ответа (блокировка/отказ) — для понятной ошибки UI. */
function providerBlockedReason(provider, json) {
  if (provider === 'gemini') {
    const reason = json?.promptFeedback?.blockReason || json?.candidates?.[0]?.finishReason;
    return typeof reason === 'string' && reason !== 'STOP' ? reason : '';
  }
  if (provider === 'anthropic') {
    return json?.stop_reason === 'refusal' ? 'refusal' : '';
  }
  return '';
}

function profileFromSettings(settings) {
  const profiles = settings?.ai?.profiles;
  if (Array.isArray(profiles) && profiles.length > 0) {
    const activeId = settings.ai.activeProfileId;
    return profiles.find((profile) => profile?.id === activeId) || profiles[0];
  }
  if (settings && (settings.xkiroApiKey || settings.xkiroModel || settings.xkiroBaseUrl)) {
    return {
      id: 'legacy-xkiro',
      name: 'xKiro',
      provider: 'xkiro',
      apiKey: settings.xkiroApiKey || '',
      model: settings.xkiroModel || '',
      endpoint: settings.xkiroBaseUrl || AI_BASE,
    };
  }
  return null;
}

function normalizeProfileRecord(profile, fallbackId = 'default') {
  const normalized = normalizeAiProfile(profile);
  return {
    ...normalized,
    id: String(profile?.id || fallbackId),
    name: String(profile?.name || normalized.provider || 'AI'),
  };
}

/**
 * Мигрирует legacy xkiro* поля в runtime-формат профилей. Функция возвращает
 * новый объект и не удаляет старые поля: старые версии приложения остаются
 * совместимыми с той же записью IndexedDB.
 */
export function migrateAiSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return settings || {};
  const out = { ...settings };
  const rawProfiles = settings.ai?.profiles;
  if (Array.isArray(rawProfiles) && rawProfiles.length > 0) {
    const profiles = rawProfiles
      .filter((profile) => profile && typeof profile === 'object' && !Array.isArray(profile))
      .map((profile, index) => normalizeProfileRecord(profile, `profile-${index + 1}`));
    if (profiles.length > 0) {
      const activeProfileId = profiles.some((profile) => profile.id === settings.ai.activeProfileId)
        ? settings.ai.activeProfileId : profiles[0].id;
      out.ai = { ...settings.ai, activeProfileId, profiles };
    }
    return out;
  }
  if (settings.xkiroApiKey || settings.xkiroModel || settings.xkiroBaseUrl) {
    out.ai = {
      activeProfileId: 'legacy-xkiro',
      profiles: [normalizeProfileRecord({
        id: 'legacy-xkiro', name: 'xKiro', provider: 'xkiro',
        apiKey: settings.xkiroApiKey || '', model: settings.xkiroModel || '',
        endpoint: settings.xkiroBaseUrl || AI_BASE,
      }, 'legacy-xkiro')],
    };
  }
  return out;
}

/** Возвращает активный нормализованный профиль без изменения настроек. */
export function getActiveAiProfile(settings) {
  return normalizeAiProfile(migrateAiSettings(settings));
}

/**
 * Удаляет секреты из AI-профилей перед экспортом. Модель, endpoint и
 * capabilities переносимы; apiKey/auth/headers никогда не экспортируются.
 */
export function sanitizeAiSettingsForExport(settings) {
  const migrated = migrateAiSettings(settings);
  const profiles = migrated?.ai?.profiles;
  if (!Array.isArray(profiles) || profiles.length === 0) return undefined;
  return {
    activeProfileId: migrated.ai.activeProfileId,
    profiles: profiles.map((profile) => {
      // Явный allowlist профиля: нельзя экспортировать неизвестные будущие
      // поля, которые могут оказаться секретами (password/token/headers и т.п.).
      const safeProfile = {};
      for (const key of ['id', 'name', 'provider', 'endpoint', 'model', 'options', 'endpoints']) {
        if (key in profile) safeProfile[key] = profile[key];
      }
      return safeProfile;
    }),
  };
}

/** Сливает импортированные AI-профили с локальными, сохраняя локальные ключи. */
export function mergeAiSettings(localSettings, importedSettings) {
  const local = migrateAiSettings(localSettings || {});
  const imported = migrateAiSettings(importedSettings || {});
  const localProfiles = Array.isArray(local.ai?.profiles) ? local.ai.profiles : [];
  const importedProfiles = Array.isArray(imported.ai?.profiles) ? imported.ai.profiles : [];
  if (importedProfiles.length === 0) return local;
  const byId = new Map(localProfiles.map((profile) => [profile.id, profile]));
  const profiles = importedProfiles.map((profile) => {
    const previous = byId.get(profile.id);
    return {
      ...(previous || {}), ...profile,
      // Backup intentionally omits secrets. Empty/missing imported values must
      // not erase a key configured locally on this device.
      ...(previous?.apiKey && !profile.apiKey ? { apiKey: previous.apiKey } : {}),
    };
  });
  const activeProfileId = profiles.some((profile) => profile.id === imported.ai.activeProfileId)
    ? imported.ai.activeProfileId : (local.ai?.activeProfileId || profiles[0].id);
  return { ...local, ai: { ...local.ai, ...imported.ai, activeProfileId, profiles } };
}

/** Преобразует старые xkiro* настройки в единый профиль без изменения IndexedDB. */
export function normalizeAiProfile(profileOrSettings) {
  const profile = profileFromSettings(profileOrSettings) || profileOrSettings || {};
  const provider = String(profile.provider || (profileOrSettings?.provider ? profileOrSettings.provider : 'xkiro')).toLowerCase();
  const endpoint = profile.endpoint || profile.baseUrl || AI_PROVIDER_DEFAULT_ENDPOINTS[provider] || '';
  return {
    ...profile,
    provider,
    endpoint: normalizeProviderBase(endpoint, ''),
    apiKey: String(profile.apiKey || ''),
    model: String(profile.model || ''),
  };
}

/**
 * Создаёт provider-agnostic клиент. xKiro использует старый проверенный код,
 * OpenAI-compatible и Ollama — общий безопасный OpenAI-совместимый транспорт.
 */
export function getAiClient(profileOrSettings) {
  const profile = normalizeAiProfile(profileOrSettings);
  const provider = profile.provider;
  const capabilities = AI_PROVIDER_CAPABILITIES[provider]
    || AI_PROVIDER_CAPABILITIES['custom-http'];
  const label = providerLabel(provider);

  const requireModel = () => {
    if (!profile.model) throw new AiProviderError('Не выбрана AI-модель.', {
      provider, operation: 'chat',
    });
  };
  const requireKey = () => {
    // Ключ обязателен для облачных протоколов. Локальные endpoint
    // (Ollama) и OpenAI-совместимые прокси без авторизации остаются рабочими.
    if (!profile.apiKey && (provider === 'xkiro' || provider === 'anthropic' || provider === 'gemini')) {
      throw new AiProviderError(`Не задан API-ключ ${label}.`, { provider, operation: 'chat' });
    }
  };
  const requireCapability = (name, operation) => {
    if (!capabilities[name]) {
      throw new AiProviderError(`${label} не поддерживает операцию «${operation}».`, {
        provider, operation,
      });
    }
  };

  return {
    profile,
    provider,
    capabilities,
    async listModels({ signal } = {}) {
      requireCapability('models', 'models');
      requireKey();
      if (provider === 'xkiro') return listModels(profile.apiKey, { baseUrl: profile.endpoint });
      const json = await requestProviderJson(profile, providerModelsPath(provider), { operation: 'models', signal });
      return normalizeProviderModelsFor(provider, json);
    },
    async complete({ messages, temperature = 0.3, maxTokens = 1024, json = false, signal } = {}) {
      requireCapability('chat', 'chat');
      requireModel();
      requireKey();
      if (provider === 'xkiro') {
        return chatXkiro({
          apiKey: profile.apiKey,
          model: profile.model,
          messages,
          temperature,
          maxTokens,
          json,
          baseUrl: profile.endpoint,
        });
      }
      const request = buildProviderChatRequest(provider, profile, {
        messages, temperature, maxTokens, json: Boolean(json && capabilities.json),
      });
      const response = await requestProviderJson(profile, request.path, {
        method: 'POST', body: request.body, operation: 'chat', signal,
      });
      const text = normalizeProviderCompletionText(provider, response);
      if (!text) {
        const reason = providerBlockedReason(provider, response);
        throw new AiProviderError(
          reason
            ? `${label} не вернул текст ответа (причина: ${reason}).`
            : `${label} не вернул текст ответа.`,
          { provider, operation: 'chat' }
        );
      }
      return text;
    },
    async search({ query, maxResults = 5, signal } = {}) {
      requireCapability('search', 'search');
      requireKey();
      return searchXkiro({ apiKey: profile.apiKey, query, maxResults, baseUrl: profile.endpoint });
    },
    async fetchPage({ url } = {}) {
      requireCapability('pageFetch', 'fetch');
      return fetchPageViaWorker({ url, baseUrl: profile.endpoint });
    },
  };
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
  const profile = normalizeAiProfile(settings);
  if (!profile.provider) return false;
  // Старый контракт сохраняется: ключ означает, что настройка начата;
  // наличие модели проверяется отдельным helper-ом перед операцией.
  if (profile.provider === 'xkiro') return Boolean(profile.apiKey);
  if (profile.provider === 'ollama') return Boolean(profile.endpoint);
  return Boolean(profile.apiKey);
}

/** Проверяет, готов ли выбранный профиль выполнить запрос к модели. */
export function isAiModelConfigured(settings) {
  const profile = normalizeAiProfile(settings);
  return Boolean(profile.model && (profile.provider === 'ollama' || profile.apiKey));
}

/**
 * 🔖 3.9.1 — Этап 4: запрос страницы российского книжного сайта через
 * универсальный endpoint Worker (worker/worker.js, маршрут /fetch).
 * Worker сам валидирует схему/домен, редиректы, таймаут и блокировки;
 * здесь — только вызов и нормализация ошибок.
 * @param {object} opts
 * @param {string} opts.url — ссылка на страницу книги
 * @param {string} [opts.baseUrl] — URL пользовательского Worker
 *   (по умолчанию api.xkiro.com — тогда /fetch упадёт с 404, что
 *   означает «Worker не настроен/не поддерживает /fetch»).
 * @returns {Promise<{ok: true, url: string, finalUrl: string, domain: string,
 *   status: number, contentType: string, html: string, truncated: boolean,
 *   redirected: boolean, warnings: string[]}>}
 */
export async function fetchPageViaWorker({ url, baseUrl = AI_BASE }) {
  if (!url || !String(url).trim()) throw new AiApiError('Пустой URL страницы.');
  const endpoint = `${normalizeBase(baseUrl)}/fetch`;
  let resp;
  try {
    resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ url: String(url).trim() }),
    });
  } catch {
    throw new AiApiError(
      'Не удалось связаться с endpoint Worker. Проверьте настройки AI в Настройках → AI (xKiro).',
      { status: 0 }
    );
  }
  let jsonResp = null;
  try { jsonResp = await resp.json(); } catch { /* идём в общий статус */ }
  if (!resp.ok || !jsonResp || jsonResp.ok !== true) {
    const detail = jsonResp?.error ? `: ${jsonResp.error}` : '';
    throw new AiApiError(`Endpoint Worker вернул ошибку (HTTP ${resp.status})${detail}`, { status: resp.status });
  }
  return jsonResp;
}