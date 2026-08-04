// ─────────────────────────────────────────────
// 📦 BookTrackerPro — uikit.js
// 🔖 v3.6.0 | 2026-08-04
// 📝 Переиспользуемые UI-компоненты «ночной библиотеки»
//
//    Компоненты:
//      📅 Дата-пикер   — кастомный календарь вместо <input type=date>
//      🔽 Кастомный селект — вместо системного <select>, с поиском
//      ✅ Confirm       — стилизованный диалог вместо нативного confirm()
//
//    Принципы:
//      — Нативный контрол остаётся в DOM и является источником истины.
//        Код форм продолжает читать .value без изменений.
//      — Никаких эмодзи в UI — только SVG из icons.js.
//      — Стили инжектируются один раз, соответствуют app.css.
//
//    Использование:
//      import { enhanceForm, attachCustomSelect, showConfirm } from './uikit.js';
//      enhanceForm(formBody);                    // авто-улучшение всех контролов
//      attachCustomSelect(sel, { search: true, renderOption: fn });
//      const ok = await showConfirm('Удалить книгу?', { danger: true });
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
  return isNaN(d) ? null : d;
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

// ═══ Общее позиционирование поповера ═══
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
//  4. АВТО-УЛУЧШЕНИЕ ФОРМЫ
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
//  5. СТИЛИ (инжектируются один раз)
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
`;
if (!document.getElementById('uikit-styles')) {
  const style = document.createElement('style');
  style.id = 'uikit-styles';
  style.textContent = UIKIT_STYLES;
  document.head.appendChild(style);
}