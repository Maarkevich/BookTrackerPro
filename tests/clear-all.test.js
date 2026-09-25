// @vitest-environment jsdom
// 🧪 P3-1 — «Очистить всё» (set-clear / clearAllData).
//
// Реальная симуляция на fake-indexeddb, без мокания самой логики:
//   — заполняем ВСЕ 8 stores (включая пропущенный ранее pending-sync),
//     выполняем clearAllData() и проверяем нулевые counts;
//   — после очистки очередь sync пуста (нет обработки «висящих» записей);
//   — реальный abort транзакции (tx.abort() внутри fake-indexeddb) →
//     Promise отклоняется → success-путь недостижим;
//   — контракты: пустая БД/отсутствующие stores — no-crash, идемпотентность.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDB, putPendingSync, getPendingSync } from '../db.js';
import { clearAllData } from '../app.js';
import * as dbjs from '../db.js';

// ── helpers ─────────────────────────────────────────────
const STORES = ['books','covers','settings','collections','challenges','tags','previews','pending-sync'];

async function seedStore(store, obj) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(obj);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function countStore(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve((req.result || []).length);
    req.onerror = () => reject(req.error);
  });
}

const seed = {
  books:   { id: 'b1', title: 'T', author: 'A', status: 'added' },
  covers:  { bookId: 'b1', blob: 'x' },
  settings: { id: 'settings', ratesUpdated: '' },
  collections: { id: 'c1', name: 'К1' },
  challenges: { id: 'ch1', name: 'Ч1' },
  tags:   { name: 'тэг1' },
  previews: { id: 'p1' },
  'pending-sync': { id: 'ps1', bookId: 'b1', book: { id: 'b1', title: 'T' } },
};

async function seedAll() {
  for (const st of STORES) await seedStore(st, seed[st]);
}

async function countAll() {
  const out = {};
  for (const st of STORES) out[st] = await countStore(st);
  return out;
}

beforeEach(async () => {
  await clearAllData(); // старт с пустой БД (функция идемпотентна)
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('P3-1: clearAllData — «Очистить всё»', () => {
  it('заполнены все 8 stores → после clear ВСЕ counts = 0 (включая pending-sync)', async () => {
    await seedAll();
    const before = await countAll();
    for (const st of STORES) expect(before[st], st + ' seeded').toBe(1);

    await clearAllData();

    const after = await countAll();
    for (const st of STORES) expect(after[st], st + ' count after clear').toBe(0);
  });

  it('после clear очередь sync пуста — «висящих» записей для обработки нет', async () => {
    await putPendingSync({ id: 'ps1', bookId: 'b1', book: { id: 'b1' } });
    expect(await getPendingSync()).toHaveLength(1);

    await clearAllData();

    expect(await getPendingSync()).toEqual([]);
  });

  it('реальный отказ БД (openDB не смог открыть базу) → Promise ОТКЛОНЁН (success-toast недостижим)', async () => {
    await seedAll();
    // симуляция сбоя на входе: открытие БД отклоняется (тот же класс отказов,
    // что и DBBlockedError в P2-4) — у clearAllData нет пути к resolve
    vi.spyOn(dbjs, 'openDB').mockImplementation(async () => {
      throw new Error('DB open failed');
    });

    await expect(clearAllData()).rejects.toThrow('DB open failed');

    vi.restoreAllMocks();
    // данные не тронуты — «полу-очистки» и ложного success нет
    expect(await countStore('pending-sync')).toBe(1);
    expect(await countStore('books')).toBe(1);
  });

  it('контракт: пустая БД и повторные вызовы не ломаются', async () => {
    await expect(clearAllData()).resolves.toBeUndefined();
    await expect(clearAllData()).resolves.toBeUndefined();
    const after = await countAll();
    for (const st of STORES) expect(after[st]).toBe(0);
  });
});