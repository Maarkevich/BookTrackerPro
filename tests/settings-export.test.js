// ═══════════════════════════════════════════════════════════════════
// Регрессионные тесты P1-4 — API credentials НЕ попадают в backup.
// Проверяют РЕАЛЬНЫЕ функции db.js через fake-indexeddb:
//   sanitizeSettingsForExport / exportAll / importAll / saveSettings.
//
// Покрытие:
//   A. sanitizeSettingsForExport: безопасные поля сохраняются,
//      все 5 секретов отсутствуют (allowlist, не denylist);
//   B. неизвестный будущий ключ удаляется автоматически;
//   C. null/undefined/{} → {} без падения;
//   D. exportAll: data.settings не содержит credentials;
//   E. exportAll: безопасные настройки сохраняются;
//   F. importAll: старый backup с секретами не записывает их обратно.
// ═══════════════════════════════════════════════════════════════════
// @vitest-environment node
import 'fake-indexeddb/auto';
import { beforeEach, describe, it, expect } from 'vitest';
import {
  sanitizeSettingsForExport, exportAll, importAll, loadSettings, saveSettings, openDB,
} from '../db.js';

// чистим все store между тестами
async function clearDB() {
  const db = await openDB();
  const names = Array.from({ length: db.objectStoreNames.length }, (_, i) => db.objectStoreNames.item(i));
  await new Promise((resolve) => {
    const tx = db.transaction(names, 'readwrite');
    for (const st of names) tx.objectStore(st).clear();
    tx.oncomplete = resolve;
  });
}
beforeEach(clearDB);

describe('P1-4: sanitizeSettingsForExport() — allowlist настроек (db.js)', () => {
  it('A: безопасные поля сохраняются, все 5 секретов отсутствуют', () => {
    const out = sanitizeSettingsForExport({
      lrAppId: 'app1', lrSecret: 'sec1', lrPartnerId: 'pid1', lrPartnerSecret: 'psec1',
      microlinkApiKey: 'ml-key',
      confetti: true, sound: false, defaultPlatform: 'youtube', bloggerMode: true,
      defaultCurrency: 'RUB', showPriceInCards: true, showPriceInDetail: false, showPriceInStats: true,
      exchangeRates: { USD: 90 }, ratesUpdated: '01.01.2026',
    });
    // безопасные поля на месте
    expect(out.confetti).toBe(true);
    expect(out.sound).toBe(false);
    expect(out.defaultPlatform).toBe('youtube');
    expect(out.bloggerMode).toBe(true);
    expect(out.defaultCurrency).toBe('RUB');
    expect(out.showPriceInCards).toBe(true);
    expect(out.exchangeRates).toEqual({ USD: 90 });
    expect(out.ratesUpdated).toBe('01.01.2026');
    // секреты отсутствуют
    expect(out).not.toHaveProperty('lrAppId');
    expect(out).not.toHaveProperty('lrSecret');
    expect(out).not.toHaveProperty('lrPartnerId');
    expect(out).not.toHaveProperty('lrPartnerSecret');
    expect(out).not.toHaveProperty('microlinkApiKey');
  });

  it('B: неизвестный будущий секрет (whatEverSecret) удаляется', () => {
    const out = sanitizeSettingsForExport({ defaultCurrency: 'EUR', whatEverSecret: 'x' });
    expect(out.defaultCurrency).toBe('EUR');
    expect(out).not.toHaveProperty('whatEverSecret');
  });

  it('C: null/undefined/{} → {} без падения', () => {
    expect(sanitizeSettingsForExport(null)).toEqual({});
    expect(sanitizeSettingsForExport(undefined)).toEqual({});
    expect(sanitizeSettingsForExport({})).toEqual({});
  });
});

describe('P1-4: exportAll() — секреты не попадают в backup (db.js)', () => {
  const SECRET_SETTINGS = {
    lrAppId: 'app1', lrSecret: 'sec1', lrPartnerId: 'pid1', lrPartnerSecret: 'psec1',
    microlinkApiKey: 'ml-key',
    defaultCurrency: 'RUB', exchangeRates: { USD: 90 }, defaultPlatform: 'youtube', confetti: true,
  };

  it('D: data.settings не содержит ни одного credentials-ключа', async () => {
    await saveSettings(SECRET_SETTINGS);
    const data = await exportAll();
    expect(data.settings).not.toHaveProperty('lrAppId');
    expect(data.settings).not.toHaveProperty('lrSecret');
    expect(data.settings).not.toHaveProperty('lrPartnerId');
    expect(data.settings).not.toHaveProperty('lrPartnerSecret');
    expect(data.settings).not.toHaveProperty('microlinkApiKey');
  });

  it('E: безопасные настройки сохраняются в backup', async () => {
    await saveSettings(SECRET_SETTINGS);
    const data = await exportAll();
    expect(data.settings.defaultCurrency).toBe('RUB');
    expect(data.settings.exchangeRates).toEqual({ USD: 90 });
    expect(data.settings.defaultPlatform).toBe('youtube');
    expect(data.settings.confetti).toBe(true);
  });

  it('C: сохранённые credentials остаются в IndexedDB (механизм хранения не тронут)', async () => {
    await saveSettings(SECRET_SETTINGS);
    const stored = await loadSettings();
    expect(stored.lrSecret).toBe('sec1');
    expect(stored.microlinkApiKey).toBe('ml-key');
  });
});

describe('P1-4: importAll() — credentials из старого backup не попадают обратно (db.js)', () => {
  it('F: старый backup с секретами в settings не записывает их в IndexedDB', async () => {
    const res = await importAll({
      app: 'BookTrackerPro', version: 1,
      books: [{ id: 'bk1', title: 'Книга', author: 'A' }],
      settings: {
        lrAppId: 'app1', lrSecret: 'sec1', lrPartnerId: 'pid1', lrPartnerSecret: 'psec1',
        microlinkApiKey: 'ml-key', defaultCurrency: 'RUB',
      },
    });
    expect(res.addedBooks).toBe(1);
    // importAll settings не импортирует — секреты в базу не попадают
    const stored = await loadSettings();
    expect(stored).toBeNull();
  });
});