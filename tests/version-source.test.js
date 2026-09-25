// @vitest-environment node
// 🧪 P3-4 — Устаревший version.js удалён, version.json — единственный
// активный источник версии и cache name.
//
// Что доказывают тесты:
//   — version.js физически ОТСУТСТВУЕТ (артефакт v3.8.0 удалён);
//   — version.json существует, валиден как JSON и несёт version/cache;
//   — активный код (app.js, sw-register.js, sw.js) ссылается ТОЛЬКО
//     на version.json, ни один модуль import graph не ссылается
//     на version.js;
//   — sw.js: version.json обрабатывается отдельным route (network-first),
//     в app shell / precache version.js больше нет.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const exists = (rel) => existsSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)));

const IMPORT_GRAPH = [
  'app.js', 'index.html', 'sw.js', 'db.js', 'uikit.js', 'utils.js', 'icons.js',
  'isbn.js', 'scanner.js', 'microlink.js', 'ocr.js', 'content.js', 'review.js',
  'stats.js', 'collections.js', 'challenges.js', 'series.js', 'sw-register.js',
  'version.js', 'search.js', 'button.js',
];

describe('P3-4: version.js удалён, version.json — источник истины', () => {
  it('version.js физически отсутствует (устаревший артефакт v3.8.0)', () => {
    expect(exists('version.js')).toBe(false);
    expect(exists('search.js')).toBe(false);
  });

  it('version.json существует и содержит валидный JSON с полями version/cache', () => {
    expect(exists('version.json')).toBe(true);
    const meta = JSON.parse(read('version.json'));
    expect(typeof meta.version).toBe('string');
    expect(typeof meta.cache).toBe('string');
    expect(meta.version).not.toBe('3.8.0'); // не устаревшая v3.8.0 из version.js
  });

  it('активный код использует только version.json (app.js, sw-register.js, sw.js)', () => {
    const app = read('app.js');
    const swreg = read('sw-register.js');
    const sw = read('sw.js');
    expect(app).toContain("fetch('version.json')");
    expect(swreg).toContain('version.json');
    expect(sw).toContain('version.json');
    for (const src of [app, swreg, sw]) {
      // 'version.js' — префикс 'version.json'; файл version.js ищем по границе слова
      expect(src).not.toMatch(/version\.js(?!on)/);
    }
  });

  it('sw.js: version.json — сетевой route, в app shell нет version.js', () => {
    const sw = read('sw.js');
    expect(sw).not.toMatch(/version\.js(?!on)/);
    expect(sw).toMatch(/endsWith\('version\.json'\)/);
  });

  it('ни один файл import graph не ссылается на version.js', () => {
    for (const f of IMPORT_GRAPH) {
      if (!exists(f)) continue;
      const src = read(f);
      expect(src, `${f} не должен ссылаться на version.js`).not.toMatch(/version\.js(?!on)/);
    }
  });
});