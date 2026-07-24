// ─────────────────────────────────────────────
// 📦 BookTrackerPro — scanner.js
// 🔖 v3.2.0 | 2026-07-24
// 📝 Сканер штрихкодов ISBN
//
//    Стратегия:
//      1. Нативный BarcodeDetector API (Chrome, Edge, Samsung)
//      2. Фолбэк: ZXing-wasm (Firefox, Safari, старые браузеры)
//      3. Ручной ввод ISBN (всегда доступен)
//
//    Поддерживаемые форматы: EAN-13, EAN-8, Code 128
//    Валидация: только валидные ISBN-10 / ISBN-13
// ─────────────────────────────────────────────

import { validateISBN, cleanISBN } from './isbn.js';

// ═══════════════════════════════════════════════
//  СОСТОЯНИЕ СКАНЕРА
// ═══════════════════════════════════════════════

let _stream = null;         // MediaStream камеры
let _scanTimer = null;      // setTimeout для цикла сканирования
let _abortCtrl = null;      // AbortController для отмены
let _active = false;        // флаг активности сканера
let _zxingModule = null;    // лениво загруженный ZXing модуль

// ═══════════════════════════════════════════════
//  1. ГЛАВНАЯ ФУНКЦИЯ
// ═══════════════════════════════════════════════

/**
 * Запускает сканер штрихкодов.
 * Возвращает Promise, который резолвится найденным ISBN или null.
 *
 * @param {HTMLVideoElement} videoEl — элемент <video> для превью
 * @param {function} onStatus — колбэк (status, message)
 *   status: 'loading' | 'scanning' | 'fallback' | 'error'
 * @returns {Promise<string|null>} — найденный ISBN или null
 */
export function startScanner(videoEl, onStatus = () => {}) {
  return new Promise(async (resolve) => {
    // Сброс предыдущего состояния
    cleanup();
    _abortCtrl = new AbortController();
    _active = true;

    const signal = _abortCtrl.signal;

    // ── Шаг 1: Пробуем нативный BarcodeDetector ──
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
            cleanup();
            resolve(null);
            return;
          }

          const result = await scanLoop_Native(videoEl, supported, signal);
          cleanup();
          resolve(result);
          return;
        }
      } catch (e) {
        console.warn('[Scanner] BarcodeDetector failed:', e.message);
      }
    }

    // ── Шаг 2: Фолбэк на ZXing-wasm ──
    try {
      onStatus('loading', '⏳ Загружаю библиотеку сканирования...');

      const zxing = await loadZXing();
      if (zxing) {
        onStatus('scanning', '📷 Наведите камеру на штрихкод книги...');

        const cameraOk = await startCamera(videoEl);
        if (!cameraOk) {
          onStatus('error', '❌ Нет доступа к камере');
          cleanup();
          resolve(null);
          return;
        }

        const result = await scanLoop_ZXing(videoEl, zxing, signal);
        cleanup();
        resolve(result);
        return;
      }
    } catch (e) {
      console.warn('[Scanner] ZXing fallback failed:', e.message);
    }

    // ── Шаг 3: Ни один метод не сработал ──
    onStatus('fallback', '⌨️ Автосканирование недоступно — введите ISBN вручную');
    cleanup();
    resolve(null);
  });
}

/**
 * Останавливает сканер и освобождает камеру.
 */
export function stopScanner() {
  _abortCtrl?.abort();
  cleanup();
}

/**
 * Проверяет, активен ли сканер.
 * @returns {boolean}
 */
export function isScannerActive() {
  return _active;
}

// ═══════════════════════════════════════════════
//  2. КАМЕРА
// ═══════════════════════════════════════════════

/**
 * Запускает камеру и привязывает к <video>.
 * Предпочитает заднюю камеру (facingMode: environment).
 * @param {HTMLVideoElement} videoEl
 * @returns {Promise<boolean>} — true если камера запущена
 */
