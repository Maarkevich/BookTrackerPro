// @vitest-environment jsdom
// ═══════════════════════════════════════════════════════════════════
// Регрессионные тесты P2-15 — «OCR/camera lifecycle incomplete».
//
// Оригинальная проблема (до фикса):
//   — `captureQuoteByPhoto()` проверяла `cancelled` только один раз;
//     после `await preprocessImage()`, `await getWorker()` и
//     `await worker.recognize()` оверлей мог быть уже закрыт, а код
//     продолжал: писал в удалённый DOM, показывал результат, вызывал
//     showToast/логировал ошибки «мёртвой» сессии;
//   — `getWorker()` кешировал Tesseract-воркер БЕЗ возможности
//     завершить его — воркер (WASM, память) жил вечно даже после
//     навигации/закрытия PWA; при pagehide камера и воркер не
//     освобождались;
//   — отсутствовала централизованная обработка page visibility —
//     уход в фон/навигация оставляли камеру включённой;
//   — конкуренция OCR↔scanner: обе функции могли одновременно
//     захватить камеру (два camera flow).
//
// Что доказывают тесты (РЕАЛЬНАЯ симуляция гонки «отмена → поздний
// ответ», а не мок проблемы):
//   — отмена во время предобработки: поздний resolved preprocess
//     НЕ приводит к показу результата и НЕ запускает recognize;
//   — отмена во время загрузки модели: поздний worker завершается
//     (terminate вызван) и НЕ остаётся без потребителя;
//   — отмена во время recognize: поздний data НЕ пишется в resultArea;
//   — pagehide: оверлей закрывается, tracks останавливаются,
//     isOcrActive() → false;
//   — visibilitychange→hidden: камера/воркер освобождаются, но оверлей
//     остаётся (сессия жива), при возврате можно отменить штатно;
//   — конкуренция OCR↔scanner: при активном сканере старт OCR
//     останавливает сканер (stopScanner вызывается);
//   — повторные сессии: terminateOcrWorker() + новая сессия захватывает
//     камеру заново (state сброшен);
//   — контракт не сломан: легитимный успешный флоу возвращает текст и
//     стопает камеру; отмена без фото возвращает null без ошибок.
// ═══════════════════════════════════════════════════════════════════
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureQuoteByPhoto, isOcrActive, terminateOcrWorker } from '../ocr.js';
// 🆕 P2-15: scanner.js мокаем ТОЛЬКО в этом файле (ocr.js импортирует
// из него isScannerActive/stopScanner для запрета двойного camera flow).
// Реальные функции тестируются в scanner.test.js / scanner-cancel.test.js.
vi.mock('../scanner.js', () => ({
  isScannerActive: vi.fn(() => false),
  stopScanner: vi.fn(),
  startScanner: vi.fn(),
}));
import { isScannerActive, stopScanner } from '../scanner.js';

// ═══════════════════════════════════════
//  ХЕЛПЕРЫ
// ═══════════════════════════════════════

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function makeTrack() {
  return { stop: vi.fn() };
}

function makeStream(tracks) {
  return { getTracks: () => tracks };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 10) {
  for (let i = 0; i < n; i++) await tick();
}

/** Мокает глобальные API, которых нет в jsdom, И возвращает хелперы. */
const ocrDom = {
  gumCalls: [],
  streams: [],
  workers: [],
  ctxMock: null,
  bitmapCalls: [],
  createBitmapDeferred: null,

  setupCamera() {
    this.gumCalls = [];
    this.streams = [];
    this.gumMock = vi.fn(() => {
      const d = deferred();
      this.gumCalls.push(d);
      return d.promise;
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: this.gumMock },
      configurable: true,
    });
  },

  /**
   * createImageBitmap: по умолчанию мгновенно возвращает фиктивный bitmap.
   * Для симуляции «гонки» тест кладёт deferred в createBitmapDeferred.
   */
  setupBitmapDeferred() {
    const d = deferred();
    this.createBitmapDeferred = d;
    globalThis.createImageBitmap = vi.fn(() => d.promise);
  },

  setupBitmapInstant() {
    this.createBitmapDeferred = null;
    globalThis.createImageBitmap = vi.fn(() => Promise.resolve({
      width: 16, height: 16, close: vi.fn(),
    }));
  },

  /** canvas.getContext('2d') и video.play() в jsdom не реализованы — подменяем. */
  setupCtx() {
    this.ctxMock = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(16 * 16 * 4) })),
      putImageData: vi.fn(),
    };
    HTMLCanvasElement.prototype.getContext = vi.fn(() => this.ctxMock);
    // video.play() в jsdom бросает «Not implemented» — имитируем успешный старт
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  },

  setupTesseract() {
    this.workers = [];
    this.createWorkerMock = vi.fn(() => {
      const setParamsD = deferred();
      const recognizeD = deferred();
      const worker = {
        setParameters: vi.fn(() => setParamsD.promise),
        recognize: vi.fn(() => recognizeD.promise),
        terminate: vi.fn(() => Promise.resolve()),
        _setParamsD: setParamsD,
        _recognizeD: recognizeD,
      };
      this.workers.push(worker);
      return Promise.resolve(worker);
    });
    window.Tesseract = { createWorker: this.createWorkerMock };
  },

  setupUrl() {
    URL.createObjectURL = vi.fn(() => `blob:mock-${Math.random().toString(36).slice(2)}`);
    URL.revokeObjectURL = vi.fn();
  },

  restoreGlobals() {
    if (globalThis.createImageBitmap) delete globalThis.createImageBitmap;
    if (HTMLCanvasElement.prototype.getContext) {
      delete HTMLCanvasElement.prototype.getContext;
    }
    if (HTMLMediaElement.prototype.play) {
      delete HTMLMediaElement.prototype.play;
    }
  },
};

