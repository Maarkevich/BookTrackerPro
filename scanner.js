// 📦 BookTrackerPro — scanner.js
// 🔖 v3.8.3 | 2026-08-14
// 📝 Сканер штрихкодов ISBN
//
//    Стратегия распознавания (по приоритету):
//      1. Нативный BarcodeDetector API
//         (Chrome 83+, Edge, Samsung Internet, Android)
//      2. Фолбэк: ZXing-wasm из CDN
//         (Firefox, Safari, старые браузеры)
//      3. Ручной ввод ISBN (всегда доступен)
//
//    Поддерживаемые форматы: EAN-13, EAN-8, Code 128
//    Валидация: только валидные ISBN-10 / ISBN-13
//
//    Новое в 3.8.3:
//      — Убрана дублирующая проверка ISBN (978/979 префикс
//        уже покрывается validateISBN)
//      — Улучшенная обработка ошибок камеры
//      — JSDoc для публичных функций
//      — Корректная очистка ресурсов при остановке
//
//    Сохранено из 3.7.0:
//      — AbortController для остановки сканирования
//      — Retry камеры без facingMode при неудаче
//      — Вибрация при успешном распознавании
//      — MAX_ERRORS = 30 (~7.5 сек ошибок → выход)
// ─────────────────────────────────────────────
import { validateISBN, cleanISBN } from './isbn.js';

// ═══════════════════════════════════════════════
//  СОСТОЯНИЕ МОДУЛЯ
// ═══════════════════════════════════════════════
let _stream = null;         // MediaStream камеры
let _scanTimer = null;      // setTimeout текущего цикла
let _abortCtrl = null;      // AbortController
let _active = false;        // активен ли сканер
let _zxingModule = null;    // кеш ZXing-wasm модуля

// ═══════════════════════════════════════════════
//  1. ПУБЛИЧНЫЙ API
// ═══════════════════════════════════════════════

/**
 * Запускает сканирование штрихкода.
 * Возвращает Promise<string|null> — найденный ISBN или null.
 *
 * Стратегия:
 *   1. Нативный BarcodeDetector (быстрый, без загрузок)
 *   2. ZXing-wasm из CDN (фолбэк для Safari/Firefox)
 *   3. null → UI показывает ручной ввод
 *
 * @param {HTMLVideoElement} videoEl — видеоэлемент для камеры
 * @param {function} onStatus — колбэк статуса (status, message)
 *   status: 'scanning' | 'loading' | 'fallback' | 'error'
 * @returns {Promise<string|null>}
 */
export function startScanner(videoEl, onStatus = () => {}) {
  return new Promise(async (resolve) => {
    cleanup();
    _abortCtrl = new AbortController();
    _active = true;
    const signal = _abortCtrl.signal;

    // ── 1. Нативный BarcodeDetector ──
    if ('BarcodeDetector' in window) {
      try {
        const formats = await BarcodeDetector.getSupportedFormats();
        const needed = ['ean_13', 'ean_8', 'code_128'];
        const supported = needed.filter(f => formats.includes(f));

        if (supported.length > 0) {
          onStatus('scanning', '📷 Наведите камеру на штрихкод книги...');
          const cameraOk = await startCamera(videoEl);
          if (!cameraOk) {
            onStatus('error', '❌ Нет доступа к камере');
            cleanup(); resolve(null); return;
          }
          const result = await scanLoop_Native(videoEl, supported, signal);
          cleanup(); resolve(result); return;
        }
      } catch (e) {
        console.warn('[Scanner] BarcodeDetector failed:', e.message);
      }
    }

    // ── 2. Фолбэк ZXing-wasm ──
    try {
      onStatus('loading', '⏳ Загружаю библиотеку сканирования...');
      const zxing = await loadZXing();
      if (zxing) {
        onStatus('scanning', '📷 Наведите камеру на штрихкод книги...');
        const cameraOk = await startCamera(videoEl);
        if (!cameraOk) {
          onStatus('error', '❌ Нет доступа к камере');
          cleanup(); resolve(null); return;
        }
        const result = await scanLoop_ZXing(videoEl, zxing, signal);
        cleanup(); resolve(result); return;
      }
    } catch (e) {
      console.warn('[Scanner] ZXing fallback failed:', e.message);
    }

    // ── 3. Ручной ввод ──
    onStatus('fallback', '⌨️ Автосканирование недоступно — введите ISBN вручную');
    cleanup(); resolve(null);
  });
}

/**
 * Останавливает сканирование и освобождает камеру.
 */
export function stopScanner() {
  _abortCtrl?.abort();
  cleanup();
}

/**
 * Активен ли сейчас сканер.
 * @returns {boolean}
 */
export function isScannerActive() {
  return _active;
}

// ═══════════════════════════════════════════════
//  2. КАМЕРА
// ═══════════════════════════════════════════════

/**
 * Запрашивает доступ к камере и запускает видеопоток.
 * Сначала пробует заднюю камеру, затем любую доступную.
 *
 * @param {HTMLVideoElement} videoEl
 * @returns {Promise<boolean>} — true если камера запущена
 */
async function startCamera(videoEl) {
  try {
    _stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
    return await attachStream(videoEl);
  } catch (e) {
    console.warn('[Scanner] Camera error (env):', e.message);
    // Повторная попытка без ограничений facingMode
    // (некоторые камеры не поддерживают ideal)
    try {
      _stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      return await attachStream(videoEl);
    } catch (e2) {
      console.warn('[Scanner] Camera error (any):', e2.message);
      return false;
    }
  }
}

