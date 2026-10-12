// ═══════════════════════════════════════════════════════════════════
// 🔖 3.9.1 — ЭТАП 7: AI-отзыв с плюсами и минусами (§12).
//
// Доказываем РЕАЛЬНОЕ поведение (без моков логики):
//   — normalizeAiReview: JSON-схема {text,pros,cons,recommendation,rating},
//     markdown-фенс, мусор → пустая структура, клип rating 1..5,
//     нормализация рекомендации к одной из трёх допустимых строк;
//   — aiReviewPreviewHtml: раздельные чекбоксы частей; ОЦЕНКА по умолчанию
//     ОТКЛЮЧЕНА (§12), остальные включены;
//   — readAiReviewChosen: снимает выбор пользователя из DOM;
//   — buildReviewWithAi: применяет ТОЛЬКО отмеченные части, не трогая
//     цитаты/«для кого»/без спойлеров; неотмеченная оценка не меняется;
//     пустые поля AI не затирают уже введённые значения.
// ═══════════════════════════════════════════════════════════════════
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  normalizeAiReview,
  aiReviewPreviewHtml,
  readAiReviewChosen,
  buildReviewWithAi,
  AI_REVIEW_SYSTEM,
} from '../app.js';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('normalizeAiReview', () => {
  it('разбирает JSON-ответ AI об отзыве', () => {
    const ai = normalizeAiReview(JSON.stringify({
      text: 'Развёрнутый отзыв', pros: 'язык, сюжет', cons: 'затянуто',
      recommendation: 'Да, рекомендую', rating: 5,
    }));
    expect(ai).toEqual({
      text: 'Развёрнутый отзыв', pros: 'язык, сюжет', cons: 'затянуто',
      recommendation: 'Да, рекомендую', rating: 5,
    });
  });

  it('снимает markdown-ограждение ```json', () => {
    const ai = normalizeAiReview('```json\n{"text":"T","rating":4}\n```');
    expect(ai.text).toBe('T');
    expect(ai.rating).toBe(4);
  });

  it('нормализует свободную рекомендацию к одной из трёх строк', () => {
    expect(normalizeAiReview({ recommendation: 'нет, не рекомендую' }).recommendation).toBe('Нет, не рекомендую');
    expect(normalizeAiReview({ recommendation: 'С оговорками' }).recommendation).toBe('С оговорками');
    expect(normalizeAiReview({ recommendation: 'Рекомендую!' }).recommendation).toBe('Да, рекомендую');
    expect(normalizeAiReview({ recommendation: 'что-то' }).recommendation).toBe('');
  });

  it('клипует оценку к диапазону 0..5 и не бросает на мусоре', () => {
    expect(normalizeAiReview({ rating: 9 }).rating).toBe(5);
    expect(normalizeAiReview({ rating: -3 }).rating).toBe(0);
    expect(normalizeAiReview({ rating: 'нет' }).rating).toBe(0);
    expect(normalizeAiReview('не json').text).toBe('');
    expect(normalizeAiReview(null)).toEqual({ text: '', pros: '', cons: '', recommendation: '', rating: 0 });
  });
});

describe('aiReviewPreviewHtml + readAiReviewChosen', () => {
  it('рендерит раздельные чекбоксы частей; оценка по умолчанию ВЫКЛЮЧЕНА', () => {
    const ai = normalizeAiReview({ text: 'T', pros: 'P', cons: 'C', recommendation: 'С оговорками', rating: 4 });
    document.body.innerHTML = aiReviewPreviewHtml(ai);

    const checks = [...document.querySelectorAll('.ai-rv-check')];
    const byId = Object.fromEntries(checks.map(c => [c.dataset.rv, c.checked]));
    expect(Object.keys(byId).sort()).toEqual(['cons', 'pros', 'rating', 'recommendation', 'text']);
    expect(byId.rating).toBe(false);
    expect(byId.text).toBe(true);
    expect(byId.pros).toBe(true);
    expect(byId.cons).toBe(true);
    expect(byId.recommendation).toBe(true);

    // readAiReviewChosen отражает текущее состояние
    expect(readAiReviewChosen(document.body).rating).toBe(false);

    // явный выбор оценки пользователем
    document.querySelector('.ai-rv-check[data-rv="rating"]').checked = true;
    expect(readAiReviewChosen(document.body).rating).toBe(true);
  });

  it('экранирует текст ответа (XSS-контракт)', () => {
    document.body.innerHTML = aiReviewPreviewHtml({ text: '<img src=x onerror=alert(1)>' });
    expect(document.querySelector('.ai-rv-row img')).toBeNull();
    expect(document.body.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('buildReviewWithAi (раздельное применение §12)', () => {
  const existing = {
    text: 'старый текст', pros: 'старые плюсы', cons: 'старые минусы',
    rating: 3, recommendation: 'С оговорками',
    quotes: [{ text: 'Q', page: 10 }], targetAudience: 'для всех', spoilerFree: false,
    createdAt: '2020-01-01T00:00:00.000Z',
  };
  const ai = { text: 'новый текст', pros: 'новые плюсы', cons: 'новые минусы', recommendation: 'Да, рекомендую', rating: 5 };

  it('оценка НЕ меняется без явного выбора, остальные части применяются', () => {
    const out = buildReviewWithAi(existing, ai, { text: true, pros: true, cons: true, recommendation: true, rating: false });
    expect(out.text).toBe('новый текст');
    expect(out.pros).toBe('новые плюсы');
    expect(out.cons).toBe('новые минусы');
    expect(out.recommendation).toBe('Да, рекомендую');
    expect(out.rating).toBe(3); // не тронута
    // прочие поля сохранены
    expect(out.quotes).toEqual([{ text: 'Q', page: 10 }]);
    expect(out.targetAudience).toBe('для всех');
    expect(out.spoilerFree).toBe(false);
    expect(out.createdAt).toBe('2020-01-01T00:00:00.000Z');
    expect(out.updatedAt).toBeTruthy();
  });

  it('только выбранная оценка применяется, текст остаётся старым', () => {
    const out = buildReviewWithAi(existing, ai, { rating: true });
    expect(out.rating).toBe(5);
    expect(out.text).toBe('старый текст');
    expect(out.pros).toBe('старые плюсы');
    expect(out.recommendation).toBe('С оговорками');
  });

  it('пустые поля AI не затирают уже введённые значения (контракт не сломан)', () => {
    const emptyAi = { text: '', pros: '', cons: '', recommendation: '', rating: 0 };
    const out = buildReviewWithAi(existing, emptyAi, { text: true, pros: true, cons: true, recommendation: true, rating: true });
    expect(out.text).toBe('старый текст');
    expect(out.pros).toBe('старые плюсы');
    expect(out.rating).toBe(3);
  });
});

describe('AI_REVIEW_SYSTEM (контракт схемы §12)', () => {
  it('требует раздельные text/pros/cons/recommendation/rating без markdown', () => {
    for (const key of ['"text"', '"pros"', '"cons"', '"recommendation"', '"rating"']) {
      expect(AI_REVIEW_SYSTEM).toContain(key);
    }
    expect(AI_REVIEW_SYSTEM).toContain('markdown');
    expect(AI_REVIEW_SYSTEM).toContain('Да, рекомендую');
    expect(AI_REVIEW_SYSTEM).toContain('Нет, не рекомендую');
    expect(AI_REVIEW_SYSTEM).toContain('С оговорками');
  });
});
