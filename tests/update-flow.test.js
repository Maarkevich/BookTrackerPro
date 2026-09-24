// ═══════════════════════════════════════════════════════════════════
// Регрессионные тесты P1-10 — «Обновление гоняется двумя моделями:
// install-time skipWaiting vs подтверждение пользователем».
//
// Оригинальная проблема (до фикса):
//   1. sw.js при install СРАЗУ вызывал self.skipWaiting() → новый worker
//      активировался автоматически → мгновенный controllerchange →
//      window.location.reload() в sw-register.js. Пользовательский ввод
//      (открытая форма добавления/редактирования книги) терялся БЕЗ
//      подтверждения, баннер «Обновить» был бессмысленным.
//   2. app.js дополнительно вешал СВОЙ click-handler на #update-apply /
//      #update-dismiss («SKIP_WAITING по всем вкладкам из getRegistration()»),
//      при этом showUpdateBanner() в sw-register.js каждый раз КЛОНИРУЕТ
//      кнопки (cloneNode+replaceChild), уничтожая app.js-listener'ы —
//      две точки истины, поведение недетерминированное.
//
// Что доказывают тесты (РЕАЛЬНАЯ симуляция флоу обновления):
//   — первый install (нет контроллера): баннер НЕ показан, reload НЕ вызван,
//     worker не активируется автоматически (ожидает браузерное решение);
//   — update при открытой форме (контроллер есть): worker в состоянии
//     "installed", баннер показан, НО НЕ происходит postMessage и reload,
//     пока пользователь не нажал «Обновить» — ввод не теряется;
//   — кнопка «Обновить» → ровно один postMessage SKIP_WAITING на worker;
//     после активации — РОВНО ОДИН reload даже при двух controllerchange
//     (guard _reloading, две вкладки);
//   — dismiss: postMessage НЕ отправлен, баннер скрыт;
//   - уже waiting worker при старте → баннер показан;
//   - sw.js: сообщение SKIP_WAITING вызывает skipWaiting, другие сообщения — нет.
// ═══════════════════════════════════════════════════════════════════
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const SW_PATH = fileURLToPath(new URL('../sw.js', import.meta.url));
const SW_REGISTER_PATH = fileURLToPath(new URL('../sw-register.js', import.meta.url));

// ═══════════════════════════════════════════════════
//  ХЕЛПЕРЫ: мок DOM-элементов (баннер, кнопки)
// ═══════════════════════════════════════════════════

function makeBtn(registry = []) {
  const handlers = {};
  const btn = {
    addEventListener: (type, fn) => { handlers[type] = fn; },
    click: () => { if (handlers.click) handlers.click(); },
    // showUpdateBanner клонирует кнопку (cloneNode+replaceChild) и вешает
    // listener на КЛОН — клон регистрируется, чтобы тест кликал по нему
    cloneNode: () => { const c = makeBtn(registry); registry.push(c); return c; },
    parentNode: { replaceChild: () => {} },
    classList: { add: vi.fn(), remove: vi.fn() },
  };
  return btn;
}

function makeBanner() {
  return {
    classList: { add: vi.fn(), remove: vi.fn(), contains: () => false },
    remove: vi.fn(),
    querySelector: () => makeBtn(),
  };
}

// ═══════════════════════════════════════════════════
//  ЗАГРУЗКА sw.js в vm (install + message listener)
// ═══════════════════════════════════════════════════

function loadSW() {
  const listeners = {};
  const cacheStore = new Map();
  let skipWaitingCalled = false;

  const cacheLike = {
    add(url) { return Promise.resolve().then(() => {
      const name = this._name;
      if (!cacheStore.has(name)) cacheStore.set(name, new Map());
      cacheStore.get(name).set(String(url), true);
    }); },
    async addAll(urls) { await Promise.all(urls.map(u => this.add(u))); },
    async put() {}, async match() { return null; }, async keys() { return []; }, async delete() { return true; },
  };

  const selfMock = {
    location: { origin: 'http://localhost' },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => { skipWaitingCalled = true; },
    clients: { claim: () => Promise.resolve(), matchAll: () => Promise.resolve([]), openWindow: () => Promise.resolve(null) },
    registration: { update: () => Promise.resolve(), showNotification: () => Promise.resolve() },
  };

  const sandbox = {
    self: selfMock,
    caches: {
      open: async (name) => ({ ...cacheLike, _name: name }),
      delete: async () => true,
    },
    fetch: () => Promise.resolve(new Response('', { status: 200 })),
    Response, URL,
    console,
    navigator: { onLine: true },
    location: { protocol: 'https:', hostname: 'localhost' },
    document: undefined,
    window: {},
    MessageChannel: class {
      constructor() { this.port1 = { onmessage: null, postMessage() {} }; this.port2 = { postMessage() {} }; }
    },
    setTimeout, clearTimeout,
    Promise,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(SW_PATH, 'utf8'), sandbox, { filename: 'sw.js' });

  return {
    installHandler: listeners.install,
    messageHandler: listeners.message,
    get skipWaitingCalled() { return skipWaitingCalled; },
  };
}