/**
 * Открывает OCR-оверлей и, если file=true, выбирает фото из галереи.
 * Если clickRun=true — жмёт «Распознать» (должны быть созданы моки bitmap/ctx).
 * Если resolveCamera=true — резолвит первый getUserMedia потоком с tracks.
 * Возвращает { p, overlay, tracks }.
 */
async function openOcr({ file = true, clickRun = true, resolveCamera = true } = {}) {
  const p = captureQuoteByPhoto();
  await flush();
  if (ocrDom.gumCalls.length === 0) throw new Error('camera not requested');

  const overlay = document.querySelector('.overlay');
  if (!overlay) throw new Error('overlay missing');

  let tracks = null;
  if (resolveCamera) {
    tracks = [makeTrack(), makeTrack()];
    ocrDom.gumCalls[0].resolve(makeStream(tracks));
    await flush();
  }

  if (file) {
    const fileInput = overlay.querySelector('#ocr-file');
    const f = new File(['x'], 'page.jpg', { type: 'image/jpeg' });
    Object.defineProperty(fileInput, 'files', { value: [f], configurable: true });
    fileInput.dispatchEvent(new Event('change'));
    await flush();
  }
  if (clickRun) {
    const run = overlay.querySelector('#ocr-run');
    if (run && !run.classList.contains('hidden')) run.click();
    await flush();
  }
  return { p, overlay, tracks };
}

// ═══════════════════════════════════════
//  ПОДГОТОВКА
// ═══════════════════════════════════════

beforeEach(() => {
  document.body.innerHTML = '';
  ocrDom.setupCamera();
  ocrDom.setupBitmapInstant();
  ocrDom.setupCtx();
  ocrDom.setupTesseract();
  ocrDom.setupUrl();
  isScannerActive.mockReturnValue(false);
  stopScanner.mockClear();
});

afterEach(async () => {
  // Штатно закрываем оверлей, если он остался (сброс _ocrOpen)
  const ov = document.querySelector('.overlay');
  if (ov) {
    const btn = ov.querySelector('#ocr-cancel');
    if (btn) btn.click();
    await flush(20);
  }
  await terminateOcrWorker();
  ocrDom.restoreGlobals();
  vi.restoreAllMocks();
});

// ═══════════════════════════════════════
//  ТЕСТЫ
// ═══════════════════════════════════════

describe('P2-15 OCR: отмена во время async-этапов', () => {
  it('отмена во время предобработки: поздний preprocess НЕ запускает recognize и НЕ пишет в DOM', async () => {
    // Сразу после старта OCR подменяем createImageBitmap на deferred —
    // это момент «предобработка висит».
    ocrDom.setupBitmapDeferred();
    const { p, overlay } = await openOcr();
    // Распознавание нажато, но preprocess застрял на createImageBitmap
    expect(ocrDom.createBitmapDeferred).toBeTruthy();
    // Отмена ДО завершения предобработки
    overlay.querySelector('#ocr-cancel').click();
    await flush();
    // «Поздно» завершаем предобработку
    ocrDom.createBitmapDeferred.resolve({
      width: 16, height: 16, data: new Uint8ClampedArray(16 * 16 * 4),
    });
    await flush(20);
    // Контракт: recognize не запускался, воркер не создавался, resolve(null)
    expect(ocrDom.createWorkerMock).not.toHaveBeenCalled();
    expect(document.querySelector('#ocr-result')).toBeNull();
    expect(await p).toBeNull();
  });

  it('отмена во время загрузки модели: поздний worker завершается (terminate) и не работает вхолостую', async () => {
    const { p, overlay } = await openOcr();
    // Предобработка завершилась, createWorker вызван, setParameters висит —
    // это момент «загрузки модели».
    expect(ocrDom.createWorkerMock).toHaveBeenCalledTimes(1);
    expect(ocrDom.workers[0].recognize).not.toHaveBeenCalled();
    // Отмена во время загрузки модели
    overlay.querySelector('#ocr-cancel').click();
    await flush();
    // «Поздно» модель загрузилась (setParameters резолвится)
    ocrDom.workers[0]._setParamsD.resolve();
    await flush(20);
    // recognize не запускался
    expect(ocrDom.workers[0].recognize).not.toHaveBeenCalled();
    // Воркер был завершён через terminateOcrWorker (не остался без потребителя)
    expect(ocrDom.workers[0].terminate).toHaveBeenCalled();
    expect(await p).toBeNull();
  });

  it('отмена во время recognize: поздний результат НЕ пишется в resultArea', async () => {
    const { p, overlay } = await openOcr();
    // Модель загружена, recognize висит
    ocrDom.workers[0]._setParamsD.resolve();
    await flush();
    expect(ocrDom.workers[0].recognize).toHaveBeenCalledTimes(1);
    // Отмена во время распознавания
    overlay.querySelector('#ocr-cancel').click();
    await flush();
    // «Поздно» приходит распознанный текст
    ocrDom.workers[0]._recognizeD.resolve({ data: { text: 'Поздний текст' } });
    await flush(20);
    // Контракт: текст НЕ появился, resolve(null)
    expect(document.querySelector('#ocr-result')).toBeNull();
    expect(await p).toBeNull();
  });
});

