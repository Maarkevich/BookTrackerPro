// 📦 BookTrackerPro — ocr.js
// 🔖 v3.8.3 | 2026-08-14
// 📝 Распознавание цитат по фото (OCR)
//
//    Полный оффлайн: Tesseract.js + файлы в корне:
//      tesseract.min.js
//      worker.min.js
//      tesseract-core-simd.wasm.js
//      rus.traineddata.gz   (русский)
//      eng.traineddata.gz   (английский, опционально)
//
//    Флоу:
//      📷 Фото страницы → предобработка (canvas)
//      → Tesseract (rus+eng) → текст → правка → в цитату
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
import { showToast } from './utils.js';
import { icon } from './icons.js';

// Базовый путь к файлам Tesseract (в корне проекта)
const BASE = '/BookTrackerPro';

// Языки распознавания (rus — русский, eng — английский)
const OCR_LANGS = 'rus+eng';

// Кеш воркера (не пересоздаём каждый раз)
let _worker = null;
let _workerPromise = null;
let _loadProgress = 0;

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
  return new Promise((resolve) => {
    const overlay = buildOverlay();
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

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
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        await video.play();
        captureBtn.disabled = false;
      } catch (e) {
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
      cancelled = true;
      stopCamera();
      revokePreview(); // 🆕 v3.8.3: фикс утечки
      overlay.remove();
      document.body.style.overflow = '';
      resolve(result);
    }

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
        capturedBlob = blob;
        showPreview(blob);
      }, 'image/jpeg', 0.92);
    });

    // ── Выбор из галереи ──
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      capturedBlob = file;
      showPreview(file);
    });

    function showPreview(blob) {
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
      if (!capturedBlob) return;

      overlay.querySelector('#ocr-run').classList.add('hidden');
      overlay.querySelector('#ocr-progress').classList.remove('hidden');
      statusEl.textContent = '⏳ Загружаю модель распознавания...';

      try {
        // Предобработка изображения
        const processed = await preprocessImage(capturedBlob);

        const worker = await getWorker((p) => {
          // Прогресс загрузки модели / распознавания
          const pct = Math.round(p * 100);
          progressFill.style.width = pct + '%';
          progressText.textContent = pct + '%';
          if (p < 0.5) statusEl.textContent = '⏳ Загружаю языковую модель...';
          else statusEl.textContent = '🔍 Распознаю текст...';
        });

        statusEl.textContent = '🔍 Распознаю текст...';
        const { data } = await worker.recognize(processed);
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
 * @param {function} onProgress — колбэк прогресса (0..1)
 * @returns {Promise<object>} — Tesseract worker
 */
async function getWorker(onProgress) {
  if (_worker) return _worker;

  // Если воркер уже создаётся — ждём тот же Promise
  if (_workerPromise) return _workerPromise;

  _workerPromise = (async () => {
    const Tesseract = await loadTesseractLib();
    const worker = await Tesseract.createWorker(OCR_LANGS, 1, {
      workerPath: `${BASE}/worker.min.js`,
      corePath: `${BASE}/tesseract-core-simd.wasm.js`,
      langPath: BASE,              // ищет rus.traineddata.gz / eng.traineddata.gz
      cacheMethod: 'indexeddb',    // кеширует модель в IndexedDB
      gzip: true,                  // traineddata в формате .gz
      logger: (m) => {
        if (m.status === 'recognizing text' || m.status === 'loading language traineddata') {
          _loadProgress = m.progress || 0;
          if (onProgress) onProgress(_loadProgress);
        }
      },
    });

    // Настройки для лучшего распознавания книжного текста
    await worker.setParameters({
      tessedit_pageseg_mode: '3',   // авто-сегментация
      preserve_interword_spaces: '1',
    });

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
 * Предварительная проверка доступности OCR.
 * Проверяет наличие критичных файлов через HEAD-запросы.
 *
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function checkOcrSupport() {
  try {
    const r = await fetch(`${BASE}/tesseract.min.js`, { method: 'HEAD' });
    if (!r.ok) return { ok: false, error: 'tesseract.min.js не найден' };

    const r2 = await fetch(`${BASE}/rus.traineddata.gz`, { method: 'HEAD' });
    if (!r2.ok) return { ok: false, error: 'rus.traineddata.gz не найден' };

    return { ok: true };
  } catch (e) {
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