// 📦 BookTrackerPro — content.js
// 🔖 v3.8.5 | 2026-08-17
// 📝 Контент-план для бук-блогера
//
//    Новое в 3.8.5:
//      — openContentDetail() — read-only карточка контента.
//        Открывается вместо редактора при клике по контенту
//        (из карточки книги, контент-плана, календаря).
//        Внутри — «Редактировать», «Удалить», «→ след. статус».
//
//    Сохранено из 3.8.4:
//      — defaultPlatform из настроек (3-й аргумент openContentForm)
//      — Отчётность издательству, превью публикаций (Microlink)
//      — SVG-иконки, кастомные селекты/дата-пикеры
// ─────────────────────────────────────────────
import { addContentToBook, updateContentInBook, removeContentFromBook, loadBooks } from './db.js';
import { esc, showToast, trackOverlay, untrackOverlay, formatDateRu } from './utils.js';
import { fetchLinkPreview } from './microlink.js';
import { brandIcon, icon, CONTENT_TYPE_ICONS, CONTENT_STATUS_ICONS } from './icons.js';
import { attachCustomSelect, attachDatePicker, showConfirm } from './uikit.js';

// ═══════════════════════════════════════════════
//  КОНСТАНТЫ
// ═══════════════════════════════════════════════
export const CONTENT_TYPES = {
  unboxing:     { icon: '📦', label: 'Распаковка',           color: 'unboxing' },
  read_with_me: { icon: '📖', label: 'Начни читать со мной', color: 'read_with_me' },
  review:       { icon: '💬', label: 'Отзыв / Мнение',       color: 'review' },
  lipsync:      { icon: '🎵', label: 'Липсинг',              color: 'lipsync' },
  top:          { icon: '🏆', label: 'Подборка / Топ',       color: 'top' },
  quote:        { icon: '✨', label: 'Цитата',                color: 'quote' },
  comparison:   { icon: '⚖️', label: 'Сравнение',            color: 'comparison' },
  haul:         { icon: '🛒', label: 'Книжный haul',          color: 'haul' },
};
export const CONTENT_STATUSES = {
  idea:      { icon: '💡', label: 'Идея',          class: 'status-idea' },
  planned:   { icon: '📅', label: 'Запланировано', class: 'status-planned' },
  filming:   { icon: '🎥', label: 'Снимаю',        class: 'status-filming' },
  editing:   { icon: '✂️', label: 'Монтаж',        class: 'status-editing' },
  published: { icon: '📤', label: 'Опубликовано',  class: 'status-published' },
};
export const PLATFORMS = {
  youtube:   { icon: '▶️', label: 'YouTube',   color: '#ff5b5b' },
  tiktok:    { icon: '🎵', label: 'TikTok',    color: '#7fb8b0' },
  telegram:  { icon: '✈️', label: 'Telegram',  color: '#8ab4e8' },
  vk:        { icon: '🔵', label: 'VK',        color: '#7aa3e0' },
  dzen:      { icon: '📰', label: 'Дзен',      color: '#e0955c' },
  instagram: { icon: '📸', label: 'Instagram', color: '#d98aa8' },
  pinterest: { icon: '📌', label: 'Pinterest', color: '#e06a5c' },
  threads:   { icon: '🧵', label: 'Threads',   color: '#b3a48e' },
};

export function platformIcon(key, size = 16) {
  const p = PLATFORMS[key];
  return brandIcon(key, size, p?.color || 'currentColor');
}

const STATUS_ORDER = ['idea', 'planned', 'filming', 'editing', 'published'];

