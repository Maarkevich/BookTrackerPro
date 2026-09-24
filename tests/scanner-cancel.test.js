// @vitest-environment jsdom
// ═══════════════════════════════════════════════════════════════════
// Регрессионные тесты P2-14 — «Scanner cancellation races».
//
// Оригинальная проблема (до фикса):
//   Отмена (stopScanner) не прерывала pending операции: getUserMedia,
//   video.play(), dynamic import() и текущий detect/readBarcodes.
//   Позднее завершение могло:
//     — присвоить глобальный _stream ПОСЛЕ cleanup() → камера снова
//       включена («повторно включившаяся камера»), никто её не стопнет;
//     — зарезолвить старую сессию валидным ISBN из «мёртвого» детекта;
//     — выполнить cleanup() старой сессии, остановив камеру НОВОЙ
//       сессии (race при быстром reopen);
//     — после abort всё равно выполнить повторный getUserMedia (retry)
//       или перейти в fallback-ветку.
//   Причина: сигнал проверялся в основном между итерациями циклов,
//   а состояние сканера (module-level _stream/_abortCtrl/_active) не
//   привязывалось к session token.
//
// Что доказывают тесты (реальная симуляция сбоя, не мок проблемы):
//   — getUserMedia/play()/detect() возвращают deferred-промисы,
//     которые тест разрешает/отклоняет ПОСЛЕ stopScanner() вручную —
//     это честная гонка «отмена → поздний ответ»;
//   — поздний stream немедленно останавливается (все tracks .stop());
//   — быстрый close-open: cleanup старой сессии НЕ трогает камеру новой;
//   — deny/allow после отмены не производят retry getUserMedia;
//   — отмена во время dynamic import не ведёт к fallback-статусу;
//   — контракт не сломан: легитимное успешное сканирование возвращает
//     ISBN и стопает камеру; отказ камеры при активной сессии даёт
//     штатный null+error и retry (два вызова getUserMedia).
// ═══════════════════════════════════════════════════════════════════
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startScanner, stopScanner, isScannerActive } from '../scanner.js';

// ═══════════════════════════════════════
//  ХЕЛПЕРЫ
// ═══════════════════════════════════════

const VALID_ISBN = '9785170987658';

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function makeTrack(label) {
  return { label, stop: vi.fn() };
}

function makeStream(tracks) {
  return { getTracks: () => tracks };
}

function makeVideoEl(playFn) {
  return {
    readyState: 4,
    videoWidth: 640,
    videoHeight: 480,
    muted: false,
    playsInline: false,
    srcObject: null,
    play: playFn || (() => Promise.resolve()),
  };
}

// Динамические моки, пересоздаются в beforeEach
let gumCalls = [];        // deferred getUserMedia по порядку вызовов
let gumMock;
let detectCalls = [];     // deferred detector.detect() по порядку вызовов
let BarcodeDetectorMock;

const tick = () => new Promise((r) => setTimeout(r, 0));

// getUserMedia вызывается асинхронно (после await getSupportedFormats) —
// ждём, пока сделаны N вызовов камеры.
async function waitGum(n) {
  for (let i = 0; i < 50 && gumCalls.length < n; i++) {
    await tick();
  }
  expect(gumCalls.length).toBe(n);
  return gumCalls;
}

function setupCamera() {
  gumCalls = [];
  gumMock = vi.fn(() => {
    const d = deferred();
    gumCalls.push(d);
    return d.promise;
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: gumMock },
    configurable: true,
  });
}

function setupDetector() {
  detectCalls = [];
  BarcodeDetectorMock = class MockBarcodeDetector {
    static supported = ['ean_13', 'ean_8', 'code_128'];
    static getSupportedFormats() {
      return Promise.resolve(MockBarcodeDetector.supported);
    }
    constructor(formats) { this.formats = formats; }
    detect() {
      const d = deferred();
      detectCalls.push(d);
      return d.promise;
    }
  };
  window.BarcodeDetector = BarcodeDetectorMock;
}

