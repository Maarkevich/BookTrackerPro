// 📦 BookTrackerPro — scanner.js
// 🔖 v3.8.3 | 2026-08-14
// 📝 Сканер штрихкодов ISBN
//
//    Стратегия распознавания (по приоритету):
//      1. Нативный BarcodeDetector API
//         (Chrome 83+, Edge, Samsung Internet, Android)
//      2. Фолбэк: ZXing-wasm (локальный, под /BookTrackerPro/zxing/)
//         (Firefox, Safari, старые браузеры)
//      3. Ручной ввод ISBN (всегда доступен)
//
//    Поддерживаемые форматы: EAN-13, EAN-8, Code 128
//    Валидация: только валидные ISBN-10 / ISBN-13
//
//    🆕 P1-14: ZXing-wasm больше НЕ грузится с CDN (unpkg/jsDelivr).
//    Причины: 1) CSP script-src 'self' блокирует динамический import()
//    remote ES module (CDN были только в connect-src); 2) файла
//    dist/reader/zxing_reader.js в пакете вообще нет — это ES-сборка
//    dist/es/reader/index.js (+ core + wasm); 3) CDN не давал
//    гарантии offline. Теперь фиксированная версия 1.2.12 лежит
//    локально и precache-ируется sw.js.
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

// 🆕 P1-14: базовый путь приложения (совместим с GitHub Pages).
const BASE = '/BookTrackerPro';

// Локальная точка входа ZXing-wasm (фиксированная версия 1.2.12).
// Расположение соответствует структуре npm-пакета:
//   zxing/dist/es/reader/index.js       — ES module (обёртка)
//   zxing/dist/es/core-DnsuMG85.js      — ES module (ядро, chained import)
//   zxing/dist/reader/zxing_reader.wasm — WASM-бинарник
const ZXING_ENTRY = `${BASE}/zxing/dist/es/reader/index.js`;

// 🆕 P2-16: зона интереса (ROI) — центральная область кадра, где обычно
// находится штрихкод при наведении. Доли от размеров видео.
// Внешние углы почти никогда не содержат искомый код, а их пиксели
// только зря копируются в canvas и декодируются.
const ZXING_ROI = { x: 0.15, y: 0.2, w: 0.7, h: 0.6 };

// 🆕 P2-16: максимальная сторона изображения, передаваемого в ZXing.
// EAN-13 = 95 модулей; при 640 px ширины это ~6.7 px на модуль —
// более чем достаточно для надёжного распознавания (ZXing.tryHarder).
// Кадр 1280×720 → 640×~308: в ~4.7 раза меньше пикселей на отрисовку,
// getImageData и decode — главный выигрыш по CPU/батарее.
const ZXING_MAX_SCAN_DIM = 640;

// 🆕 P2-16: адаптивная частота сканирования. Базовый интервал 400 мс.
// Если decode занимает заметную часть интервала — пауза растёт до
// ZXING_DELAY_MAX (медленное устройство не грузит CPU вхолостую);
// если decode мгновенный — пауза сокращается до ZXING_DELAY_MIN.
const ZXING_DELAY_BASE = 400;
const ZXING_DELAY_MIN = 200;
const ZXING_DELAY_MAX = 900;

// ═══════════════════════════════════════════════
//  СОСТОЯНИЕ МОДУЛЯ
// ═══════════════════════════════════════════════
let _stream = null;         // MediaStream камеры
let _scanTimer = null;      // setTimeout текущего цикла
let _abortCtrl = null;      // AbortController
let _active = false;        // активен ли сканер
let _zxingModule = null;    // кеш ZXing-wasm модуля
let _session = 0;           // 🆕 P2-14: монотонно растущий token сессии

// 🆕 P2-14: останавливает все tracks потока (не трогая глобальный _stream).
function stopStream(stream) {
  if (stream) stream.getTracks().forEach(t => t.stop());
}

/**
 * 🆕 P2-14: актуальна ли сессия. После КАЖДОГО await следует проверять
 * session === _session && _active && !signal.aborted — иначе позднее
 * завершение (getUserMedia/play/import/detect) продолжит старую сессию
 * или затрёт камеру новой.
 */
function isCurrentSession(session, signal) {
  return session === _session && _active && !(signal && signal.aborted);
}

// ═══════════════════════════════════════════════
//  1. ПУБЛИЧНЫЙ API
// ═══════════════════════════════════════════════