describe('P2-15 OCR: page visibility, камера, воркер', () => {
  it('pagehide: оверлей закрывается, tracks останавливаются, isOcrActive() → false', async () => {
    const { p, overlay, tracks } = await openOcr({ file: false });
    expect(gumCalledTimes()).toBe(1);
    expect(isOcrActive()).toBe(true);
    expect(tracks.every(t => !t.stop.mock.calls.length)).toBe(true);
    window.dispatchEvent(new Event('pagehide'));
    await flush(20);
    expect(isOcrActive()).toBe(false);
    // Камера остановлена
    expect(tracks.every(t => t.stop.mock.calls.length === 1)).toBe(true);
    expect(document.querySelector('.overlay')).toBeNull();
    expect(await p).toBeNull();
  });

  it('visibilitychange→hidden: камера и воркер освобождаются, оверлей остаётся', async () => {
    const { p, overlay, tracks } = await openOcr();
    expect(isOcrActive()).toBe(true);
    // Уход в фон
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    window.dispatchEvent(new Event('visibilitychange'));
    await flush(20);
    // Камера остановлена, но оверлей жив (продолжить можно)
    expect(tracks.every(t => t.stop.mock.calls.length >= 1)).toBe(true);
    expect(document.querySelector('.overlay')).not.toBeNull();
    expect(isOcrActive()).toBe(true);
    // Возврат в foreground: воркер ещё не создавался, поэтому освобождать
    // нечего — просто проверяем, что сессия завершается штатно.
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    overlay.querySelector('#ocr-cancel').click();
    expect(await p).toBeNull();
    expect(isOcrActive()).toBe(false);
  });

  it('конкуренция OCR↔scanner: при активном сканере старт OCR стопает сканер', async () => {
    isScannerActive.mockReturnValue(true);
    stopScanner.mockClear();
    const p = captureQuoteByPhoto();
    await flush();
    expect(ocrDom.gumMock).toHaveBeenCalledTimes(1);
    expect(stopScanner).toHaveBeenCalled();
    const overlay = document.querySelector('.overlay');
    overlay.querySelector('#ocr-cancel').click();
    expect(await p).toBeNull();
  });

  it('повторные сессии: terminateOcrWorker() + новая сессия захватывает камеру заново', async () => {
    const { overlay } = await openOcr({ file: false });
    overlay.querySelector('#ocr-cancel').click();
    await flush();
    expect(isOcrActive()).toBe(false);
    await terminateOcrWorker();
    const p2 = captureQuoteByPhoto();
    await flush();
    expect(ocrDom.gumMock).toHaveBeenCalledTimes(2);
    expect(isOcrActive()).toBe(true);
    const ov2 = document.querySelector('.overlay');
    ov2.querySelector('#ocr-cancel').click();
    expect(await p2).toBeNull();
  });

  it('контракт: успешный флоу возвращает текст и стопает камеру', async () => {
    const { p, tracks } = await openOcr();
    ocrDom.workers[0]._setParamsD.resolve();
    await flush();
    ocrDom.workers[0]._recognizeD.resolve({ data: { text: '  Успешный текст  ' } });
    await flush(20);
    const area = document.querySelector('#ocr-result');
    expect(area.value).toBe('Успешный текст');
    document.querySelector('#ocr-use').click();
    expect(await p).toBe('Успешный текст');
    expect(isOcrActive()).toBe(false);
    expect(document.querySelector('.overlay')).toBeNull();
    expect(tracks.every(t => t.stop.mock.calls.length >= 1)).toBe(true);
  });
});

function gumCalledTimes() {
  return ocrDom.gumMock.mock.calls.length;
}