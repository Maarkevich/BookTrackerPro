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
  AiApiError, listModels, chatXkiro, searchXkiro, extractJson, isAiConfigured, AI_BASE,
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