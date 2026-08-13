// 📦 BookTrackerPro — uikit.js
// 🔖 v3.7.0 | 2026-08-07
// 📝 Переиспользуемые UI-компоненты «ночной библиотеки»
//
//    Компоненты:
//      📅 Дата-пикер   — кастомный календарь вместо <input type=date>
//      🔽 Кастомный селект — вместо системного <select>, с поиском
//      ✅ Confirm       — стилизованный диалог вместо нативного confirm()
//      🏷️ Chip Group   — множественный выбор (форматы книг) (v3.7.0)
//      💘 Chip Input   — автокомплит для тропов/тегов (v3.7.0)
//
//    Принципы:
//      — Нативный контрол остаётся в DOM и является источником истины.
//        Код форм продолжает читать .value без изменений.
//      — Никаких эмодзи в UI — только SVG из icons.js.
//      — Стили инжектируются один раз, соответствуют app.css.
//
//    Новое в 3.7.0:
//      — attachChipGroup(): множественный выбор чипами
//        (форматы: бумажная / электронная / аудио)
//      — attachChipInput(): ввод тропов с автокомплитом
//        из уже существующих тропов всех книг
//      — attachSelectWithCustom(): селект + «Добавить своё»
//        (площадки эл. книг: ЛитРес, Яндекс Книги, Bookmate...)
//
//    Использование:
//      import { enhanceForm, attachCustomSelect, showConfirm,
//               attachChipGroup, attachChipInput } from './uikit.js';
//      enhanceForm(formBody);
//      attachCustomSelect(sel, { search: true, renderOption: fn });
//      const ok = await showConfirm('Удалить книгу?', { danger: true });
//      attachChipGroup(container, { values: ['paper'], options: [...] });
//      attachChipInput(input, { suggestions: [...], placeholder: '...' });
// ─────────────────────────────────────────────
import { icon } from './icons.js';
import { esc } from './utils.js';

// ═══════════════════════════════════════════════
//  ХЕЛПЕРЫ
// ═══════════════════════════════════════════════
const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь',
                'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const DAYS = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

function pad(n) { return String(n).padStart(2, '0'); }

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseISO(iso) {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return isNaN(d.getTime()) ? null : d;
}

/** Сетка дней для года/месяца (6 строк × 7). Пн — первый. */
function buildCells(year, month) {
  const first = new Date(year, month, 1);
  const dim = new Date(year, month + 1, 0).getDate();
  let startDow = first.getDay() - 1; if (startDow < 0) startDow = 6;
  const prevLast = new Date(year, month, 0).getDate();
  const cells = [];
  for (let i = startDow - 1; i >= 0; i--) cells.push({ day: prevLast - i, other: true });
  for (let d = 1; d <= dim; d++)
    cells.push({ day: d, other: false, dateStr: `${year}-${pad(month + 1)}-${pad(d)}` });
  const rem = 42 - cells.length;
  for (let i = 1; i <= rem; i++) cells.push({ day: i, other: true });
  return cells;
}

/** Общее позиционирование поповера относительно якоря. */
function positionPop(pop, anchor) {
  const rect = anchor.getBoundingClientRect();
  const pw = pop.classList.contains('dp-pop') ? 300 : Math.min(rect.width, 320);
  let left = rect.left;
  if (left + pw > window.innerWidth - 10) left = window.innerWidth - pw - 10;
  if (left < 10) left = 10;
  pop.style.width = pw + 'px';
  pop.style.left = left + 'px';
  let top = rect.bottom + 6;
  pop.style.top = top + 'px';
  requestAnimationFrame(() => {
    const ph = pop.offsetHeight;
    if (top + ph > window.innerHeight - 10) {
      top = rect.top - ph - 6;
      if (top < 10) top = 10;
      pop.style.top = top + 'px';
    }
  });
}

// ═══════════════════════════════════════════════
//  1. ДАТА-ПИКЕР
// ═══════════════════════════════════════════════
let _activePicker = null;
let _pickerState = null;

/**
 * Привязывает кастомный календарь к <input type="date">.
 * Нативный пикер блокируется через readonly, значение остаётся ISO.
 * @param {HTMLInputElement} input
 */
export function attachDatePicker(input) {
  if (!input || input._dpInit) return;
  input._dpInit = true;
  input.setAttribute('readonly', 'readonly');
  input.classList.add('dp-input');
  input.addEventListener('click', () => openDatePicker(input));
  // iOS может пытаться открыть нативный пикер при фокусе — гасим
  input.addEventListener('focus', (e) => e.target.blur());
}

