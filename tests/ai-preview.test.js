// ═══════════════════════════════════════════════════════════════════
// 🔖 3.8.8 — прозрачное AI-превью, обложки и схема извлечения (app.js).
//
// Что доказывают тесты (РЕАЛЬНАЯ симуляция, без моков логики):
//   — openAiDataPreview: рендерит оверлей «Ответ AI — что применить»,
//     чекбоксы полей; «Применить выбранное» заполняет форму ТОЛЬКО
//     отмеченными полями (серия/обложка выключены → не применяются),
//     показывается «сырой» ответ AI; отмена не меняет форму;
//   — fallbackCover: если модель не вернула coverUrl, превью предлагает
//     обложку из результата поиска (thumbnail) и применяет её;
//   — fillFormFromAi: применение селективно (chosen) + серия (название/
//     номер/всего) + цена с валютой;
//   — attachAiCover (фикс обложек v3.8.8): если CDN блокирует CORS
//     (fetch бросает — как при hotlink-защите Google Books/Litres),
//     у книги остаётся http(s)-фолбэк book.coverUrl/book.cover — обложка
//     показывается через <img referrerpolicy="no-referrer"> и попадает
//     в бэкап (паттерн P1-3), а не теряется молча;
//   — контракт схемы: AI_BOOK_FIELDS_SYSTEM требует максимум полей —
//     серия (номер/всего), цена с валютой, возраст, теги, обложка.
// ═══════════════════════════════════════════════════════════════════
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  openAiDataPreview,
  fillFormFromAi,
  attachAiCover,
  AI_BOOK_FIELDS_SYSTEM,
} from '../app.js';

const FORM_IDS = [
  '#bf-title', '#bf-author', '#bf-isbn', '#bf-genre', '#bf-publisher', '#bf-year',
  '#bf-pages', '#bf-age', '#bf-desc', '#bf-series', '#bf-series-num', '#bf-series-total',
  '#bf-price', '#bf-currency', '#bf-cover',
];

function realForm() {
  document.body.innerHTML = FORM_IDS.map(id => `<input id="${id.slice(1)}"/>`).join('');
  return document.body;
}

