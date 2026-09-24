// ═══════════════════════════════════════════════════════════════════
// Регрессионные тесты P1-9 — «SW активирует неполный shell
// из-за allSettled/catch».
//
// Оригинальная проблема (до фикса):
//   sw.js install:
//     Promise.allSettled(SHELL_ASSETS.map(url =>
//       cache.add(url).catch(err => console.warn(...))))
//     .then(() => self.skipWaiting())
//   — каждый `.catch()` поглощал ошибку, `allSettled` никогда не
//     отклонялся → `skipWaiting()` вызывался БЕЗУСЛОВНО, и новый worker
//     активировался даже если часть критического app shell не
//     закешировалась. После потери сети приложение/отдельные функции
//     не запускаются, а worker уже «обновился».
//
// Что доказывают тесты (РЕАЛЬНАЯ симуляция SW-среды):
//   — sw.js исполняется в vm-контексте с mock self/caches/fetch;
//   — 404/timeout на КАЖДОМ обязательном ресурсе → install ОТКЛОНЯЕТСЯ,
//     `skipWaiting()` НЕ вызывается → новый worker не активируется,
//     предыдущий рабочий SW сохраняет управление;
//   — 404 на опциональном ресурсе (иконка) → install УСПЕШЕН,
//     установка не блокируется (контракт «опциональные не критичны»);
//   — полная успешная установка → install успешен, кеш содержит весь
//     app shell. 🆕 P1-10: при этом `skipWaiting()` НЕ вызывается —
//     активация происходит ТОЛЬКО по сообщению SKIP_WAITING
//     (кнопка «Обновить» в sw-register.js).
// ═══════════════════════════════════════════════════════════════════
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const SW_SOURCE = readFileSync(fileURLToPath(new URL('../sw.js', import.meta.url)), 'utf8');

