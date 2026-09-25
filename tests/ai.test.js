// ═══════════════════════════════════════════════════════════════════
// 🔖 3.8.6 — тесты сетевого клиента xKiro (ai.js).
//
// Что симулируется (РЕАЛЬНЫЕ fetch-вызовы через vi.stubGlobal):
//   — GET /v1/models c Bearer-авторизацией и модальностью chat;
//   — POST /v1/chat/completions с корректным телом (OpenAI-совместимо,
//     response_format json_object при json=true);
//   — POST /v1/search с телом {model:'xkiro/web-search', query, max_results};
//   — сетевые сбои (fetch бросает) и статусы 401/5xx → человекочитаемая
//     ошибка AiApiError (а не «сырой» JSON/fetch);
//   — извлечение JSON из ответов LLM (фенсы ```json, окружение текстом);
//   — контракт БЕЗОПАСНОСТИ: в исходнике ai.js НЕТ захардкоженных ключей.
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AiApiError, listModels, chatXkiro, searchXkiro, extractJson, isAiConfigured,
} from '../ai.js';

const KEY = 'test-key-123';
const MODEL = 'openai/gpt-5.6-sol';

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
      { id: 'openai/gpt-5.6-sol', name: 'GPT-5.6 Sol', access_tier: 'free' },
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
      { id: 'openai/gpt-5.6-sol', name: 'GPT-5.6 Sol', description: '', tier: 'free' },
      { id: 'anthropic/claude-x', name: '', description: 'Claude X', tier: '' },
    ]);
  });

  it('объект {data:[...]} тоже разбирается; полностью пустые/мусорные записи отфильтровываются', async () => {
    stubFetch(() => jsonResponse({ data: [{ id: 'a/x' }, {}] }));
    const res = await listModels(KEY);
    expect(res).toEqual([
      { id: 'a/x', name: '', description: '', tier: '' },
    ]);
  });

  it('401 → AiApiError «Неверный API-ключ»', async () => {
    stubFetch(() => jsonResponse({ error: { message: 'bad key' } }, 401));
    await expect(listModels(KEY)).rejects.toMatchObject({
      name: 'AiApiError',
      status: 401,
      message: expect.stringContaining('Неверный API-ключ'),
    });
  });

  it('сеть недоступна (fetch бросает) → AiApiError «Нет связи»', async () => {
    stubFetch(() => { throw new TypeError('Failed to fetch'); });
    await expect(listModels(KEY)).rejects.toMatchObject({ status: 0, message: expect.stringContaining('Нет связи') });
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

  it('500 → AiApiError «временно недоступен»', async () => {
    stubFetch(() => jsonResponse({}, 500));
    await expect(chatXkiro({ apiKey: KEY, model: MODEL, messages: [{ role: 'user', content: 'x' }] }))
      .rejects.toMatchObject({ status: 500, message: expect.stringContaining('временно недоступен') });
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
  it('POST /v1/search: тело {model, query, max_results}, маппинг полей', async () => {
    const fn = stubFetch(() => jsonResponse({
      results: [
        { title: 'Книга', url: 'https://litres.ru/x', snippet: 'Описание', source: 'ЛитРес', publicationDate: '2024', favicon: 'f', thumbnail: 't' },
      ],
    }));
    const res = await searchXkiro({ apiKey: KEY, query: 'Мастер и Маргарита', maxResults: 3 });
    const [, init] = fn.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      model: 'xkiro/web-search',
      query: 'Мастер и Маргарита',
      max_results: 3,
    });
    expect(res).toEqual([{
      title: 'Книга', url: 'https://litres.ru/x', snippet: 'Описание', source: 'ЛитРес',
      publicationDate: '2024', favicon: 'f', thumbnail: 't',
    }]);
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
  it('instanceof Error с name и status', () => {
    const e = new AiApiError('msg', { status: 401 });
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('AiApiError');
    expect(e.status).toBe(401);
    expect(new AiApiError('x').status).toBe(0);
  });
});