/**
 * Запускает сканирование штрихкода.
 * Возвращает Promise<string|null> — найденный ISBN или null.
 *
 * Стратегия:
 *   1. Нативный BarcodeDetector (быстрый, без загрузок)
 *   2. ZXing-wasm локальный (фолбэк для Safari/Firefox)
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
    const session = ++_session; // 🆕 P2-14: token этой сессии
    _abortCtrl = new AbortController();
    _active = true;
    const signal = _abortCtrl.signal;

    // 🆕 P2-14: единая точка выхода — cleanup выполняется только
    // если сессия всё ещё актуальна (не затрёт камеру новой сессии).
    const done = (value) => {
      if (session === _session) cleanup();
      resolve(value);
    };

    // ── 1. Нативный BarcodeDetector ──
    if ('BarcodeDetector' in window) {
      try {
        const formats = await BarcodeDetector.getSupportedFormats();
        if (!isCurrentSession(session, signal)) { done(null); return; }
        const needed = ['ean_13', 'ean_8', 'code_128'];
        const supported = needed.filter(f => formats.includes(f));

        if (supported.length > 0) {
          onStatus('scanning', '📷 Наведите камеру на штрихкод книги...');
          const cameraOk = await startCamera(videoEl, session, signal);
          if (!isCurrentSession(session, signal)) { done(null); return; }
          if (!cameraOk) {
            onStatus('error', '❌ Нет доступа к камере');
            done(null); return;
          }
          const result = await scanLoop_Native(videoEl, supported, signal, session);
          done(result); return;
        }
      } catch (e) {
        console.warn('[Scanner] BarcodeDetector failed:', e.message);
        if (!isCurrentSession(session, signal)) { done(null); return; } // 🆕 P2-14
      }
    }

    // ── 2. Фолбэк ZXing-wasm ──
    try {
      onStatus('loading', '⏳ Загружаю библиотеку сканирования...');
      const zxing = await loadZXing();
      if (!isCurrentSession(session, signal)) { done(null); return; }
      if (zxing) {
        onStatus('scanning', '📷 Наведите камеру на штрихкод книги...');
        const cameraOk = await startCamera(videoEl, session, signal);
        if (!isCurrentSession(session, signal)) { done(null); return; }
        if (!cameraOk) {
          onStatus('error', '❌ Нет доступа к камере');
          done(null); return;
        }
        const result = await scanLoop_ZXing(videoEl, zxing, signal, session);
        done(result); return;
      }
    } catch (e) {
      console.warn('[Scanner] ZXing fallback failed:', e.message);
      if (!isCurrentSession(session, signal)) { done(null); return; } // 🆕 P2-14
    }

    // ── 3. Ручной ввод ──
    onStatus('fallback', '⌨️ Автосканирование недоступно — введите ISBN вручную');
    done(null);
  });
}

/**
 * Останавливает сканирование и освобождает камеру.
 */
export function stopScanner() {
  _abortCtrl?.abort();
  _session++; // 🆕 P2-14: инвалидируем сессию ДО cleanup, чтобы pending
              // getUserMedia/play/import старой сессии не смогли продолжить.
  cleanup();
}

/**
 * Активен ли сейчас сканер.
 * @returns {boolean}
 */
export function isScannerActive() {
  return _active;
}

/**
 * Текущий token сессии (для юнит-тестов P2-16 и диагностики).
 * Сессия создаётся вызовом startScanner() и инвалидируется
 * stopScanner() / повторным startScanner().
 * @returns {number}
 */
export function getScannerSession() {
  return _session;
}

// ═══════════════════════════════════════════════
//  2. КАМЕРА
// ═══════════════════════════════════════════════

/**
 * Запрашивает доступ к камере и запускает видеопоток.
 * Сначала пробует заднюю камеру, затем любую доступную.
 *
 * 🆕 P2-14: получает локальный stream из getUserMedia, проверяет
 * актуальность сессии ПОСЛЕ await и немедленно останавливает поздний
 * stream (никогда не присваивает его глобальному _stream, если сессия
 * уже отменена/перезапущена).
 *
 * @param {HTMLVideoElement} videoEl
 * @param {number} session — token сессии
 * @param {AbortSignal} signal
 * @returns {Promise<boolean>} — true если камера запущена
 */
async function startCamera(videoEl, session, signal) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
    if (!isCurrentSession(session, signal)) {
      stopStream(stream); // 🆕 P2-14: позднее разрешение — сразу стоп
      return false;
    }
    return await attachStream(videoEl, stream, session, signal);
  } catch (e) {
    console.warn('[Scanner] Camera error (env):', e.message);
    if (!isCurrentSession(session, signal)) return false; // 🆕 P2-14: отмена во время первого запроса — без retry
    // Повторная попытка без ограничений facingMode
    // (некоторые камеры не поддерживают ideal)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      if (!isCurrentSession(session, signal)) {
        stopStream(stream); // 🆕 P2-14
        return false;
      }
      return await attachStream(videoEl, stream, session, signal);
    } catch (e2) {
      console.warn('[Scanner] Camera error (any):', e2.message);
      return false;
    }
  }
}

