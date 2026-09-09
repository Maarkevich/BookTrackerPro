// ═══════════════════════════════════════════════════════════════════
// Регрессионные тесты P1-1 (Stored XSS) — проверяют РЕАЛЬНЫЕ функции.
// Никаких копий логики: esc() из utils.js, render-функции из
// collections.js / series.js / content.js.
//
// Статус на момент написания:
//  - тесты esc() (текстовый контекст)   → должны ПРОХОДИТЬ;
//  - тесты coverUrl (src) и publishedUrl (href)
//    → ОЖИДАЕМО ПАДАЮТ: фиксируют существующие уязвимости
//    (сырой src, атрибутный breakout через кавычки, javascript: URL).
//
// Исправление продакшн-кода выполняется СЛЕДУЮЩИМ этапом.
// ═══════════════════════════════════════════════════════════════════
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { esc, safeUrl } from '../utils.js';
import { renderCollectionDetail } from '../collections.js';
import { renderSeriesDetail } from '../series.js';
import { renderContentTab } from '../content.js';

// Минимальные вредоносные значения (по заданию)
const SCRIPT_PAYLOAD = '<script>alert(1)</script>';
const IMG_PAYLOAD = '<img src=x onerror=alert(1)>';
// Атрибутный breakout в контексте src="..." — хранится в coverUrl
const ATTR_BREAKOUT_COVER = 'https://example.com/x" onerror="alert(1)';
// Схема javascript: в контексте href="..." — хранится в publishedUrl
const JS_URL = 'javascript:alert(1)';

const noop = () => {};

describe('P1-1: esc() — текстовый контекст безопасен (utils.js)', () => {
  it('<script>alert(1)</script> экранируется: элемент script не создаётся', () => {
    const div = document.createElement('div');
    div.innerHTML = esc(SCRIPT_PAYLOAD);
    expect(div.querySelector('script')).toBeNull();
    expect(div.textContent).toBe(SCRIPT_PAYLOAD);
  });

  it('<img src=x onerror=alert(1)> экранируется: элемент img не создаётся', () => {
    const div = document.createElement('div');
    div.innerHTML = esc(IMG_PAYLOAD);
    expect(div.querySelector('img')).toBeNull();
    expect(div.textContent).toBe(IMG_PAYLOAD);
  });
});

describe('P1-1: renderCollectionDetail — coverUrl в src (collections.js)', () => {
  it('Название книги с payload не создаёт исполняемый HTML (esc покрывает title)', () => {
    const container = document.createElement('div');
    const collection = { id: 'c1', name: 'Коллекция', emoji: 'x', bookIds: ['b1'] };
    const books = [{ id: 'b1', title: IMG_PAYLOAD, author: 'A', coverUrl: '' }];
    renderCollectionDetail(container, collection, books, { onBack: noop, onEdit: noop });

    expect(container.querySelector('img[onerror]')).toBeNull();
    expect(container.textContent).toContain(IMG_PAYLOAD);
  });

  it('coverUrl с "onerror=" не должен создавать onerror-атрибут (регрессия P1-1)', () => {
    const container = document.createElement('div');
    const collection = { id: 'c1', name: 'Коллекция', emoji: 'x', bookIds: ['b1'] };
    const books = [{ id: 'b1', title: 'Книга', author: 'A', coverUrl: ATTR_BREAKOUT_COVER }];
    renderCollectionDetail(container, collection, books, { onBack: noop, onEdit: noop });

    expect(container.querySelector('img[onerror]')).toBeNull();
  });
});

describe('P1-1: renderSeriesDetail — coverUrl в src (series.js)', () => {
  it('coverUrl с "onerror=" не должен создавать onerror-атрибут (регрессия P1-1)', () => {
    const container = document.createElement('div');
    const books = [{
      id: 'b1', title: 'Книга', author: 'A', series: 'Сага', seriesNumber: 1,
      coverUrl: ATTR_BREAKOUT_COVER, status: 'want',
    }];
    renderSeriesDetail(container, 'Сага', books, { onBack: noop, onAddBook: noop });

    expect(container.querySelector('img[onerror]')).toBeNull();
  });
});

describe('P1-1: publishedUrl — схема javascript: в href (content.js)', () => {
  it('publishedUrl со схемой javascript: не должен создавать a[href^="javascript:"] (регрессия P1-1)', () => {
    const container = document.createElement('div');
    const books = [{
      id: 'b1', title: 'Книга', author: 'A', coverUrl: '',
      contentItems: [{
        id: 'ci1', type: 'review', status: 'published',
        platform: 'youtube', publishedUrl: JS_URL, plannedDate: '2026-01-01',
      }],
    }];
    renderContentTab(container, books, {}, {
      onAdd: noop, onEdit: noop, onStatusChange: noop, onDelete: noop,
    });

    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
  });
});

describe('P1-1: safeUrl() — allowlist схем (utils.js)', () => {
  it('блокирует javascript:', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('');
  });

  it('блокирует data: и vbscript:', () => {
    expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBe('');
    expect(safeUrl('vbscript:msgbox(1)')).toBe('');
  });

  it('блокирует невалидные и пустые значения', () => {
    expect(safeUrl('')).toBe('');
    expect(safeUrl(null)).toBe('');
    expect(safeUrl('x" onerror="alert(1)')).toBe('');
  });

  it('разрешает https:/http:/blob:', () => {
    expect(safeUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(safeUrl('http://example.com/a')).toBe('http://example.com/a');
    expect(safeUrl('blob:https://example.com/abc-123')).toBe('blob:https://example.com/abc-123');
  });

  it('percent-кодирует кавычки/пробелы (нет breakout из атрибута)', () => {
    const out = safeUrl(ATTR_BREAKOUT_COVER);
    expect(out).not.toContain('"');
    expect(out).toContain('%22');
  });
});