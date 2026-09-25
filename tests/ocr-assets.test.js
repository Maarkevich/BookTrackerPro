// ═══════════════════════════════════════════════════════════════════
// 🔖 3.8.6 — «OCR не работает: ошибка загрузки Tesseract».
//
// Оригинальная проблема (до фикса):
//   tesseract.min.js (26 903 б) и worker.min.js (13 641 б) в корне
//   проекта были ОБРЕЗАНЫ: начинались с середины webpack-бандла и
//   не содержали runtime, т.е. при <script src> браузер выбрасывал
//   SyntaxError → loadTesseractLib() отклонялся → все запуски OCR
//   падали с «Не удалось загрузить tesseract.min.js». Файлы заменены
//   на полный согласованный комплект tesseract.js 5.1.1 +
//   tesseract.js-core 5.1.1 (tesseract.min.js, worker.min.js,
//   tesseract-core-simd.wasm.js), rus.traineddata.gz сохранён.
//
// Что доказывают тесты:
//   — tesseract.min.js / worker.min.js реально ПАРСЯТСЯ как JS
//     (обрезанный файл выбрасывает SyntaxError — тест падал бы);
//   — размеры фактически лежащих на диске файлов соответствуют
//     полному комплекту v5.1.1, а не обрезкам;
//   — core содержит встроенный wasmBinary (wasm-биндинг не потерян);
//   — rus.traineddata.gz — валидный gzip (magic 0x1f 0x8b).
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function read(name) {
  return readFileSync(`${ROOT}/${name}`);
}

/**
 * Синтаксическая проверка без исполнения: new Function(source) только
 * КОМПИЛИРУЕТ переданный код (тело функции), но не запускает его.
 * Обрезанный JS-файл выбрасывает SyntaxError — это и ловит тест.
 */
function parseOk(name, bytes) {
  try {
    // eslint-disable-next-line no-new-func
    new Function(bytes.toString('utf8'));
    return true;
  } catch {
    return false;
  }
}

describe('🔖 3.8.6: OCR-ассеты целы (не обрезаны)', () => {
  it('tesseract.min.js — полный бандл 5.1.1: парсится, размер > 50 КБ', () => {
    const b = read('tesseract.min.js');
    expect(b.length).toBeGreaterThan(50 * 1024);
    expect(parseOk('tesseract.min.js', b)).toBe(true);
    const s = b.toString('utf8');
    // Entry-модуль бандла экспортирует createWorker (модуль 311 присутствует).
    expect(s.includes('createWorker')).toBe(true);
  });

  it('worker.min.js — полный worker-бандл 5.1.1: парсится, размер > 100 КБ', () => {
    const b = read('worker.min.js');
    expect(b.length).toBeGreaterThan(100 * 1024);
    expect(parseOk('worker.min.js', b)).toBe(true);
    const s = b.toString('utf8');
    expect(s.includes('importScripts')).toBe(true);
    expect(s.includes('setAdapter')).toBe(true);
  });

  it('tesseract-core-simd.wasm.js — полное ядро 5.1.1 с встроенным wasm: size > 4 МБ, содержит wasmBinary', () => {
    const b = read('tesseract-core-simd.wasm.js');
    expect(b.length).toBeGreaterThan(4 * 1024 * 1024);
    const s = b.toString('utf8');
    expect(s.replace(/^\s+/, '').startsWith('var TesseractCore')).toBe(true);
    expect(s.includes('wasmBinary')).toBe(true);
  });

  it('rus.traineddata.gz — валидный gzip (magic 1f 8b), размер > 8 МБ', () => {
    const b = read('rus.traineddata.gz');
    expect(b.length).toBeGreaterThan(8 * 1024 * 1024);
    expect(b[0]).toBe(0x1f);
    expect(b[1]).toBe(0x8b);
  });
});