// ═══════════════════════════════════════════════
//  1. ВКЛАДКА «КОНТЕНТ»
// ═══════════════════════════════════════════════
export function renderContentTab(container, books, settings, callbacks) {
  const allContent = [];
  for (const book of books) {
    for (const item of (book.contentItems || [])) {
      allContent.push({
        ...item,
        bookId: book.id,
        bookTitle: book.id === '__no_book__' ? '— Без книги —' : book.title,
        bookAuthor: book.author,
        bookCover: book.coverUrl || '',
      });
    }
  }
  allContent.sort((a, b) => {
    const da = a.plannedDate || a.publishedDate || a.createdAt || '';
    const db = b.plannedDate || b.publishedDate || b.createdAt || '';
    return db.localeCompare(da);
  });

  if (!container._contentFilter) container._contentFilter = 'all';
  const currentFilter = container._contentFilter;

  const filters = [
    { id: 'all',       label: `Все (${allContent.length})`, ic: '' },
    { id: 'idea',      label: 'Идеи',          ic: 'lightbulb' },
    { id: 'planned',   label: 'Запланировано', ic: 'calendar' },
    { id: 'filming',   label: 'Снимаю',        ic: 'video' },
    { id: 'editing',   label: 'Монтаж',        ic: 'scissors' },
    { id: 'published', label: 'Опубликовано',  ic: 'send' },
  ];

  const filtered = currentFilter === 'all'
    ? allContent
    : allContent.filter(c => c.status === currentFilter);

  const groups = groupByDate(filtered);

  container.innerHTML = `
    <div class="filter-bar no-scrollbar">
      ${filters.map(f => `
        <button class="filter-chip ${currentFilter === f.id ? 'active' : ''}" data-cfilter="${f.id}">
          ${f.ic ? icon(f.ic, 13) + ' ' : ''}${f.label}
        </button>
      `).join('')}
    </div>
    ${filtered.length === 0 ? `
      <div class="empty-state">
        <div class="empty-icon">${icon('film', 56)}</div>
        <div class="empty-title">Нет контента</div>
        <div class="empty-text">
          Добавьте контент-элемент к книге —
          распаковку, отзыв, липсинг или подборку
        </div>
        <button id="content-empty-add" class="btn-primary mt-16" style="width:auto">
          ${icon('plus', 16)} Добавить контент
        </button>
      </div>
    ` : `
      ${groups.map(g => `
        <div class="mb-16">
          <div class="text-small text-muted mb-8" style="font-weight:800;letter-spacing:.04em">
            ${icon(g.ic || 'calendar', 12)} ${g.label}
          </div>
          ${g.items.map(c => renderContentCard(c)).join('')}
        </div>
      `).join('')}
    `}
    <button id="content-add-btn" class="btn-primary mt-16">${icon('plus', 16)} Новый контент</button>
  `;

  container.querySelectorAll('[data-cfilter]').forEach(chip => {
    chip.addEventListener('click', () => {
      container._contentFilter = chip.dataset.cfilter;
      renderContentTab(container, books, settings, callbacks);
    });
  });

  const addBtn = container.querySelector('#content-add-btn');
  const emptyAdd = container.querySelector('#content-empty-add');
  if (addBtn) addBtn.addEventListener('click', () => callbacks.onAdd());
  if (emptyAdd) emptyAdd.addEventListener('click', () => callbacks.onAdd());

  // 🆕 v3.8.5: клик по карточке → READ-ONLY карточка (onEdit теперь = onOpenDetail)
  container.querySelectorAll('.content-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('button') || e.target.closest('a')) return;
      callbacks.onEdit(
        findContentItem(books, card.dataset.bookId, card.dataset.contentId),
        card.dataset.bookId
      );
    });
  });

  container.querySelectorAll('[data-status-btn]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      callbacks.onStatusChange(btn.dataset.contentId, btn.dataset.bookId, btn.dataset.newStatus);
    });
  });

  container.querySelectorAll('[data-delete-content]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      callbacks.onDelete(btn.dataset.contentId, btn.dataset.bookId);
    });
  });

  container.querySelectorAll('[data-copy-url]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard?.writeText(btn.dataset.copyUrl).then(() =>
        showToast('🔗 Ссылка скопирована', 'success'));
    });
  });

  loadContentPreviews(container);
}

