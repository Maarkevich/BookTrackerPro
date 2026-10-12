// ═══════════════════════════════════════════════════════════════════
// 🔖 3.9.1 — ЭТАП 6: предпросмотр нормализованного результата (§7–§10).
//
// Доказываем РЕАЛЬНОЕ поведение openAiDataPreview с нормализованными
// данными (normalizeAiResult → toPreviewData):
//   — несколько цен → радио-выбор основной; выбираем вторую → в форму
//     попадает именно вторая цена (не первая);
//   — несколько обложек → галерея радио; вторая → в форму её URL;
//   — конфликты и предупреждения показываются пользователю (visibility);
//   — источники: подтверждённые (✅) и отклонённые по ISBN (⚠️) различимы.
// ═══════════════════════════════════════════════════════════════════
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openAiDataPreview } from '../app.js';
import { normalizeAiResult, toPreviewData } from '../normalize.js';

const ISBN13 = '9785170987658';
const ISBN13B = '9780306406157';

const FORM_IDS = [
  '#bf-title', '#bf-author', '#bf-isbn', '#bf-genre', '#bf-publisher', '#bf-year',
  '#bf-pages', '#bf-age', '#bf-desc', '#bf-series', '#bf-series-num', '#bf-series-total',
  '#bf-price', '#bf-currency', '#bf-cover',
];

function realForm() {
  document.body.innerHTML = FORM_IDS.map((id) => `<input id="${id.slice(1)}"/>`).join('');
}

function sampleResult() {
  return normalizeAiResult({
    book: { title: 'Книга', isbn: ISBN13 },
    priceCandidates: [
      { amount: 700, currency: 'RUB', type: 'paper', source: 'ЧГ', label: 'Печатная' },
      { amount: 300, currency: 'RUB', type: 'ebook', source: 'Литрес' },
    ],
    coverCandidates: [
      { url: 'https://cdn.example.com/a.jpg' },
      { url: 'https://cdn.example.com/b.jpg' },
    ],
    conflicts: [{ field: 'publisher', values: [{ value: 'Эксмо', source: 'eksmo.ru' }, { value: 'АСТ', source: 'ast.ru' }] }],
    warnings: ['Страница подгружается JavaScript'],
    sources: [
      { url: 'https://eksmo.ru/a', isbn: ISBN13 },
      { url: 'https://ast.ru/b', isbn: ISBN13B },
    ],
    confidence: 0.7,
  }, { now: '2026-10-12T00:00:00.000Z' });
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('openAiDataPreview с нормализованным результатом §7–§10', () => {
  it('несколько цен → радио; выбранная вторая цена применяется', async () => {
    realForm();
    const result = sampleResult();
    const data = toPreviewData(result, { queryIsbn: ISBN13 });
    const p = openAiDataPreview(document.body, data, { normalized: result });

    const overlay = document.querySelector('.overlay');
    const radios = overlay.querySelectorAll('.ai-prev-price-radio');
    expect(radios).toHaveLength(2);
    expect(overlay.querySelector('.ai-prev-check[data-prev-id="price"]')).toBeNull(); // нет дубля
    radios[1].checked = true;
    radios[0].checked = false;

    overlay.querySelector('#ai-prev-apply').click();
    await expect(p).resolves.toBe(true);
    expect(document.querySelector('#bf-price').value).toBe('300');
    expect(document.querySelector('#bf-currency').value).toBe('RUB');
  });

  it('несколько обложек → галерея; выбранная вторая обложка применяется', async () => {
    realForm();
    const result = sampleResult();
    const p = openAiDataPreview(document.body, toPreviewData(result), { normalized: result });

    const overlay = document.querySelector('.overlay');
    const covers = overlay.querySelectorAll('.ai-prev-cover-radio');
    expect(covers).toHaveLength(2);
    covers[1].checked = true;
    covers[0].checked = false;

    overlay.querySelector('#ai-prev-apply').click();
    await expect(p).resolves.toBe(true);
    expect(document.querySelector('#bf-cover').value).toBe('https://cdn.example.com/b.jpg');
  });

  it('показывает конфликты, предупреждения и подтверждение источников', () => {
    realForm();
    const result = sampleResult();
    openAiDataPreview(document.body, toPreviewData(result, { queryIsbn: ISBN13 }), { normalized: result });
    const overlay = document.querySelector('.overlay');
    expect(overlay.textContent).toContain('Расхождения источников');
    expect(overlay.textContent).toContain('publisher');
    expect(overlay.textContent).toContain('Предупреждения');
    expect(overlay.textContent).toContain('Страница подгружается JavaScript');
    expect(overlay.textContent).toContain('Источники (2)');
    // eksmo подтверждён ISBN (✅), ast — несовпадающий ISBN (⚠️)
    expect(overlay.textContent).toContain('✅');
    expect(overlay.textContent).toContain('⚠️');
    document.querySelector('.ai-prev-close').click();
  });

  it('обычный (legacy) ответ без новых блоков работает как раньше', async () => {
    realForm();
    const p = openAiDataPreview(document.body, { title: 'Т', author: 'А', priceAmount: 100, priceCurrency: 'RUB' });
    const overlay = document.querySelector('.overlay');
    expect(overlay.querySelectorAll('.ai-prev-price-radio')).toHaveLength(0);
    expect(overlay.querySelectorAll('.ai-prev-cover-radio')).toHaveLength(0);
    overlay.querySelector('#ai-prev-apply').click();
    await expect(p).resolves.toBe(true);
    expect(document.querySelector('#bf-title').value).toBe('Т');
    expect(document.querySelector('#bf-price').value).toBe('100');
  });
});
