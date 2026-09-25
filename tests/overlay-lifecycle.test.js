// @vitest-environment jsdom
// ═══════════════════════════════════════════════════════════════════
// Регрессионные тесты P2-17 — «overlay/back/focus/safe-area lifecycle
// inconsistent». Реальные юниты utils.js: trackOverlay / untrackOverlay /
// releaseOverlay / closeTopOverlay / closeTopOverlayForBack / hasOverlays /
// consumePoppingState / popTopOverlay + focus trap + scroll refcount.
//
// Оригинальная проблема (до фикса):
//   — оверлеи регистрировались в back-стеке по-разному: часть — руками
//     через document.body.style.overflow = 'hidden' БЕЗ trackOverlay
//     (scanner, review-form, content-form, OCR), часть — через
//     trackOverlay без onClose; итог: Android back закрывал одни оверлеи,
//     но «проскакивал» другие; Escape закрывал только статические ID;
//   — ручной сброс document.body.style.overflow = '' в каждой функции
//     ломал вложенные оверлеи (закрытие нижнего при открытом верхнем
//     разблокировало скролл) — не было refcount;
//   — onClose не вызывался на жесте «назад» (popstate) — динамические
//     оверлеи (content/collections/challenges/OCR/microlink/book-picker/
//     day-popup) не удалялись из DOM, камера/воркеры не освобождались;
//   — попытка звать onClose в popstate приводила к ДВОЙНОЙ навигации:
//     браузер уже сделал back, а onClose звал history.back() повторно.
//
// Что доказывают тесты (РЕАЛЬНАЯ симуляция жестов, а не мок проблемы):
//   — вложенные оверлеи: scroll-lock держится refcount (включая закрытие
//     нижнего слоя при открытом верхнем);
//   — жест «назад» (popstate): верхний оверлей закрывается через onClose,
//     но history.back() НЕ вызывается повторно (closeTopOverlayForBack);
//   — Escape: closeTopOverlay закрывает верхний через onClose;
//   — backdrop: untrackOverlay вызывает history.back() ровно один раз;
//   — focus trap: Tab/Shift+Tab не выходят за пределы верхнего оверлея;
//   — focus restore: фокус возвращается на элемент, который был до открытия;
//   — releaseOverlay (pagehide): снимает слой БЕЗ history.back();
//   — программный popstate от untrackOverlay потребляется consumePoppingState;
//   — контракт не сломан: легитимные null/[] (пустой стек) штатны.
// ═══════════════════════════════════════════════════════════════════
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  trackOverlay,
  untrackOverlay,
  releaseOverlay,
  closeTopOverlay,
  closeTopOverlayForBack,
  hasOverlays,
  consumePoppingState,
  popTopOverlay,
} from '../utils.js';

/**
 * Создаёт оверлей с кнопками и добавляет его в body.
 * Элементы НЕ имеют класса .hidden (динамические оверлеи из реальных
 * модулей), а закрытие симулирует реальный onClose из app.js/etc.
 */
function makeOverlay(id) {
  const el = document.createElement('div');
  el.className = 'overlay';
  el.id = id || `ov-${Math.random().toString(36).slice(2)}`;
  el.innerHTML = `
    <button class="first">Первый</button>
    <input placeholder="поле" />
    <button class="last">Последний</button>
  `;
  document.body.appendChild(el);
  return el;
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 5) {
  for (let i = 0; i < n; i++) await tick();
}

/** Разворачивает «жест назад» ровно как app.js setupBackGesture. */
function simulateAndroidBack() {
  if (consumePoppingState()) return;
  if (hasOverlays()) { closeTopOverlayForBack(); return; }
}

let backSpy = null;

beforeEach(() => {
  document.body.innerHTML = '';
  // jsdom не реализует history.back — ставим spy, чтобы считать вызовы.
  backSpy = vi.spyOn(history, 'back').mockImplementation(() => {});
  // Потребляем возможный «хвост» _poppingState из прошлого теста.
  consumePoppingState();
});

afterEach(() => {
  // Дочищаем незакрытые оверлеи (если тест «забыл» закрыть).
  let guard = 0;
  while (hasOverlays() && guard++ < 10) {
    try { closeTopOverlayForBack(); } catch (e) {}
  }
  document.body.innerHTML = '';
  consumePoppingState();
  backSpy?.mockRestore();
});