// ═══════════════════════════════════════════════
//  2. КАРТОЧКА КОНТЕНТА (в списке)
// ═══════════════════════════════════════════════
function renderContentCard(item) {
  const type = CONTENT_TYPES[item.type] || { icon: '🎬', label: item.type, color: '' };
  const status = CONTENT_STATUSES[item.status] || { icon: '❓', label: item.status, class: '' };
  const platform = PLATFORMS[item.platform] || { icon: '🌐', label: item.platform || '' };

  const idx = STATUS_ORDER.indexOf(item.status);
  const nextStatus = idx < STATUS_ORDER.length - 1 ? STATUS_ORDER[idx + 1] : null;
  const nextInfo = nextStatus ? CONTENT_STATUSES[nextStatus] : null;
  const dateStr = item.publishedDate || item.plannedDate || '';

  const reportSent = item.reportSent || false;
  const reportBadge = reportSent
    ? `<span class="cc-report-badge sent" title="Отчёт отправлен">${icon('checkBadge', 11)} отчёт</span>`
    : '';

  return `
    <div class="content-card" data-book-id="${item.bookId}" data-content-id="${item.id}">
      <div class="content-icon ${type.color}">${icon(CONTENT_TYPE_ICONS[item.type] || 'film', 22)}</div>
      <div class="content-info">
        <div class="content-title">${esc(item.title || type.label)}</div>
        <div class="content-book">${icon('bookClosed', 12)} ${esc(item.bookTitle)}</div>
        <div class="content-meta">
          <span class="content-list-status ${status.class}">${icon(CONTENT_STATUS_ICONS[item.status] || 'film', 12)} ${status.label}</span>
          <span class="platform-badge">${brandIcon(item.platform, 12)} ${platform.label}</span>
          ${dateStr ? `<span class="content-date">${icon('calendar', 11)} ${dateStr}</span>` : ''}
          ${reportBadge}
        </div>
        ${item.publishedUrl ? `
          <div class="content-published" data-preview-url="${esc(item.publishedUrl)}">
            <div class="content-meta mt-8">
              <a href="${esc(item.publishedUrl)}" target="_blank" rel="noopener" class="text-small">${icon('external', 12)} Открыть</a>
              <button data-copy-url="${esc(item.publishedUrl)}"
                style="background:none;border:none;cursor:pointer;font-size:.78rem;color:var(--text-muted);display:inline-flex;align-items:center;gap:4px">
                ${icon('copy', 11)} Копировать ссылку
              </button>
            </div>
          </div>
        ` : ''}
        ${item.notes ? `<div class="text-small text-muted mt-8 truncate">${esc(item.notes)}</div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
        ${nextInfo ? `
          <button data-status-btn
            data-book-id="${item.bookId}"
            data-content-id="${item.id}"
            data-new-status="${nextStatus}"
            class="btn-small" style="padding:6px 10px"
            aria-label="Следующий статус: ${nextInfo.label}"
            title="→ ${nextInfo.label}">
            ${icon(CONTENT_STATUS_ICONS[nextStatus] || 'film', 14)}
          </button>
        ` : `<span style="text-align:center;color:var(--accent)">${icon('trophy', 18)}</span>`}
        <button data-delete-content
          data-book-id="${item.bookId}"
          data-content-id="${item.id}"
          class="icon-btn" style="width:32px;height:32px"
          aria-label="Удалить" title="Удалить">
          ${icon('trash', 15)}
        </button>
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════
//  2.1 ПРЕВЬЮ ПУБЛИКАЦИЙ (Microlink)
// ═══════════════════════════════════════════════
function loadContentPreviews(container) {
  const els = container.querySelectorAll('.content-published[data-preview-url], .cd-published[data-preview-url]');
  if (els.length === 0) return;
  if (!('IntersectionObserver' in window)) { els.forEach(hydratePreview); return; }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      hydratePreview(entry.target);
    }
  }, { rootMargin: '200px' });
  els.forEach(el => observer.observe(el));
}