function fakeForm() {
  const els = new Map(FORM_IDS.map(id => [id, { value: '' }]));
  return {
    els,
    querySelector(sel) { return els.get(sel) || null; },
  };
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('openAiDataPreview (прозрачное окно ответа AI)', () => {
  it('применяет ТОЛЬКО отмеченные поля; выключенные серия/обложка не трогаются', async () => {
    const fb = realForm();
    const p = openAiDataPreview(fb, {
      title: 'Мастер и Маргарита',
      author: 'Булгаков',
      genre: 'Роман',
      series: 'Серия X',
      seriesNumber: 2,
      seriesTotal: 5,
      priceAmount: 599,
      priceCurrency: 'RUB',
      coverUrl: 'https://cdn.example.com/mim.jpg',
    });
    const overlay = document.querySelector('.overlay');
    expect(overlay).toBeTruthy();
    expect(overlay.textContent).toContain('Ответ AI — что применить');

    overlay.querySelectorAll('.ai-prev-check').forEach(cb => {
      if (cb.dataset.prevId === 'series' || cb.dataset.prevId === 'cover') cb.checked = false;
    });
    overlay.querySelector('#ai-prev-apply').click();
    await expect(p).resolves.toBe(true);

    expect(document.querySelector('#bf-title').value).toBe('Мастер и Маргарита');
    expect(document.querySelector('#bf-author').value).toBe('Булгаков');
    expect(document.querySelector('#bf-genre').value).toBe('Роман');
    expect(document.querySelector('#bf-price').value).toBe('599');
    expect(document.querySelector('#bf-currency').value).toBe('RUB');
    expect(document.querySelector('#bf-series').value).toBe('');
    expect(document.querySelector('#bf-series-num').value).toBe('');
    expect(document.querySelector('#bf-cover').value).toBe('');
  });

  it('fallbackCover: обложка из результата поиска, когда модель не дала coverUrl', async () => {
    const fb = realForm();
    const p = openAiDataPreview(fb, { title: 'Т', author: 'А' }, { fallbackCover: 'https://cdn.example.com/thumb.jpg' });
    const overlay = document.querySelector('.overlay');
    expect(overlay.querySelector('.ai-prev-check[data-prev-id="cover"]')).toBeTruthy();
    overlay.querySelector('#ai-prev-apply').click();
    await expect(p).resolves.toBe(true);
    expect(document.querySelector('#bf-cover').value).toBe('https://cdn.example.com/thumb.jpg');
  });

  it('отмена (Esc-кнопка) не изменяет форму и resolve(false)', async () => {
    const fb = realForm();
    const p = openAiDataPreview(fb, { title: 'Т' });
    document.querySelector('#ai-prev-cancel').click();
    await expect(p).resolves.toBe(false);
    expect(document.querySelector('#bf-title').value).toBe('');
  });

  it('показывает «сырой» ответ AI (JSON модели)', async () => {
    const p = openAiDataPreview(realForm(), { title: 'Тест', author: 'Кто-то' });
    const raw = document.querySelector('.overlay details pre');
    expect(raw).toBeTruthy();
    expect(raw.textContent).toContain('"author"');
    expect(raw.textContent).toContain('Кто-то');
    document.querySelector('.ai-prev-close').click();
    await expect(p).resolves.toBe(false);
  });
});

describe('fillFormFromAi (селективное применение)', () => {
  it('chosen ограничивает поля; серия включает номер и «всего в серии»', () => {
    const fb = fakeForm();
    fillFormFromAi(fb, {
      title: 'Т', author: 'А', genre: 'Р',
      series: 'X', seriesNumber: 3, seriesTotal: 7,
      priceAmount: 499, priceCurrency: 'EUR',
      publishedDate: '1999',
    }, { chosen: { title: true, series: true, price: true } });

    expect(fb.els.get('#bf-title').value).toBe('Т');
    expect(fb.els.get('#bf-author').value).toBe('');
    expect(fb.els.get('#bf-genre').value).toBe('');
    expect(fb.els.get('#bf-publishedDate')?.value).toBeUndefined();
    expect(fb.els.get('#bf-series').value).toBe('X');
    expect(String(fb.els.get('#bf-series-num').value)).toBe('3');
    expect(String(fb.els.get('#bf-series-total').value)).toBe('7');
    expect(String(fb.els.get('#bf-price').value)).toBe('499');
    expect(fb.els.get('#bf-currency').value).toBe('EUR');
  });

  it('opts.cover применяется отдельным чекбоксом обложки', () => {
    const fb = fakeForm();
    fillFormFromAi(fb, { title: 'Т' }, { chosen: { cover: true }, cover: 'https://x/c.jpg' });
    expect(fb.els.get('#bf-cover').value).toBe('https://x/c.jpg');
  });
});

describe('attachAiCover (фикс обложек при CORS-блокировке)', () => {
  it('fetch бросает (CDN не отдаёт CORS) → остаётся http(s)-фолбэк в book.cover/coverUrl', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    const book = { id: 'bk-cors', cover: '', coverUrl: '' };
    await attachAiCover(book, 'https://cdn.example.com/cover.jpg');
    // Контракт: обложка НЕ теряется молча — ссылка сохраняется и как
    // экранный URL, и как fallback в бэкапе (P1-3).
    expect(book.coverUrl).toBe('https://cdn.example.com/cover.jpg');
    expect(book.cover).toBe('https://cdn.example.com/cover.jpg');
  });

  it('не-http(s) значение и пустой URL не трогают книгу', async () => {
    const book = { id: 'bk-x', cover: '', coverUrl: '' };
    await attachAiCover(book, '');
    expect(book.coverUrl).toBe('');
    const book2 = { id: 'bk-x2', cover: '', coverUrl: '' };
    await attachAiCover(book2, 'javascript:alert(1)');
    expect(book2.coverUrl).toBe('');
  });
});

describe('AI_BOOK_FIELDS_SYSTEM (контракт схемы извлечения)', () => {
  it('требует максимум полей: серия (номер/всего), цена с валютой, возраст, теги, обложка', () => {
    const schemaKeys = [
      '"title"', '"author"', '"isbn"', '"genre"', '"publisher"', '"publishedDate"',
      '"pageCount"', '"ageRating"', '"description"', '"series"', '"seriesNumber"',
      '"seriesTotal"', '"priceAmount"', '"priceCurrency"', '"coverUrl"', '"tags"',
    ];
    for (const key of schemaKeys) {
      expect(AI_BOOK_FIELDS_SYSTEM).toContain(key);
    }
    // Запрет выдумывания — залог того, что пустые поля останутся пустыми.
    expect(AI_BOOK_FIELDS_SYSTEM).toContain('ничего не выдумывай');
  });
});