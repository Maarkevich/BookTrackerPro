// @vitest-environment jsdom
// ═══════════════════════════════════════════════════════════════════
// Регрессионные тесты P2-16 — «ZXing full frame main thread».
//
// Оригинальная проблема (до фикса):
//   scanLoop_ZXing() копировал ВЕСЬ кадр камеры (1280×720 и фактически
//   любое разрешение) через drawImage + getImageData и передавал его в
//   readBarcodesFromImageData каждые фиксированные 400 мс. На main thread
//   это — лишние копирования и декодирование внешних углов кадра, где
//   штрихкода нет (он занимает центр при наведении). На слабых
//   Android/iPhone это давало CPU-перегрев, дёрганный UI и расход батареи
//   даже вхолостую.
//
// Что исправлено:
//   — captureScanFrame(): из видео извлекается только центральный ROI
//     (ZXING_ROI = центральные 70% × 60% кадра), который сразу
//     downscale-ится до ≤ ZXING_MAX_SCAN_DIM (640px) в одном drawImage;
//   — nextScanDelay(): интервал сканирования адаптируется к скорости
//     decode (медленный decode → пауза растёт до 900 мс, быстрый →
//     пауза падает до 200 мс), FPS отзывчивости больше не фиксирован.
//
// Что доказывают тесты (реальная симуляция, мок только внешней
// зависимости zxing-модуля):
//   — в decode уходит ROI-кадр (sx,sy,sw,sh < полного кадра) уменьшенного
//     размера (canvas.width ≤ 640), а не полный 1280×720;
//   — маленький 320×240 кадр НЕ увеличивается (нет бессмысленного
//     апскейла);
//   — videoWidth/Height = 0 → null без обращения к canvas (контракт);
//   — nextScanDelay(): пауза растёт на медленных устройствах, падает на
//     быстрых, зажата [ZXING_DELAY_MIN, ZXING_DELAY_MAX], стабильный
//     decode не дёргает интервал (контракт);
//   — интеграция: успешное распознавание ISBN через цикл возвращает
//     чистый ISBN, при этом в readBarcodes уходит ROI-кадр;
//   — интеграция: abort во время pending decode → null, поздний decode
//     не резолвит мёртвую сессию цикла;
//   — интеграция: легитимный [] не резолвит цикл и не ломает его;
//     отмена после этого даёт null.
// ═══════════════════════════════════════════════════════════════════
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureScanFrame,
  nextScanDelay,
  scanLoop_ZXing,
  startScanner,
  stopScanner,
  getScannerSession,
} from '../scanner.js';

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

function makeVideoEl(width = 1280, height = 720) {
  return {
    readyState: 4,
    videoWidth: width,
    videoHeight: height,
    muted: false,
    playsInline: false,
    srcObject: null,
    play: () => Promise.resolve(),
  };
}

let gumCalls = [];        // deferred getUserMedia по порядку вызовов
let gumMock;
let BarcodeDetectorMock;

const tick = () => new Promise((r) => setTimeout(r, 0));

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
  BarcodeDetectorMock = class MockBarcodeDetector {
    static supported = ['ean_13', 'ean_8', 'code_128'];
    static getSupportedFormats() {
      return Promise.resolve(MockBarcodeDetector.supported);
    }
    constructor(formats) { this.formats = formats; }
    detect() { return deferred().promise; } // никогда не резолвим — нам не нужен native-путь
  };
  window.BarcodeDetector = BarcodeDetectorMock;
}

// Мок canvas-контекста: фиксируем drawImage/getImageData вызовы.
let ctxMock;
let drawImageCalls;
let getImageDataCalls;