function runInstall(installHandler) {
  let promise = null;
  installHandler({ waitUntil: (p) => { promise = p; } });
  return promise;
}

function runMessage(messageHandler, data) {
  const handler = messageHandler({
    data,
    ports: [],
    waitUntil: () => {},
  });
  return handler;
}

// ═══════════════════════════════════════════════════
//  ЗАГРУЗКА sw-register.js в vm (update flow + баннер)
// ═══════════════════════════════════════════════════

/**
 * Создаёт sandbox для sw-register.js и возвращает состояние окружения
 * (registration, worker, document, события, reload-spy), чтобы тест
 * мог эмулировать updatefound → statechange → клики баннера → activate.
 * @param {object} [opts] — { hasController } определяет, есть ли уже
 *   активный контроллер (обновление) или нет (первая установка).
 */
function loadRegister({ hasController = true } = {}) {
  const env = {
    registration: null,
    reloadCalls: 0,
    controllerChangeHandlers: [],
    updateFoundHandlers: [],
    banner: makeBanner(),
    applyBtns: [],
    dismissBtns: [],
    postedMessages: [],
  };

  const applyBtn = makeBtn(env.applyBtns);
  const dismissBtn = makeBtn(env.dismissBtns);

  const makeWorker = (state = 'installing') => {
    const w = {
      state,
      _listeners: {},
      postMessage: vi.fn((msg) => { env.postedMessages.push(msg); }),
      addEventListener: (type, fn) => { w._listeners[type] = fn; },
      // эмулирует переход в состояние и срабатывает statechange listener
      setState(next) { w.state = next; if (w._listeners.statechange) w._listeners.statechange(); },
    };
    return w;
  };

  const controller = hasController ? makeWorker('activated') : null;

  const registration = {
    scope: '/BookTrackerPro/',
    installing: null,
    waiting: null,
    update: vi.fn(() => Promise.resolve()),
    addEventListener: (type, fn) => { if (type === 'updatefound') env.updateFoundHandlers.push(fn); },
  };

  const documentMock = {
    visibilityState: 'visible',
    addEventListener: vi.fn(),
    getElementById: vi.fn((id) => {
      if (id === 'update-banner') return env.banner;
      if (id === 'update-apply') { env.applyBtns.push(applyBtn); return applyBtn; }
      if (id === 'update-dismiss') { env.dismissBtns.push(dismissBtn); return dismissBtn; }
      return null;
    }),
    createElement: vi.fn(() => ({ className: '', innerHTML: '', style: {}, appendChild: vi.fn(), querySelector: () => makeBtn(), remove: vi.fn() })),
    body: { appendChild: vi.fn() },
    querySelector: () => null,
  };

  const windowMock = {
    addEventListener: vi.fn(),
    location: { reload: vi.fn(() => { env.reloadCalls += 1; }) },
  };

  const navigatorMock = {
    serviceWorker: {
      controller,
      register: vi.fn(() => Promise.resolve(registration)),
      getRegistration: vi.fn(() => Promise.resolve(registration)),
      addEventListener: (type, fn) => { if (type === 'controllerchange') env.controllerChangeHandlers.push(fn); },
    },
    permissions: { query: () => Promise.resolve({ state: 'denied' }) },
  };

  const sandbox = {
    navigator: navigatorMock,
    document: documentMock,
    window: windowMock,
    location: { protocol: 'https:', hostname: 'localhost' },
    MessageChannel,
    console,
    setTimeout: () => 0, // фоновая периодика (verifyCacheFreshness и т.п.) не нужна в тесте
    clearTimeout: () => {},
    fetch: () => Promise.resolve(new Response('', { status: 200 })),
    Promise,
  };
  sandbox.globalThis = sandbox;

  // sw-register.js — ES-модуль с export; для vm убираем ключевое слово export.
  const source = readFileSync(SW_REGISTER_PATH, 'utf8').replace(/\bexport\s+/g, '');

  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'sw-register.js' });

  // экспортируем функцию registerSW из sandbox
  return {
    sandbox,
    env,
    registration,
    makeWorker,
    registerSW: sandbox.registerSW,
    get bannerShown() { return env.banner.classList.remove.mock.calls.length > 0; },
    // полный сценарий: новый worker проходит установку и уходит в "installed"
    async installNewWorker() {
      const worker = this.makeWorker('installing');
      await this.registerSW();
      this.registration.installing = worker;
      for (const fn of this.env.updateFoundHandlers) fn();
      worker.setState('installed');
      return worker;
    },
    emitControllerChange() {
      for (const fn of env.controllerChangeHandlers) fn();
    },
  };
}

