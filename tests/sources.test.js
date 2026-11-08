// ═══════════════════════════════════════════════════════════════════
// 🔖 3.9.4 — SOURCE REGISTRY (sources.js).
//
// Что доказывают тесты:
//   — реестр содержит все 9 книжных доменов спецификации и совпадает с
//     ALLOWED_DOMAINS Worker (единый источник истины, без рассинхрона);
//   — домен матчится точно и как поддомен (cdn.litres.ru), но не как
//     суффикс чужого домена (litres.ru.evil.com);
//   — www/порт/схема/регистр нормализуются;
//   — неизвестный домен не считается книжным, тип fallback — 'catalog';
//   — normalize.js делегирует реестру (sourceTypeByDomain/isRussianSourceUrl);
//   — реестр защищён от случайной мутации, listSources() отдаёт копии.
// ═══════════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import {
  SOURCE_REGISTRY,
  normalizeSourceHost,
  getSourceEntry,
  isRegisteredSource,
  sourceTypeFor,
  sourceLabelFor,
  listSources,
  sourceDomains,
  isValidSourceType,
} from '../sources.js';
import { sourceTypeByDomain, isRussianSourceUrl } from '../normalize.js';
import { ALLOWED_DOMAINS } from '../worker/worker.js';

const EXPECTED_DOMAINS = [
  'eksmo.ru', 'ast.ru', 'mann-ivanov-ferber.ru', 'rosman.ru', 'litres.ru',
  'chitai-gorod.ru', 'bookvoed.ru', 'rsl.ru', 'findbook.ru',
];

describe('SOURCE_REGISTRY: единый реестр книжных источников', () => {
  it('содержит все 9 доменов спецификации с корректными типами', () => {
    expect(sourceDomains().sort()).toEqual([...EXPECTED_DOMAINS].sort());
    for (const entry of SOURCE_REGISTRY) {
      expect(isValidSourceType(entry.type), entry.domain).toBe(true);
      expect(entry.label).toBeTruthy();
    }
  });

  it('синхронизирован с allowlist Worker (нет рассинхрона доменов)', () => {
    expect([...sourceDomains()].sort()).toEqual([...ALLOWED_DOMAINS].sort());
  });

  it('getSourceEntry: точный домен, www, поддомен, URL, порт и регистр', () => {
    expect(getSourceEntry('litres.ru')?.type).toBe('shop');
    expect(getSourceEntry('www.litres.ru')?.domain).toBe('litres.ru');
    expect(getSourceEntry('cdn.litres.ru')?.domain).toBe('litres.ru');
    expect(getSourceEntry('https://WWW.LitRes.RU:443/book/x?y=1')?.domain).toBe('litres.ru');
    expect(getSourceEntry('mann-ivanov-ferber.ru')?.type).toBe('publisher');
    expect(getSourceEntry('rsl.ru')?.type).toBe('library');
    expect(getSourceEntry('findbook.ru')?.type).toBe('catalog');
  });

  it('чужой/суффиксный/пустой домен не считается книжным', () => {
    expect(getSourceEntry('ozon.ru')).toBeNull();
    expect(getSourceEntry('litres.ru.evil.com')).toBeNull();
    expect(getSourceEntry('not-a-domain')).toBeNull();
    expect(getSourceEntry('')).toBeNull();
    expect(isRegisteredSource('https://amazon.com/x')).toBe(false);
    expect(isRegisteredSource('https://www.bookvoed.ru/x')).toBe(true);
  });

  it('sourceTypeFor/sourceLabelFor: fallback для неизвестного домена', () => {
    expect(sourceTypeFor('https://eksmo.ru/book/1')).toBe('publisher');
    expect(sourceLabelFor('https://eksmo.ru/book/1')).toBe('Эксмо');
    expect(sourceTypeFor('unknown.example')).toBe('catalog');
    expect(sourceLabelFor('unknown.example')).toBe('');
  });

  it('normalizeSourceHost нормализует схему, www, порт, путь', () => {
    expect(normalizeSourceHost('https://WWW.LitRes.RU:443/book?a=1')).toBe('litres.ru');
    expect(normalizeSourceHost('litres.ru')).toBe('litres.ru');
    expect(normalizeSourceHost('www.litres.ru/book')).toBe('litres.ru');
    expect(normalizeSourceHost('')).toBe('');
  });

  it('реестр заморожен, listSources() отдаёт копии (мутация не влияет)', () => {
    expect(Object.isFrozen(SOURCE_REGISTRY)).toBe(true);
    const copy = listSources();
    copy[0].type = 'catalog';
    expect(SOURCE_REGISTRY[0].type).not.toBe('catalog');
  });

  it('normalize.js делегирует реестру (§9, обратная совместимость)', () => {
    expect(sourceTypeByDomain('www.ast.ru')).toBe('publisher');
    expect(sourceTypeByDomain('rsl.ru')).toBe('library');
    expect(sourceTypeByDomain('unknown.com')).toBe('catalog');
    expect(isRussianSourceUrl('https://amazon.com/x')).toBe(false);
    expect(isRussianSourceUrl('https://cdn.litres.ru/x')).toBe(true);
  });
});