async function hydratePreview(el) {
  const url = el.dataset.previewUrl;
  if (!url || el.dataset.hydrated) return;
  el.dataset.hydrated = '1';
  const preview = await fetchLinkPreview(url);
  if (!preview || (!preview.image && !preview.title)) return;
  const card = document.createElement('a');
  card.className = 'link-preview-card';
  card.href = url;
  card.target = '_blank';
  card.rel = 'noopener';
  card.innerHTML = `
    ${preview.image
      ? `<img class="link-preview-img" src="${preview.image}" alt="" loading="lazy"/>`
      : `<div class="link-preview-img link-preview-img-empty">${platformIcon(preview.source, 18)}</div>`}
    <div class="link-preview-info">
      <div class="link-preview-title">${esc(preview.title || url)}</div>
      <div class="link-preview-meta">
        ${platformIcon(preview.source, 11)}
        ${esc(preview.publisher || preview.source)}
      </div>
    </div>
  `;
  el.insertBefore(card, el.firstChild);
}

// ═══════════════════════════════════════════════
//  🆕 2.2 READ-ONLY КАРТОЧКА КОНТЕНТА (v3.8.5)
// ═══════════════════════════════════════════════
/**
 * Открывает карточку контента (просмотр), НЕ редактор.
 * Самодостаточна: редактирование / удаление / смена статуса / превью.
 *
 * @param {object} item  — контент-элемент
 * @param {object} book  — книга-владелец (может быть null)
 * @param {object} opts  — { settings } (для defaultPlatform при редактировании)
 */
