// ═══════════════════════════════════════════════════════════════════
// Регрессионные тесты P1-14 — «ZXing fallback не работает из-за
// CDN URL/CSP/offline».
//
// Оригинальная проблема (до фикса):
//   scanner.js loadZXing():
//     const CDNS = [
//       'https://unpkg.com/zxing-wasm@1.2.12/dist/reader/zxing_reader.js',
//       'https://cdn.jsdelivr.net/npm/zxing-wasm@1.2.12/dist/reader/zxing_reader.js',
//     ];
//     const module = await import(/* webpackIgnore: true */ url);
//   1) CSP index.html: script-src 'self' — динамический import() remote
//      ES module БЛОКИРУЕТСЯ (unpkg/jsDelivr числились только в
//      connect-src, что не разрешает загрузку script module);
//   2) в пакете zxing-wasm@1.2.12 НЕ СУЩЕСТВУЕТ файла
//      dist/reader/zxing_reader.js — ES-сборка живёт в
//      dist/es/reader/index.js (+ dist/es/core-DnsuMG85.js + wasm);
//   3) CDN-реализация не давала гарантированного offline.
//   → в Safari/Firefox автосканирование всегда деградировало до ручного.
//
// Что доказывают тесты (контракты после фикса):
//   — scanner.js больше НЕ содержит unpkg/jsDelivr dynamic import;
//   — loadZXing() импортирует ЛОКАЛЬНЫЙ self-URL (/BookTrackerPro/zxing/...);
//   — локальные файлы пакета реально существуют на диске (js, core, wasm)
//     с размерами фиксированной версии @1.2.12;
//   — scanner.js вызывает setZXingModuleOverrides с ЛОКАЛЬНЫМ wasm-путём
//     (не fastly.jsdelivr.net default ядра);
//   - CSP index.html: unpkg/jsDelivr убраны из connect-src, script-src
//     остаётся 'self' (никаких CDN script-src);
//   — sw.js precache содержит все 3 локальных ZXing-файла
//     (контроль «включены в контролируемый cache»);
//   — локальный index.js ссылается только на ../core-DnsuMG85.js.
// ═══════════════════════════════════════════════════════════════════
// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');

const SCANNER_JS = read('scanner.js');
const INDEX_HTML = read('index.html');
const SW_JS = read('sw.js');
const ZX_INDEX = read('zxing/dist/es/reader/index.js');

describe('P1-14: ZXing fallback локализован (self + precache, без CDN)', () => {
  it('scanner.js НЕ содержит remote CDN import (unpkg/jsDelivr)', () => {
    expect(SCANNER_JS).not.toMatch(/import\s*\(\s*['"`]https:\/\/(unpkg|cdn\.jsdelivr)/);
    expect(SCANNER_JS).not.toMatch(/unpkg\.com/);
    expect(SCANNER_JS).not.toMatch(/cdn\.jsdelivr\.net/);
  });

  it('loadZXing() импортирует ЛОКАЛЬНЫЙ self-URL под /BookTrackerPro/zxing/', () => {
    expect(SCANNER_JS).toMatch(/const\s+ZXING_ENTRY\s*=\s*`\$\{BASE\}\/zxing\/dist\/es\/reader\/index\.js`/);
    expect(SCANNER_JS).toMatch(/await\s+import\(\/\* webpackIgnore: true \*\/\s*ZXING_ENTRY\)/);
    expect(SCANNER_JS).toMatch(/\/BookTrackerPro\/zxing\/dist\/es\/reader\/index\.js/);
  });

  it('locateFile переопределён на ЛОКАЛЬНЫЙ wasm-путь (не fastly CDN default)', () => {
    expect(SCANNER_JS).toMatch(/setZXingModuleOverrides/);
    expect(SCANNER_JS).toMatch(/locateFile/);
    expect(SCANNER_JS).toMatch(/zxing\/dist\/reader\//);
    expect(SCANNER_JS).not.toMatch(/fastly\.jsdelivr\.net/);
    expect(SCANNER_JS).not.toMatch(/zxing_reader\.wasm.*fastly/);
  });

  it('локальные файлы @1.2.12 существуют с ожидаемыми размерами', () => {
    const sizes = {
      'zxing/dist/es/reader/index.js': 51802,
      'zxing/dist/es/core-DnsuMG85.js': 4798,
      'zxing/dist/reader/zxing_reader.wasm': 843343,
    };
    for (const [file, expected] of Object.entries(sizes)) {
      const stats = require('node:fs').statSync(path.join(ROOT, file));
      expect(stats.size, `${file} должен существовать`).toBe(expected);
    }
  });

  it('локализованный index.js импортирует ядро только как ../core-DnsuMG85.js', () => {
    const imports = [...ZX_INDEX.matchAll(/from\s+"([^"]+)"/g)].map(m => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.every(i => i === '../core-DnsuMG85.js')).toBe(true);
  });

  it('CSP: unpkg/jsDelivr убраны из connect-src; script-src остаётся self', () => {
    const csp = (INDEX_HTML.match(/Content-Security-Policy[^>]*content="([^"]+)"/) || [])[1];
    expect(csp).toBeTruthy();
    expect(csp).toMatch(/script-src 'self'/);
    expect(csp).not.toMatch(/script-src[^;]*https:\/\/unpkg/);
    expect(csp).not.toMatch(/script-src[^;]*jsdelivr/);
    expect(csp).not.toMatch(/https:\/\/unpkg\.com/);
    expect(csp).not.toMatch(/https:\/\/cdn\.jsdelivr\.net/);
  });

  it('sw.js precache содержит все 3 локальных ZXing-файла', () => {
    expect(SW_JS).toMatch(/`\$\{BASE\}\/zxing\/dist\/es\/reader\/index\.js`/);
    expect(SW_JS).toMatch(/`\$\{BASE\}\/zxing\/dist\/es\/core-DnsuMG85\.js`/);
    expect(SW_JS).toMatch(/`\$\{BASE\}\/zxing\/dist\/reader\/zxing_reader\.wasm`/);
    // Файлы внутри SHELL_ASSETS (прекэш при инсталляции)
    const m = SW_JS.match(/const\s+SHELL_ASSETS\s*=\s*\[\s*([\s\S]*?)\s*\];/);
    expect(m).not.toBeNull();
    const shell = m[1];
    expect(shell).toMatch(/zxing\/dist\/es\/reader\/index\.js/);
    expect(shell).toMatch(/zxing\/dist\/es\/core-DnsuMG85\.js/);
    expect(shell).toMatch(/zxing\/dist\/reader\/zxing_reader\.wasm/);
  });

  it('wasm-файл валиден: заголовок модуля WebAssembly (\\0asm)', () => {
    const buf = require('node:fs').readFileSync(path.join(ROOT, 'zxing/dist/reader/zxing_reader.wasm'));
    expect(buf[0]).toBe(0x00);
    expect(buf[1]).toBe(0x61); // 'a'
    expect(buf[2]).toBe(0x73); // 's'
    expect(buf[3]).toBe(0x6d); // 'm'
  });
});