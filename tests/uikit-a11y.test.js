// @vitest-environment jsdom
// 🧪 P2-18 — «Custom date/select/cards keyboard accessibility».
//
// Симулирует РЕАЛЬНЫЕ клавиатурные сценарии (не мокает хэндлеры):
//   — дата-пикер: открытие по focus/Enter/Space, стрелки/Home/End/PageUp/Down,
//     Escape, roving tabindex, возврат фокуса; coarse-устройства сохраняют blur-hack;
//   — кастомный селект: открытие по стрелкам, навигация по опциям (roving focus +
//     aria-activedescendant), Enter/Space выбор, Home/End, Escape, возврат фокуса;
//   — карточки: makeCardKeyboardAccessible — Enter/Space = клик, вложенные кнопки
//     не активируют карточку;
//   — контракты: null-входы и повторная инициализация не ломают поведение.
//
// jsdom не реализует requestAnimationFrame и matchMedia — даём минимальные заглушки.

if (typeof globalThis.requestAnimationFrame !== 'function') {
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query) => ({
    matches: false, media: query,
    addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {},
  });
}

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  attachDatePicker, closeDatePicker, attachCustomSelect, closeDropdown, closeAllPopups,
} from '../uikit.js';
import { makeCardKeyboardAccessible } from '../utils.js';

function key(target, k, opts = {}) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
}
function keyUp(target, k, opts = {}) {
  target.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true, cancelable: true, ...opts }));
}
const nextTick = () => new Promise((r) => setTimeout(r, 0));

// uikit хранит одиночные состояния (_activePicker/_activeDropdown) на уровне
// модуля — закрываем их после каждого теста и сбрасываем DOM
afterEach(() => {
  closeDatePicker({ restoreFocus: false });
  closeDropdown();
  document.body.innerHTML = '';
});

