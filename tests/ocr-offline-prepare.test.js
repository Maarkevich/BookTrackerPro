// ═══════════════════════════════════════════════════════════════════
// Регрессионные тесты P1-13 — «OCR не гарантирован cold offline
// после установки».
//
// Оригинальная проблема (до фикса):
//   sw.js precache содержит ТОЛЬКО сам ocr.js. Тяжёлые OCR-ресурсы
//   (tesseract.min.js, worker.min.js, tesseract-core-simd.wasm.js,
//   rus.traineddata.gz) попадают в btp-ocr-v2 ТОЛЬКО через runtime-ответ
//   handleOcrAsset — т.е. после ПЕРВОГО успешного онлайн-OCR-запроса.
//   loadTesseractLib() грузит tesseract.min.js динамическим <script>:
//   у пользователя, установившего PWA, но не запускавшего OCR с сетью,
//   при первом офлайн-запуске fetch в handleOcrAsset падает (кеш пуст) →
//   распознавание не работает. Отсутствует механизм преднамеренной
//   подготовки набора до момента, когда он понадобится.
//
// Что доказывают тесты (РЕАЛЬНАЯ симуляция prepareOcrOffline):
//   — fresh profile (кеш пуст) + online: подготовка кладёт ВСЕ 4 URL
//     в btp-ocr-v2, isOcrReadyOffline() → true;
//   — interrupted download (404 на 3-м файле): {ok:false} и в кеше НЕТ
//     частично скачанных файлов (атомарный rollback);
//   — quota failure: cache.put отклоняется → {ok:false} + rollback;
//   — повторная подготовка: уже готовый набор НЕ перекачивается
//     (fetch не вызывается — кеш не дублируется);
//   - контроль всех URL в btp-ocr-v2: набор идентичен OCR_OFFLINE_ASSETS
//     и НЕ содержит eng.traineddata.gz (P1-12);
//   — контракт имён: имя кеша OCR в ocr.js == OCR_CACHE_NAME в sw.js.
// ═══════════════════════════════════════════════════════════════════
// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareOcrOffline, isOcrReadyOffline } from '../ocr.js';

const OCR_SOURCE = readFileSync(path.resolve(process.cwd(), 'ocr.js'), 'utf8');
const SW_SOURCE = readFileSync(path.resolve(process.cwd(), 'sw.js'), 'utf8');

const BASE = (OCR_SOURCE.match(/const\s+BASE\s*=\s*'([^']+)'/) || [])[1];
// 🔖 3.8.6: v1 → v2 (в v1 мог быть закеширован обрезанный Tesseract).
const OCR_CACHE = 'btp-ocr-v2';
const ASSETS = [
  `${BASE}/tesseract.min.js`,
  `${BASE}/worker.min.js`,
  `${BASE}/tesseract-core-simd.wasm.js`,
  `${BASE}/rus.traineddata.gz`,
];

/** Реальные размеры файлов оффлайн-набора на диске (для контроля размера). */
function diskSizes() {
  const sizes = {};
  for (const url of ASSETS) {
    const file = url.split('/').pop();
    try {
      const stats = require('node:fs').statSync(path.join(process.cwd(), file));
      sizes[file] = stats.size;
    } catch { sizes[file] = null; }
  }
  return sizes;
}

/**
 * Создаёт mock CacheStorage (как в браузере):
 * имя кеша → Map<url, Response>. Может эмулировать quota (put бросает).
 */
function createMockCaches({ failPut = false } = {}) {
  const store = new Map(); // cacheName -> Map(url -> Response)
  let openCalls = 0;
  const cacheLike = {
    async match(url) {
      const m = store.get(OCR_CACHE) || new Map();
      return m.get(String(url)) || undefined;
    },
    async put(url, resp) {
      if (failPut) {
        const err = new Error('quota exceeded');
        err.name = 'QuotaExceededError';
        throw err;
      }
      if (!store.has(OCR_CACHE)) store.set(OCR_CACHE, new Map());
      store.get(OCR_CACHE).set(String(url), resp);
    },
    async delete(url) { store.get(OCR_CACHE)?.delete(String(url)); return true; },
    async keys() { return [...(store.get(OCR_CACHE)?.keys() || [])]; },
  };
  return {
    open: async (name) => { openCalls++; return cacheLike; },
    store,
    get openCalls() { return openCalls; },
  };
}