export function openContentDetail(item, book, opts = {}) {
  if (!item) return;
  const settings = opts.settings || {};

  const type = CONTENT_TYPES[item.type] || { label: item.type || 'Контент', color: '' };
  const status = CONTENT_STATUSES[item.status] || { label: item.status || '', class: '' };
  const platform = PLATFORMS[item.platform] || { label: item.platform || '' };
  const idx = STATUS_ORDER.indexOf(item.status);
  const nextStatus = idx < STATUS_ORDER.length - 1 ? STATUS_ORDER[idx + 1] : null;
  const nextInfo = nextStatus ? CONTENT_STATUSES[nextStatus] : null;

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `
    <div class="overlay-panel" style="max-height:85dvh">
      <div class="overlay-header">
        <h2><span class="content-icon ${type.color}" style="width:34px;height:34px">${icon(CONTENT_TYPE_ICONS[item.type] || 'film', 18)}</span> ${esc(item.title || type.label)}</h2>
        <button class="icon-btn cd-close" aria-label="Закрыть">${icon('close', 16)}</button>
      </div>
      <div class="overlay-body">
        <!-- Книга -->
        ${book ? `
          <div class="cd-book">
            ${book.coverUrl
              ? `<img src="${book.coverUrl}" referrerpolicy="no-referrer" alt="" style="width:40px;height:60px;border-radius:5px;object-fit:cover"/>`
              : `<span style="width:40px;height:60px;display:flex;align-items:center;justify-content:center;background:var(--bg-input);border-radius:5px">${icon('bookClosed', 20)}</span>`}
            <div>
              <div style="font-weight:700;font-size:.9rem">${esc(book.title)}</div>
              <div class="text-small text-muted">${esc(book.author)}</div>
            </div>
          </div>
        ` : ''}

        <!-- Статусы -->
        <div class="content-meta" style="margin:12px 0">
          <span class="content-list-status ${status.class}">${icon(CONTENT_STATUS_ICONS[item.status] || 'film', 12)} ${status.label}</span>
          <span class="platform-badge">${brandIcon(item.platform, 12)} ${platform.label}</span>
          ${item.reportSent ? `<span class="cc-report-badge sent">${icon('checkBadge', 11)} отчёт</span>` : ''}
        </div>

        <!-- Даты -->
        <div class="cd-dates">
          ${item.plannedDate ? `<div class="cd-date">${icon('calendar', 13)} План: <b>${formatDateRu(item.plannedDate)}</b></div>` : ''}
          ${item.publishedDate ? `<div class="cd-date">${icon('send', 13)} Публикация: <b>${formatDateRu(item.publishedDate)}</b></div>` : ''}
          ${item.reportSent && item.reportDate ? `<div class="cd-date">${icon('report', 13)} Отчёт: <b>${formatDateRu(item.reportDate)}</b></div>` : ''}
        </div>

        <!-- Заметки -->
        ${item.notes ? `
          <div class="detail-section">
            <h3>${icon('edit', 14)} Заметки</h3>
            <div class="detail-description">${esc(item.notes)}</div>
          </div>
        ` : ''}

        <!-- Публикация -->
        ${item.publishedUrl ? `
          <div class="detail-section">
            <h3>${icon('link', 14)} Публикация</h3>
            <div class="cd-published" data-preview-url="${esc(item.publishedUrl)}">
              <a href="${esc(item.publishedUrl)}" target="_blank" rel="noopener" class="text-small">
                ${icon('external', 12)} Открыть ссылку
              </a>
            </div>
          </div>
        ` : ''}

        <!-- Действия -->
        <div class="btn-group mt-16">
          ${nextInfo ? `
            <button id="cd-next" class="btn-primary">
              ${icon(CONTENT_STATUS_ICONS[nextStatus] || 'film', 14)} → ${nextInfo.label}
            </button>
          ` : ''}
          <button id="cd-edit" class="btn-secondary">${icon('edit', 14)} Редактировать</button>
          <button id="cd-delete" class="btn-danger" aria-label="Удалить">${icon('trash', 14)}</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  trackOverlay(overlay);

  const close = () => {
    overlay.remove();
    untrackOverlay(overlay);
    document.body.style.overflow = '';
  };

  overlay.querySelector('.cd-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  overlay.querySelector('#cd-edit').addEventListener('click', () => {
    close();
    openContentForm(item, book?.id, settings);
  });

  overlay.querySelector('#cd-delete').addEventListener('click', async () => {
    const ok = await showConfirm('Удалить этот контент?', { danger: true, okText: 'Удалить' });
    if (!ok) return;
    await removeContentFromBook(book?.id, item.id);
    close();
    showToast('🗑️ Контент удалён', 'info');
    document.dispatchEvent(new CustomEvent('data-changed'));
  });

  const nextBtn = overlay.querySelector('#cd-next');
  if (nextBtn) nextBtn.addEventListener('click', async () => {
    await updateContentStatus(book?.id, item.id, nextStatus);
    close();
    if (nextStatus === 'published') showToast('📤 Контент опубликован! 🎉', 'success');
    else showToast(`Статус: ${nextInfo.label}`, 'success');
    document.dispatchEvent(new CustomEvent('data-changed'));
  });

  loadContentPreviews(overlay);
}

// ═══════════════════════════════════════════════
//  3. ФОРМА КОНТЕНТА (редактор)
// ═══════════════════════════════════════════════
export function openContentForm(item, bookId, settings = {}) {
  const overlay = document.getElementById('content-overlay');
  const title = document.getElementById('content-form-title');
  const body = document.getElementById('content-form-body');
  if (!overlay || !body) return;

  title.innerHTML = item
    ? `${icon('edit', 18)} Редактировать контент`
    : `${icon('film', 18)} Новый контент`;

  loadBooks().then(books => {
    renderContentFormBody(body, books, item, bookId, settings);
  });

  overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function renderContentFormBody(body, books, item, preselectedBookId, settings = {}) {
  const c = item || {};
  const defaultPlatform = settings.defaultPlatform || 'youtube';

  body.innerHTML = `
    <div class="form-group">
      <label>${icon('bookClosed', 13)} Книга</label>
      <select id="cf-book" required>
        <option value="">— Без книги (общий контент) —</option>
        ${books.filter(b => b.id !== '__no_book__').map(b => `
          <option value="${b.id}" ${(c.bookId || preselectedBookId) === b.id ? 'selected' : ''}>
            ${esc(b.title)} — ${esc(b.author)}
          </option>
        `).join('')}
      </select>
    </div>
    <div class="form-group">
      <label>${icon('film', 13)} Тип контента *</label>
      <div class="content-type-grid">
        ${Object.entries(CONTENT_TYPES).map(([key, t]) => `
          <button class="content-type-btn ${(c.type || 'unboxing') === key ? 'active' : ''}" data-type="${key}">
            <span class="content-type-icon">${icon(CONTENT_TYPE_ICONS[key] || 'film', 22)}</span>
            <span class="content-type-label">${t.label}</span>
          </button>
        `).join('')}
      </div>
    </div>
    <div class="form-group">
      <label>${icon('edit', 13)} Название</label>
      <input type="text" id="cf-title" value="${esc(c.title || '')}" placeholder="Распаковка июльской посылки ЭКСМО"/>
      <div class="form-hint">Если пусто — будет использовано название типа</div>
    </div>
    <div class="form-group">
      <label>${icon('globe', 13)} Площадка</label>
      <div class="platform-grid">
        ${Object.entries(PLATFORMS).map(([key, p]) => `
          <button class="platform-btn ${(c.platform || defaultPlatform) === key ? 'active' : ''}" data-platform="${key}">
            ${brandIcon(key, 15)} ${p.label}
          </button>
        `).join('')}
      </div>
    </div>
    <div class="form-group">
      <label>${icon('chart', 13)} Статус</label>
      <select id="cf-status">
        ${Object.entries(CONTENT_STATUSES).map(([key, s]) => `
          <option value="${key}" ${(c.status || 'idea') === key ? 'selected' : ''}>${s.label}</option>
        `).join('')}
      </select>
    </div>
    <div class="form-row">
      <div class="form-group"><label>${icon('calendar', 13)} Дата плана</label><input type="date" id="cf-planned" value="${c.plannedDate || ''}"/></div>
      <div class="form-group"><label>${icon('send', 13)} Дата публикации</label><input type="date" id="cf-published" value="${c.publishedDate || ''}"/></div>
    </div>
    <div class="form-group">
      <label>${icon('link', 13)} Ссылка на публикацию</label>
      <input type="url" id="cf-url" value="${esc(c.publishedUrl || '')}" placeholder="https://youtube.com/watch?v=..."/>
      <div class="form-hint">Превью подтянется автоматически (Microlink)</div>
    </div>
    <div class="form-group">
      <label>${icon('edit', 13)} Заметки</label>
      <textarea id="cf-notes" rows="3" placeholder="Идеи для съёмки, сценарий, реквизит...">${esc(c.notes || '')}</textarea>
    </div>
    <div class="form-section">
      <h3>${icon('report', 15)} Отчёт издательству</h3>
      <div class="toggle-row">
        <span class="toggle-label">${icon('send', 14)} Отчёт отправлен</span>
        <div class="toggle ${c.reportSent ? 'active' : ''}" id="cf-report-toggle" role="switch" aria-checked="${!!c.reportSent}" tabindex="0"></div>
      </div>
      <div id="cf-report-fields" class="${c.reportSent ? '' : 'hidden'}">
        <div class="form-group">
          <label>${icon('calendar', 13)} Дата отправки</label>
          <input type="date" id="cf-report-date" value="${c.reportDate || ''}"/>
        </div>
      </div>
      <div class="form-hint">Отметьте, если отчёт о контенте отправлен издательству или автору</div>
    </div>
    <div class="btn-group">
      <button id="cf-save" class="btn-primary">${icon('check', 15)} Сохранить</button>
      ${item ? `<button id="cf-delete" class="btn-danger">${icon('trash', 15)} Удалить</button>` : ''}
    </div>
  `;

  let selectedType = c.type || 'unboxing';
  let selectedPlatform = c.platform || defaultPlatform;

  body.querySelectorAll('.content-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      body.querySelectorAll('.content-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedType = btn.dataset.type;
    });
  });
  body.querySelectorAll('.platform-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      body.querySelectorAll('.platform-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedPlatform = btn.dataset.platform;
    });
  });

  attachCustomSelect(body.querySelector('#cf-book'), {
    search: true,
    searchPlaceholder: 'Название или автор...',
  });
  const statusRenderer = (opt) => {
    const s = CONTENT_STATUSES[opt.value];
    if (!s) return esc(opt.textContent);
    return `<span style="display:flex;align-items:center;gap:8px">${icon(CONTENT_STATUS_ICONS[opt.value] || 'film', 15)} ${esc(s.label)}</span>`;
  };
  attachCustomSelect(body.querySelector('#cf-status'), {
    renderOption: statusRenderer,
    renderTrigger: statusRenderer,
  });
  attachDatePicker(body.querySelector('#cf-planned'));
  attachDatePicker(body.querySelector('#cf-published'));
  attachDatePicker(body.querySelector('#cf-report-date'));

  const reportToggle = body.querySelector('#cf-report-toggle');
  const toggleReport = function() {
    this.classList.toggle('active');
    this.setAttribute('aria-checked', this.classList.contains('active'));
    body.querySelector('#cf-report-fields').classList.toggle('hidden');
  };
  reportToggle.addEventListener('click', toggleReport);
  reportToggle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleReport.call(reportToggle); }
  });

  body.querySelector('#cf-save').addEventListener('click', async () => {
    const bookId = body.querySelector('#cf-book').value;
    const isReportSent = body.querySelector('#cf-report-toggle').classList.contains('active');
    const contentData = {
      id: c.id || `content_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: selectedType,
      title: body.querySelector('#cf-title').value.trim(),
      platform: selectedPlatform,
      status: body.querySelector('#cf-status').value,
      plannedDate: body.querySelector('#cf-planned').value,
      publishedDate: body.querySelector('#cf-published').value,
      publishedUrl: body.querySelector('#cf-url').value.trim(),
      notes: body.querySelector('#cf-notes').value.trim(),
      reportSent: isReportSent,
      reportDate: isReportSent ? body.querySelector('#cf-report-date').value : '',
      createdAt: c.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      bookId: bookId || null,
    };
    try {
      const finalBookId = bookId || '__no_book__';
      if (item) {
        const oldBookId = item.bookId || c.bookId || bookId;
        if (oldBookId && oldBookId !== finalBookId) {
          await removeContentFromBook(oldBookId, contentData.id);
          await addContentToBook(finalBookId, contentData);
        } else {
          await updateContentInBook(finalBookId, contentData.id, contentData);
        }
        showToast('✅ Контент обновлён', 'success');
      } else {
        await addContentToBook(finalBookId, contentData);
        showToast('✅ Контент добавлен', 'success');
      }
      closeContentForm();
      document.dispatchEvent(new CustomEvent('data-changed'));
    } catch (e) {
      showToast('❌ Ошибка сохранения', 'error');
      console.error('[Content] Save error:', e);
    }
  });

  const delBtn = body.querySelector('#cf-delete');
  if (delBtn) {
    delBtn.addEventListener('click', async () => {
      const ok = await showConfirm('Удалить этот контент?', { danger: true, okText: 'Удалить' });
      if (!ok) return;
      try {
        const bookId = body.querySelector('#cf-book').value || c.bookId;
        await removeContentFromBook(bookId, c.id);
        showToast('🗑️ Контент удалён', 'info');
        closeContentForm();
        document.dispatchEvent(new CustomEvent('data-changed'));
      } catch { showToast('❌ Ошибка удаления', 'error'); }
    });
  }
}

