// 📦 BookTrackerPro — ocr.js
// 🔖 v3.8.3 | 2026-08-14
// 📝 Распознавание цитат по фото (OCR)
//
//    Полный оффлайн: Tesseract.js + файлы в корне:
//      tesseract.min.js
//      worker.min.js
//      tesseract-core-simd.wasm.js
//      rus.traineddata.gz   (русский)
//      eng.traineddata.gz   (английский, НЕ поставляется — см. P1-12)
//
//    Флоу:
//      📷 Фото страницы → предобработка (canvas)
//      → Tesseract (rus) → текст → правка → в цитату
//
//    Точность для печатного текста: ~90-95%
//
//    Новое в 3.8.3:
//      — Фикс утечки Object URL в showPreview (revoke при закрытии)
//      — Улучшенная обработка ошибок камеры
//      — aria-label на всех кнопках оверлея
//      — JSDoc для публичных функций
//      — Корректная очистка ресурсов при отмене
//
//    Сохранено из 3.7.0:
//      — showToast импортируется из utils.js (разрыв цикла)
//      — SVG-иконки из icons.js в хроме оверлея
// ─────────────────────────────────────────────
import { showToast, trackOverlay, untrackOverlay, releaseOverlay } from './utils.js';
import { icon } from './icons.js';
// 🆕 P2-15: конкуренция камер OCR↔scanner централизуется здесь —
// при старте камеры OCR останавливаем активный ISBN-сканер
// (запрет одновременного camera flow).
import { isScannerActive, stopScanner } from './scanner.js';

// Базовый путь к файлам Tesseract (в корне проекта)
const BASE = '/BookTrackerPro';

// Языки распознавания.
// 🆕 P1-12: только русский — `eng.traineddata.gz` НЕ поставляется в проекте
// (проверенный `rus.traineddata.gz` = 8 634 337 bytes, eng отсутствует).
// Раньше `rus+eng` заставлял Tesseract при каждом createWorker запрашивать
// eng-модель → 404 → cold-start OCR падал даже для русского текста.
const OCR_LANGS = 'rus';

// Кеш воркера (не пересоздаём каждый раз).
// 🆕 P2-15: политика terminate/recreate — pagehide/terminateOcrWorker()
// увеличивают _workerEpoch; создающийся в этот момент worker НЕ кешируется
// и немедленно завершается; следующий запуск OCR создаёт новый воркер.
let _worker = null;
let _workerPromise = null;
let _loadProgress = 0;
let _workerEpoch = 0;

// 🆕 P2-15: запрет одновременного OCR-флоу (один оверлей за раз).
let _ocrOpen = false;

// ═══════════════════════════════════════════════
//  1. ГЛАВНАЯ ФУНКЦИЯ
// ═══════════════════════════════════════════════

/**
 * Открывает оверлей OCR: фото → распознавание → текст.
 * Возвращает Promise<string|null> — распознанный текст или null.
 *
 * Флоу:
 *   1. Запуск камеры (или выбор из галереи)
 *   2. Съёмка / выбор фото
 *   3. Предобработка (grayscale + contrast)
 *   4. Tesseract распознавание
 *   5. Пользователь правит текст
 *   6. Возврат текста или null (отмена)
 *
 * @returns {Promise<string|null>}
 */
