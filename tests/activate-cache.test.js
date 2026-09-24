// ═══════════════════════════════════════════════════════════════════
// Регрессионные тесты P1-11 — «SW удаляет чужие origin caches».
//
// Оригинальная проблема (до фикса):
//   sw.js activate:
//     const validCaches = [CACHE_NAME, COVER_CACHE_NAME, OCR_CACHE_NAME];
//     keys.filter((key) => !validCaches.includes(key))
//         .map((key) => caches.delete(key))
//   — на общем origin (GitHub Pages / custom domain) service worker
//     приложения BookTrackerPro удалял ВСЕ кеши origin, которые не входят
//     в allowlist, включая кеши ДРУГИХ приложений (other-app-cache и пр.).
//     Владелец кеша определялся только «не входит в список», без проверки
//     префикса/namespace самого приложения.
//
// Что доказывают тесты (РЕАЛЬНАЯ симуляция activate в SW-среде):
//   — чужой кеш other-app-cache на общем origin НЕ удаляется;
//   — текущие кеши приложения (btp-v*, btp-covers-v1, btp-ocr-v1)
//     НЕ удаляются (validCaches);
//   — устаревший кеш приложения btp-v3.8.4 (не входящий в validCaches)
//     удаляется;
//   — clients.claim() вызывается после очистки;
//   — при отсутствии своих устаревших кешей ничего не удаляется.
// ═══════════════════════════════════════════════════════════════════
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const SW_SOURCE = readFileSync(fileURLToPath(new URL('../sw.js', import.meta.url)), 'utf8');

/** Достаёт имена кешей из исходника sw.js. */
function extractCacheNames() {
  const get = (name) => {
    const m = SW_SOURCE.match(new RegExp(`const\\s+${name}\\s*=\\s*'([^']+)'`));
    if (!m) throw new Error(`${name} не найден в sw.js`);
    return m[1];
  };
  return {
    CACHE_NAME: get('CACHE_NAME'),
    COVER_CACHE_NAME: get('COVER_CACHE_NAME'),
    OCR_CACHE_NAME: get('OCR_CACHE_NAME'),
  };
}

/**
 * Исполняет sw.js в vm-контексте с mock caches/self.
 * @param {string[]} cacheKeys — список кешей, которые вернёт caches.keys()
 */
function loadSW({ cacheKeys = [] } = {}) {
  const listeners = {};
  const deletedKeys = [];
  let claimCalled = false;

  const selfMock = {
    location: { origin: 'http://localhost' },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => {},
    clients: {
      claim: () => { claimCalled = true; return Promise.resolve(); },
      matchAll: () => Promise.resolve([]),
      openWindow: () => Promise.resolve(null),
    },
    registration: {
      update: () => Promise.resolve(),
      showNotification: () => Promise.resolve(),
    },
  };

  const sandbox = {
    self: selfMock,
    caches: {
      keys: async () => [...cacheKeys],
      delete: async (key) => { deletedKeys.push(key); return true; },
      open: async () => ({}), // в activate не используется
    },
    fetch: () => Promise.resolve(new Response('', { status: 200 })),
    Response,
    URL,
    console,
    navigator: { onLine: true },
    location: { protocol: 'https:', hostname: 'localhost' },
    document: undefined,
    window: {},
    MessageChannel: class {
      constructor() { this.port1 = { onmessage: null, postMessage() {} }; this.port2 = { postMessage() {} }; }
    },
    setTimeout,
    clearTimeout,
    Promise,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SW_SOURCE, sandbox, { filename: 'sw.js' });

  if (!listeners.activate) throw new Error('activate listener не зарегистрирован');

  return {
    activateHandler: listeners.activate,
    get deletedKeys() { return deletedKeys; },
    get claimCalled() { return claimCalled; },
  };
}

/** Вызывает activate handler и возвращает waitUntil-промис. */
function runActivate(activateHandler) {
  let promise = null;
  activateHandler({ waitUntil: (p) => { promise = p; } });
  return promise;
}

const { CACHE_NAME, COVER_CACHE_NAME, OCR_CACHE_NAME } = extractCacheNames();

describe('P1-11: activate удаляет только кеши BookTrackerPro (prefix btp-)', () => {
  it('на общем origin: чужой other-app-cache НЕ удаляется, свой устаревший btp-кеш удаляется', async () => {
    const sw = loadSW({
      cacheKeys: [CACHE_NAME, COVER_CACHE_NAME, OCR_CACHE_NAME, 'btp-v3.8.4', 'other-app-cache'],
    });
    await runActivate(sw.activateHandler);

    // чужой кеш другого приложения на этом же origin — НЕ тронут
    expect(sw.deletedKeys).not.toContain('other-app-cache');
    // текущие кеши приложения — НЕ тронуты
    expect(sw.deletedKeys).not.toContain(CACHE_NAME);
    expect(sw.deletedKeys).not.toContain(COVER_CACHE_NAME);
    expect(sw.deletedKeys).not.toContain(OCR_CACHE_NAME);
    // устаревший кеш приложения — удалён
    expect(sw.deletedKeys).toEqual(['btp-v3.8.4']);
    expect(sw.claimCalled).toBe(true);
  });

  it('несколько чужих кешей различных имён — ни один не удаляется', async () => {
    const sw = loadSW({
      cacheKeys: [CACHE_NAME, 'other-app-v2-cache', 'some-storage', 'random-app'],
    });
    await runActivate(sw.activateHandler);
    expect(sw.deletedKeys).toEqual([]);
    expect(sw.claimCalled).toBe(true);
  });

  it('все устаревшие btp-кеши удаляются (v3.8.3, cover-старый), активные и чужие остаются', async () => {
    const sw = loadSW({
      cacheKeys: [
        CACHE_NAME, COVER_CACHE_NAME, OCR_CACHE_NAME,
        'btp-v3.8.3', 'btp-v3.8.4', 'btp-covers-v0', 'foreign-cache',
      ],
    });
    await runActivate(sw.activateHandler);

    expect(sw.deletedKeys).toContain('btp-v3.8.3');
    expect(sw.deletedKeys).toContain('btp-v3.8.4');
    expect(sw.deletedKeys).toContain('btp-covers-v0');
    expect(sw.deletedKeys).not.toContain('foreign-cache');
    expect(sw.deletedKeys).not.toContain(CACHE_NAME);
    expect(sw.deletedKeys).not.toContain(COVER_CACHE_NAME);
    expect(sw.deletedKeys).not.toContain(OCR_CACHE_NAME);
    expect(sw.claimCalled).toBe(true);
  });

  it('только чужие кеши на origin — ничего не удаляется (контракт не сломан)', async () => {
    const sw = loadSW({ cacheKeys: ['other-app-cache', 'foreign-cache'] });
    await runActivate(sw.activateHandler);
    expect(sw.deletedKeys).toEqual([]);
    expect(sw.claimCalled).toBe(true);
  });

  it('среди keys нет ни одного кеша приложения — activate проходит без удалений', async () => {
    const sw = loadSW({ cacheKeys: [] });
    await runActivate(sw.activateHandler);
    expect(sw.deletedKeys).toEqual([]);
    expect(sw.claimCalled).toBe(true);
  });
});