function closeContentForm() {
  const overlay = document.getElementById('content-overlay');
  if (overlay) {
    overlay.classList.add('hidden');
    document.body.style.overflow = '';
  }
}

// ═══════════════════════════════════════════════
//  4. ОПЕРАЦИИ (для app.js)
// ═══════════════════════════════════════════════
export async function deleteContentItem(bookId, contentId) {
  await removeContentFromBook(bookId, contentId);
}

export async function updateContentStatus(bookId, contentId, newStatus) {
  const updates = { status: newStatus, updatedAt: new Date().toISOString() };
  if (newStatus === 'published') {
    const books = await loadBooks();
    const book = books.find(b => b.id === bookId);
    const item = (book?.contentItems || []).find(ct => ct.id === contentId);
    if (item && !item.publishedDate) {
      updates.publishedDate = new Date().toISOString().slice(0, 10);
    }
  }
  await updateContentInBook(bookId, contentId, updates);
}

// ═══════════════════════════════════════════════
//  5. УТИЛИТЫ
// ═══════════════════════════════════════════════
function findContentItem(books, bookId, contentId) {
  const book = books.find(b => b.id === bookId);
  if (!book) return null;
  return (book.contentItems || []).find(c => c.id === contentId) || null;
}

// 🆕 v3.8.4: группы дат с SVG-иконками
function groupByDate(items) {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const groups = {};
  const ensure = (label, ic) => {
    if (!groups[label]) groups[label] = { label, ic, items: [] };
    return groups[label];
  };
  for (const item of items) {
    const date = item.plannedDate || item.publishedDate || '';
    if (!date) ensure('Без даты', 'calendarX').items.push(item);
    else if (date === today) ensure('Сегодня', 'calendar').items.push(item);
    else if (date === tomorrow) ensure('Завтра', 'calendarPlus').items.push(item);
    else if (date === yesterday) ensure('Вчера', 'calendarX').items.push(item);
    else if (date < today) ensure('Прошедшие', 'clock').items.push(item);
    else ensure(formatDateRu(date), 'calendar').items.push(item);
  }
  const order = ['Сегодня', 'Завтра'];
  return Object.values(groups).sort((a, b) => {
    const ai = order.indexOf(a.label), bi = order.indexOf(b.label);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    if (a.label === 'Без даты') return 1;
    if (b.label === 'Без даты') return -1;
    if (a.label === 'Прошедшие') return 1;
    if (b.label === 'Прошедшие') return -1;
    return a.label.localeCompare(b.label, 'ru');
  });
}

