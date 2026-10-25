// ═══════════════════════════════════════════════════════════════════
// 🔖 3.8.7 — тесты сетевого клиента xKiro (ai.js).
//
// Что симулируется (РЕАЛЬНЫЕ fetch-вызовы через vi.stubGlobal):
//   — GET /v1/models c Bearer-авторизацией и модальностью chat;
//     реальные поля xKiro: display_name → name, access_tier → tier;
//   — POST /v1/chat/completions с корректным телом (OpenAI-совместимо,
//     response_format json_object при json=true);
//   — POST /v1/search с телом {model:'xkiro/web-search', query, max_results};
//     реальные поля ответа: publishedDate / faviconUrl / thumbnailUrl;
//   — baseUrl (CORS-прокси) подставляется во все URL; хвостовой слеш
//     нормализуется; пустой baseUrl → api.xkiro.com;
//   — сетевые сбои (fetch бросает — CORS/оффлайн) → понятное сообщение
//     с подсказкой про прокси; статусы 400/401/403/402/429/502/503/5xx →
//     человекочитаемая ошибка AiApiError (а не «сырой» JSON/fetch);
//   — извлечение JSON из ответов LLM (фенсы ```json, окружение текстом);
//   — контракт БЕЗОПАСНОСТИ: в исходнике ai.js НЕТ захардкоженных ключей.
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AiApiError, AiProviderError, listModels, chatXkiro, searchXkiro, extractJson,
  isAiConfigured, normalizeAiProfile, migrateAiSettings, getActiveAiProfile,
  sanitizeAiSettingsForExport, mergeAiSettings, getAiClient, AI_BASE,
} from '../ai.js';

const KEY = 'test-key-123';
const MODEL = 'openai/gpt-5.6-sol';
const PROXY = 'https://worker.example.com';