async function startCamera(videoEl) {
  try {
    // Пробуем заднюю камеру
    _stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        // Запрещаем виртуальные камеры (OBS и т.п.)
        // для более стабильного сканирования
      },
      audio: false
    });

    videoEl.srcObject = _stream;
    videoEl.setAttribute('playsinline', '');
    videoEl.setAttribute('muted', '');
    videoEl.muted = true;

    await videoEl.play();
    return true;
  } catch (e) {
    console.warn('[Scanner] Camera error:', e.message);

    // Пробуем без ограничений (любая камера)
    try {
      _stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false
      });
      videoEl.srcObject = _stream;
      videoEl.muted = true;
      await videoEl.play();
      return true;
    } catch {
      return false;
    }
  }
}

// ═══════════════════════════════════════════════
//  3. СКАНИРОВАНИЕ: BarcodeDetector (нативный)
// ═══════════════════════════════════════════════

/**
 * Цикл сканирования через нативный BarcodeDetector.
 * Доступен в Chrome 83+, Edge 83+, Samsung Internet.
 * НЕ доступен в Firefox и Safari (на 2026 год).
 *
 * @param {HTMLVideoElement} videoEl
 * @param {string[]} formats — поддерживаемые форматы
 * @param {AbortSignal} signal
 * @returns {Promise<string|null>}
 */
async function scanLoop_Native(videoEl, formats, signal) {
  const detector = new BarcodeDetector({ formats });

  return new Promise((resolve) => {
    let consecutiveErrors = 0;
    const MAX_ERRORS = 30; // ~9 секунд при 300мс интервале

    const scan = async () => {
      if (signal.aborted || !_active) {
        resolve(null);
        return;
      }

      try {
        // Проверяем, что видео готово
        if (videoEl.readyState < 2) {
          _scanTimer = setTimeout(scan, 200);
          return;
        }

        const codes = await detector.detect(videoEl);

        for (const code of codes) {
          const raw = code.rawValue?.replace(/[\s\-]/g, '');
          if (!raw) continue;

          // Проверяем: это ISBN?
          if ((raw.length === 13 || raw.length === 10) && validateISBN(raw)) {
            // Вибрация при успехе (если поддерживается)
            if (navigator.vibrate) navigator.vibrate(100);
            resolve(cleanISBN(raw));
            return;
          }

          // EAN-13 начинающийся с 978/979 = книжный ISBN
          if (raw.length === 13 &&
              (raw.startsWith('978') || raw.startsWith('979')) &&
              validateISBN(raw)) {
            if (navigator.vibrate) navigator.vibrate(100);
            resolve(cleanISBN(raw));
            return;
          }
        }

        consecutiveErrors = 0; // сброс при успешном детекте (даже без ISBN)
      } catch (e) {
        consecutiveErrors++;
        if (consecutiveErrors > MAX_ERRORS) {
          console.warn('[Scanner] Too many detect errors, stopping');
          resolve(null);
          return;
        }
      }

      // Следующий кадр через 250мс (~4 fps, экономит батарею)
      _scanTimer = setTimeout(scan, 250);
    };

    scan();
  });
}

// ═══════════════════════════════════════════════
//  4. СКАНИРОВАНИЕ: ZXing-wasm (фолбэк)
// ═══════════════════════════════════════════════

/**
 * Ленивая загрузка ZXing-wasm.
 * Загружается только если BarcodeDetector недоступен.
 *
 * ZXing-wasm: github.com/Sec-ant/zxing-wasm
 * CDN: unpkg.com/zxing-wasm
 *
 * @returns {Promise<object|null>} — модуль ZXing или null
 */
async function loadZXing() {
  if (_zxingModule) return _zxingModule;

  try {
    // Динамический импорт из CDN
    // zxing-wasm предоставляет ESM-модуль
    const module = await import(
      /* webpackIgnore: true */
      'https://unpkg.com/zxing-wasm@1.2.12/dist/reader/zxing_reader.js'
    );
    _zxingModule = module;
    return module;
  } catch (e) {
    console.warn('[Scanner] ZXing load failed:', e.message);

    // Альтернативный CDN
    try {
      const module = await import(
        /* webpackIgnore: true */
        'https://cdn.jsdelivr.net/npm/zxing-wasm@1.2.12/dist/reader/zxing_reader.js'
      );
      _zxingModule = module;
      return module;
    } catch {
      return null;
    }
  }
}