function openDatePicker(input) {
  closeDatePicker();
  closeDropdown();
  const cur = parseISO(input.value);
  const now = new Date();
  _pickerState = {
    input,
    year: cur ? cur.getFullYear() : now.getFullYear(),
    month: cur ? cur.getMonth() : now.getMonth(),
    selected: input.value || null,
  };
  _activePicker = document.createElement('div');
  _activePicker.className = 'dp-pop';
  renderPicker();
  document.body.appendChild(_activePicker);
  positionPop(_activePicker, input);
  setTimeout(() => document.addEventListener('click', _onPickerOutside, { capture: true }), 0);
}

function renderPicker() {
  const s = _pickerState;
  const cells = buildCells(s.year, s.month);
  const today = todayISO();
  _activePicker.innerHTML = `
    <div class="dp-head">
      <button type="button" class="dp-nav" data-dp-prev aria-label="Предыдущий месяц">${icon('chevronLeft', 16)}</button>
      <div class="dp-title">${MONTHS[s.month]} ${s.year}</div>
      <button type="button" class="dp-nav" data-dp-next aria-label="Следующий месяц">${icon('chevronRight', 16)}</button>
    </div>
    <div class="dp-days">${DAYS.map(d => `<div class="dp-dow">${d}</div>`).join('')}</div>
    <div class="dp-grid">
      ${cells.map(c => {
        if (c.other) return `<div class="dp-cell other">${c.day}</div>`;
        const sel = c.dateStr === s.selected ? ' selected' : '';
        const td = c.dateStr === today ? ' today' : '';
        return `<button type="button" class="dp-cell${sel}${td}" data-dp-date="${c.dateStr}">${c.day}</button>`;
      }).join('')}
    </div>
    <div class="dp-foot">
      <button type="button" class="dp-clear">${icon('calendarX', 14)} Очистить</button>
      <button type="button" class="dp-today">${icon('calendar', 14)} Сегодня</button>
    </div>
  `;
  _activePicker.querySelector('[data-dp-prev]').addEventListener('click', (e) => {
    e.stopPropagation(); s.month--; if (s.month < 0) { s.month = 11; s.year--; } renderPicker();
  });
  _activePicker.querySelector('[data-dp-next]').addEventListener('click', (e) => {
    e.stopPropagation(); s.month++; if (s.month > 11) { s.month = 0; s.year++; } renderPicker();
  });
  _activePicker.querySelectorAll('[data-dp-date]').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); selectDate(btn.dataset.dpDate); });
  });
  _activePicker.querySelector('.dp-clear').addEventListener('click', (e) => { e.stopPropagation(); selectDate(''); });
  _activePicker.querySelector('.dp-today').addEventListener('click', (e) => { e.stopPropagation(); selectDate(todayISO()); });
}

function selectDate(iso) {
  const s = _pickerState;
  if (!s) return;
  s.input.value = iso || '';
  s.input.dispatchEvent(new Event('change', { bubbles: true }));
  s.input.dispatchEvent(new Event('input', { bubbles: true }));
  closeDatePicker();
}

export function closeDatePicker() {
  if (_activePicker) { _activePicker.remove(); _activePicker = null; }
  _pickerState = null;
  document.removeEventListener('click', _onPickerOutside, { capture: true });
}

function _onPickerOutside(e) {
  if (_activePicker && !_activePicker.contains(e.target) && e.target !== _pickerState?.input) closeDatePicker();
}

// ═══════════════════════════════════════════════
//  2. КАСТОМНЫЙ СЕЛЕКТ
// ═══════════════════════════════════════════════
let _activeDropdown = null;
let _ddState = null;

/**
 * Заменяет системный <select> стилизованным dropdown.
 * Нативный select скрывается, но остаётся источником значения.
 * @param {HTMLSelectElement} select
 * @param {object} opts
 *   search {boolean}          — строка поиска внутри dropdown
 *   searchPlaceholder {string}
 *   placeholder {string}      — текст при пустом выборе
 *   renderOption {function}   — (option) => html для пункта списка
 *   renderTrigger {function}  — (selectedOption) => html для триггера
 */
export function attachCustomSelect(select, opts = {}) {
  if (!select || select._csInit) return;
  select._csInit = true;
  select._csOpts = opts;
  select.classList.add('cs-hidden');

  // Обёртка: прячем select внутрь и добавляем триггер рядом
  const wrap = document.createElement('div');
  wrap.className = 'cs-wrap';
  select.parentNode.insertBefore(wrap, select);
  wrap.appendChild(select);

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'cs-trigger';
  wrap.appendChild(trigger);

  select._csTrigger = trigger;
  select._csWrap = wrap;

  updateTrigger(select);

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (_activeDropdown && _ddState?.select === select) closeDropdown();
    else openDropdown(select);
  });
}