export function captureQuoteByPhoto() {
  // 🆕 P2-15: запрет одновременного OCR-флоу (один оверлей + одна камера за раз).
  if (_ocrOpen) return Promise.resolve(null);
  _ocrOpen = true;

  return new Promise((resolve) => {
    const overlay = buildOverlay();
    document.body.appendChild(overlay);
    // 🆕 P2-17: OCR-оверлей в back-стеке (Android back закрывает его),
    // scroll-lock с refcount, фокус/trap — единый lifecycle из utils.js.
    trackOverlay(overlay, { onClose: () => close(null) });

    const video = overlay.querySelector('#ocr-video');
    const canvas = overlay.querySelector('#ocr-canvas');
    const fileInput = overlay.querySelector('#ocr-file');
    const statusEl = overlay.querySelector('#ocr-status');
    const progressFill = overlay.querySelector('#ocr-progress-fill');
    const progressText = overlay.querySelector('#ocr-progress-text');
    const resultArea = overlay.querySelector('#ocr-result');
    const resultBlock = overlay.querySelector('#ocr-result-block');
    const captureBtn = overlay.querySelector('#ocr-capture');
    const retakeBtn = overlay.querySelector('#ocr-retake');
    const useBtn = overlay.querySelector('#ocr-use');
    const cancelBtn = overlay.querySelector('#ocr-cancel');

    let stream = null;
    let capturedBlob = null;
    let cancelled = false;
    let previewUrl = null; // 🆕 v3.8.3: для корректного revoke

    // ── Запуск камеры ──
    async function startCamera() {
      try {
        statusEl.textContent = '📷 Наведите камеру на страницу книги';
        // 🆕 P2-15: один camera flow — если ISBN-сканер уже захватил камеру,
        // останавливаем его (конкуренция OCR↔scanner централизована здесь).
        if (isScannerActive()) stopScanner();
        const s = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        // 🆕 P2-15: оверлей закрыт, пока камера запускалась — не держим поток.
        if (cancelled) {
          s.getTracks().forEach(t => t.stop());
          return;
        }
        stream = s;
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        await video.play();
        // 🆕 P2-15: отмена во время play — освобождаем камеру сразу.
        if (cancelled) {
          stopCamera();
          return;
        }
        captureBtn.disabled = false;
      } catch (e) {
        if (cancelled) return; // 🆕 P2-15: ошибка/отмена после закрытия — UI не трогаем
        console.warn('[OCR] Camera error:', e.message);
        statusEl.textContent = '⚠️ Камера недоступна — выберите фото из галереи';
        captureBtn.disabled = true;
      }
    }

    function stopCamera() {
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
      }
    }

    // 🆕 v3.8.3: очистка Object URL
    function revokePreview() {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        previewUrl = null;
      }
    }

    // ── Закрытие ──
    function close(result) {
      if (cancelled) return; // 🆕 P2-15: защита от двойного закрытия/resolve
      cancelled = true;
      stopCamera();
      revokePreview(); // 🆕 v3.8.3: фикс утечки
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('visibilitychange', onVisHidden);
      overlay.remove();
      // 🆕 P2-17: единый lifecycle — снимаем оверлей из back-стека и
      // разблокируем скролл/фокус (при жесте «назад» history.back() подавляется).
      untrackOverlay(overlay);
      _ocrOpen = false;
      resolve(result);
    }

    // 🆕 P2-15: централизованный lifecycle при навигации/видимости страницы.
    // pagehide — страница уходит (навигация/закрытие): закрываем оверлей,
    // камера и воркер освобождаются (SW продолжает жить, но JS-страница — нет).
    const onPageHide = () => {
      if (cancelled) return;
      cancelled = true;
      stopCamera();
      revokePreview();
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('visibilitychange', onVisHidden);
      overlay.remove();
      releaseOverlay(overlay); // без history.back(): навигацию делает браузер
      _ocrOpen = false;
      resolve(null);
    };
    // visibilitychange — уход в фон (переключение приложения/вкладки):
    // освобождаем камеру и воркер, но оверлей держим открытым — пользователь
    // вернётся и нажмёт «Заново», либо выберет фото из галереи.
    const onVisHidden = () => {
      if (document.visibilityState === 'hidden') {
        stopCamera();
        terminateOcrWorker();
      }
    };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('visibilitychange', onVisHidden);

    cancelBtn.addEventListener('click', () => close(null));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });

    // ── Съёмка ──
    captureBtn.addEventListener('click', () => {
      if (!video.videoWidth) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      canvas.toBlob((blob) => {
        if (cancelled) return; // 🆕 P2-15: закрыто во время toBlob — не используем
        capturedBlob = blob;
        showPreview(blob);
      }, 'image/jpeg', 0.92);
    });

    // ── Выбор из галереи ──
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file || cancelled) return; // 🆕 P2-15: позднее изменение
      capturedBlob = file;
      showPreview(file);
    });

    function showPreview(blob) {
      if (cancelled) return; // 🆕 P2-15: оверлей закрыт — не трогаем DOM
      stopCamera();
      revokePreview(); // 🆕 v3.8.3: очищаем предыдущий URL
      previewUrl = URL.createObjectURL(blob);
      const preview = overlay.querySelector('#ocr-preview');
      preview.src = previewUrl;
      preview.classList.remove('hidden');
      video.classList.add('hidden');
      captureBtn.classList.add('hidden');
      retakeBtn.classList.remove('hidden');
      statusEl.textContent = '👆 Фото готово. Нажмите «Распознать»';
      overlay.querySelector('#ocr-run').classList.remove('hidden');
    }

    retakeBtn.addEventListener('click', () => {
      if (cancelled) return; // 🆕 P2-15
      capturedBlob = null;
      revokePreview(); // 🆕 v3.8.3
      overlay.querySelector('#ocr-preview').classList.add('hidden');
      overlay.querySelector('#ocr-run').classList.add('hidden');
      resultBlock.classList.add('hidden');
      video.classList.remove('hidden');
      captureBtn.classList.remove('hidden');
      retakeBtn.classList.add('hidden');
      startCamera();
    });

    // ── Распознавание ──
    overlay.querySelector('#ocr-run').addEventListener('click', async () => {
      if (!capturedBlob || cancelled) return; // 🆕 P2-15

      overlay.querySelector('#ocr-run').classList.add('hidden');
      overlay.querySelector('#ocr-progress').classList.remove('hidden');
      statusEl.textContent = '⏳ Загружаю модель распознавания...';

      try {
        // Предобработка изображения
        const processed = await preprocessImage(capturedBlob);
        // 🆕 P2-15: оверлей закрыт во время предобработки — результат не нужен
        if (cancelled) return;

        const worker = await getWorker((p) => {
          // Прогресс загрузки модели / распознавания
          const pct = Math.round(p * 100);
          progressFill.style.width = pct + '%';
          progressText.textContent = pct + '%';
          if (p < 0.5) statusEl.textContent = '⏳ Загружаю языковую модель...';
          else statusEl.textContent = '🔍 Распознаю текст...';
        });
        // 🆕 P2-15: закрыто во время загрузки модели — воркер завершаем,
        // чтобы не оставлять тяжёлый процесс без потребителя
        if (cancelled) {
          await terminateOcrWorker();
          return;
        }

        statusEl.textContent = '🔍 Распознаю текст...';
        const { data } = await worker.recognize(processed);
        // 🆕 P2-15: поздний результат распознавания после закрытия — игнорируем
        if (cancelled) return;
        const text = (data.text || '').trim();

        if (!text) {
          statusEl.textContent = '⚠️ Текст не распознан. Попробуйте другое фото';
          overlay.querySelector('#ocr-run').classList.remove('hidden');
          overlay.querySelector('#ocr-progress').classList.add('hidden');
          return;
        }

        // Показываем результат для правки
        resultArea.value = text;
        resultBlock.classList.remove('hidden');
        overlay.querySelector('#ocr-progress').classList.add('hidden');
        statusEl.textContent = '✏️ Проверьте и поправьте текст, затем «Использовать»';
        useBtn.classList.remove('hidden');
      } catch (e) {
        if (cancelled) return; // 🆕 P2-15: ошибка после закрытия — не показываем
        console.error('[OCR] Recognition error:', e);
        statusEl.textContent = '❌ Ошибка распознавания: ' + e.message;
        overlay.querySelector('#ocr-run').classList.add('hidden');
        overlay.querySelector('#ocr-progress').classList.add('hidden');
        showToast('❌ Не удалось распознать текст', 'error');
      }
    });

    // ── Использовать результат ──
    useBtn.addEventListener('click', () => {
      const text = resultArea.value.trim();
      close(text || null);
    });

    // Старт
    startCamera();
  });
}