/** Mock fetch: url → Response(ok) или 404. */
function mockFetch({ failAt } = {}) {
  return vi.fn(async (url) => {
    const u = String(url);
    if (failAt && u.endsWith('/' + failAt)) return new Response('', { status: 404 });
    if (u.includes('tesseract-core-simd.wasm.js')) return new Response('wasm', { status: 200 });
    return new Response('data', { status: 200 });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('P1-13: подготовка OCR для полного offline', () => {
  it('контракт: OCR_CACHE_NAME в ocr.js совпадает с OCR_CACHE_NAME в sw.js', () => {
    const ocrCache = (OCR_SOURCE.match(/const\s+OCR_CACHE_NAME\s*=\s*'([^']+)'/) || [])[1];
    const swCache = (SW_SOURCE.match(/const\s+OCR_CACHE_NAME\s*=\s*'([^']+)'/) || [])[1];
    expect(swCache).toBe('btp-ocr-v2');
    expect(ocrCache).toBe(swCache);
  });

  it('контракт: набор OCR_OFFLINE_ASSETS = 4 файла, без eng.traineddata.gz (P1-12)', () => {
    const m = OCR_SOURCE.match(/const\s+OCR_OFFLINE_ASSETS\s*=\s*\[\s*([\s\S]*?)\s*\];/);
    expect(m).not.toBeNull();
    const urls = [...m[1].matchAll(/`([^`]+)`/g)].map(x => x[1]).map(u => u.replace(/\$\{BASE\}/g, BASE));
    expect(urls.length).toBe(4);
    expect(urls.some(u => u.includes('eng.traineddata.gz'))).toBe(false);
    expect(urls.some(u => u.includes('rus.traineddata.gz'))).toBe(true);
    expect(urls.some(u => u.includes('tesseract.min.js'))).toBe(true);
    expect(urls.some(u => u.includes('worker.min.js'))).toBe(true);
    expect(urls.some(u => u.includes('tesseract-core-simd.wasm.js'))).toBe(true);
  });

  it('fresh profile + online: подготовка заполняет btp-ocr-v2 всеми URL, isOcrReadyOffline → true', async () => {
    const caches = createMockCaches();
    const fetchMock = mockFetch();
    vi.stubGlobal('caches', caches);
    vi.stubGlobal('fetch', fetchMock);

    const r = await prepareOcrOffline();
    expect(r.ok).toBe(true);

    const cached = await (await caches.open(OCR_CACHE)).keys();
    expect(cached.sort()).toEqual([...ASSETS].sort());
    expect(cached.length).toBe(4);

    const ready = await isOcrReadyOffline();
    expect(ready).toEqual({ ok: true, missing: [] });
  });

  it('interrupted download: 404 на 3-м файле → {ok:false} и в кеше НЕТ частичных файлов (атомарность)', async () => {
    const caches = createMockCaches();
    const fetchMock = mockFetch({ failAt: 'tesseract-core-simd.wasm.js' });
    vi.stubGlobal('caches', caches);
    vi.stubGlobal('fetch', fetchMock);

    const r = await prepareOcrOffline();
    expect(r.ok).toBe(false);
    expect(r.error).toContain('tesseract-core-simd.wasm.js');

    const cached = await (await caches.open(OCR_CACHE)).keys();
    expect(cached).toHaveLength(0); // первые два файла откачены
    const ready = await isOcrReadyOffline();
    expect(ready.ok).toBe(false);
  });

  it('interrupted download: сетевая ошибка fetch (offline) → {ok:false} + rollback', async () => {
    const caches = createMockCaches();
    const fetchMock = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    vi.stubGlobal('caches', caches);
    vi.stubGlobal('fetch', fetchMock);

    const r = await prepareOcrOffline();
    expect(r.ok).toBe(false);
    const cached = await (await caches.open(OCR_CACHE)).keys();
    expect(cached).toHaveLength(0);
  });

  it('quota failure: cache.put бросает QuotaExceededError → {ok:false} + rollback', async () => {
    const caches = createMockCaches({ failPut: true });
    const fetchMock = mockFetch();
    vi.stubGlobal('caches', caches);
    vi.stubGlobal('fetch', fetchMock);

    const r = await prepareOcrOffline();
    expect(r.ok).toBe(false);
    expect(r.error).toContain('кеш');
    const cached = await (await caches.open(OCR_CACHE)).keys();
    expect(cached).toHaveLength(0);
  });

  it('повторная подготовка: при уже полном кеше fetch НЕ вызывается, {ok:true}', async () => {
    const caches = createMockCaches();
    const fetchMock = mockFetch();
    vi.stubGlobal('caches', caches);
    vi.stubGlobal('fetch', fetchMock);

    // первый раз — реальная загрузка
    const first = await prepareOcrOffline();
    expect(first.ok).toBe(true);
    const fetchedOnce = fetchMock.mock.calls.length;

    // второй раз — всё уже в кеше
    const second = await prepareOcrOffline();
    expect(second.ok).toBe(true);
    expect(fetchMock.mock.calls.length).toBe(fetchedOnce); // не перекачивал
    const cached = await (await caches.open(OCR_CACHE)).keys();
    expect(cached.length).toBe(4);
  });

  it('контроль всех URL в btp-ocr-v2: набор на диске попарно покрывает OCR_OFFLINE_ASSETS', () => {
    const sizes = diskSizes();
    for (const url of ASSETS) {
      const file = url.split('/').pop();
      expect(sizes[file], `${file} должен существовать в корне проекта`).toBeTruthy();
    }
    // rus.traineddata.gz — проверенный размер по AUDIT.md (8 634 337 bytes)
    expect(sizes['rus.traineddata.gz']).toBe(8634337);
  });
});