function stubFetch(impl) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('listModels', () => {
  it('GET /v1/models?modality=chat с Bearer-ключом; плоский массив → нормализация', async () => {
    const fn = stubFetch(() => jsonResponse([
      { id: 'openai/gpt-5.6-sol', display_name: 'GPT-5.6 Sol', access_tier: 'free' },
      { id: 'anthropic/claude-x', description: 'Claude X' },
    ]));
    const res = await listModels(KEY);
    expect(fn).toHaveBeenCalledWith(
      'https://api.xkiro.com/v1/models?modality=chat',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: `Bearer ${KEY}` }),
      })
    );
    expect(res).toEqual([
      { id: 'openai/gpt-5.6-sol', name: 'GPT-5.6 Sol', description: '', tier: 'free', modality: '' },
      { id: 'anthropic/claude-x', name: '', description: 'Claude X', tier: '', modality: '' },
    ]);
  });

  it('display_name / access_tier — реальные поля xKiro (docs.xkiro.com/api/list-models)', async () => {
    stubFetch(() => jsonResponse({
      data: [
        { id: 'vendor/model-a', display_name: 'Модель A', access_tier: 'premium', modality: 'chat' },
        { id: 'vendor/model-b', name: 'Старое поле name', access_tier: 'free' },
      ],
    }));
    const res = await listModels(KEY);
    // display_name приоритетнее name; access_tier → tier; modality копируется
    expect(res).toEqual([
      { id: 'vendor/model-a', name: 'Модель A', description: '', tier: 'premium', modality: 'chat' },
      { id: 'vendor/model-b', name: 'Старое поле name', description: '', tier: 'free', modality: '' },
    ]);
  });

  it('объект {data:[...]} тоже разбирается; полностью пустые/мусорные записи отфильтровываются', async () => {
    stubFetch(() => jsonResponse({ data: [{ id: 'a/x' }, {}] }));
    const res = await listModels(KEY);
    expect(res).toEqual([
      { id: 'a/x', name: '', description: '', tier: '', modality: '' },
    ]);
  });

  it('baseUrl CORS-прокси подставляется в URL; хвостовой слеш нормализуется', async () => {
    const fn = stubFetch(() => jsonResponse([]));
    await listModels(KEY, { baseUrl: `${PROXY}/` });
    expect(fn).toHaveBeenCalledWith(
      `${PROXY}/v1/models?modality=chat`,
      expect.anything()
    );
    // пустой baseUrl → api.xkiro.com по умолчанию
    await listModels(KEY, { baseUrl: '' });
    expect(fn).toHaveBeenCalledWith(`${AI_BASE}/v1/models?modality=chat`, expect.anything());
  });

  it('401 → AiApiError «Неверный API-ключ»', async () => {
    stubFetch(() => jsonResponse({ error: { message: 'bad key' } }, 401));
    await expect(listModels(KEY)).rejects.toMatchObject({
      name: 'AiApiError',
      status: 401,
      message: expect.stringContaining('Неверный API-ключ'),
    });
  });

  it('403 → AiApiError «Неверный API-ключ»', async () => {
    stubFetch(() => jsonResponse({ error: { message: 'forbidden' } }, 403));
    await expect(listModels(KEY)).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining('Неверный API-ключ'),
    });
  });

  it('сеть/CORS недоступна (fetch бросает) → понятная ошибка с подсказкой про прокси', async () => {
    stubFetch(() => { throw new TypeError('Failed to fetch'); });
    await expect(listModels(KEY)).rejects.toMatchObject({
      status: 0,
      message: expect.stringContaining('Не удалось связаться с xKiro'),
    });
    await expect(listModels(KEY)).rejects.toMatchObject({
      message: expect.stringContaining('CORS'),
    });
  });

  it('ключ не задан → ошибка до запроса (fetch не вызывается)', async () => {
    const fn = stubFetch(() => jsonResponse([]));
    await expect(listModels('')).rejects.toThrow('Не задан API-ключ');
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('chatXkiro', () => {
  it('POST /v1/chat/completions: тело OpenAI-совместимо + Bearer; возвращает text', async () => {
    const fn = stubFetch(() => jsonResponse({
      choices: [{ message: { content: 'Привет!' } }],
    }));
    const out = await chatXkiro({
      apiKey: KEY, model: MODEL,
      messages: [{ role: 'user', content: 'Привет' }],
      temperature: 0.7, maxTokens: 200,
    });
    expect(out).toBe('Привет!');
    const [, init] = fn.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
    });
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      model: MODEL,
      messages: [{ role: 'user', content: 'Привет' }],
      temperature: 0.7,
      max_tokens: 200,
    });
  });

  it('baseUrl CORS-прокси подставляется в URL', async () => {
    const fn = stubFetch(() => jsonResponse({ choices: [{ message: { content: 'ok' } }] }));
    await chatXkiro({ apiKey: KEY, model: MODEL, messages: [{ role: 'user', content: 'x' }], baseUrl: PROXY });
    expect(fn).toHaveBeenCalledWith(`${PROXY}/v1/chat/completions`, expect.anything());
  });

  it('json=true → response_format json_object', async () => {
    const fn = stubFetch(() => jsonResponse({ choices: [{ message: { content: '{}' } }] }));
    await chatXkiro({ apiKey: KEY, model: MODEL, messages: [{ role: 'user', content: 'x' }], json: true });
    const body = JSON.parse(fn.mock.calls[0][1].body);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('пустой ответ choices → AiApiError «AI не вернул»', async () => {
    stubFetch(() => jsonResponse({ choices: [] }));
    await expect(chatXkiro({ apiKey: KEY, model: MODEL, messages: [{ role: 'user', content: 'x' }] }))
      .rejects.toThrow('AI не вернул текст ответа');
  });

  it('500 → AiApiError «временно недоступен» (с деталями сервера при наличии)', async () => {
    stubFetch(() => jsonResponse({ error: { message: 'upstream exploded' } }, 500));
    await expect(chatXkiro({ apiKey: KEY, model: MODEL, messages: [{ role: 'user', content: 'x' }] }))
      .rejects.toMatchObject({ status: 500, message: expect.stringContaining('upstream exploded') });
  });

  it('503 → AiApiError «временно недоступен», повтор позже', async () => {
    stubFetch(() => jsonResponse({ error: { message: 'service_unavailable' } }, 503));
    await expect(chatXkiro({ apiKey: KEY, model: MODEL, messages: [{ role: 'user', content: 'x' }] }))
      .rejects.toMatchObject({ status: 503, message: expect.stringContaining('временно недоступен') });
  });

  it('429 → AiApiError «Слишком много запросов»', async () => {
    stubFetch(() => jsonResponse({ error: { message: 'rate limited' } }, 429));
    await expect(chatXkiro({ apiKey: KEY, model: MODEL, messages: [{ role: 'user', content: 'x' }] }))
      .rejects.toMatchObject({ status: 429, message: expect.stringContaining('Слишком много запросов') });
  });

  it('402 → AiApiError «Недостаточно средств»', async () => {
    stubFetch(() => jsonResponse({ error: { message: 'insufficient balance' } }, 402));
    await expect(chatXkiro({ apiKey: KEY, model: MODEL, messages: [{ role: 'user', content: 'x' }] }))
      .rejects.toMatchObject({ status: 402, message: expect.stringContaining('Недостаточно средств') });
  });

  it('ошибка тела запроса 400 → деталь сервера', async () => {
    stubFetch(() => jsonResponse({ error: { message: 'model not found', code: 'model_not_found' } }, 400));
    await expect(chatXkiro({ apiKey: KEY, model: 'нет-такой', messages: [{ role: 'user', content: 'x' }] }))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining('model not found') });
  });

  it('400 без деталей → «неверный запрос (HTTP 400)»', async () => {
    stubFetch(() => jsonResponse({}, 400));
    await expect(chatXkiro({ apiKey: KEY, model: MODEL, messages: [{ role: 'user', content: 'x' }] }))
      .rejects.toThrow('неверный запрос (HTTP 400)');
  });

  it('защита от пустых параметров: нет модели / нет сообщений', async () => {
    const fn = stubFetch(() => jsonResponse({ choices: [{ message: { content: 'x' } }] }));
    await expect(chatXkiro({ apiKey: KEY, model: '', messages: [{ role: 'user', content: 'x' }] }))
      .rejects.toThrow('Не выбрана AI-модель');
    await expect(chatXkiro({ apiKey: KEY, model: MODEL, messages: [] })).rejects.toThrow('Пустой запрос');
    await expect(chatXkiro({ apiKey: '', model: MODEL, messages: [{ role: 'user', content: 'x' }] }))
      .rejects.toThrow('Не задан API-ключ');
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('searchXkiro', () => {
  it('POST /v1/search: тело {model, query, max_results}; реальные поля xKiro маппятся', async () => {
    const fn = stubFetch(() => jsonResponse({
      results: [
        { title: 'Книга', url: 'https://litres.ru/x', snippet: 'Описание', source: 'ЛитРес', publishedDate: '2024-03-01', faviconUrl: 'https://x/f.ico', thumbnailUrl: 'https://x/t.jpg' },
      ],
    }));
    const res = await searchXkiro({ apiKey: KEY, query: 'Мастер и Маргарита', maxResults: 3 });
    const [, init] = fn.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      model: 'xkiro/web-search',
      query: 'Мастер и Маргарита',
      max_results: 3,
    });
    // 🔖 3.8.7: publishedDate/faviconUrl/thumbnailUrl (docs.xkiro.com/api/web-search)
    expect(res).toEqual([{
      title: 'Книга', url: 'https://litres.ru/x', snippet: 'Описание', source: 'ЛитРес',
      publicationDate: '2024-03-01', favicon: 'https://x/f.ico', thumbnail: 'https://x/t.jpg',
    }]);
  });

  it('старые поля publicationDate/favicon/thumbnail тоже принимаются (обратная совместимость)', async () => {
    stubFetch(() => jsonResponse({ data: [
      { title: 'A', url: 'u', publicationDate: '2019', favicon: 'f', thumbnail: 't' },
    ] }));
    const res = await searchXkiro({ apiKey: KEY, query: 'q' });
    expect(res[0]).toMatchObject({
      publicationDate: '2019', favicon: 'f', thumbnail: 't',
    });
  });

  it('baseUrl CORS-прокси подставляется в URL', async () => {
    const fn = stubFetch(() => jsonResponse({ results: [] }));
    await searchXkiro({ apiKey: KEY, query: 'q', baseUrl: PROXY });
    expect(fn).toHaveBeenCalledWith(`${PROXY}/v1/search`, expect.anything());
  });

  it('502 no_search_performed → AiApiError «переформулируйте»', async () => {
    stubFetch(() => jsonResponse({ error: { message: 'no search', code: 'no_search_performed' } }, 502));
    await expect(searchXkiro({ apiKey: KEY, query: 'q' }))
      .rejects.toMatchObject({ status: 502, code: 'no_search_performed', message: expect.stringContaining('переформулируйте') });
  });

  it('пустой запрос → AiApiError без сети', async () => {
    const fn = stubFetch(() => jsonResponse({ results: [] }));
    await expect(searchXkiro({ apiKey: KEY, query: '   ' })).rejects.toThrow('Пустой поисковый запрос');
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('provider-agnostic AI client', () => {
  it('OpenAI-compatible profile uses /v1 endpoints, Bearer and normalizes chat content', async () => {
    const fn = stubFetch((url, init) => {
      if (url === `${PROXY}/v1/models`) return jsonResponse({ data: [{ id: 'local/model', name: 'Local model' }] });
      return jsonResponse({ choices: [{ message: { content: [{ type: 'text', text: 'готово' }] } }] });
    });
    const client = getAiClient({
      provider: 'openai-compatible', endpoint: `${PROXY}/v1`, apiKey: KEY, model: MODEL,
    });

    await expect(client.listModels()).resolves.toEqual([{
      id: 'local/model', name: 'Local model', description: '', tier: '', modality: '',
    }]);
    await expect(client.complete({
      messages: [{ role: 'user', content: 'тест' }], json: true,
    })).resolves.toBe('готово');

    expect(fn).toHaveBeenNthCalledWith(1, `${PROXY}/v1/models`, expect.objectContaining({
      headers: expect.objectContaining({ Authorization: `Bearer ${KEY}` }),
    }));
    const [, init] = fn.mock.calls[1];
    expect(JSON.parse(init.body)).toMatchObject({
      model: MODEL,
      messages: [{ role: 'user', content: 'тест' }],
      response_format: { type: 'json_object' },
    });
  });

  it('Ollama не требует API-ключа, но требует модель и endpoint', async () => {
    const fn = stubFetch(() => jsonResponse({ choices: [{ message: { content: 'локальный ответ' } }] }));
    const client = getAiClient({
      provider: 'ollama', endpoint: 'http://localhost:11434', model: 'llama3.2',
    });
    await expect(client.complete({ messages: [{ role: 'user', content: 'тест' }] }))
      .resolves.toBe('локальный ответ');
    expect(fn).toHaveBeenCalledWith('http://localhost:11434/v1/chat/completions', expect.anything());
    expect(fn.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it('provider без web search возвращает нормализованную ошибку без сетевого запроса', async () => {
    const fn = stubFetch(() => jsonResponse({ results: [] }));
    const client = getAiClient({
      provider: 'openai-compatible', endpoint: PROXY, apiKey: KEY, model: MODEL,
    });
    await expect(client.search({ query: 'книга' })).rejects.toMatchObject({
      name: 'AiProviderError', provider: 'openai-compatible', operation: 'search', status: 0,
      message: expect.stringContaining('не поддерживает'),
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it('legacy xkiro settings преобразуются в профиль без изменения исходных настроек', () => {
    const settings = { xkiroApiKey: KEY, xkiroModel: MODEL, xkiroBaseUrl: `${PROXY}/` };
    const profile = normalizeAiProfile(settings);
    expect(profile).toMatchObject({
      provider: 'xkiro', apiKey: KEY, model: MODEL, endpoint: PROXY,
    });
    expect(settings).toEqual({ xkiroApiKey: KEY, xkiroModel: MODEL, xkiroBaseUrl: `${PROXY}/` });
    expect(isAiConfigured(settings)).toBe(true);
  });

  it('активный профиль из settings.ai имеет приоритет над legacy xkiro-полями', () => {
    const profile = normalizeAiProfile({
      xkiroApiKey: 'legacy', xkiroModel: 'legacy/model',
      ai: {
        activeProfileId: 'local',
        profiles: [{ id: 'local', provider: 'ollama', endpoint: 'http://localhost:11434', model: 'llama3.2' }],
      },
    });
    expect(profile).toMatchObject({ provider: 'ollama', endpoint: 'http://localhost:11434', model: 'llama3.2' });
    expect(isAiConfigured({ ai: { profiles: [profile] } })).toBe(true);
  });
});

describe('AI settings migration and export safety', () => {
  it('migrateAiSettings creates a runtime profile and preserves legacy fields', () => {
    const legacy = { xkiroApiKey: KEY, xkiroModel: MODEL, xkiroBaseUrl: `${PROXY}/` };
    const migrated = migrateAiSettings(legacy);
    expect(migrated).not.toBe(legacy);
    expect(migrated).toMatchObject({ xkiroApiKey: KEY, xkiroModel: MODEL, xkiroBaseUrl: `${PROXY}/` });
    expect(migrated.ai).toMatchObject({ activeProfileId: 'legacy-xkiro' });
    expect(migrated.ai.profiles[0]).toMatchObject({
      id: 'legacy-xkiro', provider: 'xkiro', apiKey: KEY, model: MODEL, endpoint: PROXY,
    });
    expect(getActiveAiProfile(legacy)).toMatchObject({ provider: 'xkiro', apiKey: KEY, model: MODEL });
  });

  it('sanitizeAiSettingsForExport removes key, auth and headers but keeps provider configuration', () => {
    const safe = sanitizeAiSettingsForExport({
      ai: {
        activeProfileId: 'local',
        profiles: [{
          id: 'local', provider: 'ollama', endpoint: 'http://localhost:11434', model: 'llama3.2',
          apiKey: KEY, auth: { type: 'bearer' }, headers: { Authorization: `Bearer ${KEY}` }, futureSecret: 'must-not-export',
        }],
      },
    });
    expect(safe).toMatchObject({
      activeProfileId: 'local',
      profiles: [{ id: 'local', provider: 'ollama', endpoint: 'http://localhost:11434', model: 'llama3.2' }],
    });
    expect(safe.profiles[0]).not.toHaveProperty('apiKey');
    expect(safe.profiles[0]).not.toHaveProperty('auth');
    expect(safe.profiles[0]).not.toHaveProperty('headers');
    expect(safe.profiles[0]).not.toHaveProperty('futureSecret');
  });

  it('mergeAiSettings preserves local API key when imported backup omits it', () => {
    const merged = mergeAiSettings(
      { ai: { activeProfileId: 'main', profiles: [{ id: 'main', provider: 'openai-compatible', endpoint: PROXY, model: 'old', apiKey: KEY }] } },
      { ai: { activeProfileId: 'main', profiles: [{ id: 'main', provider: 'openai-compatible', endpoint: `${PROXY}/v2`, model: 'new' }] } },
    );
    expect(merged.ai.profiles[0]).toMatchObject({ endpoint: `${PROXY}/v2`, model: 'new', apiKey: KEY });
  });

  it('активный профиль выбирается детерминированно, если activeProfileId повреждён', () => {
    const migrated = migrateAiSettings({
      ai: {
        activeProfileId: 'missing',
        profiles: [{ id: 'first', provider: 'ollama', model: 'a' }, { id: 'second', provider: 'ollama', model: 'b' }],
      },
    });
    expect(migrated.ai.activeProfileId).toBe('first');
    expect(migrated.ai.profiles).toHaveLength(2);
  });
});

describe('extractJson', () => {
  it('чистый JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('markdown-огороженный ```json ... ```', () => {
    expect(extractJson('```json\n{"a":[1,2]}\n```')).toEqual({ a: [1, 2] });
    expect(extractJson('Ответ:\n```json\n{"a":1}\n```\nконец')).toEqual({ a: 1 });
  });

  it('JSON внутри текста (сбалансированная вырезка)', () => {
    expect(extractJson('Вот данные: {"title":"Мастер","author":"Булгаков"} спасибо!')).toEqual({
      title: 'Мастер', author: 'Булгаков',
    });
    expect(extractJson('[{"id":1},{"id":2}] с новой строки\n')).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('мусор/пусто → null', () => {
    expect(extractJson('')).toBeNull();
    expect(extractJson(null)).toBeNull();
    expect(extractJson('просто текст')).toBeNull();
    expect(extractJson('{"broken": }')).toBeNull();
  });
});

describe('контракт безопасности: ключей в коде нет', () => {
  it('исходник ai.js не содержит захардкоженных секретов', () => {
    const src = readFileSync(new URL('../ai.js', import.meta.url), 'utf8');
    // не должно быть токенов вида sk-..., строк из 32+ hex/base64 символов-секретов
    expect(src.match(/sk-[A-Za-z0-9]{8,}/)).toBeNull();
    expect(src.match(/[A-Za-z0-9_-]{40,}/)).toBeNull();
  });

  it('app.js совместим со старым SW-кэшем без named export fetchPageViaWorker', () => {
    const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
    expect(app).toContain("import * as AiClient from './ai.js';");
    expect(app).toContain('const fetchPageViaWorker = AiClient.fetchPageViaWorker ||');
  });
});

describe('isAiConfigured', () => {
  it('true только при непустом ключе', () => {
    expect(isAiConfigured({ xkiroApiKey: 'abc' })).toBe(true);
    expect(isAiConfigured({ xkiroApiKey: '' })).toBe(false);
    expect(isAiConfigured(null)).toBe(false);
    expect(isAiConfigured({})).toBe(false);
  });
});

describe('AiApiError', () => {
  it('instanceof Error с name и status/code', () => {
    const e = new AiApiError('msg', { status: 401, code: 'bad_key' });
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('AiApiError');
    expect(e.status).toBe(401);
    expect(e.code).toBe('bad_key');
    expect(new AiApiError('x').status).toBe(0);
    expect(new AiApiError('x').code).toBe('');
  });
});