// ═══════════════════════════════════════════════════════════════════
//  1. SCROLL-LOCK С REFCOUNT (вложенные оверлеи)
// ═══════════════════════════════════════════════════════════════════

describe('P2-17 overlay lifecycle: scroll-lock refcount', () => {
  it('блокирует скролл при первом оверлее и разблокирует только после закрытия всех', () => {
    const a = makeOverlay('ov-a');
    const b = makeOverlay('ov-b');
    trackOverlay(a);
    expect(document.body.style.overflow).toBe('hidden');
    trackOverlay(b);
    expect(document.body.style.overflow).toBe('hidden');
    // Закрываем НИЖНИЙ при открытом верхнем — скролл остаётся заблокирован
    // (это и было сломано ручными style.overflow = '' в модулях).
    untrackOverlay(a);
    expect(document.body.style.overflow).toBe('hidden');
    expect(hasOverlays()).toBe(true);
    // Закрываем верхний — стек пуст → разблокировка
    untrackOverlay(b);
    expect(document.body.style.overflow).toBe('');
    expect(hasOverlays()).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  2. ЖЕСТ «НАЗАД» (Android back / browser back) — popstate
// ═══════════════════════════════════════════════════════════════════

describe('P2-17 overlay lifecycle: back gesture', () => {
  it('закрывает верхний оверлей через onClose и НЕ вызывает history.back() повторно', () => {
    const el = makeOverlay();
    const onClose = vi.fn(() => { el.remove(); });
    trackOverlay(el, { onClose });
    expect(hasOverlays()).toBe(true);

    simulateAndroidBack();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(hasOverlays()).toBe(false);
    // Браузер уже сделал back — повторная навигация НЕ должна произойти.
    expect(backSpy).not.toHaveBeenCalled();
    // Динамический оверлей удалён из DOM (рюкзак из модулей close())
    expect(document.querySelector('.overlay')).toBeNull();
  });

  it('вложенные оверлеи: каждый back закрывает ровно верхний слой', () => {
    const a = makeOverlay('ov-a');
    const b = makeOverlay('ov-b');
    const onCloseB = vi.fn(() => { b.remove(); });
    const onCloseA = vi.fn(() => { a.remove(); });
    trackOverlay(a, { onClose: onCloseA });
    trackOverlay(b, { onClose: onCloseB });

    simulateAndroidBack();
    expect(onCloseB).toHaveBeenCalledTimes(1);
    expect(onCloseA).not.toHaveBeenCalled();
    expect(document.getElementById('ov-a')).not.toBeNull();
    expect(document.getElementById('ov-b')).toBeNull();
    expect(hasOverlays()).toBe(true);

    simulateAndroidBack();
    expect(onCloseA).toHaveBeenCalledTimes(1);
    expect(hasOverlays()).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  3. ESCAPE — closeTopOverlay
// ═══════════════════════════════════════════════════════════════════

describe('P2-17 overlay lifecycle: Escape (closeTopOverlay)', () => {
  it('закрывает верхний через onClose (Escape-обработчик app.js)', () => {
    const el = makeOverlay();
    const onClose = vi.fn(() => { el.remove(); });
    trackOverlay(el, { onClose });
    closeTopOverlay();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(hasOverlays()).toBe(false);
  });

  it('пустой стек: closeTopOverlay возвращает null без ошибок (контракт)', () => {
    expect(closeTopOverlay()).toBeNull();
    expect(closeTopOverlayForBack()).toBeNull();
    expect(popTopOverlay()).toBeNull();
    expect(hasOverlays()).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  4. BACKDROP — untrackOverlay + history.back ровно один раз
// ═══════════════════════════════════════════════════════════════════

describe('P2-17 overlay lifecycle: backdrop / untrackOverlay', () => {
  it('untrackOverlay (клик по подложке / крестик) зовёт history.back() ровно один раз', () => {
    const el = makeOverlay();
    const onClose = vi.fn();
    trackOverlay(el, { onClose });
    expect(hasOverlays()).toBe(true);

    untrackOverlay(el);

    expect(backSpy).toHaveBeenCalledTimes(1);
    expect(hasOverlays()).toBe(false);
    // Программный back отмечается флагом → popstate в app.js будет пропущен.
    expect(consumePoppingState()).toBe(true);
    expect(consumePoppingState()).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  5. FOCUS TRAP (Tab / Shift+Tab)
// ═══════════════════════════════════════════════════════════════════

describe('P2-17 overlay lifecycle: focus trap', () => {
  function keydown(key, shiftKey = false) {
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key, shiftKey, bubbles: true, cancelable: true,
    }));
  }

  it('Tab извне оверлея фокусит первый элемент, Shift+Tab — последний', () => {
    const el = makeOverlay();
    const first = el.querySelector('.first');
    const last = el.querySelector('.last');
    trackOverlay(el);
    // Фокус вне оверлея (body) → Tab уводит внутрь на первый, Shift+Tab — на последний
    document.activeElement?.blur?.();
    keydown('Tab');
    expect(document.activeElement).toBe(first);
    keydown('Tab', true);
    expect(document.activeElement).toBe(last);
    untrackOverlay(el);
  });

  it('Tab с последнего элемента зацикливается на первый; Shift+Tab с первого — на последний', () => {
    const el = makeOverlay();
    const first = el.querySelector('.first');
    const last = el.querySelector('.last');
    const mid = el.querySelector('input');
    trackOverlay(el);
    last.focus();
    keydown('Tab');
    expect(document.activeElement).toBe(first);
    first.focus();
    keydown('Tab', true);
    expect(document.activeElement).toBe(last);
    // Внутренние Tab: trap не даёт покинуть оверлей (jsdom не реализует
    // нативную навигацию — фокус остаётся ВНУТРИ или на одном из краёв).
    mid.focus();
    keydown('Tab');
    expect(el.contains(document.activeElement)).toBe(true);
    untrackOverlay(el);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  6. FOCUS RESTORE
// ═══════════════════════════════════════════════════════════════════

describe('P2-17 overlay lifecycle: focus restore', () => {
  it('восстанавливает фокус на элемент, который был до открытия оверлея', () => {
    const trigger = document.createElement('button');
    trigger.id = 'trigger';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const el = makeOverlay();
    trackOverlay(el);
    el.querySelector('input').focus();
    expect(document.activeElement).not.toBe(trigger);

    untrackOverlay(el);
    expect(document.activeElement).toBe(trigger);
  });

  it('если prevFocus был body (не фокусируемый), восстановление безопасно пропускается', () => {
    const el = makeOverlay();
    document.activeElement?.blur?.();
    trackOverlay(el);
    untrackOverlay(el);
    // Контракт: ничего не падает, стек пуст
    expect(hasOverlays()).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  7. releaseOverlay (pagehide) — без history.back
// ═══════════════════════════════════════════════════════════════════

describe('P2-17 overlay lifecycle: releaseOverlay (pagehide)', () => {
  it('снимает оверлей из стека (scroll/focus), но НЕ зовёт history.back() — навигацию делает браузер', () => {
    const el = makeOverlay();
    const onClose = vi.fn();
    trackOverlay(el, { onClose });
    expect(hasOverlays()).toBe(true);

    releaseOverlay(el);

    expect(backSpy).not.toHaveBeenCalled();
    expect(hasOverlays()).toBe(false);
    expect(consumePoppingState()).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  8. КОНТРАКТ НЕ СЛОМАН
// ═══════════════════════════════════════════════════════════════════

describe('P2-17 overlay lifecycle: contract not broken', () => {
  it('untrackOverlay/releaseOverlay по отсутствующему элементу — no-op без ошибок', () => {
    const el = makeOverlay();
    expect(() => untrackOverlay(el)).not.toThrow();
    expect(() => releaseOverlay(el)).not.toThrow();
    expect(() => popTopOverlay()).not.toThrow();
    expect(hasOverlays()).toBe(false);
  });

  it('деferred-и общего lifecycle async-safe: закрытие до отложенного onClose не ломает стек', async () => {
    const el = makeOverlay();
    const d = deferred();
    const onClose = vi.fn(() => d.resolve());
    trackOverlay(el, { onClose });
    // «Жест назад» — закроем верхний; onClose асинхронный
    closeTopOverlay();
    expect(hasOverlays()).toBe(false);
    d.resolve();
    await flush();
    // Стек пуст, новое открытие работает штатно
    const el2 = makeOverlay();
    trackOverlay(el2);
    expect(hasOverlays()).toBe(true);
    untrackOverlay(el2);
    expect(hasOverlays()).toBe(false);
  });
});