/** Достаёт BASE и массив SHELL_ASSETS из исходника sw.js и интерполирует их. */
function extractShellAssets() {
  const baseMatch = SW_SOURCE.match(/const\s+BASE\s*=\s*'([^']+)'/);
  const base = baseMatch ? baseMatch[1] : '';
  const m = SW_SOURCE.match(/const\s+SHELL_ASSETS\s*=\s*\[\s*([\s\S]*?)\s*\];/);
  if (!m) throw new Error('SHELL_ASSETS не найден в sw.js');
  const urls = [...m[1].matchAll(/`([^`]+)`|'([^']+)'|"([^"]+)"/g)]
    .map(x => x[1] || x[2] || x[3])
    .map(u => u.replace(/\$\{BASE\}/g, base));
  if (urls.length === 0) throw new Error('SHELL_ASSETS пуст');
  return urls;
}

const SHELL_ASSETS = extractShellAssets();
const CRITICAL_URLS = SHELL_ASSETS.filter(u => !u.endsWith('.png'));
const OPTIONAL_URLS = SHELL_ASSETS.filter(u => u.endsWith('.png'));

/**
 * Создаёт mock CacheStorage + исполняет sw.js в vm-контексте.
 * @param {Set<string>} failUrls — URL, для которых cache.add вернёт 404/timeout
 */
function loadSW({ failUrls = new Set() } = {}) {
  const listeners = {};
  const cacheStore = new Map(); // CACHE_NAME -> Map(url -> true)
  let skipWaitingCalled = false;
  let claimCalled = false;

  const cacheLike = {
    add(url) {
      return new Promise((resolve, reject) => {
        if (failUrls.has(String(url))) {
          // 404/timeout: Response не 2xx / сетевая ошибка
          reject(new TypeError(`Failed to fetch (404/timeout): ${url}`));
          return;
        }
        setTimeout(() => {
          const name = this._name;
          if (!cacheStore.has(name)) cacheStore.set(name, new Map());
          cacheStore.get(name).set(String(url), true);
          resolve();
        }, 0);
      });
    },
    async addAll(urls) {
      // браузерная семантика addAll: при первом сбое отклоняется
      const results = await Promise.allSettled(urls.map(u => this.add(u)));
      const failed = results.find(r => r.status === 'rejected');
      if (failed) throw failed.reason;
    },
    async put() { },
    async match() { return null; },
    async keys() { return []; },
    async delete() { return true; },
  };

  const exportsObj = { caches: cacheStore, skipWaiting: () => skipWaitingCalled };
  const selfMock = {
    location: { origin: 'http://localhost' },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => { skipWaitingCalled = true; },
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
    caches: { open: async (name) => ({ ...cacheLike, _name: name }) },
    fetch: () => Promise.resolve(new Response('', { status: 200 })),
    Response,
    URL,
    console,
    navigator: { onLine: true },
    location: { protocol: 'https:', hostname: 'localhost' },
    document: undefined,
    window: {},
    MessageChannel: class { constructor() { this.port1 = { onmessage: null, postMessage() {} }; this.port2 = { postMessage() {} }; } },
    setTimeout,
    clearTimeout,
    Promise,
    exportsObj,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SW_SOURCE, sandbox, { filename: 'sw.js' });

  if (!listeners.install) throw new Error('install listener не зарегистрирован');

  return {
    installHandler: listeners.install,
    get skipWaitingCalled() { return skipWaitingCalled; },
    get claimCalled() { return claimCalled; },
    cacheStore,
    sandbox,
  };
}

/** Вызывает install handler и возвращает waitUntil-промис. */
function runInstall(installHandler) {
  let promise = null;
  installHandler({ waitUntil: (p) => { promise = p; } });
  return promise;
}

// ═══════════════════════════════════════════════════
describe('P1-9: install не активирует неполный shell', () => {
  it('успешная установка: весь app shell закеширован; P1-10: skipWaiting НЕ вызван автоматически', async () => {
    const sw = loadSW();
    await expect(runInstall(sw.installHandler)).resolves.toBeUndefined();
    // 🆕 P1-10: install больше не активирует worker сам — активация только
    // по сообщению SKIP_WAITING (кнопка «Обновить»). Иначе мгновенный
    // controllerchange → reload теряет ввод в открытой форме.
    expect(sw.skipWaitingCalled).toBe(false);
    const cache = sw.cacheStore.values().next().value;
    expect(cache).toBeDefined();
    for (const url of SHELL_ASSETS) expect(cache.has(url), `не закеширован: ${url}`).toBe(true);
  });

  it.each(CRITICAL_URLS)('404 на обязательный ресурс %s → install ОТКЛОНЁН, skipWaiting НЕ вызван', async (url) => {
    const sw = loadSW({ failUrls: new Set([url]) });
    await expect(runInstall(sw.installHandler)).rejects.toThrow();
    // skipWaiting не вызван → новый worker НЕ активируется,
    // предыдущий рабочий SW продолжает управлять страницей
    expect(sw.skipWaitingCalled).toBe(false);
  });

  it.each(CRITICAL_URLS)('timeout на обязательный ресурс %s → install ОТКЛОНЁН, skipWaiting НЕ вызван', async (url) => {
    const sw = loadSW({ failUrls: new Set([url]) });
    await expect(runInstall(sw.installHandler)).rejects.toThrow();
    expect(sw.skipWaitingCalled).toBe(false);
  });

  it.each(OPTIONAL_URLS)('404 на опциональную иконку %s → install УСПЕШЕН (не блокирует установку)', async (url) => {
    const sw = loadSW({ failUrls: new Set([url]) });
    await expect(runInstall(sw.installHandler)).resolves.toBeUndefined();
    // P1-10: успешный install не активирует worker автоматически
    expect(sw.skipWaitingCalled).toBe(false);
  });

  it('симультанный сбой критического + иконки: критический важнее → install отклонён', async () => {
    const [criticalUrl] = CRITICAL_URLS;
    const [optionalUrl] = OPTIONAL_URLS;
    const sw = loadSW({ failUrls: new Set([criticalUrl, optionalUrl]) });
    await expect(runInstall(sw.installHandler)).rejects.toThrow();
    expect(sw.skipWaitingCalled).toBe(false);
  });

  it('SHELL_ASSETS корректно разделён: есть и критические, и опциональные группы', () => {
    expect(CRITICAL_URLS.length).toBeGreaterThan(0);
    expect(OPTIONAL_URLS.length).toBeGreaterThan(0);
    expect(CRITICAL_URLS.length + OPTIONAL_URLS.length).toBe(SHELL_ASSETS.length);
  });
});