// ═══════════════════════════════════════════════
//  6. СТИЛИ (инжектируются один раз)
// ═══════════════════════════════════════════════
const CONTENT_FORM_STYLES = `
.content-type-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; }
.content-type-btn {
  display:flex; flex-direction:column; align-items:center; gap:6px;
  padding:12px 4px; border-radius:10px;
  background:var(--bg-input); border:2px solid transparent;
  cursor:pointer; transition:all .2s var(--ease);
  font-size:.72rem; color:var(--text-secondary);
}
.content-type-btn:hover { border-color:var(--border); transform:translateY(-1px); }
.content-type-btn.active {
  border-color:var(--accent); background:var(--accent-dim); color:var(--accent);
}
.content-type-icon { display:flex; align-items:center; justify-content:center; color:var(--accent); }
.content-type-label { text-align:center; line-height:1.2; }
.platform-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; }
.platform-btn {
  display:flex; align-items:center; justify-content:center; gap:6px;
  padding:8px 6px; border-radius:8px;
  background:var(--bg-input); border:2px solid transparent;
  cursor:pointer; font-size:.78rem; color:var(--text-secondary);
  transition:all .2s var(--ease); text-align:center;
}
.platform-btn:hover { border-color:var(--border); transform:translateY(-1px); }
.platform-btn.active {
  border-color:var(--accent); background:var(--accent-dim);
  color:var(--accent); font-weight:700;
}
.cc-report-badge {
  display:inline-flex; align-items:center; gap:3px;
  padding:2px 8px; border-radius:10px;
  font-size:.66rem; font-weight:800;
  text-transform:uppercase; letter-spacing:.04em;
}
.cc-report-badge.sent { background:var(--green-dim); color:var(--green); }
/* 🆕 v3.8.5: карточка контента */
.cd-book { display:flex; gap:10px; align-items:center; }
.cd-dates { display:flex; flex-direction:column; gap:6px; }
.cd-date { display:flex; align-items:center; gap:6px; font-size:.85rem; color:var(--text-secondary); }
.cd-date b { color:var(--text-primary); font-weight:700; }
@media (max-width:400px) {
  .content-type-grid { grid-template-columns:repeat(2,1fr); }
  .platform-grid { grid-template-columns:repeat(2,1fr); }
}
`;
if (!document.getElementById('content-form-styles')) {
  const style = document.createElement('style');
  style.id = 'content-form-styles';
  style.textContent = CONTENT_FORM_STYLES;
  document.head.appendChild(style);
}