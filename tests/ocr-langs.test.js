// ═══════════════════════════════════════════════════════════════════
// Регрессионные тесты P1-12 — «OCR rus+eng при отсутствующем
// eng.traineddata.gz».
//
// Оригинальная проблема (до фикса):
//   ocr.js:  const OCR_LANGS = 'rus+eng';
//   getWorker → Tesseract.createWorker(OCR_LANGS, 1, { langPath: BASE, … })
//   — Tesseract при создании воркера ЗАПРАШИВАЕТ каждый язык из OCR_LANGS:
//     и rus.traineddata.gz, и eng.traineddata.gz. В проекте есть только
//     русская модель (rus.traineddata.gz = 8 634 337 bytes), eng отсутствует.
//   → cold-start OCR: 404 на eng.traineddata.gz → createWorker отклоняется →
//     распознавание падает даже для русского текста.
//   При этом checkOcrSupport() проверял ТОЛЬКО rus и возвращал {ok:true} —
//   проверка поддержки рассинхронена с фактическим runtime.
//
// Что доказывают тесты (РЕАЛЬНАЯ симуляция контракта с runtime):
//   — OCR_LANGS = 'rus' (eng НЕ запрашивается при createWorker);
//   — checkOcrSupport() больше НЕ шлёт HEAD на eng.traineddata.gz;
//   — 404 на rus.traineddata.gz → {ok:false, error про rus};
//   - 404 на tesseract.min.js → {ok:false};
//   — все ok → {ok:true}.
// ═══════════════════════════════════════════════════════════════════
// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkOcrSupport } from '../ocr.js';

const OCR_SOURCE = readFileSync(path.resolve(process.cwd(), 'ocr.js'), 'utf8');

/** Фейк fetch, эмулирующий файлы на сервере: ключ "missing" → 404. */
function mockFetch(okMap) {
  return vi.fn(async (url, init) => {
    for (const [path, ok] of Object.entries(okMap)) {
      if (String(url).endsWith(path)) {
        if (!ok) return new Response('', { status: 404 });
        return new Response('', { status: 200 });
      }
    }
    return new Response('', { status: 404 });
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('P1-12: OCR runtime использует только доступные языки (rus)', () => {
  it('OCR_LANGS = rus, без eng — контракт конфигурации', () => {
    const langMatch = OCR_SOURCE.match(/const\s+OCR_LANGS\s*=\s*'([^']+)'/);
    expect(langMatch).not.toBeNull();
    const langs = langMatch[1].split('+');
    expect(langs).toContain('rus');
    // eng.traineddata.gz отсутствует в проекте → runtime не должен его требовать
    expect(langs).not.toContain('eng');
  });

  it('checkOcrSupport(): НЕ запрашивает eng.traineddata.gz (контракт семейства языков)', async () => {
    const fetchMock = mockFetch({
      '/tesseract.min.js': true,
      '/rus.traineddata.gz': true,
      '/eng.traineddata.gz': false, // отсутствует на диске
    });
    vi.stubGlobal('fetch', fetchMock);

    const r = await checkOcrSupport();
    expect(r).toEqual({ ok: true });
    // при ok:true eng вообще не упоминается в запросах
    const askedUrls = fetchMock.mock.calls.map(c => String(c[0]));
    expect(askedUrls.some(u => u.includes('eng.traineddata.gz'))).toBe(false);
  });

  it('404 на rus.traineddata.gz → checkOcrSupport возвращает {ok:false} с ошибкой про rus', async () => {
    vi.stubGlobal('fetch', mockFetch({
      '/tesseract.min.js': true,
      '/rus.traineddata.gz': false,
    }));

    const r = await checkOcrSupport();
    expect(r.ok).toBe(false);
    expect(r.error).toContain('rus.traineddata.gz');
  });

  it('404 на tesseract.min.js → {ok:false} с ошибкой про tesseract', async () => {
    vi.stubGlobal('fetch', mockFetch({
      '/tesseract.min.js': false,
      '/rus.traineddata.gz': true,
    }));

    const r = await checkOcrSupport();
    expect(r.ok).toBe(false);
    expect(r.error).toContain('tesseract.min.js');
  });

  it('все файлы на месте (rus) → {ok:true}', async () => {
    vi.stubGlobal('fetch', mockFetch({
      '/tesseract.min.js': true,
      '/rus.traineddata.gz': true,
    }));

    const r = await checkOcrSupport();
    expect(r).toEqual({ ok: true });
  });

  it('сетевой сбой fetch → {ok:false} с сообщением об ошибке', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));

    const r = await checkOcrSupport();
    expect(r.ok).toBe(false);
    expect(typeof r.error).toBe('string');
  });
});