/**
 * Цикл сканирования через ZXing-wasm.
 * Рисует кадр видео на canvas, передаёт в ZXing.
 *
 * @param {HTMLVideoElement} videoEl
 * @param {object} zxing — модуль ZXing
 * @param {AbortSignal} signal
 * @returns {Promise<string|null>}
 */
async function scanLoop_ZXing(videoEl, zxing, signal) {
  // Создаём offscreen canvas для захвата кадров
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  return new Promise((resolve) => {
    let consecutiveErrors = 0;
    const MAX_ERRORS = 30;

    const scan = async () => {
      if (signal.aborted || !_active) {
        resolve(null);
        return;
      }

      try {
        if (videoEl.readyState < 2) {
          _scanTimer = setTimeout(scan, 200);
          return;
        }

        // Устанавливаем размер canvas = размер видео
        const w = videoEl.videoWidth;
        const h = videoEl.videoHeight;
        if (w === 0 || h === 0) {
          _scanTimer = setTimeout(scan, 200);
          return;
        }

        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(videoEl, 0, 0, w, h);

        // Получаем ImageData
        const imageData = ctx.getImageData(0, 0, w, h);

        // ZXing-wasm: readBarcodesFromImageData
        const results = await zxing.readBarcodesFromImageData(imageData, {
          tryHarder: true,
          formats: ['EAN-13', 'EAN-8', 'Code128'],
        });

        for (const result of (results || [])) {
          const raw = result.text?.replace(/[\s\-]/g, '');
          if (!raw) continue;

          if ((raw.length === 13 || raw.length === 10) && validateISBN(raw)) {
            if (navigator.vibrate) navigator.vibrate(100);
            resolve(cleanISBN(raw));
            return;
          }

          if (raw.length === 13 &&
              (raw.startsWith('978') || raw.startsWith('979')) &&
              validateISBN(raw)) {
            if (navigator.vibrate) navigator.vibrate(100);
            resolve(cleanISBN(raw));
            return;
          }
        }

        consecutiveErrors = 0;
      } catch (e) {
        consecutiveErrors++;
        if (consecutiveErrors > MAX_ERRORS) {
          console.warn('[Scanner] ZXing too many errors, stopping');
          resolve(null);
          return;
        }
      }

      // ZXing тяжелее BarcodeDetector → интервал 400мс
      _scanTimer = setTimeout(scan, 400);
    };

    scan();
  });
}

// ═══════════════════════════════════════════════
//  5. ОЧИСТКА
// ═══════════════════════════════════════════════

/**
 * Останавливает камеру, таймеры, сбрасывает состояние.
 */
function cleanup() {
  _active = false;

  // Останавливаем таймер сканирования
  if (_scanTimer) {
    clearTimeout(_scanTimer);
    _scanTimer = null;
  }

  // Останавливаем камеру
  if (_stream) {
    _stream.getTracks().forEach(track => {
      track.stop();
    });
    _stream = null;
  }
}

// ═══════════════════════════════════════════════
//  6. ПРОВЕРКА ПОДДЕРЖКИ
// ═══════════════════════════════════════════════

/**
 * Проверяет, какой метод сканирования доступен.
 * Полезно для отображения в настройках.
 *
 * @returns {Promise<{method: string, supported: boolean}>}
 */
export async function checkScannerSupport() {
  // 1. BarcodeDetector
  if ('BarcodeDetector' in window) {
    try {
      const formats = await BarcodeDetector.getSupportedFormats();
      const hasEAN = formats.includes('ean_13');
      if (hasEAN) {
        return { method: 'BarcodeDetector (нативный)', supported: true };
      }
    } catch { /* fallthrough */ }
  }

  // 2. ZXing-wasm (проверяем доступность CDN)
  try {
    const r = await fetch(
      'https://unpkg.com/zxing-wasm@1.2.12/dist/reader/zxing_reader.js',
      { method: 'HEAD' }
    );
    if (r.ok) {
      return { method: 'ZXing-wasm (фолбэк)', supported: true };
    }
  } catch { /* offline */ }

  // 3. Только ручной ввод
  return { method: 'Ручной ввод', supported: false };
}

/**
 * Проверяет доступ к камере без запуска сканера.
 * @returns {Promise<boolean>}
 */
export async function checkCameraAccess() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some(d => d.kind === 'videoinput');
  } catch {
    return false;
  }
}