function setupCtx() {
  drawImageCalls = [];
  getImageDataCalls = [];
  const imageDataCache = new Map();
  ctxMock = {
    drawImage: vi.fn((...args) => {
      drawImageCalls.push(args);
    }),
    getImageData: vi.fn((x, y, w, h) => {
      getImageDataCalls.push([x, y, w, h]);
      const key = `${w}x${h}`;
      if (!imageDataCache.has(key)) {
        imageDataCache.set(key, {
          width: w,
          height: h,
          data: new Uint8ClampedArray(w * h * 4),
        });
      }
      return imageDataCache.get(key);
    }),
  };
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    value: () => ctxMock,
    configurable: true,
    writable: true,
  });
}

// Открывает активную сессию сканера с висящей камерой.
// Возвращает token сессии и промис startScanner для штатного завершения.
async function openActiveScanner(videoEl) {
  const p = startScanner(videoEl, vi.fn());
  await waitGum(1); // сессия инициализирована (getUserMedia вызван)
  return { sessionToken: getScannerSession(), p };
}

// Штатно завершает фоновый startScanner: stopScanner + разрешение gum.
async function finishActiveScanner(p) {
  stopScanner();
  if (gumCalls.length > 0) {
    gumCalls.forEach((g) => g.resolve(makeStream([makeTrack('t')])));
  }
  const res = await p;
  expect(res).toBeNull();
  expect(getScannerSession()).toBeGreaterThan(0);
}

// ═══════════════════════════════════════
//  ПОДГОТОВКА
// ═══════════════════════════════════════

beforeEach(() => {
  setupCamera();
  setupDetector();
  setupCtx();
  stopScanner(); // сброс module-level состояния между тестами
});

afterEach(() => {
  stopScanner();
  gumCalls.forEach((g) => g.resolve(makeStream([makeTrack('t')])));
  delete window.BarcodeDetector;
  delete navigator.mediaDevices;
  vi.restoreAllMocks();
});

// ═══════════════════════════════════════
//  ТЕСТЫ
// ═══════════════════════════════════════

describe('P2-16: captureScanFrame — ROI + downscale', () => {
  it('в decode уходит только центральный ROI, уменьшенный до ≤640px (не полный кадр)', () => {
    const video = makeVideoEl(1280, 720);
    const canvas = { width: 0, height: 0 };
    const img = captureScanFrame(ctxMock, video, canvas);

    // zxing получает уменьшенный кадр, а не 1280×720
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(309);
    expect(img.width).toBe(640);
    expect(img.height).toBe(309);
    expect(getImageDataCalls).toEqual([[0, 0, 640, 309]]);

    // drawImage: источник = центральный ROI (192,144,896,432) < полного кадра,
    // назначение = 640×309 (downscale в том же drawImage, без отдельного прохода)
    expect(drawImageCalls).toEqual([[video, 192, 144, 896, 432, 0, 0, 640, 309]]);
  });

  it('маленький кадр не увеличивается (нет апскейла до 640)', () => {
    const video = makeVideoEl(320, 240);
    const canvas = { width: 0, height: 0 };
    const img = captureScanFrame(ctxMock, video, canvas);

    // ROI = 224×144 → scale = 1 → без увеличения
    expect(canvas.width).toBe(224);
    expect(canvas.height).toBe(144);
    expect(img.width).toBe(224);
    expect(drawImageCalls).toEqual([[video, 48, 48, 224, 144, 0, 0, 224, 144]]);
  });

  it('контракт: videoWidth/Height = 0 → null без обращений к canvas', () => {
    const video = makeVideoEl(0, 0);
    const canvas = { width: 0, height: 0 };
    const img = captureScanFrame(ctxMock, video, canvas);

    expect(img).toBeNull();
    expect(drawImageCalls).toHaveLength(0);
    expect(getImageDataCalls).toHaveLength(0);
  });
});

