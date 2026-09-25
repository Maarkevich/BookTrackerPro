// @vitest-environment jsdom
// 🧪 P3-3 — PWA install: синхронная регистрация beforeinstallprompt
// и iOS standalone-инструкция с dismiss persistence.
//
// Что доказывают тесты (реальная симуляция, без мокания логики):
//   — обработчик beforeinstallprompt регистрируется СИНХРОННО при
//     загрузке модуля (а не после await-цепочки init): диспатч события
//     сразу после импорта → preventDefault сработал;
//   — appinstalled: Chromium-установка скрывает баннер и гасит
//     iOS-инструкцию (persists в localStorage);
//   — iosInstallDecision: iOS + не standalone + не dismissed → показать;
//     Android/desktop, standalone или dismissed → не показывать;
//   — iosInstallInfo: реальная детекция по UA (iPhone/iPad/MacIntel),
//     navigator.standalone и localStorage;
//   — dismissIosInstallBanner: persistence — после dismiss инструкция
//     больше не показывается.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const DISMISS_KEY = 'btp_install_ios_dismissed';

/** Возвращает СВЕЖИЙ инстанс app.js: beforeEach делает vi.resetModules(),
 * поэтому каждый загрузчик перевыполняет модуль и синхронную регистрацию
 * слушателей — она видна спаю window.addEventListener. */
function loadApp() {
  return import('../app.js');
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  vi.restoreAllMocks();
  // снимаем переопределения navigator из предыдущих тестов,
  // чтобы UA/platform/standalone вернулись к jsdom-дефолтам
  ['standalone', 'platform', 'maxTouchPoints', 'userAgent'].forEach((k) => {
    try { delete navigator[k]; } catch { /* ignore */ }
  });
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('P3-3: beforeinstallprompt регистрируется синхронно при загрузке модуля', () => {
  it('listener активен СРАЗУ после импорта (до init): диспатч → preventDefault', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const app = await loadApp();

    const promptCalls = addSpy.mock.calls.filter((c) => c[0] === 'beforeinstallprompt');
    const installedCalls = addSpy.mock.calls.filter((c) => c[0] === 'appinstalled');
    expect(promptCalls).toHaveLength(1);
    expect(installedCalls).toHaveLength(1);
    expect(typeof promptCalls[0][1]).toBe('function');

    // событие стреляет сразу после импорта — до вызова init():
    const ev = new Event('beforeinstallprompt', { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(app).toBeTruthy();
  });

  it('appinstalled при установке: гасит Chromium-баннер и iOS-инструкцию (persistence)', async () => {
    await loadApp();

    const ev = new Event('beforeinstallprompt', { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);

    window.dispatchEvent(new Event('appinstalled'));

    // после установки iOS-инструкция больше не предлагается
    expect(localStorage.getItem(DISMISS_KEY)).toBe('1');
  });
});

describe('P3-3: iosInstallDecision — выбрать показ инструкции', () => {
  it('iOS + не standalone + не dismissed → показать', async () => {
    const { iosInstallDecision } = await loadApp();
    expect(iosInstallDecision({ isIOS: true, standalone: false, dismissed: false })).toBe(true);
  });

  it('Android / desktop → не показывать', async () => {
    const { iosInstallDecision } = await loadApp();
    expect(iosInstallDecision({ isIOS: false, standalone: false, dismissed: false })).toBe(false);
    expect(iosInstallDecision({ isIOS: false, standalone: true, dismissed: false })).toBe(false);
    expect(iosInstallDecision({ isIOS: false, standalone: false, dismissed: true })).toBe(false);
  });

  it('уже установленное standalone-приложение → не показывать', async () => {
    const { iosInstallDecision } = await loadApp();
    expect(iosInstallDecision({ isIOS: true, standalone: true, dismissed: false })).toBe(false);
    expect(iosInstallDecision({ isIOS: true, standalone: true, dismissed: true })).toBe(false);
  });

  it('после dismiss (persistence) → не показывать, даже если снова iOS', async () => {
    const { iosInstallDecision } = await loadApp();
    expect(iosInstallDecision({ isIOS: true, standalone: false, dismissed: true })).toBe(false);
  });
});

describe('P3-3: iosInstallInfo / dismiss — реальная детекция', () => {
  it('iPhone UA (не standalone) → show=true', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
      configurable: true,
    });
    const { iosInstallInfo } = await loadApp();
    const info = iosInstallInfo();
    expect(info.isIOS).toBe(true);
    expect(info.standalone).toBe(false);
    expect(info.show).toBe(true);
  });

  it('iPadOS (MacIntel + touch) → isIOS=true', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
      configurable: true,
    });
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true });
    const { iosInstallInfo } = await loadApp();
    expect(iosInstallInfo().isIOS).toBe(true);
  });

  it('уже установленное standalone (navigator.standalone) → show=false', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
      configurable: true,
    });
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    const { iosInstallInfo } = await loadApp();
    expect(iosInstallInfo().show).toBe(false);
  });

  it('dismiss → persistence: повторный iosInstallInfo показывает false', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
      configurable: true,
    });
    const { iosInstallInfo, dismissIosInstallBanner } = await loadApp();

    expect(iosInstallInfo().show).toBe(true);
    dismissIosInstallBanner();
    expect(localStorage.getItem(DISMISS_KEY)).toBe('1');
    expect(iosInstallInfo().show).toBe(false);
    expect(iosInstallInfo().dismissed).toBe(true);
  });
});