/**
 * Привязывает MediaStream к видеоэлементу.
 * @param {HTMLVideoElement} videoEl
 * @returns {Promise<boolean>}
 */
async function attachStream(videoEl) {
  if (!_stream) return false;
  videoEl.srcObject = _stream;
  videoEl.muted = true;
  videoEl.playsInline = true;
  try {
    await videoEl.play();
    return true;
  } catch (e) {
    console.warn('[Scanner] Video play failed:', e.message);
    return false;
  }
}

// ═══════════════════════════════════════════════
//  3. СКАНИРОВАНИЕ: BarcodeDetector (нативный)
// ═══════════════════════════════════════════════

/**
 * Цикл распознавания через нативный BarcodeDetector.
 * @param {HTMLVideoElement} videoEl
 * @param {string[]} formats — поддерживаемые форматы
 * @param {AbortSignal} signal
 * @returns {Promise<string|null>}
 */
async function scanLoop_Native(videoEl, formats, signal) {
  const detector = new BarcodeDetector({ formats });

  return new Promise((resolve) => {
    let errors = 0;
    const MAX_ERRORS = 30; // ~7.5 секунд непрерывных ошибок → выход

    const scan = async () => {
      if (signal.aborted || !_active) { resolve(null); return; }

      try {
        // Ждём пока видео готово
        if (videoEl.readyState < 2) {
          _scanTimer = setTimeout(scan, 200);
          return;
        }

        const codes = await detector.detect(videoEl);
        for (const code of codes) {
          const raw = code.rawValue?.replace(/[\s\-]/g, '');
          if (!raw) continue;

          // 🆕 v3.8.3: упрощённая проверка — validateISBN
          // уже покрывает ISBN-10, ISBN-13 и префиксы 978/979
          if ((raw.length === 13 || raw.length === 10) && validateISBN(raw)) {
            if (navigator.vibrate) navigator.vibrate(100);
            resolve(cleanISBN(raw));
            return;
          }
        }
        errors = 0; // успешный кадр без результата — сброс счётчика
      } catch (e) {
        errors++;
        if (errors > MAX_ERRORS) { resolve(null); return; }
      }

      _scanTimer = setTimeout(scan, 250);
    };
    scan();
  });
}

// ═══════════════════════════════════════════════
//  4. СКАНИРОВАНИЕ: ZXing-wasm (фолбэк)
// ═══════════════════════════════════════════════

/**
 * Ленивая загрузка ZXing-wasm из CDN (с кешем модуля).
 * Пробует два CDN на случай недоступности одного.
 * @returns {Promise<object|null>}
 */
async function loadZXing() {
  if (_zxingModule) return _zxingModule;

  const CDNS = [
    'https://unpkg.com/zxing-wasm@1.2.12/dist/reader/zxing_reader.js',
    'https://cdn.jsdelivr.net/npm/zxing-wasm@1.2.12/dist/reader/zxing_reader.js',
  ];

  for (const url of CDNS) {
    try {
      const module = await import(/* webpackIgnore: true */ url);
      _zxingModule = module;
      return module;
    } catch (e) {
      console.warn('[Scanner] ZXing load failed from', url, e.message);
    }
  }
  return null;
}

/**
 * Цикл распознавания через ZXing-wasm.
 * Рендерит кадр видео в canvas и передаёт ImageData в ZXing.
 *
 * @param {HTMLVideoElement} videoEl
 * @param {object} zxing — модуль ZXing-wasm
 * @param {AbortSignal} signal
 * @returns {Promise<string|null>}
 */
async function scanLoop_ZXing(videoEl, zxing, signal) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  return new Promise((resolve) => {
    let errors = 0;
    const MAX_ERRORS = 30;

    const scan = async () => {
      if (signal.aborted || !_active) { resolve(null); return; }

      try {
        if (videoEl.readyState < 2) {
          _scanTimer = setTimeout(scan, 200);
          return;
        }

        const w = videoEl.videoWidth;
        const h = videoEl.videoHeight;
        if (w === 0 || h === 0) {
          _scanTimer = setTimeout(scan, 200);
          return;
        }

        // Рендерим кадр в canvas
        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(videoEl, 0, 0, w, h);
        const imageData = ctx.getImageData(0, 0, w, h);

        // Распознаём
        const results = await zxing.readBarcodesFromImageData(imageData, {
          tryHarder: true,
          formats: ['EAN-13', 'EAN-8', 'Code128'],
        });

        for (const result of (results || [])) {
          const raw = result.text?.replace(/[\s\-]/g, '');
          if (!raw) continue;

          // 🆕 v3.8.3: упрощённая проверка
          if ((raw.length === 13 || raw.length === 10) && validateISBN(raw)) {
            if (navigator.vibrate) navigator.vibrate(100);
            resolve(cleanISBN(raw));
            return;
          }
        }
        errors = 0;
      } catch (e) {
        errors++;
        if (errors > MAX_ERRORS) { resolve(null); return; }
      }

      // ZXing медленнее нативного — интервал больше
      _scanTimer = setTimeout(scan, 400);
    };
    scan();
  });
}

// ═══════════════════════════════════════════════
//  5. ОЧИСТКА РЕСУРСОВ
// ═══════════════════════════════════════════════

/**
 * Останавливает камеру, таймеры, сбрасывает состояние.
 */
function cleanup() {
  _active = false;

  if (_scanTimer) {
    clearTimeout(_scanTimer);
    _scanTimer = null;
  }

  if (_stream) {
    _stream.getTracks().forEach(track => track.stop());
    _stream = null;
  }
}