// ═══════════════════════════════════════
//  ПОДГОТОВКА
// ═══════════════════════════════════════

beforeEach(() => {
  setupCamera();
  setupDetector();
  stopScanner(); // сброс module-level состояния между тестами
});

afterEach(() => {
  stopScanner(); // не оставляем живых камер/таймеров между тестами
  delete window.BarcodeDetector;
  delete navigator.mediaDevices;
  vi.restoreAllMocks();
});

// ═══════════════════════════════════════
//  ТЕСТЫ
// ═══════════════════════════════════════

describe('P2-14: Scanner cancellation races', () => {
  it('close во время permission prompt: поздний stream немедленно останавливается', async () => {
    const video = makeVideoEl();
    const t1 = makeTrack('t1');
    const t2 = makeTrack('t2');
    const onStatus = vi.fn();

    const p = startScanner(video, onStatus);

    // getUserMedia ещё в полёте (permission prompt)
    await waitGum(1);
    expect(gumMock).toHaveBeenCalledTimes(1);

    stopScanner(); // отмена ДО разрешения промиса камеры

    // Поздний ответ getUserMedia (allow после отмены)
    gumCalls[0].resolve(makeStream([t1, t2]));
    const result = await p;

    expect(result).toBeNull();
    expect(t1.stop).toHaveBeenCalledTimes(1); // поздний stream остановлен
    expect(t2.stop).toHaveBeenCalledTimes(1);
    expect(gumMock).toHaveBeenCalledTimes(1); // НЕ было retry после отмены
    expect(onStatus).not.toHaveBeenCalledWith('error', expect.anything());
    expect(isScannerActive()).toBe(false);
  });

  it('deny после отмены: reject не вызывает retry и не даёт статус error', async () => {
    const video = makeVideoEl();
    const onStatus = vi.fn();

    const p = startScanner(video, onStatus);
    await waitGum(1);
    expect(gumMock).toHaveBeenCalledTimes(1);

    stopScanner();

    // Пользователь отклонил разрешение ПОСЛЕ отмены
    gumCalls[0].reject(new Error('Permission denied'));
    const result = await p;

    expect(result).toBeNull();
    expect(gumMock).toHaveBeenCalledTimes(1); // без retry после abort
    expect(onStatus).not.toHaveBeenCalledWith('error', expect.anything());
  });

  it('close во время video.play(): поздний play не присваивает поток', async () => {
    const playD = deferred();
    const video = makeVideoEl(() => playD.promise);
    const t1 = makeTrack('t1');
    const onStatus = vi.fn();

    const p = startScanner(video, onStatus);

    // Камера разрешена, play() завис
    await waitGum(1);
    gumCalls[0].resolve(makeStream([t1]));
    await tick();
    await tick();

    stopScanner(); // отмена во время play

    // Поздний успешный play
    playD.resolve();
    const result = await p;

    expect(result).toBeNull();
    expect(t1.stop).toHaveBeenCalledTimes(1); // поток не «прижился»
    expect(video.srcObject).toBeNull(); // _stream не присвоен после отмены
  });

  it('close во время detect: поздний валидный ISBN НЕ резолвит старую сессию', async () => {
    const video = makeVideoEl();
    const t1 = makeTrack('t1');
    const onStatus = vi.fn();

    const p = startScanner(video, onStatus);

    // Камера ok → цикл детекта крутится
    await waitGum(1);
    gumCalls[0].resolve(makeStream([t1]));
    await tick();
    await tick();
    expect(detectCalls.length).toBeGreaterThan(0);

    stopScanner(); // отмена во время висящего detect()

    // Поздний detect вернул ВАЛИДНЫЙ ISBN — но сессия уже мертва
    detectCalls[0].resolve([{ rawValue: VALID_ISBN }]);
    const result = await p;

    expect(result).toBeNull(); // НЕ ISBN из мёртвой сессии
    expect(t1.stop).toHaveBeenCalledTimes(1);
  });

  it('быстрый close-open: cleanup старой сессии не останавливает камеру новой', async () => {
    const video = makeVideoEl();
    const oldT = makeTrack('old');
    const newT = makeTrack('new');
    const onStatus = vi.fn();

    // ── Сессия 1: getUserMedia завис ──
    const p1 = startScanner(video, onStatus);
    await waitGum(1);
    expect(gumMock).toHaveBeenCalledTimes(1);

    // ── Быстрый reopen: отмена + новая сессия ──
    stopScanner();
    const p2 = startScanner(video, onStatus);
    await waitGum(2);
    expect(gumMock).toHaveBeenCalledTimes(2);

    // ── Новая сессия получает камеру и работает ──
    gumCalls[1].resolve(makeStream([newT]));
    await tick();
    await tick();
    await tick();
    expect(newT.stop).not.toHaveBeenCalled(); // камера новой жива
    expect(isScannerActive()).toBe(true);

    // ── Поздний ответ СТАРОЙ сессии + её cleanup ──
    gumCalls[0].resolve(makeStream([oldT]));
    const result1 = await p1;
    expect(result1).toBeNull();
    expect(oldT.stop).toHaveBeenCalledTimes(1); // старый поток утилизирован

    // Камера НОВОЙ сессии НЕ должна быть остановлена cleanup старой
    expect(newT.stop).not.toHaveBeenCalled();

    // Останавливаем вторую сессию штатно и дожидаемся её завершения
    stopScanner();
    expect(newT.stop).toHaveBeenCalledTimes(1);
    // Висящий detect() второй сессии отменяется по токену сессии
    detectCalls[detectCalls.length - 1].resolve([]);
    const result2 = await p2;
    expect(result2).toBeNull();
  });

  it('close во время dynamic import (ZXing fallback): нет fallback-статуса и камеры', async () => {
    delete window.BarcodeDetector; // нативный детектор недоступен → путь loadZXing
    const video = makeVideoEl();
    const onStatus = vi.fn();

    const p = startScanner(video, onStatus);
    // Пока import() висит/разрешается — отменяем
    stopScanner();

    const result = await p;
    expect(result).toBeNull();
    expect(gumMock).toHaveBeenCalledTimes(0); // камера вообще не запрашивалась
    expect(onStatus).not.toHaveBeenCalledWith('fallback', expect.anything());
    expect(onStatus).not.toHaveBeenCalledWith('scanning', expect.anything());
  });

  it('контракт не сломан: успешное сканирование возвращает ISBN и стопает камеру', async () => {
    const video = makeVideoEl();
    const t1 = makeTrack('t1');

    const p = startScanner(video);
    await waitGum(1);
    gumCalls[0].resolve(makeStream([t1]));
    await tick();
    await tick();

    detectCalls[0].resolve([{ rawValue: VALID_ISBN }]);
    const result = await p;

    expect(result).toBe(VALID_ISBN);
    expect(t1.stop).toHaveBeenCalledTimes(1); // камера освобождена после успеха
    expect(isScannerActive()).toBe(false);
  });

  it('контракт не сломан: отказ камеры при активной сессии — null + error + retry', async () => {
    const video = makeVideoEl();
    const onStatus = vi.fn();

    const p = startScanner(video, onStatus);

    // Обе попытки getUserMedia (env + any) отклонены, сессия активна
    await waitGum(1);
    gumCalls[0].reject(new Error('NotAllowedError'));
    await tick();
    expect(gumMock).toHaveBeenCalledTimes(2); // штатный retry без facingMode
    gumCalls[1].reject(new Error('NotFoundError'));

    const result = await p;
    expect(result).toBeNull();
    expect(onStatus).toHaveBeenCalledWith('error', expect.stringContaining('камере'));
    expect(isScannerActive()).toBe(false);
  });
});