// ═══════════════════════════════════════════════
//  ДАТА-ПИКЕР
// ═══════════════════════════════════════════════
describe('P2-18: дата-пикер — keyboard/focus', () => {
  let input;
  let onChange;

  beforeEach(() => {
    document.body.innerHTML = '';
    input = document.createElement('input');
    input.type = 'date';
    input.value = '2026-09-15';
    document.body.appendChild(input);
    onChange = vi.fn();
    input.addEventListener('change', onChange);
  });

  function openDesktop() {
    attachDatePicker(input);
    input.focus(); // desktop: focus → openDatePicker
  }

  it('desktop: фокус открывает пикер (без matchMedia → non-coarse)', () => {
    openDesktop();
    const pop = document.querySelector('.dp-pop');
    expect(pop).toBeTruthy();
    expect(pop.getAttribute('role')).toBe('dialog');
    // фокус переехал внутрь пикера (на focusDate)
    const day = pop.querySelector('[data-dp-date="2026-09-15"]');
    expect(document.activeElement).toBe(day);
  });

  it('desktop: повторный click не переоткрывает (guard), пикер один', () => {
    openDesktop();
    const pop = document.querySelector('.dp-pop');
    input.click();
    expect(document.querySelectorAll('.dp-pop').length).toBe(1);
    expect(document.querySelector('.dp-pop')).toBe(pop);
  });

  it('desktop: Enter/Space на input открывают пикер', () => {
    attachDatePicker(input);
    key(input, 'Enter');
    expect(document.querySelector('.dp-pop')).toBeTruthy();
    closeDatePicker();
    key(input, ' ');
    expect(document.querySelector('.dp-pop')).toBeTruthy();
  });

  it('coarse (touch): focus гасится blur, нативный пикер не открывается', () => {
    const orig = window.matchMedia;
    window.matchMedia = (q) => ({ matches: true, media: q,
      addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
    try {
      attachDatePicker(input);
      input.focus();
      expect(document.activeElement).not.toBe(input);
      expect(document.querySelector('.dp-pop')).toBeNull();
    } finally {
      window.matchMedia = orig;
    }
  });

  it('ArrowRight двигает фокус по дням, roving tabindex', () => {
    openDesktop();
    const pop = document.querySelector('.dp-pop');
    key(pop.querySelector('[data-dp-date="2026-09-15"]'), 'ArrowRight');
    // renderPicker() пересоздаёт кнопки — сравниваем по data-атрибуту, а не по ссылке
    const d16 = pop.querySelector('[data-dp-date="2026-09-16"]');
    expect(document.activeElement).toBe(d16);
    expect(d16.getAttribute('tabindex')).toBe('0');
    expect(pop.querySelector('[data-dp-date="2026-09-15"]').getAttribute('tabindex')).toBe('-1');
  });

  it('ArrowRight с последнего дня месяца пересекает месяц (01 следующего)', () => {
    input.value = '2026-01-31';
    openDesktop();
    const pop = document.querySelector('.dp-pop');
    key(pop.querySelector('[data-dp-date="2026-01-31"]'), 'ArrowRight');
    expect(document.activeElement.getAttribute('data-dp-date')).toBe('2026-02-01');
  });

  it('Home/End — первый/последний день месяца', () => {
    input.value = '2026-02-15'; // 2026 не високосный
    openDesktop();
    const pop = document.querySelector('.dp-pop');
    const d15 = pop.querySelector('[data-dp-date="2026-02-15"]');
    key(d15, 'Home');
    expect(document.activeElement.getAttribute('data-dp-date')).toBe('2026-02-01');
    key(document.activeElement, 'End');
    expect(document.activeElement.getAttribute('data-dp-date')).toBe('2026-02-28');
  });

  it('PageUp/PageDown меняют месяц (день сохраняется, фокус на нём)', () => {
    openDesktop();
    const pop = document.querySelector('.dp-pop');
    key(pop.querySelector('[data-dp-date="2026-09-15"]'), 'PageUp');
    expect(document.activeElement.getAttribute('data-dp-date')).toBe('2026-08-15');
    expect(pop.querySelector('.dp-title').textContent).toContain('Август');
    key(document.activeElement, 'PageDown');
    expect(document.activeElement.getAttribute('data-dp-date')).toBe('2026-09-15');
  });

  it('Enter (нативный click кнопки дня) выбирает дату, закрывает, возвращает фокус', async () => {
    openDesktop();
    const pop = document.querySelector('.dp-pop');
    const d16 = pop.querySelector('[data-dp-date="2026-09-16"]');
    d16.click(); // браузер: Enter на <button> генерирует click
    expect(document.querySelector('.dp-pop')).toBeNull();
    expect(input.value).toBe('2026-09-16');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(input); // возврат фокуса
    // P2-18-регрессия: возврат фокуса НЕ должен мгновенно пере-открывать пикер
    await nextTick();
    expect(document.querySelector('.dp-pop')).toBeNull();
  });

  it('Escape закрывает без изменения значения, фокус возвращается', async () => {
    openDesktop();
    const pop = document.querySelector('.dp-pop');
    key(pop.querySelector('[data-dp-date="2026-09-16"]'), 'Escape');
    expect(document.querySelector('.dp-pop')).toBeNull();
    expect(input.value).toBe('2026-09-15');
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
    // P2-18-регрессия: возврат фокуса НЕ должен мгновенно пере-открывать пикер
    await nextTick();
    expect(document.querySelector('.dp-pop')).toBeNull();
  });

  it('клик вне закрывает пикер БЕЗ принудительного возврата фокуса', async () => {
    openDesktop();
    await nextTick(); // регистрация _onPickerOutside в setTimeout(0)
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.dp-pop')).toBeNull();
    expect(document.activeElement).not.toBe(input); // фокус не украден
  });

  it('контракт: attachDatePicker(null) — no-op, повторная инициализация — один пикер', () => {
    expect(() => attachDatePicker(null)).not.toThrow();
    attachDatePicker(input);
    attachDatePicker(input); // _dpInit → не пересоздаёт слушатели
    input.focus();
    key(input, 'Enter');
    input.click();
    expect(document.querySelectorAll('.dp-pop').length).toBe(1);
  });
});

// ═══════════════════════════════════════════════
//  КАСТОМНЫЙ СЕЛЕКТ
// ═══════════════════════════════════════════════
describe('P2-18: кастомный селект — keyboard/focus', () => {
  let select;
  let onChange;

  function makeSelect(options, attachOpts = {}) {
    select = document.createElement('select');
    options.forEach((o) => {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      select.appendChild(opt);
    });
    document.body.appendChild(select);
    attachCustomSelect(select, attachOpts);
    onChange = vi.fn();
    select.addEventListener('change', onChange);
    return select;
  }
  const trigger = () => select._csTrigger;
  const opts = () => [...document.querySelectorAll('.cs-option')];

  beforeEach(() => { document.body.innerHTML = ''; });

  it('ArrowDown на триггере открывает список, фокус на выбранной опции', () => {
    makeSelect([{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }]);
    select.selectedIndex = 1;
    trigger().focus();
    key(trigger(), 'ArrowDown');
    const dd = document.querySelector('.cs-dropdown');
    expect(dd).toBeTruthy();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(select.selectedIndex).toBe(1); // значение не изменилось
    expect(document.activeElement).toBe(opts()[1]); // фокус на выбранной
  });

  it('ArrowDown/ArrowUp перемещают roving focus (с wrap), aria-activedescendant', () => {
    makeSelect([{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }]);
    trigger().focus();
    key(trigger(), 'ArrowDown'); // focus → опция индекса 0
    const dd = document.querySelector('.cs-dropdown');
    key(document.activeElement, 'ArrowDown');
    expect(document.activeElement).toBe(opts()[1]);
    expect(opts()[0].getAttribute('tabindex')).toBe('-1');
    expect(opts()[1].getAttribute('tabindex')).toBe('0');
    expect(dd.getAttribute('aria-activedescendant')).toBe(opts()[1].id);
    key(document.activeElement, 'ArrowUp');
    key(document.activeElement, 'ArrowUp'); // wrap вниз списка
    expect(document.activeElement).toBe(opts()[2]);
  });

  it('Home/End — первая/последняя опция', () => {
    makeSelect([{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }]);
    trigger().focus();
    key(trigger(), 'ArrowDown');
    key(document.activeElement, 'End');
    expect(document.activeElement).toBe(opts()[2]);
    key(document.activeElement, 'Home');
    expect(document.activeElement).toBe(opts()[0]);
  });

  it('Enter выбирает фокусную опцию: value+change, закрытие, фокус на триггер', () => {
    makeSelect([{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }]);
    trigger().focus();
    key(trigger(), 'ArrowDown');
    key(document.activeElement, 'ArrowDown'); // → b
    key(document.activeElement, 'Enter');
    expect(select.value).toBe('b');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.cs-dropdown')).toBeNull();
    expect(document.activeElement).toBe(trigger()); // возврат фокуса
  });

  it('Escape закрывает без выбора, фокус возвращается на триггер', () => {
    makeSelect([{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]);
    select.selectedIndex = 1;
    trigger().focus();
    key(trigger(), 'ArrowDown');
    key(document.activeElement, 'Escape');
    expect(document.querySelector('.cs-dropdown')).toBeNull();
    expect(select.value).toBe('b');
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger());
  });

  it('клик по опции (мышь) выбирает и закрывает', () => {
    makeSelect([{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]);
    trigger().click(); // мышиное открытие — фокус остаётся на триггере
    expect(document.querySelector('.cs-dropdown')).toBeTruthy();
    opts()[1].click();
    expect(select.value).toBe('b');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.cs-dropdown')).toBeNull();
  });

  it('search-режим: ArrowDown из поля поиска уводит в список опций', () => {
    makeSelect([{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }], { search: true });
    trigger().focus();
    key(trigger(), 'ArrowDown');
    const si = document.querySelector('.cs-search-input');
    expect(document.activeElement).toBe(si); // клавиатурно-открытый поиск в фокусе
    key(si, 'ArrowDown');
    expect(document.activeElement).toBe(opts()[0]);
  });

  it('контракты: null/пустой select не ломаются; повторная инициализация — один триггер', () => {
    expect(() => attachCustomSelect(null)).not.toThrow();
    const empty = document.createElement('select');
    document.body.appendChild(empty);
    expect(() => attachCustomSelect(empty)).not.toThrow();
    expect(() => closeDropdown()).not.toThrow();
    document.body.innerHTML = '';
    const sel = makeSelect([{ value: 'a', label: 'A' }]);
    attachCustomSelect(sel, {}); // _csInit → повторно не оборачивает
    expect(sel._csWrap.querySelectorAll('.cs-trigger').length).toBe(1);
  });
});

// ═══════════════════════════════════════════════
//  КАРТОЧКИ — makeCardKeyboardAccessible
// ═══════════════════════════════════════════════
describe('P2-18: карточки — keyboard ≡ click', () => {
  let card;
  const onClick = vi.fn();

  beforeEach(() => {
    document.body.innerHTML = '';
    onClick.mockClear();
    card = document.createElement('div');
    card.className = 'book-card';
    card.dataset.id = 'b1';
    document.body.appendChild(card);
    card.addEventListener('click', onClick);
  });

  it('получает tabindex=0 и role="button"; aria-label из opts', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    makeCardKeyboardAccessible(el, { label: 'Открыть книгу' });
    expect(el.getAttribute('role')).toBe('button');
    expect(el.getAttribute('aria-label')).toBe('Открыть книгу');
    expect(el.tabIndex).toBe(0);
  });

  it('Enter = клик (только когда фокус на карточке)', () => {
    makeCardKeyboardAccessible(card);
    expect(onClick).not.toHaveBeenCalled();
    card.focus();
    key(card, 'Enter');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('Space: срабатывает на keyup (keydown без keyup — не кликает), ровно один раз', () => {
    makeCardKeyboardAccessible(card);
    card.focus();
    key(card, ' ');
    expect(onClick).not.toHaveBeenCalled(); // keydown только прокрутку запрещает
    keyUp(card, ' ');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('вложенная кнопка в фокусе не активирует карточку', () => {
    const inner = document.createElement('button');
    inner.type = 'button';
    card.appendChild(inner);
    makeCardKeyboardAccessible(card);
    inner.focus();
    key(inner, 'Enter');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('повторная инициализация не дублирует обработчики (Enter = 1 клик)', () => {
    makeCardKeyboardAccessible(card);
    makeCardKeyboardAccessible(card);
    card.focus();
    key(card, 'Enter');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('контракт: null — no-op; Space без повторного keyup не «залипает» после blur', () => {
    expect(() => makeCardKeyboardAccessible(null)).not.toThrow();
    makeCardKeyboardAccessible(card);
    card.focus();
    key(card, ' ');
    card.blur(); // уход с карточки до keyup
    keyUp(card, ' ');
    expect(onClick).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════
//  СМОК: closeAllPopups с открытыми пикером и селектом
// ═══════════════════════════════════════════════
describe('P2-18: closeAllPopups', () => {
  it('закрывает и дата-пикер, и селект без исключений', () => {
    document.body.innerHTML = '';
    const input = document.createElement('input');
    input.type = 'date';
    document.body.appendChild(input);
    const sel = document.createElement('select');
    sel.innerHTML = '<option value="1">Один</option><option value="2">Два</option>';
    document.body.appendChild(sel);
    attachDatePicker(input);
    attachCustomSelect(sel, {});
    input.focus();
    expect(document.querySelector('.dp-pop')).toBeTruthy();
    sel._csTrigger.click();
    // политика «один попап за раз»: открытие dropdown закрывает дата-пикер
    expect(document.querySelector('.cs-dropdown')).toBeTruthy();
    expect(document.querySelector('.dp-pop')).toBeNull();
    expect(() => closeAllPopups()).not.toThrow();
    expect(document.querySelector('.cs-dropdown')).toBeNull();
  });
});