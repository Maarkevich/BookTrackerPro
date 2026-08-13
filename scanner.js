// 📦 BookTrackerPro — scanner.js
// 🔖 v3.7.0 | 2026-08-09
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
//    Вибрация при успехе: navigator.vibrate (мобильные)
//
//    Сохранено из 3.5.0 — логика без изменений.
//    Новое в 3.7.0:
//      — Обновлена версия
//      — Улучшена очистка медиапотока при закрытии
//        (фикс «зависшей» камеры на iOS при сворачивании)
//      — Повторная попытка getUserMedia без facingMode
//        (некоторые фронтальные камеры не поддерживают ideal)
// ─────────────────────────────────────────────
import { validateISBN, cleanISBN } from './isbn.js';

let _stream = null;
let _scanTimer = null;
let _abortCtrl = null;
let _active = false;
let _zxingModule = null;

// ═══════════════════════════════════════════════
//  1. ГЛАВНАЯ ФУНКЦИЯ
// ═══════════════════════════════════════════════
/**
* Запускает сканирование штрихкода.
* Возвращает Promise<string|null> — найденный ISBN или null.
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
* Привязывает медиапоток к видеоэлементу и запускает воспроизведение.
* @param {HTMLVideoElement} videoEl
* @returns {Promise<boolean>}
*/
async function attachStream(videoEl) {
try {
videoEl.srcObject = _stream;
// playsinline обязателен для iOS — иначе видео откроется на весь экран
videoEl.setAttribute('playsinline', '');
videoEl.setAttribute('webkit-playsinline', '');
videoEl.muted = true;
await videoEl.play();
return true;
} catch (e) {
console.warn('[Scanner] Play error:', e.message);
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
const MAX_ERRORS = 30; // ~7.5 секунд连续ных ошибок → выход

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
// Проверяем валидность ISBN
if ((raw.length === 13 || raw.length === 10) && validateISBN(raw)) {
if (navigator.vibrate) navigator.vibrate(100);
resolve(cleanISBN(raw));
return;
}
// EAN-13 начинающийся с 978/979 — книжный
if (raw.length === 13 &&
(raw.startsWith('978') || raw.startsWith('979')) &&
validateISBN(raw)) {
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
* Останавливает таймер сканирования и освобождает медиапоток.
* Вызывается при закрытии сканера, ошибке или успешном результате.
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

// ═══════════════════════════════════════════════
//  6. ПРОВЕРКА ПОДДЕРЖКИ (для Настроек)
// ═══════════════════════════════════════════════
/**
* Определяет доступный метод сканирования.
* Используется в Настройках для отображения статуса.
*
* @returns {Promise<{method: string, supported: boolean}>}
*/
export async function checkScannerSupport() {
// 1. Нативный BarcodeDetector
if ('BarcodeDetector' in window) {
try {
const formats = await BarcodeDetector.getSupportedFormats();
if (formats.includes('ean_13')) {
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
if (r.ok) return { method: 'ZXing-wasm (фолбэк)', supported: true };
} catch { /* offline */ }
// 3. Только ручной ввод
return { method: 'Ручной ввод', supported: false };
}

/**
* Проверяет наличие видеоустройств (камер).
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