/** Обновляет текст триггера под текущее значение select. */
function updateTrigger(select) {
  const trigger = select._csTrigger;
  if (!trigger) return;
  const selected = select.options[select.selectedIndex];
  const opts = select._csOpts || {};
  let html;
  if (!selected || selected.value === '') {
    html = `<span class="cs-placeholder">${esc(opts.placeholder || '— Выберите —')}</span>`;
  } else if (opts.renderTrigger) {
    html = opts.renderTrigger(selected);
  } else {
    html = `<span class="cs-text">${esc(selected.textContent)}</span>`;
  }
  trigger.innerHTML = html + `<span class="cs-arrow">${icon('chevronDown', 14)}</span>`;
}

/** Перерисовать триггер после программного изменения значения. */
export function refreshCustomSelect(select) {
  if (select && select._csTrigger) updateTrigger(select);
}

function openDropdown(select) {
  closeDropdown();
  closeDatePicker();
  _activeDropdown = document.createElement('div');
  _activeDropdown.className = 'cs-dropdown';
  _ddState = { select };
  renderDropdown('');
  document.body.appendChild(_activeDropdown);
  positionPop(_activeDropdown, select._csTrigger);
  setTimeout(() => document.addEventListener('click', _onDdOutside, { capture: true }), 0);
}

function renderDropdown(filter) {
  const select = _ddState.select;
  const opts = select._csOpts || {};
  const q = (filter || '').toLowerCase().trim();
  let items = '';
  for (const opt of select.options) {
    const text = opt.textContent;
    if (q && !text.toLowerCase().includes(q)) continue;
    const sel = opt.selected ? ' selected' : '';
    const content = opts.renderOption ? opts.renderOption(opt) : esc(text);
    items += `<div class="cs-option${sel}" data-cs-val="${esc(opt.value)}">` +
      `<span class="cs-option-body">${content}</span>` +
      `${opt.selected ? `<span class="cs-check">${icon('check', 14)}</span>` : ''}</div>`;
  }
  if (!items) items = `<div class="cs-empty">Ничего не найдено</div>`;

  _activeDropdown.innerHTML = `
    ${opts.search ? `
    <div class="cs-search">
      ${icon('search', 14)}
      <input type="text" class="cs-search-input"
        placeholder="${esc(opts.searchPlaceholder || 'Поиск...')}" value="${esc(filter || '')}"/>
    </div>` : ''}
    <div class="cs-options">${items}</div>
  `;

  if (opts.search) {
    const si = _activeDropdown.querySelector('.cs-search-input');
    si.addEventListener('input', () => renderDropdown(si.value));
    si.addEventListener('click', (e) => e.stopPropagation());
    setTimeout(() => si.focus(), 50);
  }

  _activeDropdown.querySelectorAll('.cs-option').forEach(o => {
    o.addEventListener('click', (e) => { e.stopPropagation(); selectOption(select, o.dataset.csVal); });
  });
}

function selectOption(select, value) {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  updateTrigger(select);
  closeDropdown();
}

export function closeDropdown() {
  if (_activeDropdown) { _activeDropdown.remove(); _activeDropdown = null; }
  _ddState = null;
  document.removeEventListener('click', _onDdOutside, { capture: true });
}

function _onDdOutside(e) {
  const trig = _ddState?.select?._csTrigger;
  if (_activeDropdown && !_activeDropdown.contains(e.target) && (!trig || !trig.contains(e.target))) closeDropdown();
}

// ═══════════════════════════════════════════════
//  3. CONFIRM (замена нативного)
// ═══════════════════════════════════════════════
/**
 * Стилизованный confirm. Возвращает Promise<boolean>.
 * @param {string} message
 * @param {object} opts — { okText, cancelText, danger }
 * @returns {Promise<boolean>}
 */