describe('P2-16: nextScanDelay — адаптивная частота', () => {
  it('медленный decode удваивает паузу (разгружает main thread)', () => {
    // 800 мс decode при текущем 400 мс → decodeMs > delay*0.75 → пауза = min(900, max(400, 1600)) = 900
    expect(nextScanDelay(400, 800)).toBe(900);
  });

  it('быстрый decode сокращает паузу до минимума', () => {
    expect(nextScanDelay(400, 5)).toBe(300);
    expect(nextScanDelay(300, 5)).toBe(200); // floor = ZXING_DELAY_MIN
    expect(nextScanDelay(200, 5)).toBe(200); // не ниже MIN
  });

  it('пауза зажата в [MIN, MAX] даже при экстремальном decode', () => {
    expect(nextScanDelay(400, 100000)).toBe(900);   // cap сверху
    expect(nextScanDelay(200, 100000)).toBe(900);
    expect(nextScanDelay(200, 1)).toBe(200);        // floor снизу
  });

  it('контракт: стабильный decode не дёргает интервал', () => {
    // decodeMs между 25% и 75% текущего интервала → пауза не меняется
    expect(nextScanDelay(400, 150)).toBe(400);
  });
});

describe('P2-16: scanLoop_ZXing — интеграция цикла', () => {
  it('успешное распознавание возвращает чистый ISBN, в decode уходит ROI-кадр', async () => {
    const video = makeVideoEl(1280, 720);
    const zxing = {
      readBarcodesFromImageData: vi.fn(async () => [{ text: '978-5-17-098765-8' }]),
    };
    const ab = new AbortController();

    const { sessionToken, p } = await openActiveScanner(video);
    const result = await scanLoop_ZXing(video, zxing, ab.signal, sessionToken);

    expect(result).toBe(VALID_ISBN);
    // decode получил НЕ полный кадр, а уменьшенный ROI
    expect(zxing.readBarcodesFromImageData).toHaveBeenCalledTimes(1);
    expect(zxing.readBarcodesFromImageData.mock.calls[0][0].width).toBe(640);
    expect(zxing.readBarcodesFromImageData.mock.calls[0][0].height).toBe(309);
    expect(drawImageCalls).toEqual([[video, 192, 144, 896, 432, 0, 0, 640, 309]]);

    const settled = await Promise.race([
      Promise.resolve(false),
      p.then(() => true, () => true),
    ]);
    // фоновый startScanner жил на висящей камере — завершаем штатно
    await finishActiveScanner(p);
    expect(settled).toBe(false); // до finish ничего не упало
  });

  it('abort во время pending decode → null; поздний decode не резолвит мёртвую сессию', async () => {
    const video = makeVideoEl(1280, 720);
    const d = deferred();
    const zxing = {
      readBarcodesFromImageData: vi.fn(() => d.promise),
    };
    const ab = new AbortController();

    const { sessionToken, p } = await openActiveScanner(video);
    const loop = scanLoop_ZXing(video, zxing, ab.signal, sessionToken);

    await tick(); // дождались первого вызова decode
    expect(zxing.readBarcodesFromImageData).toHaveBeenCalledTimes(1);

    ab.abort(); // отмена во время висящего decode

    d.resolve([{ text: VALID_ISBN }]); // поздний «валидный» результат
    const result = await loop;

    expect(result).toBeNull(); // мёртвая сессия не резолвится ISBN
    await finishActiveScanner(p);
  });

  it('контракт: легитимный [] не резолвит цикл; отмена после этого даёт null', async () => {
    const video = makeVideoEl(1280, 720);
    const zxing = {
      readBarcodesFromImageData: vi.fn(async () => []),
    };
    const ab = new AbortController();

    const { sessionToken, p } = await openActiveScanner(video);
    const loop = scanLoop_ZXing(video, zxing, ab.signal, sessionToken);

    await tick();
    await tick();
    expect(zxing.readBarcodesFromImageData).toHaveBeenCalledTimes(1);
    // [] — легитимный результат, цикл продолжает (промис не зарезолвлен)
    let settled = false;
    loop.then(() => { settled = true; });
    await tick();
    expect(settled).toBe(false);

    ab.abort(); // отмена → следующий проход цикла завершается null
    const result = await loop;
    expect(result).toBeNull();
    await finishActiveScanner(p);
  });
});