// ═══════════════════════════════════════════════════
describe('P1-10: подтверждение перед активацией нового SW', () => {
  it('sw.js: install НЕ вызывает skipWaiting (активация только по подтверждению)', async () => {
    const sw = loadSW();
    await runInstall(sw.installHandler);
    expect(sw.skipWaitingCalled).toBe(false);
  });

  it('sw.js: сообщение SKIP_WAITING вызывает skipWaiting (кнопка «Обновить»)', async () => {
    const sw = loadSW();
    await runInstall(sw.installHandler);
    expect(sw.skipWaitingCalled).toBe(false);
    runMessage(sw.messageHandler, 'SKIP_WAITING');
    expect(sw.skipWaitingCalled).toBe(true);
  });

  it('sw.js: прочие сообщения (GET_CACHE_VERSION, CLEAR_COVER_CACHE) не вызывают skipWaiting', async () => {
    const sw = loadSW();
    await runInstall(sw.installHandler);
    runMessage(sw.messageHandler, 'GET_CACHE_VERSION');
    expect(sw.skipWaitingCalled).toBe(false);
    runMessage(sw.messageHandler, 'CLEAR_COVER_CACHE');
    expect(sw.skipWaitingCalled).toBe(false);
  });

  it('first install (нет контроллера): баннер НЕ показан, worker НЕ активируется сам', async () => {
    const reg = loadRegister({ hasController: false });
    await reg.installNewWorker();
    // контроллера нет → условие showUpdateBanner ложно → баннер не показан
    expect(reg.bannerShown).toBe(false);
    expect(reg.env.reloadCalls).toBe(0);
    expect(reg.env.postedMessages).toEqual(expect.not.arrayContaining(['SKIP_WAITING']));
  });

  it('update при открытой форме: баннер показан, но reload/postMessage НЕ происходит до клика «Обновить»', async () => {
    const reg = loadRegister();
    await reg.installNewWorker();

    // баннер показан (есть контроллер)
    expect(reg.bannerShown).toBe(true);
    // пока пользователь не подтвердил — ничего не отправлено и не перезагружено
    expect(reg.env.postedMessages).toEqual(expect.not.arrayContaining(['SKIP_WAITING']));
    expect(reg.env.reloadCalls).toBe(0);
  });

  it('клик «Обновить» → ровно ОДИН postMessage(SKIP_WAITING) и ОДИН reload после активации', async () => {
    const reg = loadRegister();
    const worker = await reg.installNewWorker();

    // нажали «Обновить» (последний клон кнопки #update-apply)
    const applyBtn = reg.env.applyBtns[reg.env.applyBtns.length - 1];
    expect(applyBtn).toBeDefined();
    applyBtn.click();

    expect(reg.env.postedMessages.filter(m => m === 'SKIP_WAITING')).toEqual(['SKIP_WAITING']);
    expect(worker.postMessage).toHaveBeenCalledWith('SKIP_WAITING');
    expect(reg.env.reloadCalls).toBe(0); // reload только после controllerchange

    // worker активировался → controllerchange
    reg.emitControllerChange();
    expect(reg.env.reloadCalls).toBe(1);
  });

  it('два controllerchange (две вкладки): reload РОВНО ОДИН раз — guard _reloading', async () => {
    const reg = loadRegister();
    await reg.installNewWorker();

    const applyBtn = reg.env.applyBtns[reg.env.applyBtns.length - 1];
    applyBtn.click();
    reg.emitControllerChange();
    reg.emitControllerChange(); // вторая вкладка тоже получила событие
    expect(reg.env.reloadCalls).toBe(1);
  });

  it('dismiss: postMessage НЕ отправлен, баннер скрыт, worker остаётся waiting', async () => {
    const reg = loadRegister();
    await reg.installNewWorker();

    const dismissBtn = reg.env.dismissBtns[reg.env.dismissBtns.length - 1];
    expect(dismissBtn).toBeDefined();
    dismissBtn.click();

    expect(reg.env.postedMessages).toEqual(expect.not.arrayContaining(['SKIP_WAITING']));
    expect(reg.env.reloadCalls).toBe(0);
    expect(reg.env.banner.classList.add).toHaveBeenCalledWith('hidden');
  });

  it('уже waiting worker при старте → баннер показан, postMessage НЕ отправлен до клика', async () => {
    const reg = loadRegister();
    const waiting = reg.makeWorker('installed');
    reg.registration.waiting = waiting;
    await reg.registerSW();
    expect(reg.bannerShown).toBe(true);
    expect(reg.env.postedMessages).toEqual(expect.not.arrayContaining(['SKIP_WAITING']));
    expect(reg.env.reloadCalls).toBe(0);
  });
});
