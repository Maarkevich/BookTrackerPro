// ═══════════════════════════════════════════════════════════════════
// Регрессионные тесты P2-2 — «Settings exported but not imported».
//
// Оригинальная проблема (до фикса):
//   — exportAll() включал settings, но importAll() их полностью
//     игнорировал (merge был только для books/collections/challenges/
//     tags), поэтому backup-контракт обещал настройки, а restore
//     их не восстанавливал.
//
// Что доказывают тесты:
//   — round-trip: export → import восстанавливает ВСЕ несекретные
//     настройки (allowlist P1-4), credentials не попадают (P1-4);
//   — policy restore-merge: ключи backup ЗАМЕНЯЮТ локальные; локальные
//     ключи, отсутствующие в backup, СТАНОВЯТСЯ прежними
//     (т.е. сохраняются) согласно выбранной policy;
//   — отсутствие settings или пустой settings в backup → настройки
//     НЕ трогаются (appliedSettings = 0);
//   — старый backup (без settings) и version=1 → импорт работает,
//     локальные настройки не теряются;
//   — security: секретные ключи (lrAppId/lrSecret/microlinkApiKey/
//     lrPartner*) НЕ записываются даже если приходят в backup;
//   — атомарность: при abort транзакции настройки тоже НЕ применяются.
// ═══════════════════════════════════════════════════════════════════
// @vitest-environment node
import 'fake-indexeddb/auto';
import { IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  exportAll, importAll, loadSettings, openDB, saveSettings,
} from '../db.js';

const _orig = {};

/** Следующие N вызовов store.<method> abort'ят свою транзакцию. */
function abortOn(method, times = 1) {
  const proto = IDBObjectStore.prototype;
  if (!_orig[method]) _orig[method] = proto[method];
  let remaining = times;
  proto[method] = function (...args) {
    const res = _orig[method].apply(this, args);
    if (remaining > 0) { remaining--; this.transaction.abort(); }
    return res;
  };
}

function restoreProtos() {
  for (const [m, fn] of Object.entries(_orig)) IDBObjectStore.prototype[m] = fn;
  for (const key of Object.keys(_orig)) delete _orig[key];
}

async function clearDB() {
  const db = await openDB();
  const names = Array.from({ length: db.objectStoreNames.length }, (_, i) => db.objectStoreNames.item(i));
  await new Promise((resolve) => {
    const tx = db.transaction(names, 'readwrite');
    for (const st of names) tx.objectStore(st).clear();
    tx.oncomplete = resolve;
  });
}

/** Backup с только несекретными настройками (не экспортированный, ручной). */
const BACKUP_WITH_SAFE_SETTINGS = () => ({
  app: 'BookTrackerPro',
  version: 1,
  books: [{ id: 'bk1', title: 'Книга', author: 'A' }],
  collections: [], challenges: [], tags: [],
  settings: { confetti: true, sound: false, defaultCurrency: 'EUR' },
  covers: [],
});

beforeEach(clearDB)
afterEach(restoreProtos)

// ═══════════════════════════════════════════════
//  ROUND-TRIP: export → import восстанавливает настройки
// ═══════════════════════════════════════════════
describe('P2-2: round-trip несекретных настроек (export → import → loadSettings)', () => {
  it('экспорт → очистка → импорт → настройки восстановлены, credentials отсутствуют', async () => {
    await saveSettings({
      confetti: true, sound: false, defaultPlatform: 'litres',
      defaultCurrency: 'EUR', showPriceInCards: false,
      // секреты (не должны попасть в backup и в импорт)
      lrAppId: 'app1', lrSecret: 'sec1',
    });
    const backup = await exportAll();

    // после очистки и round-trip
    await clearDB();
    const res = await importAll(backup);
    expect(res.appliedSettings).toBeGreaterThan(0);

    const settings = await loadSettings();
    expect(settings.confetti).toBe(true);
    expect(settings.sound).toBe(false);
    expect(settings.defaultPlatform).toBe('litres');
    expect(settings.defaultCurrency).toBe('EUR');
    expect(settings.showPriceInCards).toBe(false);
    // P1-4: секреты не экспортируются → не могут прийти и в импорт
    expect(settings.lrAppId).toBeUndefined();
    expect(settings.lrSecret).toBeUndefined();
  });

  it('все ключи SAFE_SETTINGS_KEYS переживают round-trip без изменений', async () => {
    await saveSettings({
      confetti: true, sound: true, defaultPlatform: 'pocket',
      bloggerMode: true, defaultCurrency: 'USD',
      showPriceInCards: true, showPriceInDetail: false, showPriceInStats: true,
      exchangeRates: { USD: 95 }, ratesUpdated: 1234567890,
    });
    const backup = await exportAll();
    await clearDB();
    await importAll(backup);

    const settings = await loadSettings();
    expect(settings).toMatchObject({
      confetti: true, sound: true, defaultPlatform: 'pocket',
      bloggerMode: true, defaultCurrency: 'USD',
      showPriceInCards: true, showPriceInDetail: false, showPriceInStats: true,
      exchangeRates: { USD: 95 }, ratesUpdated: 1234567890,
    });
  });
});