/**
 * Привязывает MediaStream к видеоэлементу.
 *
 * 🆕 P2-14: принимает локальный stream (не глобальный _stream) и
 * присваивает его в _stream ТОЛЬКО для актуальной сессии; при отмене
 * или ошибке play немедленно останавливает tracks.
 *
 * @param {HTMLVideoElement} videoEl
 * @param {MediaStream} stream
 * @param {number} session
 * @param {AbortSignal} signal
 * @returns {Promise<boolean>}
 */
async function attachStream(videoEl, stream, session, signal) {
  if (!stream) return false;
  videoEl.srcObject = stream;
  videoEl.muted = true;
  videoEl.playsInline = true;
  try {
    await videoEl.play();
    if (!isCurrentSession(session, signal)) {
      videoEl.srcObject = null; // 🆕 P2-14: не оставляем мёртвый поток привязанным
      stopStream(stream); // 🆕 P2-14: отмена во время play
      return false;
    }
    _stream = stream; // только для актуальной сессии
    return true;
  } catch (e) {
    console.warn('[Scanner] Video play failed:', e.message);
    videoEl.srcObject = null; // 🆕 P2-14: не оставляем непривязанный поток
    stopStream(stream); // 🆕 P2-14: не оставляем непривязанный поток жить
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
 * @param {number} session — token сессии (P2-14)
 * @returns {Promise<string|null>}
 */
async function scanLoop_Native(videoEl, formats, signal, session) {
  const detector = new BarcodeDetector({ formats });

  return new Promise((resolve) => {
    let errors = 0;
    const MAX_ERRORS = 30; // ~7.5 секунд непрерывных ошибок → выход

    const scan = async () => {
      if (!isCurrentSession(session, signal)) { resolve(null); return; }

      try {
        // Ждём пока видео готово
        if (videoEl.readyState < 2) {
          _scanTimer = setTimeout(scan, 200);
          return;
        }

        const codes = await detector.detect(videoEl);
        // 🆕 P2-14: отмена могла произойти во время detect — поздний
        // результат не должен резолвить старую сессию
        if (!isCurrentSession(session, signal)) { resolve(null); return; }
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
        // 🆕 P2-14: stop во время детекта может вызвать ошибку — это
        // штатная отмена, а не накопление ошибок
        if (!isCurrentSession(session, signal)) { resolve(null); return; }
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
 * Ленивая загрузка ZXing-wasm (с кешем модуля).
 *
 * 🆕 P1-14: фиксированная версия 1.2.12 подключается с self
 * (`/BookTrackerPro/zxing/dist/es/reader/index.js`), а не с CDN.
 * 1) CSP script-src 'self' блокировал динамический import() remote
 *    ES module (unpkg/jsDelivr числились только в connect-src);
 * 2) в пакете не существует файла dist/reader/zxing_reader.js — модуль
 *    собирается как dist/es/reader/index.js; 3) CDN не гарантировал
 *    offline. WASM-путь переопределяется через setZXingModuleOverrides,
 *    иначе ядро ZXing по умолчанию ищет wasm на внешнем CDN.
 *
 * @returns {Promise<object|null>}
 */
async function loadZXing() {
  if (_zxingModule) return _zxingModule;

  try {
    const module = await import(/* webpackIgnore: true */ ZXING_ENTRY);
    // Локальный WASM вместо CDN-пути из default overrides ядра.
    if (typeof module.setZXingModuleOverrides === 'function') {
      module.setZXingModuleOverrides({
        locateFile: (file, base) => file.endsWith('.wasm')
          ? `${BASE}/zxing/dist/reader/${file}`
          : base + file,
      });
    }
    _zxingModule = module;
    return module;
  } catch (e) {
    console.warn('[Scanner] ZXing load failed from', ZXING_ENTRY, e.message);
  }
  return null;
}

/**
 * 🆕 P2-16: адаптивный интервал сканирования.
 *
 * Медленный decode (decodeMs близок к интервалу) → пауза растёт,
 * не давая ставить decode в очередь на main thread
 * (медленный телефон не лагает, а просто сканирует реже).
 * Быстрый decode → пауза сокращается до ZXING_DELAY_MIN
 * (быстрые устройства не теряют отзывчивость).
 *
 * Чистая функция — экспортируется как @internal для юнит-тестов P2-16.
 *
 * @param {number} delay — текущий интервал, мс
 * @param {number} decodeMs — сколько занял последний decode, мс
 * @returns {number} новый интервал, мс
 */
export function nextScanDelay(delay, decodeMs) {
  if (decodeMs > delay * 0.75) {
    // Медленный decode: разгружаем main thread
    return Math.min(ZXING_DELAY_MAX, Math.round(Math.max(delay, decodeMs * 2)));
  }
  if (decodeMs < delay * 0.25 && delay > ZXING_DELAY_MIN) {
    // Быстрый decode: можно сканировать чаще, но не быстрее порога
    return Math.max(ZXING_DELAY_MIN, delay - 100);
  }
  return delay;
}

/**
 * 🆕 P2-16: извлекает из видео только зону интереса (ROI) и сразу
 * масштабирует её до разумного размера для распознавания.
 *
 * Экспортируется как @internal для юнит-тестов P2-16.
 *
 * Зачем: раньше весь кадр 1280×720 (или фактическое разрешение) целиком
 * копировался через drawImage + getImageData на main thread, а EAN-13
 * занимает на экране лишь центральную часть. Копирование и декодирование
 * внешних углов — бессмысленные расходы CPU/батареи, особенно на
 * слабых Android/iPhone.
 *
 * Возвращает ImageData размером ≤ ZXING_MAX_SCAN_DIM по большей стороне.
 *
 * @param {HTMLCanvasRenderingContext2D} ctx
 * @param {HTMLVideoElement} videoEl
 * @param {HTMLCanvasElement} canvas
 * @returns {ImageData|null}
 */
export function captureScanFrame(ctx, videoEl, canvas) {
  const vw = videoEl.videoWidth;
  const vh = videoEl.videoHeight;
  if (vw === 0 || vh === 0) return null;

  // Зона интереса в пикселях источника (центральная область штрихкода)
  const sx = Math.round(vw * ZXING_ROI.x);
  const sy = Math.round(vh * ZXING_ROI.y);
  const sw = Math.round(vw * ZXING_ROI.w);
  const sh = Math.round(vh * ZXING_ROI.h);

  // Downscale с сохранением пропорций до ZXING_MAX_SCAN_DIM
  const scale = Math.min(1, ZXING_MAX_SCAN_DIM / Math.max(sw, sh));
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));

  // Рисуем ТОЛЬКО ROI (не весь кадр) и сразу в уменьшенный размер —
  // drawImage сам выполняет downscale без отдельного прохода.
  canvas.width = dw;
  canvas.height = dh;
  ctx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, dw, dh);
  return ctx.getImageData(0, 0, dw, dh);
}

/**
 * Цикл распознавания через ZXing-wasm.
 * Рендерит кадр видео в canvas и передаёт ImageData в ZXing.
 *
 * 🆕 P2-16: на main thread обрабатывается только центральный ROI,
 * уменьшенный до ≤ ZXING_MAX_SCAN_DIM, а интервал сканирования
 * адаптируется к скорости decode (медленное устройство → реже,
 * быстрое → чаще, но не быстрее нижнего порога).
 *
 * @param {HTMLVideoElement} videoEl
 * @param {object} zxing — модуль ZXing-wasm
 * @param {AbortSignal} signal
 * @param {number} session — token сессии (P2-14)
 * @returns {Promise<string|null>}
 */
export async function scanLoop_ZXing(videoEl, zxing, signal, session) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  return new Promise((resolve) => {
    let errors = 0;
    const MAX_ERRORS = 30;
    let delay = ZXING_DELAY_BASE; // 🆕 P2-16: стартовый интервал

    const scan = async () => {
      if (!isCurrentSession(session, signal)) { resolve(null); return; }

      try {
        if (videoEl.readyState < 2) {
          _scanTimer = setTimeout(scan, 200);
          return;
        }

        // 🆕 P2-16: только ROI + downscale вместо всего кадра
        const imageData = captureScanFrame(ctx, videoEl, canvas);
        if (!imageData) {
          _scanTimer = setTimeout(scan, 200);
          return;
        }

        // Замер длительности decode для адаптивной частоты
        const t0 = performance.now();

        // Распознаём
        const results = await zxing.readBarcodesFromImageData(imageData, {
          tryHarder: true,
          formats: ['EAN-13', 'EAN-8', 'Code128'],
        });
        // 🆕 P2-14: отмена могла произойти во время распознавания
        if (!isCurrentSession(session, signal)) { resolve(null); return; }

        const decodeMs = performance.now() - t0; // 🆕 P2-16

        // 🆕 P2-16: адаптивная частота — интервал подстраивается под
        // производительность устройства.
        delay = nextScanDelay(delay, decodeMs);

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
        // 🆕 P2-14: stop во время распознавания — штатная отмена
        if (!isCurrentSession(session, signal)) { resolve(null); return; }
        errors++;
        if (errors > MAX_ERRORS) { resolve(null); return; }
      }

      _scanTimer = setTimeout(scan, delay); // 🆕 P2-16: адаптивная пауза
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