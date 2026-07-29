// ─────────────────────────────────────────────
// 📦 BookTrackerPro — scanner.js
// 🔖 v3.4.2 | 2026-07-30
// 📝 Сканер штрихкодов ISBN
//
//    Стратегия:
//      1. Нативный BarcodeDetector API (Chrome, Edge, Samsung)
//      2. Фолбэк: ZXing-wasm (Firefox, Safari, старые браузеры)
//      3. Ручной ввод ISBN (всегда доступен)
//
//    Форматы: EAN-13, EAN-8, Code 128
//    Валидация: только валидные ISBN-10 / ISBN-13
// ─────────────────────────────────────────────

import { validateISBN, cleanISBN } from './isbn.js';

let _stream = null;
let _scanTimer = null;
let _abortCtrl = null;
let _active = false;
let _zxingModule = null;

// ═══ 1. ГЛАВНАЯ ФУНКЦИЯ ═══

export function startScanner(videoEl, onStatus = () => {}) {
  return new Promise(async (resolve) => {
    cleanup();
    _abortCtrl = new AbortController();
    _active = true;
    const signal = _abortCtrl.signal;

    // 1. Нативный BarcodeDetector
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

    // 2. Фолбэк ZXing-wasm
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

    // 3. Ручной ввод
    onStatus('fallback', '⌨️ Автосканирование недоступно — введите ISBN вручную');
    cleanup(); resolve(null);
  });
}

export function stopScanner() {
  _abortCtrl?.abort();
  cleanup();
}

export function isScannerActive() {
  return _active;
}

// ═══ 2. КАМЕРА ═══

async function startCamera(videoEl) {
  try {
    _stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false
    });
    videoEl.srcObject = _stream;
    videoEl.setAttribute('playsinline', '');
    videoEl.muted = true;
    await videoEl.play();
    return true;
  } catch (e) {
    console.warn('[Scanner] Camera error:', e.message);
    try {
      _stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      videoEl.srcObject = _stream;
      videoEl.muted = true;
      await videoEl.play();
      return true;
    } catch { return false; }
  }
}

// ═══ 3. СКАНИРОВАНИЕ: BarcodeDetector ═══

async function scanLoop_Native(videoEl, formats, signal) {
  const detector = new BarcodeDetector({ formats });

  return new Promise((resolve) => {
    let errors = 0;
    const MAX_ERRORS = 30;

    const scan = async () => {
      if (signal.aborted || !_active) { resolve(null); return; }

      try {
        if (videoEl.readyState < 2) { _scanTimer = setTimeout(scan, 200); return; }

        const codes = await detector.detect(videoEl);
        for (const code of codes) {
          const raw = code.rawValue?.replace(/[\s\-]/g, '');
          if (!raw) continue;
          if ((raw.length === 13 || raw.length === 10) && validateISBN(raw)) {
            if (navigator.vibrate) navigator.vibrate(100);
            resolve(cleanISBN(raw)); return;
          }
          if (raw.length === 13 && (raw.startsWith('978') || raw.startsWith('979')) && validateISBN(raw)) {
            if (navigator.vibrate) navigator.vibrate(100);
            resolve(cleanISBN(raw)); return;
          }
        }
        errors = 0;
      } catch {
        errors++;
        if (errors > MAX_ERRORS) { resolve(null); return; }
      }

      _scanTimer = setTimeout(scan, 250);
    };
    scan();
  });
}

// ═══ 4. СКАНИРОВАНИЕ: ZXing-wasm ═══

async function loadZXing() {
  if (_zxingModule) return _zxingModule;
  try {
    const module = await import(/* webpackIgnore: true */ 'https://unpkg.com/zxing-wasm@1.2.12/dist/reader/zxing_reader.js');
    _zxingModule = module;
    return module;
  } catch (e) {
    console.warn('[Scanner] ZXing load failed:', e.message);
    try {
      const module = await import(/* webpackIgnore: true */ 'https://cdn.jsdelivr.net/npm/zxing-wasm@1.2.12/dist/reader/zxing_reader.js');
      _zxingModule = module;
      return module;
    } catch { return null; }
  }
}

async function scanLoop_ZXing(videoEl, zxing, signal) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  return new Promise((resolve) => {
    let errors = 0;
    const MAX_ERRORS = 30;

    const scan = async () => {
      if (signal.aborted || !_active) { resolve(null); return; }

      try {
        if (videoEl.readyState < 2) { _scanTimer = setTimeout(scan, 200); return; }

        const w = videoEl.videoWidth, h = videoEl.videoHeight;
        if (w === 0 || h === 0) { _scanTimer = setTimeout(scan, 200); return; }

        canvas.width = w; canvas.height = h;
        ctx.drawImage(videoEl, 0, 0, w, h);
        const imageData = ctx.getImageData(0, 0, w, h);

        const results = await zxing.readBarcodesFromImageData(imageData, {
          tryHarder: true,
          formats: ['EAN-13', 'EAN-8', 'Code128'],
        });

        for (const result of (results || [])) {
          const raw = result.text?.replace(/[\s\-]/g, '');
          if (!raw) continue;
          if ((raw.length === 13 || raw.length === 10) && validateISBN(raw)) {
            if (navigator.vibrate) navigator.vibrate(100);
            resolve(cleanISBN(raw)); return;
          }
          if (raw.length === 13 && (raw.startsWith('978') || raw.startsWith('979')) && validateISBN(raw)) {
            if (navigator.vibrate) navigator.vibrate(100);
            resolve(cleanISBN(raw)); return;
          }
        }
        errors = 0;
      } catch {
        errors++;
        if (errors > MAX_ERRORS) { resolve(null); return; }
      }

      _scanTimer = setTimeout(scan, 400);
    };
    scan();
  });
}

// ═══ 5. ОЧИСТКА ═══

function cleanup() {
  _active = false;
  if (_scanTimer) { clearTimeout(_scanTimer); _scanTimer = null; }
  if (_stream) {
    _stream.getTracks().forEach(track => track.stop());
    _stream = null;
  }
}

// ═══ 6. ПРОВЕРКА ПОДДЕРЖКИ ═══

export async function checkScannerSupport() {
  if ('BarcodeDetector' in window) {
    try {
      const formats = await BarcodeDetector.getSupportedFormats();
      if (formats.includes('ean_13')) return { method: 'BarcodeDetector (нативный)', supported: true };
    } catch { /* fallthrough */ }
  }
  try {
    const r = await fetch('https://unpkg.com/zxing-wasm@1.2.12/dist/reader/zxing_reader.js', { method: 'HEAD' });
    if (r.ok) return { method: 'ZXing-wasm (фолбэк)', supported: true };
  } catch { /* offline */ }
  return { method: 'Ручной ввод', supported: false };
}

export async function checkCameraAccess() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some(d => d.kind === 'videoinput');
  } catch { return false; }
}