export function showConfirm(message, opts = {}) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'ui-confirm-overlay';
    modal.innerHTML = `
      <div class="ui-confirm-panel">
        <div class="ui-confirm-icon">${icon(opts.danger ? 'trash' : 'checkCircle', 36)}</div>
        <div class="ui-confirm-msg">${esc(message)}</div>
        <div class="ui-confirm-btns">
          <button type="button" class="ui-confirm-cancel">${esc(opts.cancelText || 'Отмена')}</button>
          <button type="button" class="ui-confirm-ok ${opts.danger ? 'danger' : ''}">${esc(opts.okText || 'Да')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const okBtn = modal.querySelector('.ui-confirm-ok');
    const cancelBtn = modal.querySelector('.ui-confirm-cancel');
    okBtn.focus();
    const done = (val) => { modal.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
    okBtn.addEventListener('click', () => done(true));
    cancelBtn.addEventListener('click', () => done(false));
    modal.addEventListener('click', (e) => { if (e.target === modal) done(false); });
    const onKey = (e) => { if (e.key === 'Escape') done(false); };
    document.addEventListener('keydown', onKey);
  });
}

// ═══════════════════════════════════════════════
//  4. CHIP GROUP — множественный выбор (НОВОЕ v3.7.0)
// ═══════════════════════════════════════════════
/**
 * Группа чипов для множественного выбора.
 * Используется для форматов книги (бумажная / электронная / аудио).
 *
 * Значение хранится в скрытом input как JSON-массив.
 *
 * @param {HTMLElement} container — контейнер для чипов
 * @param {object} opts
 *   options {Array<{value, label, icon}>} — варианты
 *   values {string[]} — начальные выбранные значения
 *   inputId {string} — id скрытого input для хранения значения
 *   single {boolean} — если true, выбор только одного (radio-поведение)
 *   onChange {function} — колбэк при изменении (values) => void
 * @returns {object} — { getValues, setValues }
 */
export function attachChipGroup(container, opts = {}) {
  const options = opts.options || [];
  let values = new Set(opts.values || []);
  const single = opts.single || false;

  // Скрытый input для хранения значения
  let hiddenInput = null;
  if (opts.inputId) {
    hiddenInput = document.getElementById(opts.inputId);
    if (!hiddenInput) {
      hiddenInput = document.createElement('input');
      hiddenInput.type = 'hidden';
      hiddenInput.id = opts.inputId;
      container.appendChild(hiddenInput);
    }
    hiddenInput.value = JSON.stringify([...values]);
  }

  function render() {
    container.querySelectorAll('.cg-chip').forEach(c => c.remove());
    options.forEach(opt => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'cg-chip' + (values.has(opt.value) ? ' active' : '');
      chip.dataset.cgVal = opt.value;
      chip.innerHTML = `${opt.icon ? `<span class="cg-icon">${opt.icon}</span>` : ''}${esc(opt.label)}`;
      chip.addEventListener('click', () => {
        if (single) {
          values = new Set(values.has(opt.value) ? [] : [opt.value]);
        } else {
          if (values.has(opt.value)) values.delete(opt.value);
          else values.add(opt.value);
        }
        syncValue();
        render();
        if (opts.onChange) opts.onChange([...values]);
      });
      container.appendChild(chip);
    });
  }

  function syncValue() {
    if (hiddenInput) {
      hiddenInput.value = JSON.stringify([...values]);
      hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  render();

  return {
    getValues: () => [...values],
    setValues: (newVals) => { values = new Set(newVals); syncValue(); render(); },
  };
}

// ═══════════════════════════════════════════════
//  5. CHIP INPUT — автокомплит для тропов/тегов (НОВОЕ v3.7.0)
// ═══════════════════════════════════════════════
/**
 * Поле ввода с чипами и автокомплитом.
 * Используется для тропов в форме книги.
 *
 * Значение хранится в скрытом input как JSON-массив строк.
 *
 * @param {HTMLElement} container — контейнер
 * @param {object} opts
 *   inputId {string} — id скрытого input
 *   suggestions {string[]|function} — подсказки (массив или fn(query) => string[])
 *   values {string[]} — начальные значения
 *   placeholder {string}
 *   maxSuggestions {number} — максимум подсказок (по умолчанию 8)
 *   onChange {function} — колбэк (values) => void
 * @returns {object} — { getValues, setValues, addValue }
 */
export function attachChipInput(container, opts = {}) {
  let values = [...(opts.values || [])];
  const maxSug = opts.maxSuggestions || 8;

  // Скрытый input
  let hiddenInput = null;
  if (opts.inputId) {
    hiddenInput = document.getElementById(opts.inputId);
    if (!hiddenInput) {
      hiddenInput = document.createElement('input');
      hiddenInput.type = 'hidden';
      hiddenInput.id = opts.inputId;
      container.appendChild(hiddenInput);
    }
    hiddenInput.value = JSON.stringify(values);
  }

  // Обёртка
  const wrap = document.createElement('div');
  wrap.className = 'ci-wrap';
  container.appendChild(wrap);

  // Чипы + input в одной строке
  const chipsRow = document.createElement('div');
  chipsRow.className = 'ci-chips';
  wrap.appendChild(chipsRow);

  const textInput = document.createElement('input');
  textInput.type = 'text';
  textInput.className = 'ci-input';
  textInput.placeholder = opts.placeholder || 'Введите и нажмите Enter...';
  textInput.autocomplete = 'off';
  chipsRow.appendChild(textInput);

  // Dropdown подсказок
  const sugBox = document.createElement('div');
  sugBox.className = 'ci-suggestions hidden';
  wrap.appendChild(sugBox);

  function syncValue() {
    if (hiddenInput) {
      hiddenInput.value = JSON.stringify(values);
      hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function renderChips() {
    chipsRow.querySelectorAll('.ci-chip').forEach(c => c.remove());
    values.forEach((val, i) => {
      const chip = document.createElement('span');
      chip.className = 'ci-chip';
      chip.innerHTML = `${esc(val)}<button type="button" class="ci-chip-del" data-ci-idx="${i}">${icon('close', 10)}</button>`;
      chipsRow.insertBefore(chip, textInput);
    });
    chipsRow.querySelectorAll('.ci-chip-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        values.splice(parseInt(btn.dataset.ciIdx), 1);
        syncValue();
        renderChips();
        if (opts.onChange) opts.onChange([...values]);
      });
    });
  }

  function getSuggestions(query) {
    let sugs = [];
    if (typeof opts.suggestions === 'function') {
      sugs = opts.suggestions(query) || [];
    } else if (Array.isArray(opts.suggestions)) {
      const q = (query || '').toLowerCase().trim();
      sugs = opts.suggestions.filter(s =>
        !values.includes(s) && (!q || s.toLowerCase().includes(q))
      );
    }
    return sugs.slice(0, maxSug);
  }

  function renderSuggestions() {
    const q = textInput.value.trim();
    const sugs = getSuggestions(q);
    if (sugs.length === 0) {
      sugBox.classList.add('hidden');
      sugBox.innerHTML = '';
      return;
    }
    sugBox.classList.remove('hidden');
    sugBox.innerHTML = sugs.map(s =>
      `<div class="ci-sug" data-ci-sug="${esc(s)}">${icon('heartHands', 12)} ${esc(s)}</div>`
    ).join('');
    sugBox.querySelectorAll('.ci-sug').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault(); // не терять фокус
        addValue(el.dataset.ciSug);
        textInput.value = '';
        renderSuggestions();
      });
    });
  }

  function addValue(val) {
    const v = val.trim();
    if (!v || values.includes(v)) return;
    values.push(v);
    syncValue();
    renderChips();
    if (opts.onChange) opts.onChange([...values]);
  }

  textInput.addEventListener('input', renderSuggestions);
  textInput.addEventListener('focus', renderSuggestions);
  textInput.addEventListener('blur', () => {
    setTimeout(() => sugBox.classList.add('hidden'), 150);
  });
  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const v = textInput.value.replace(/,/g, '').trim();
      if (v) {
        addValue(v);
        textInput.value = '';
        renderSuggestions();
      }
    }
    if (e.key === 'Backspace' && !textInput.value && values.length > 0) {
      values.pop();
      syncValue();
      renderChips();
      if (opts.onChange) opts.onChange([...values]);
    }
  });

  renderChips();

  return {
    getValues: () => [...values],
    setValues: (newVals) => { values = [...newVals]; syncValue(); renderChips(); },
    addValue,
  };
}

// ═══════════════════════════════════════════════
//  6. СЕЛЕКТ С ДОБАВЛЕНИЕМ СВОЕГО (НОВОЕ v3.7.0)
// ═══════════════════════════════════════════════
/**
 * Кастомный селект + кнопка «Добавить своё».
 * Используется для площадки эл. книги (ЛитРес, Яндекс Книги, Bookmate...).
 *
 * @param {HTMLSelectElement} select
 * @param {object} opts
 *   allowCustom {boolean} — разрешить добавление своего значения
 *   customLabel {string} — текст кнопки (по умолчанию «Другое...»)
 *   onCustom {function} — колбэк при выборе «Другое»
 *   ...остальные opts из attachCustomSelect
 */
export function attachSelectWithCustom(select, opts = {}) {
  attachCustomSelect(select, opts);

  if (!opts.allowCustom) return;

  // Добавляем кнопку «Другое» после триггера
  const trigger = select._csTrigger;
  if (!trigger) return;

  const customBtn = document.createElement('button');
  customBtn.type = 'button';
  customBtn.className = 'cs-custom-btn';
  customBtn.innerHTML = `${icon('plus', 13)} ${esc(opts.customLabel || 'Другое...')}`;
  customBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (opts.onCustom) opts.onCustom();
  });
  trigger.parentNode.appendChild(customBtn);
}

// ═══════════════════════════════════════════════
//  7. АВТО-УЛУЧШЕНИЕ ФОРМЫ
// ═══════════════════════════════════════════════
/**
 * Проходит по контейнеру и применяет кастомные контролы:
 *   — все <select>            → кастомный селект (поиск при длинных списках)
 *   — все <input type="date"> → дата-пикер
 * Для особых случаев (иконки, точный поиск) вызывайте attachCustomSelect отдельно.
 * @param {HTMLElement} container
 * @param {object} baseOpts — дефолтные opts для селектов
 */
export function enhanceForm(container, baseOpts = {}) {
  if (!container) return;
  container.querySelectorAll('select').forEach(sel => {
    const o = { ...baseOpts };
    if (sel.options.length > 8 || sel.dataset.search === '1') o.search = true;
    attachCustomSelect(sel, o);
  });
  container.querySelectorAll('input[type="date"]').forEach(inp => attachDatePicker(inp));
}

/** Закрывает все открытые поповеры (удобно для Escape / навигации). */
export function closeAllPopups() {
  closeDatePicker();
  closeDropdown();
}

// ═══════════════════════════════════════════════
//  8. СТИЛИ (инжектируются один раз)
// ═══════════════════════════════════════════════
const UIKIT_STYLES = `
/* ── Дата-пикер ── */
.dp-input { cursor:pointer; }
.dp-pop {
  position:fixed; z-index:700;
  background:var(--bg-card);
  border:1px solid var(--border);
  border-radius:var(--radius);
  box-shadow:var(--shadow);
  padding:14px;
  animation:popIn .18s var(--ease-bounce);
}
.dp-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; }
.dp-title { font-weight:800; font-size:.9rem; color:var(--accent); text-align:center; flex:1; }
.dp-nav {
  width:30px; height:30px;
  display:flex; align-items:center; justify-content:center;
  border-radius:8px; background:var(--bg-input); color:var(--text-secondary);
  transition:all .15s var(--ease);
}
.dp-nav:hover { background:var(--accent-dim); color:var(--accent); }
.dp-days { display:grid; grid-template-columns:repeat(7,1fr); gap:2px; margin-bottom:4px; }
.dp-dow { text-align:center; font-size:.62rem; font-weight:800; color:var(--text-muted); text-transform:uppercase; padding:4px 0; }
.dp-grid { display:grid; grid-template-columns:repeat(7,1fr); gap:2px; }
.dp-cell {
  aspect-ratio:1; display:flex; align-items:center; justify-content:center;
  border-radius:8px; font-size:.8rem; color:var(--text-primary);
  background:transparent; transition:all .15s var(--ease);
}
.dp-cell.other { color:var(--text-muted); opacity:.35; pointer-events:none; }
.dp-cell:hover { background:var(--bg-card-hover); }
.dp-cell.today { border:1.5px solid var(--accent); color:var(--accent); font-weight:800; }
.dp-cell.selected { background:var(--accent); color:#241a08; font-weight:800; }
.dp-foot { display:flex; justify-content:space-between; gap:8px; margin-top:12px; padding-top:10px; border-top:1px solid var(--border-soft); }
.dp-clear, .dp-today {
  display:inline-flex; align-items:center; gap:6px;
  padding:6px 12px; border-radius:8px;
  font-size:.78rem; font-weight:700;
  background:var(--bg-input); color:var(--text-secondary);
  transition:all .15s var(--ease);
}
.dp-clear:hover { background:var(--red-dim); color:var(--red); }
.dp-today:hover { background:var(--accent-dim); color:var(--accent); }

/* ── Кастомный селект ── */
.cs-hidden { position:absolute; opacity:0; pointer-events:none; width:0; height:0; }
.cs-wrap { position:relative; }
.cs-trigger {
  display:flex; align-items:center; justify-content:space-between; gap:8px;
  width:100%; padding:11px 14px; min-height:44px;
  background:var(--bg-input); border:1px solid var(--border);
  border-radius:var(--radius-sm); color:var(--text-primary);
  font-size:.95rem; text-align:left; cursor:pointer;
  transition:border-color .2s var(--ease), box-shadow .2s var(--ease);
}
.cs-trigger:hover, .cs-trigger:focus { border-color:var(--accent); box-shadow:0 0 0 3px var(--accent-dim); outline:none; }
.cs-placeholder { color:var(--text-muted); }
.cs-text { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cs-arrow { color:var(--text-muted); flex-shrink:0; display:inline-flex; }
.cs-dropdown {
  position:fixed; z-index:700;
  background:var(--bg-card); border:1px solid var(--border);
  border-radius:var(--radius); box-shadow:var(--shadow);
  max-height:280px; display:flex; flex-direction:column;
  animation:popIn .18s var(--ease-bounce);
  overflow:hidden;
}
.cs-search { display:flex; align-items:center; gap:8px; padding:10px 12px; border-bottom:1px solid var(--border-soft); color:var(--text-muted); }
.cs-search-input { flex:1; background:transparent; border:none; outline:none; color:var(--text-primary); font-size:.9rem; padding:4px; }
.cs-options { overflow-y:auto; padding:6px; }
.cs-option {
  display:flex; align-items:center; gap:10px;
  padding:9px 12px; border-radius:8px;
  font-size:.88rem; color:var(--text-secondary); cursor:pointer;
  transition:all .13s var(--ease);
}
.cs-option-body { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:flex; align-items:center; gap:8px; }
.cs-option:hover { background:var(--accent-dim); color:var(--accent); }
.cs-option.selected { color:var(--accent); font-weight:800; background:var(--accent-dim); }
.cs-check { color:var(--accent); display:inline-flex; flex-shrink:0; }
.cs-empty { padding:16px; text-align:center; color:var(--text-muted); font-size:.85rem; }

/* v3.7.0: кнопка «Другое» для селекта */
.cs-custom-btn {
  display:inline-flex; align-items:center; gap:6px;
  padding:8px 14px; margin-top:6px;
  font-size:.8rem; font-weight:700;
  color:var(--accent); background:var(--accent-dim);
  border:1px solid var(--accent-strong); border-radius:var(--radius-sm);
  transition:all .15s var(--ease);
}
.cs-custom-btn:hover { background:var(--accent-strong); transform:translateY(-1px); }

/* ── Confirm ── */
.ui-confirm-overlay {
  position:fixed; inset:0; z-index:800;
  background:var(--bg-overlay); backdrop-filter:blur(3px);
  display:flex; align-items:center; justify-content:center; padding:20px;
  animation:fadeIn .2s var(--ease);
}
.ui-confirm-panel {
  width:100%; max-width:340px;
  background:var(--bg-secondary); border:1px solid var(--border);
  border-radius:var(--radius-lg); padding:26px 22px; text-align:center;
  animation:popIn .3s var(--ease-bounce); box-shadow:var(--shadow);
}
.ui-confirm-icon { color:var(--accent); margin-bottom:12px; display:flex; justify-content:center; }
.ui-confirm-msg { font-size:.95rem; font-weight:600; margin-bottom:20px; line-height:1.5; }
.ui-confirm-btns { display:flex; gap:10px; }
.ui-confirm-cancel, .ui-confirm-ok {
  flex:1; padding:11px; border-radius:var(--radius-sm);
  font-weight:700; font-size:.9rem; transition:all .18s var(--ease);
}
.ui-confirm-cancel { background:var(--bg-card); border:1px solid var(--border); color:var(--text-primary); }
.ui-confirm-cancel:hover { border-color:var(--text-muted); }
.ui-confirm-ok { background:var(--accent); color:#241a08; }
.ui-confirm-ok:hover { background:var(--accent-hover); transform:translateY(-1px); }
.ui-confirm-ok.danger { background:var(--red); color:#fff; }
.ui-confirm-ok.danger:hover { background:var(--red); filter:brightness(1.12); }

/* ── v3.7.0: Chip Group (множественный выбор) ── */
.cg-chip {
  display:inline-flex; align-items:center; gap:7px;
  padding:8px 15px; border-radius:16px;
  font-size:.82rem; font-weight:700;
  background:var(--bg-input); border:1.5px solid var(--border-soft);
  color:var(--text-secondary);
  transition:all .18s var(--ease);
  cursor:pointer;
}
.cg-chip:hover { border-color:var(--border); transform:translateY(-1px); }
.cg-chip.active {
  background:var(--accent-dim);
  border-color:var(--accent) !important;
  color:var(--accent);
  font-weight:800;
  box-shadow:0 2px 8px rgba(232,163,61,.15);
}
.cg-icon { display:inline-flex; align-items:center; }

/* ── v3.7.0: Chip Input (автокомплит для тропов) ── */
.ci-wrap { position:relative; }
.ci-chips {
  display:flex; flex-wrap:wrap; gap:6px;
  padding:8px 10px;
  background:var(--bg-input); border:1px solid var(--border);
  border-radius:var(--radius-sm);
  transition:border-color .2s var(--ease), box-shadow .2s var(--ease);
}
.ci-chips:focus-within {
  border-color:var(--accent);
  box-shadow:0 0 0 3px var(--accent-dim);
}
.ci-chip {
  display:inline-flex; align-items:center; gap:5px;
  padding:4px 8px 4px 12px; border-radius:12px;
  font-size:.78rem; font-weight:700;
  background:var(--pink-dim); color:var(--pink);
  border:1px solid rgba(217,138,168,.3);
  animation:popIn .2s var(--ease-bounce);
}
.ci-chip-del {
  display:inline-flex; align-items:center; justify-content:center;
  width:16px; height:16px; border-radius:50%;
  color:var(--pink); background:transparent;
  transition:background .15s;
  padding:0;
}
.ci-chip-del:hover { background:rgba(217,138,168,.3); }
.ci-input {
  flex:1; min-width:120px;
  background:transparent !important; border:none !important;
  outline:none !important; box-shadow:none !important;
  color:var(--text-primary); font-size:.88rem;
  padding:4px 2px !important;
}
.ci-input::placeholder { color:var(--text-muted); }
.ci-suggestions {
  position:absolute; top:100%; left:0; right:0; z-index:50;
  background:var(--bg-card); border:1px solid var(--border);
  border-radius:var(--radius-sm); box-shadow:var(--shadow);
  max-height:200px; overflow-y:auto;
  margin-top:4px;
  animation:popIn .15s var(--ease);
}
.ci-suggestions.hidden { display:none; }
.ci-sug {
  display:flex; align-items:center; gap:8px;
  padding:9px 12px;
  font-size:.84rem; color:var(--text-secondary);
  cursor:pointer;
  transition:all .13s var(--ease);
}
.ci-sug:hover {
  background:var(--accent-dim); color:var(--accent);
}
`;

if (!document.getElementById('uikit-styles')) {
  const style = document.createElement('style');
  style.id = 'uikit-styles';
  style.textContent = UIKIT_STYLES;
  document.head.appendChild(style);
}
{
  "version": "3.7.1",
  "build": "20260807",
  "cache": "btp-v3.7.1",
  "date": "2026-08-07",
  "changes": [
    "Восстановлен жест «назад» (History API): оверлеи закрываются по одному, двойной «назад» — выход из приложения",
    "Навигация назад по подвкладкам статистики: Финансы → Контент → Книги → главный экран",
    "iOS safe-area: оверлеи учитывают Dynamic Island и home indicator",
    "Обложка из галереи/камеры прямо в форме книги (без необходимости сначала вставлять URL)",
    "Все теги в карточке книги (вместо 3), секция тегов в detail-карточке",
    "Форматы книги: бумажная / электронная / аудио (множественный выбор)",
    "Электронные книги: способ получения (куплена / подписка / файл), площадка (ЛитРес, Яндекс Книги, Bookmate + свои)",
    "Аудиокниги: длительность, чтец",
    "Тропы (tropes): отдельное поле с автокомплитом, отображение в карточке и detail",
    "Microlink: резолв коротких ссылок-редиректов (ozon.ru/t/...), retry с backoff, каскад CORS-прокси",
    "Microlink: окно предпросмотра ВСЕХ найденных полей с ручным маппингом и диагностикой ошибок",
    "Microlink: free по умолчанию + поле для Pro-ключа в Настройках",
    "Отчётность по контенту: reportSent + reportDate, отображение в карточке контента",
    "Ручная синхронизация: импорт JSON без дубликатов (merge по id и title+author)",
    "showConfirm вместо нативного confirm() для всех подтверждений удаления",
    "Вынесен utils.js: разрыв циклических импортов (esc, debounce, fetchT, showToast)",
    "Новый uikit.js: кастомные селекты с поиском, дата-пикер, стилизованный confirm",
    "Фильтр по формату книги в списке (бумажные / электронные / аудио)"
  ],
  "api": {
    "google_books": "бесплатно, без ключа",
    "open_library": "бесплатно, без ключа",
    "litres_catalit": "тестовый анонимный доступ (замените на свои ключи)",
    "litres_partner": "тестовый partner_id=16 (замените на свои ключи)",
    "microlink": "бесплатно 25 запросов/день без ключа; с ключом — pro.microlink.io (лимит по тарифу)",
    "exchange_rates": "open.er-api.com — бесплатно, без ключа"
  },
  "microlink": {
    "endpoint_free": "https://api.microlink.io",
    "endpoint_pro": "https://pro.microlink.io",
    "auth_header": "x-api-key",
    "daily_limit_free": 25,
    "app_guard_free": 20,
    "app_guard_pro": 1000,
    "cache_store": "previews",
    "cache_ttl_days": 7,
    "uses": [
      "превью publishedUrl в контент-плане",
      "глубокое извлечение книги по ссылке (html=true)",
      "окно предпросмотра с маппингом полей (v3.6.0)",
      "резолв коротких ссылок-редиректов (v3.7.0)"
    ]
  },
  "icons": {
    "module": "icons.js",
    "style": "монолинейные SVG 24×24, stroke 1.8, currentColor",
    "sets": ["UI (контурные)", "BRAND (фирменные, fill)", "STATUS_ICONS", "CONTENT_TYPE_ICONS", "CONTENT_STATUS_ICONS", "GOAL_ICONS"]
  },
  "search": {
    "module": "search.js",
    "scopes": ["all", "books", "content", "reviews", "quotes", "collections", "challenges", "series", "tags"],
    "keyboard": ["↑", "↓", "Enter", "Esc"],
    "highlight": "mark",
    "cover_fix": "referrerpolicy + onerror fallback (v3.6.0)"
  },
  "uikit": {
    "module": "uikit.js",
    "components": [
      "DatePicker — кастомный календарь",
      "Select — кастомный dropdown с поиском",
      "Confirm — стилизованный диалог подтверждения"
    ]
  },
  "ocr": {
    "engine": "Tesseract.js v5",
    "languages": ["rus", "eng (опционально)"],
    "offline": true,
    "files": [
      "tesseract.min.js",
      "worker.min.js",
      "tesseract-core-simd.wasm.js",
      "rus.traineddata.gz"
    ]
  }
}