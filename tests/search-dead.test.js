// ═══════════════════════════════════════════════════════════════
//  P2-6: Two divergent search implementations/dead search.js
//  Было две расходящиеся реализации: активный поиск в app.js и
//  самостоятельный модуль search.js, который нигде не импортируется
//  и не подключается (мёртвый код).
//
//  Решение (AUDIT.md): app.js выбран источником истины, search.js
//  удалён. Тест доказывает, что:
//   1) search.js физически отсутствует;
//   2) на него нет ссылок в import graph (index.html, sw.js, модули);
//   3) активная реализация matchesBook() остаётся рабочей точкой входа.
// ═══════════════════════════════════════════════════════════════
// @vitest-environment jsdom

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { matchesBook } from '../app.js';

function read(rel) {
  return readFileSync(fileURLToPath(new URL('../' + rel, import.meta.url)), 'utf8');
}

function exists(rel) {
  return existsSync(fileURLToPath(new URL('../' + rel, import.meta.url)));
}

// Единственная активная реализация поиска — app.js (одна точка правды).
const MODULES = [
  'app.js',
  'index.html',
  'sw.js',
  'db.js',
  'isbn.js',
  'scanner.js',
  'microlink.js',
  'button.js',
  'utils.js',
];

describe('P2-6: мёртвый search.js удалён, active search — единственная реализация', () => {
  it('search.js больше не существует в проекте', () => {
    expect(exists('search.js')).toBe(false);
  });

  it('на search.js нет ссылок в import graph (модули, html, sw)', () => {
    for (const mod of MODULES) {
      if (!exists(mod)) continue; // нет такого модуля — тоже ок
      const src = read(mod);
      expect(src, `${mod} не должен ссылаться на search.js`).not.toMatch(/search\.js(?!on)/);
    }
  });

  it('index.html использует активные DOM-элементы поиска (не search.js)', () => {
    const html = read('index.html');
    expect(html).toContain('id="search-toggle"');
    expect(html).toContain('id="search-input"');
    expect(html).toContain('id="search-results"');
    // search.js не подключается скриптом
    expect(html).not.toMatch(/script[^>]*search\.js/);
  });

  it('sw.js app shell не содержит search.js', () => {
    const sw = read('sw.js');
    expect(sw).not.toContain('search.js');
  });

  it('активная реализация matchesBook() работает (контракт не сломан)', () => {
    const book = {
      title: 'Тёмная башня',
      author: 'Стивен Кинг',
      isbn: '9785170987658',
      genre: 'Фэнтези',
      publisher: 'АСТ',
      series: '',
      tags: ['финал'],
      tropes: ['slow burn'],
    };
    expect(matchesBook(book, 'тёмная')).toBe(true);
    expect(matchesBook(book, 'кинг')).toBe(true);
    expect(matchesBook(book, '978-5-17-098765-8')).toBe(true);
    expect(matchesBook(book, 'slow burn')).toBe(true);
    expect(matchesBook(book, 'несуществующий текст')).toBe(false);
  });

  it('search query нормализуется в lowercase перед matchesBook (поток app.js)', () => {
    // app.js: S.searchQuery = DOM.searchInput.value.trim().toLowerCase()
    const book = { title: 'Тёмная Башня', author: '', isbn: '', genre: '', publisher: '', series: '', tags: [], tropes: [] };
    expect(matchesBook(book, 'тёмная башня'.toLowerCase())).toBe(true);
  });
});