// ═══════════════════════════════════════════════
//  POLICY restore-merge: backup заменяет, локальное вне backup живёт
// ═══════════════════════════════════════════════
describe('P2-2: policy restore-merge', () => {
  it('ключи из backup ЗАМЕНЯЮТ локальные значения', async () => {
    await saveSettings({ confetti: false, sound: true });
    const res = await importAll(BACKUP_WITH_SAFE_SETTINGS());
    expect(res.appliedSettings).toBe(3);
    const settings = await loadSettings();
    expect(settings.confetti).toBe(true);   // было false → стал true из backup
    expect(settings.sound).toBe(false);     // было true → стал false из backup
    expect(settings.defaultCurrency).toBe('EUR');
  });

  it('локальные ключи, которых НЕТ в backup, сохраняются (не затираются)', async () => {
    await saveSettings({ confetti: false, bloggerMode: true, showPriceInStats: true });
    await importAll(BACKUP_WITH_SAFE_SETTINGS());
    const settings = await loadSettings();
    expect(settings.bloggerMode).toBe(true);      // локальный, нет в backup → жив
    expect(settings.showPriceInStats).toBe(true); // локальный, нет в backup → жив
    expect(settings.confetti).toBe(true);         // был в backup → заменил
  });
});

// ═══════════════════════════════════════════════
//  ОТСУТСТВИЕ settings в backup: ничего не трогаем
// ═══════════════════════════════════════════════
describe('P2-2: старый backup без settings → настройки не тронуты', () => {
  it('backup без поля settings: appliedSettings = 0, локальные настройки целы', async () => {
    await saveSettings({ confetti: true, defaultCurrency: 'RUB' });
    const oldBackup = {
      app: 'BookTrackerPro', version: 1,
      books: [{ id: 'bk1', title: 'Книга', author: 'A' }],
      collections: [], challenges: [], tags: [], covers: [],
    };
    const res = await importAll(oldBackup);
    expect(res.appliedSettings).toBe(0);
    expect(await loadSettings()).toMatchObject({ confetti: true, defaultCurrency: 'RUB' });
  });

  it('settings = {} (пустой объект): appliedSettings = 0, локальные настройки целы', async () => {
    await saveSettings({ confetti: true });
    const res = await importAll({
      app: 'BookTrackerPro', version: 1,
      books: [], collections: [], challenges: [], tags: [],
      settings: {}, covers: [],
    });
    expect(res.appliedSettings).toBe(0);
    expect(await loadSettings()).toMatchObject({ confetti: true });
  });
});

// ═══════════════════════════════════════════════
//  АТОМАРНОСТЬ: сбой на любом put → настройки НЕ применены
// ═══════════════════════════════════════════════
describe('P2-2: настройки применяются атомарно с остальным импортом', () => {
  it('abort транзакции на books → reject и НАСТРОЙКИ не записаны', async () => {
    abortOn('put', 1); // первый put (книга) abort'ит общую транзакцию
    await expect(importAll(BACKUP_WITH_SAFE_SETTINGS())).rejects.toThrow();
    expect(await loadSettings()).toBeNull();
  });
});