// ═══════════════════════════════════════════════
//  2. ЗАГРУЗКА TESSERACT (лениво, с кешем)
// ═══════════════════════════════════════════════

/**
 * Загружает библиотеку Tesseract (один раз).
 * Файл tesseract.min.js — локальный, в корне проекта.
 * @returns {Promise<object>} — объект Tesseract
 */
function loadTesseractLib() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${BASE}/tesseract.min.js`;
    script.onload = () => {
      if (window.Tesseract) resolve(window.Tesseract);
      else reject(new Error('Tesseract не загрузился'));
    };
    script.onerror = () => reject(new Error('Не удалось загрузить tesseract.min.js'));
    document.head.appendChild(script);
  });
}

/**
 * Создаёт (или возвращает кешированный) OCR-воркер.
 * Модель кэшируется в IndexedDB (cacheMethod: 'indexeddb'),
 * поэтому повторные запуски OCR не требуют повторной загрузки.
 *
 * 🆕 P2-15: политика terminate/recreate — getWorker привязывается к
 * текущему _workerEpoch. Если во время создания воркера был вызван
 * terminateOcrWorker (pagehide/visibilitychange/отмена), поколение
 * меняется, и новый воркер НЕ кешируется, а сразу завершается.
 * Следующий запуск OCR создаёт воркер заново.
 *
 * @param {function} onProgress — колбэк прогресса (0..1)
 * @returns {Promise<object>} — Tesseract worker
 */
async function getWorker(onProgress) {
  if (_worker) return _worker;

  // Если воркер уже создаётся — ждём тот же Promise
  if (_workerPromise) return _workerPromise;

  const epoch = _workerEpoch; // 🆕 P2-15: поколение, в котором стартуем
  _workerPromise = (async () => {
    const Tesseract = await loadTesseractLib();
    const worker = await Tesseract.createWorker(OCR_LANGS, 1, {
      workerPath: `${BASE}/worker.min.js`,
      corePath: `${BASE}/tesseract-core-simd.wasm.js`,
      langPath: BASE,              // ищет rus.traineddata.gz (P1-12: только rus)
      cacheMethod: 'indexeddb',    // кеширует модель в IndexedDB
      gzip: true,                  // traineddata в формате .gz
      logger: (m) => {
        if (m.status === 'recognizing text' || m.status === 'loading language traineddata') {
          _loadProgress = m.progress || 0;
          if (onProgress) onProgress(_loadProgress);
        }
      },
    });

    // 🆕 P2-15: воркер создался, но его поколение устарело (terminate
    // случился во время загрузки модели) — завершаем и не кешируем.
    if (epoch !== _workerEpoch) {
      if (worker && typeof worker.terminate === 'function') {
        try { await worker.terminate(); } catch { /* best effort */ }
      }
      throw new Error('OCR worker terminated');
    }

    // Настройки для лучшего распознавания книжного текста
    await worker.setParameters({
      tessedit_pageseg_mode: '3',   // авто-сегментация
      preserve_interword_spaces: '1',
    });

    // 🆕 P2-15: повторная проверка после setParameters.
    if (epoch !== _workerEpoch) {
      if (worker && typeof worker.terminate === 'function') {
        try { await worker.terminate(); } catch { /* best effort */ }
      }
      throw new Error('OCR worker terminated');
    }

    _worker = worker;
    return worker;
  })();

  try {
    return await _workerPromise;
  } catch (e) {
    _workerPromise = null; // сброс, чтобы можно было повторить
    throw e;
  }
}

/**
 * 🆕 P2-15: завершает OCR-воркер и сбрасывает кеш/прогресс.
 *
 * Политика terminate/recreate:
 *   — при pagehide (навигация/закрытие PWA) и уходе в фон
 *     (visibilitychange→hidden) вызывается автоматически;
 *   — при отмене OCR в момент загрузки модели — тоже;
 *   — после terminate следующий запуск OCR создаст новый воркер
 *     (модель по-прежнему берётся из IndexedDB — без повторной сети).
 *
 * Безопасен для повторного вызова и при отсутствии воркера.
 *
 * @returns {Promise<void>}
 */
export async function terminateOcrWorker() {
  _workerEpoch++; // инвалидируем создающиеся воркеры
  const w = _worker;
  _worker = null;
  _workerPromise = null;
  _loadProgress = 0;
  if (w && typeof w.terminate === 'function') {
    try { await w.terminate(); } catch (e) { console.warn('[OCR] terminate error:', e); }
  }
}

/**
 * 🆕 P2-15: активен ли сейчас OCR-оверлей (захвачена ли камера).
 * Используется app.js, чтобы не запускать ISBN-сканер одновременно с OCR
 * (запрет одновременного camera flow с обеих сторон).
 * @returns {boolean}
 */
export function isOcrActive() {
  return _ocrOpen;
}

/**
 * Предварительная проверка доступности OCR.
 * Проверяет наличие критичных файлов через HEAD-запросы.
 *
 * 🆕 P1-12: проверяет РОВНО те языки, которые фактически используются в
 * runtime (OCR_LANGS). Раньше проверка была захардкожена на rus, хотя
 * createWorker запрашивал rus+eng — «поддержка ок» могла быть, а
 * распознавание падало из-за отсутствующего eng-файла.
 *
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function checkOcrSupport() {
  try {
    const r = await fetch(`${BASE}/tesseract.min.js`, { method: 'HEAD' });
    if (!r.ok) return { ok: false, error: 'tesseract.min.js не найден' };

    // Проверяем каждый язык из OCR_LANGS (согласовано с createWorker)
    const langs = OCR_LANGS.split('+').map(s => s.trim()).filter(Boolean);
    for (const lang of langs) {
      const rl = await fetch(`${BASE}/${lang}.traineddata.gz`, { method: 'HEAD' });
      if (!rl.ok) return { ok: false, error: `${lang}.traineddata.gz не найден` };
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════
//  2.1 ПОДГОТОВКА OCR ДЛЯ ПОЛНОГО OFFLINE (🆕 P1-13)
// ═══════════════════════════════════════════════

// Имя runtime-кеша OCR — должно совпадать с OCR_CACHE_NAME в sw.js.
// P1-13: страница кладёт полный набор сюда, SW читает из того же кеша.
const OCR_CACHE_NAME = 'btp-ocr-v1';

// 🆕 P1-13: полный проверенный набор OCR-ресурсов для cold offline.
// Соответствует ровно тем файлам, которые реально запрашивает Tesseract:
//   — tesseract.min.js            (loadTesseractLib → <script src>)
//   — worker.min.js               (workerPath в createWorker)
//   — tesseract-core-simd.wasm.js (corePath в createWorker)
//   — rus.traineddata.gz          (langPath; P1-12: только rus — eng не поставляется)
const OCR_OFFLINE_ASSETS = [
  `${BASE}/tesseract.min.js`,
  `${BASE}/worker.min.js`,
  `${BASE}/tesseract-core-simd.wasm.js`,
  `${BASE}/rus.traineddata.gz`,
];

/**
 * Проверяет, что весь набор OCR-ресурсов уже лежит в runtime-кеше
 * (`btp-ocr-v1`). Используется для подтверждения готовности после
 * подготовки. Чисто локальная проверка — сети не требует.
 *
 * @returns {Promise<{ok: boolean, missing: string[]}>}
 */
export async function isOcrReadyOffline() {
  try {
    const cache = await caches.open(OCR_CACHE_NAME);
    const results = await Promise.all(
      OCR_OFFLINE_ASSETS.map((url) => cache.match(url).then((r) => Boolean(r)))
    );
    const missing = OCR_OFFLINE_ASSETS.filter((_, i) => !results[i]);
    return { ok: missing.length === 0, missing };
  } catch (e) {
    return { ok: false, missing: [...OCR_OFFLINE_ASSETS], error: e.message };
  }
}

/**
 * Подготавливает OCR для полного offline-использования: атомарно качает
 * весь проверенный набор OCR-ресурсов во runtime-кеш `btp-ocr-v1`.
 *
 * 🆕 P1-13: раньше тяжёлые OCR-ресурсы попадали в кеш ТОЛЬКО после
 * первого онлайн-OCR-запроса (runtime cache-first у SW). Пользователь,
 * установивший PWA, но не запускавший OCR с сетью, получал сломанное
 * распознавание при первом офлайн-запуске. Теперь по кнопке «Подготовить
 * OCR офлайн» набор скачивается заранее, а готовность подтверждается
 * проверкой кеша (isOcrReadyOffline).
 *
 * Атомарность: если хоть один запрос не ок (404/сеть) или упал
 * cache.put (quota) — уже положенные в ЭТОМ запуске URL удаляются,
 * подготовка возвращает {ok:false}.
 *
 * @param {object} [opts]
 * @param {(p: {current: number, total: number, sizeBytes: number}) => void} [opts.onProgress]
 * @returns {Promise<{ok: boolean, sizeBytes?: number, error?: string}>}
 */
export async function prepareOcrOffline({ onProgress } = {}) {
  const added = [];
  const rollback = async (cache) => {
    await Promise.allSettled(added.map((url) => cache.delete(url).catch(() => false)));
  };

  try {
    const cache = await caches.open(OCR_CACHE_NAME);
    let sizeBytes = 0;

    for (let i = 0; i < OCR_OFFLINE_ASSETS.length; i++) {
      const url = OCR_OFFLINE_ASSETS[i];

      // Уже лежит в кеше — пропускаем (повторная подготовка не перекачивает).
      const cached = await cache.match(url).catch(() => null);
      if (cached) {
        if (onProgress) {
          const cl = Number(cached.headers?.get?.('content-length')) || 0;
          sizeBytes += cl;
          onProgress({ current: i + 1, total: OCR_OFFLINE_ASSETS.length, sizeBytes });
        }
        continue;
      }

      const resp = await fetch(url);
      if (!resp.ok) {
        await rollback(cache);
        return { ok: false, error: `${url}: HTTP ${resp.status}` };
      }
      try {
        await cache.put(url, resp.clone());
      } catch (e) {
        await rollback(cache);
        return { ok: false, error: `Не удалось записать в кеш: ${e.message}` };
      }
      added.push(url);
      sizeBytes += Number(resp.headers.get('content-length')) || 0;
      if (onProgress) onProgress({ current: i + 1, total: OCR_OFFLINE_ASSETS.length, sizeBytes });
    }

    // Подтверждение готовности ТОЛЬКО после проверки кеша.
    const verify = await isOcrReadyOffline();
    if (!verify.ok) {
      await rollback(cache);
      return { ok: false, error: `Кеш неполный: ${verify.missing.join(', ')}` };
    }

    return { ok: true, sizeBytes };
  } catch (e) {
    try {
      const cache = await caches.open(OCR_CACHE_NAME);
      await rollback(cache);
    } catch { /* кеш недоступен — best effort */ }
    return { ok: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════
//  3. ПРЕДОБРАБОТКА ИЗОБРАЖЕНИЯ
// ═══════════════════════════════════════════════
//  Улучшает точность OCR:
//    — масштабирование до ~1600px по большей стороне
//    — перевод в оттенки серого
//    — повышение контраста (растяжка гистограммы)
//    — гамма-коррекция для усиления тёмного текста

/**
 * Предобрабатывает изображение для лучшего распознавания.
 * @param {Blob} blob — исходное фото
 * @returns {Promise<ImageData>}
 */
async function preprocessImage(blob) {
  const bitmap = await createImageBitmap(blob);

  // Масштабирование
  const MAX = 1600;
  let w = bitmap.width;
  let h = bitmap.height;
  const scale = Math.min(1, MAX / Math.max(w, h));
  w = Math.round(w * scale);
  h = Math.round(h * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  // 1. Оттенки серого + растяжка контраста
  // Сначала находим мин/макс яркости
  let min = 255, max = 0;
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (lum < min) min = lum;
    if (lum > max) max = lum;
  }

  const range = (max - min) || 1;

  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    // Нормализация + лёгкое усиление контраста (гамма)
    let v = ((lum - min) / range) * 255;
    v = 255 * Math.pow(v / 255, 0.85);
    v = Math.max(0, Math.min(255, v));
    data[i] = data[i + 1] = data[i + 2] = v;
  }

  ctx.putImageData(imageData, 0, 0);
  return ctx.getImageData(0, 0, w, h);
}

// ═══════════════════════════════════════════════
//  4. UI ОВЕРЛЕЙ (v3.8.3: aria-label на кнопках)
// ═══════════════════════════════════════════════

function buildOverlay() {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Распознавание цитаты по фото');

  overlay.innerHTML = `
    <div class="overlay-panel" style="max-width:560px">
      <div class="overlay-header">
        <h2>${icon('camera', 18)} Цитата по фото</h2>
        <button id="ocr-cancel" class="icon-btn" aria-label="Закрыть">${icon('close', 16)}</button>
      </div>
      <div class="overlay-body">
        <!-- Видео / превью -->
        <div class="ocr-stage">
          <video id="ocr-video" autoplay playsinline muted></video>
          <img id="ocr-preview" class="hidden" alt="Предпросмотр фото страницы"/>
          <canvas id="ocr-canvas" class="hidden"></canvas>
        </div>

        <div id="ocr-status" class="ocr-status" aria-live="polite">
          📷 Наведите камеру на страницу книги
        </div>

        <!-- Прогресс -->
        <div id="ocr-progress" class="ocr-progress hidden" role="progressbar"
             aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <div class="ocr-progress-track">
            <div id="ocr-progress-fill" class="ocr-progress-fill"></div>
          </div>
          <div id="ocr-progress-text" class="ocr-progress-text">0%</div>
        </div>

        <!-- Результат -->
        <div id="ocr-result-block" class="hidden">
          <div class="form-group">
            <label for="ocr-result">Распознанный текст (поправьте при необходимости)</label>
            <textarea id="ocr-result" rows="5"
                      placeholder="Здесь появится распознанный текст..."></textarea>
          </div>
        </div>

        <!-- Кнопки -->
        <div class="ocr-actions">
          <input type="file" id="ocr-file" accept="image/*" class="hidden"/>
          <label for="ocr-file" class="btn-secondary" style="cursor:pointer" aria-label="Выбрать фото из галереи">
            ${icon('image', 15)} Из галереи
          </label>
          <button id="ocr-capture" class="btn-primary" style="width:auto;flex:1" disabled aria-label="Сделать фото">
            ${icon('camera', 15)} Снять
          </button>
          <button id="ocr-retake" class="btn-secondary hidden" aria-label="Переснять фото">
            ${icon('refresh', 15)} Заново
          </button>
          <button id="ocr-run" class="btn-primary hidden" style="width:auto;flex:1" aria-label="Распознать текст">
            ${icon('search', 15)} Распознать
          </button>
          <button id="ocr-use" class="btn-primary hidden" style="width:auto;flex:1;background:var(--green)" aria-label="Использовать распознанный текст">
            ${icon('check', 15)} Использовать
          </button>
        </div>
      </div>
    </div>
  `;

  return overlay;
}

// ═══════════════════════════════════════════════
//  5. СТИЛИ (инжектируются один раз)
// ═══════════════════════════════════════════════
const OCR_STYLES = `
.ocr-stage {
  position:relative;
  width:100%;
  aspect-ratio:4/3;
  background:#000;
  border-radius:var(--radius);
  overflow:hidden;
  margin-bottom:12px;
}
.ocr-stage video, .ocr-stage img {
  width:100%; height:100%;
  object-fit:cover;
  display:block;
}
.ocr-stage canvas { display:none; }

.ocr-status {
  text-align:center;
  font-size:.88rem;
  color:var(--text-secondary);
  padding:6px 0 12px;
  min-height:34px;
}

.ocr-progress {
  display:flex; align-items:center; gap:12px;
  margin-bottom:12px;
}
.ocr-progress-track {
  flex:1; height:8px;
  background:var(--bg-input);
  border-radius:4px; overflow:hidden;
}
.ocr-progress-fill {
  height:100%; width:0%;
  background:linear-gradient(90deg, var(--accent), var(--cyan));
  border-radius:4px;
  transition:width .2s ease;
}
.ocr-progress-text {
  font-size:.85rem; font-weight:700;
  color:var(--accent);
  min-width:40px; text-align:right;
}

.ocr-actions {
  display:flex; gap:8px; flex-wrap:wrap;
  margin-top:8px;
}
.ocr-actions .btn-primary, .ocr-actions .btn-secondary {
  display:inline-flex; align-items:center; justify-content:center; gap:7px;
}
`;

if (!document.getElementById('ocr-styles')) {
  const style = document.createElement('style');
  style.id = 'ocr-styles';
  style.textContent = OCR_STYLES;
  document.head.appendChild(style);
}