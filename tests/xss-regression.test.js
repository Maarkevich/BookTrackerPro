// ═══════════════════════════════════════════════════════════════════
// Регрессионные тесты P1-1 (Stored XSS) — проверяют РЕАЛЬНЫЕ функции.
// Никаких копий логики: esc() из utils.js, render-функции из
// collections.js / series.js / content.js.
//
// + P1-2 (ссылки без allowlist схем): safeLinkUrl(), escAttr(),
//   ensureBookFields()/ensureContentItemFields() из db.js —
//   валидация URL на границе записи (форма, импорт, контент).
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
import { esc, safeUrl, safeLinkUrl, escAttr } from '../utils.js';
import { ensureBookFields, ensureContentItemFields } from '../db.js';
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

// ═══════════════════════════════════════════════════════════════════
// P1-2: ссылки пользователя без allowlist схем
// ═══════════════════════════════════════════════════════════════════

describe('P1-2: safeLinkUrl() — href-ссылки только http/https (utils.js)', () => {
  it('разрешает только https: и http:', () => {
    expect(safeLinkUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(safeLinkUrl('http://example.com/a')).toBe('http://example.com/a');
    expect(safeLinkUrl('HTTPS://example.com/a')).toBe('https://example.com/a');
  });

  it('блокирует javascript:/JAVASCRIPT:/data:/file:/custom:', () => {
    expect(safeLinkUrl('javascript:alert(1)')).toBe('');
    expect(safeLinkUrl('JAVASCRIPT:alert(1)')).toBe('');
    expect(safeLinkUrl('data:text/html,<script>alert(1)</script>')).toBe('');
    expect(safeLinkUrl('file:///etc/passwd')).toBe('');
    expect(safeLinkUrl('custom://x')).toBe('');
    expect(safeLinkUrl('vbscript:msgbox(1)')).toBe('');
  });

  it('блокирует blob: как пользовательскую ссылку (blob только для локальных обложек)', () => {
    expect(safeLinkUrl('blob:https://example.com/abc-123')).toBe('');
  });

  it('блокирует относительные и obfuscated-значения (напр. java\\tscript:)', () => {
    expect(safeLinkUrl('//example.com/x')).toBe('');
    expect(safeLinkUrl('/path')).toBe('');
    expect(safeLinkUrl('java\tscript:alert(1)')).toBe('');
    expect(safeLinkUrl('www.example.com')).toBe('');
  });

  it('нормализует пробелы и обрезает whitespace/перевод строки', () => {
    expect(safeLinkUrl('  https://example.com/a  ')).toBe('https://example.com/a');
    expect(safeLinkUrl('https://example.com/a\n')).toBe('https://example.com/a');
  });

  it('percent-кодирует кавычки (нет breakout из href-атрибута)', () => {
    const out = safeLinkUrl('https://example.com/x" onmouseover="alert(1)');
    expect(out).not.toContain('"');
    expect(out).toContain('%22');
  });

  it('возвращает \'\' для пустых/не-строковых значений', () => {
    expect(safeLinkUrl('')).toBe('');
    expect(safeLinkUrl(null)).toBe('');
    expect(safeLinkUrl(undefined)).toBe('');
    expect(safeLinkUrl(42)).toBe('');
  });
});

describe('P1-2: escAttr() — безопасное значение value="..." (utils.js)', () => {
  it('экранирует кавычки: нет breakout из value-атрибута', () => {
    const input = 'x" onfocus="alert(1)';
    const div = document.createElement('div');
    div.innerHTML = `<input value="${escAttr(input)}">`;
    expect(div.querySelector('input').getAttribute('value')).toBe(input);
    expect(div.querySelector('input[onfocus]')).toBeNull();
  });

  it('экранирует <, >, & и кавычки (текст сохраняется)', () => {
    const out = escAttr('a"b<c>&d');
    expect(out).not.toMatch(/[<>"]/);
    expect(out).toContain('&quot;');
    expect(out).toContain('&lt;');
    expect(out).toContain('&gt;');
  });
});

describe('P1-2: ensureBookFields() — валидация URL на границе записи (db.js)', () => {
  it('санитизирует cover/coverUrl/chatLink/contentItems[].publishedUrl', () => {
    const b = ensureBookFields({
      id: 'b1', title: 'Книга',
      cover: 'javascript:alert(1)',
      coverUrl: 'data:text/html,<script>alert(1)</script>',
      jointReading: { active: true, chatLink: 'JAVASCRIPT:alert(1)' },
      contentItems: [{ id: 'c1', publishedUrl: 'file:///etc/passwd' }],
    });
    expect(b.cover).toBe('');
    expect(b.coverUrl).toBe('');
    expect(b.jointReading.chatLink).toBe('');
    expect(b.contentItems[0].publishedUrl).toBe('');
  });

  it('сохраняет валидные https и blob для изображений (локальные обложки)', () => {
    const b = ensureBookFields({
      id: 'b2', title: 'Книга',
      cover: 'https://example.com/cover.jpg',
      coverUrl: 'blob:https://example.com/abc-123',
      jointReading: { active: true, chatLink: 'https://t.me/+abc' },
      contentItems: [{ id: 'c2', publishedUrl: 'https://youtube.com/watch?v=x' }],
    });
    expect(b.cover).toBe('https://example.com/cover.jpg');
    expect(b.coverUrl).toBe('blob:https://example.com/abc-123');
    expect(b.jointReading.chatLink).toBe('https://t.me/+abc');
    expect(b.contentItems[0].publishedUrl).toBe('https://youtube.com/watch?v=x');
  });

  it('идемпотентна: повторная санация не меняет результат', () => {
    const once = ensureBookFields({
      id: 'b3', title: 'Книга', coverUrl: 'javascript:evil()', jointReading: { active: true, chatLink: 'custom://x' },
    });
    const twice = ensureBookFields({ ...once, jointReading: { ...once.jointReading } });
    expect(twice.coverUrl).toBe('');
    expect(twice.jointReading.chatLink).toBe('');
  });
});

describe('P1-2: ensureContentItemFields() — publishedUrl при записи контента (db.js)', () => {
  it('блокирует javascript:/data:/custom:', () => {
    expect(ensureContentItemFields({ publishedUrl: 'javascript:alert(1)' }).publishedUrl).toBe('');
    expect(ensureContentItemFields({ publishedUrl: 'data:text/html,<script>x</script>' }).publishedUrl).toBe('');
    expect(ensureContentItemFields({ publishedUrl: 'custom://x' }).publishedUrl).toBe('');
  });

  it('сохраняет валидный https', () => {
    expect(ensureContentItemFields({ publishedUrl: 'https://vk.com/wall-1' }).publishedUrl)
      .toBe('https://vk.com/wall-1');
  });
});

describe('P1-2: renderCollectionDetail — coverUrl matrix (collections.js)', () => {
  function renderWithCover(coverUrl) {
    const container = document.createElement('div');
    const collection = { id: 'c1', name: 'Коллекция', emoji: 'x', bookIds: ['b1'] };
    const books = [{ id: 'b1', title: 'Книга', author: 'A', coverUrl }];
    renderCollectionDetail(container, collection, books, { onBack: noop, onEdit: noop });
    return container;
  }

  it('javascript:/data:/file: coverUrl → нет опасного src', () => {
    for (const bad of ['javascript:alert(1)', 'data:image/svg+xml,<svg onload=alert(1)>', 'file:///x.jpg']) {
      const c = renderWithCover(bad);
      expect(c.querySelector('img[src^="javascript:"]')).toBeNull();
      expect(c.querySelector('img[src^="data:"]')).toBeNull();
      expect(c.querySelector('img[onerror]')).toBeNull();
    }
  });

  it('https:/http:/blob: coverUrl → img создаётся', () => {
    for (const good of ['https://example.com/c.jpg', 'http://example.com/c.jpg', 'blob:https://example.com/abc-123']) {
      const c = renderWithCover(good);
      expect(c.querySelector('img')).not.toBeNull();
    }
  });
});