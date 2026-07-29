// ─────────────────────────────────────────────
// 📦 BookTrackerPro — content.js
// 🔖 v3.4.0 | 2026-07-29
// 📝 Контент-план для бук-блогера
//
//    Типы контента:
//      📦 unboxing · 📖 read_with_me · 💬 review · 🎵 lipsync
//      🏆 top · ✨ quote · ⚖️ comparison · 🛒 haul
//
//    Статусы:
//      💡 idea → 📅 planned → 🎥 filming → ✂️ editing → 📤 published
//
//    Площадки (8):
//      ▶️ YouTube · 🎵 TikTok · ✈️ Telegram · 🔵 VK · 📰 Дзен
//      📸 Instagram · 📌 Pinterest · 🧵 Threads
//
//    Новое в 3.4.0:
//      — Pinterest + Threads
//      — SVG-иконки соцсетей (platformIcon)
//      — Превью публикаций через Microlink (лениво, с кешем)
//
//    Стили .p-icon и .link-preview-* — в app.css
// ─────────────────────────────────────────────

import { addContentToBook, updateContentInBook, removeContentFromBook, loadBooks } from './db.js';
import { esc, showToast } from './app.js';
import { fetchLinkPreview } from './microlink.js';

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

// Площадки: иконка (эмодзи-фолбэк) + фирменный цвет
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

// SVG-иконки соцсетей (fill="currentColor" — красятся через color)
export const PLATFORM_ICONS = {
  youtube: `<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.5 3.55 12 3.55 12 3.55s-7.5 0-9.38.5A3.02 3.02 0 0 0 .5 6.19C0 8.07 0 12 0 12s0 3.93.5 5.81a3.02 3.02 0 0 0 2.12 2.14c1.88.5 9.38.5 9.38.5s7.5 0 9.38-.5a3.02 3.02 0 0 0 2.12-2.14C24 15.93 24 12 24 12s0-3.93-.5-5.81zM9.55 15.57V8.43L15.82 12l-6.27 3.57z"/></svg>`,
  tiktok: `<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M12.53.02C13.84 0 15.14.01 16.44 0c.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>`,
  telegram: `<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M11.94 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0h-.06zm4.97 7.22c.1 0 .32.02.46.14a.5.5 0 0 1 .17.33c.02.09.04.3.02.47-.18 1.9-.96 6.5-1.36 8.63-.17.9-.5 1.2-.82 1.23-.7.06-1.23-.46-1.9-.9-1.06-.7-1.65-1.13-2.68-1.8-1.19-.78-.42-1.21.26-1.91.18-.18 3.25-2.98 3.3-3.23.01-.03.02-.15-.05-.21s-.18-.04-.25-.02c-.11.02-1.8 1.14-5.06 3.34-.48.33-.91.49-1.3.48-.43-.01-1.25-.24-1.87-.44-.75-.24-1.35-.37-1.3-.79.03-.21.33-.43.9-.66 3.5-1.52 5.83-2.53 7-3.01 3.33-1.39 4.02-1.63 4.47-1.64z"/></svg>`,
  vk: `<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M15.68 0H8.32C1.59 0 0 1.59 0 8.32v7.36C0 22.41 1.59 24 8.32 24h7.36C22.41 24 24 22.41 24 15.68V8.32C24 1.59 22.41 0 15.68 0zm3.69 17.12h-1.74c-.66 0-.86-.52-2.05-1.71-1.03-1.01-1.49-1.14-1.74-1.14-.36 0-.46.1-.46.6v1.57c0 .43-.14.68-1.25.68-1.85 0-3.9-1.12-5.34-3.2-1.72-2.4-2.31-4.69-2.31-5.16 0-.26.1-.49.59-.49h1.75c.44 0 .61.2.78.68.85 2.45 2.27 4.6 2.86 4.6.22 0 .32-.1.32-.66V9.72c-.07-1.19-.7-1.29-.7-1.71 0-.2.17-.41.44-.41h2.75c.37 0 .51.2.51.64v3.47c0 .37.17.51.27.51.22 0 .41-.14.81-.54 1.26-1.41 2.15-3.58 2.15-3.58.12-.25.32-.49.76-.49h1.75c.52 0 .64.27.52.64-.22 1.02-2.35 4.03-2.35 4.03-.19.31-.26.44 0 .78.19.26.8.78 1.2 1.26.75.84 1.32 1.55 1.48 2.04.17.49-.09.75-.58.75z"/></svg>`,
  dzen: `<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" d="M12 24c6.63 0 12-5.37 12-12S18.63 0 12 0 0 5.37 0 12s5.37 12 12 12zm0-19.2 1.8 5.4 5.4 1.8-5.4 1.8-1.8 5.4-1.8-5.4-5.4-1.8 5.4-1.8 1.8-5.4z"/></svg>`,
  instagram: `<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M12 2.16c3.2 0 3.58.01 4.85.07 3.25.15 4.77 1.69 4.92 4.92.06 1.27.07 1.65.07 4.85 0 3.2-.01 3.58-.07 4.85-.15 3.23-1.66 4.77-4.92 4.92-1.27.06-1.64.07-4.85.07-3.2 0-3.58-.01-4.85-.07-3.26-.15-4.77-1.7-4.92-4.92-.06-1.27-.07-1.64-.07-4.85 0-3.2.01-3.58.07-4.85C2.4 3.92 3.92 2.38 7.15 2.23 8.42 2.18 8.8 2.16 12 2.16zM12 0C8.74 0 8.33.01 7.05.07 2.7.27.27 2.69.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.2 4.36 2.62 6.78 6.98 6.98C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c4.35-.2 6.78-2.62 6.98-6.98.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95C23.73 2.7 21.31.27 16.95.07 15.67.01 15.26 0 12 0zm0 5.84A6.16 6.16 0 1 0 12 18.16 6.16 6.16 0 0 0 12 5.84zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.4-11.85a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88z"/></svg>`,
  pinterest: `<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.08 3.16 9.43 7.63 11.17-.1-.95-.2-2.4.04-3.44.22-.94 1.4-5.96 1.4-5.96s-.35-.72-.35-1.78c0-1.67.96-2.92 2.17-2.92 1.02 0 1.51.77 1.51 1.69 0 1.03-.65 2.57-.99 4-.28 1.19.6 2.17 1.77 2.17 2.14 0 3.78-2.25 3.78-5.5 0-2.87-2.07-4.88-5.02-4.88-3.41 0-5.41 2.56-5.41 5.21 0 1.03.4 2.14.89 2.74a.36.36 0 0 1 .08.34c-.09.38-.29 1.2-.33 1.36-.05.22-.17.27-.4.16-1.5-.7-2.43-2.89-2.43-4.65 0-3.78 2.75-7.26 7.93-7.26 4.16 0 7.4 2.97 7.4 6.93 0 4.14-2.61 7.47-6.23 7.47-1.22 0-2.36-.63-2.75-1.38l-.75 2.85c-.27 1.04-1 2.35-1.49 3.15 1.12.35 2.31.53 3.55.53 6.63 0 12-5.37 12-12S18.63 0 12 0z"/></svg>`,
  threads: `<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M12.19 24h-.01c-3.58-.02-6.34-1.2-8.19-3.51C2.35 18.44 1.5 15.59 1.47 12.01v-.02C1.5 8.41 2.35 5.56 4 3.51 5.84 1.2 8.6.02 12.18 0h.01c2.75.02 5.05.72 6.83 2.1 1.68 1.29 2.86 3.13 3.51 5.47l-2.04.57c-1.1-3.96-3.9-5.99-8.3-6.02-2.91.02-5.11.94-6.54 2.72C4.31 6.5 3.62 8.91 3.59 12c.03 3.09.72 5.5 2.06 7.16 1.43 1.79 3.63 2.7 6.54 2.72 2.62-.02 4.36-.63 5.8-2.05 1.65-1.61 1.62-3.59 1.09-4.8-.31-.71-.88-1.3-1.63-1.75-.19 1.35-.62 2.45-1.29 3.27-.88 1.1-2.14 1.7-3.73 1.79-1.2.07-2.36-.22-3.26-.8-1.06-.69-1.68-1.74-1.75-2.96-.07-1.19.41-2.29 1.33-3.09.88-.76 2.12-1.2 3.58-1.29 1.02-.06 2.04-.01 3.02.14-.13-.74-.38-1.33-.75-1.75-.51-.59-1.31-.89-2.36-.89h-.03c-.84 0-1.99.23-2.72 1.32L7.73 7.85c.98-1.46 2.57-2.26 4.48-2.26h.04c3.2.02 5.1 1.98 5.29 5.39.01.07.03.72.02 1l.01.06c1.05.63 1.84 1.46 2.35 2.48.79 1.59 1.01 4.33-1.07 6.37-1.82 1.78-4.07 2.69-6.65 2.69l-.01.02zm.03-7.38c-.31.01-.6.05-.88.12-1 .24-1.62.73-1.57 1.5.05.96 1.07 1.51 2.35 1.44 1.04-.06 1.84-.44 2.38-1.13.41-.52.68-1.22.8-2.09-1.02-.15-2.06-.1-3.08.16z"/></svg>`,
};

/**
 * Возвращает SVG-иконку площадки (или эмодзи-фолбэк).
 * @param {string} key — youtube, tiktok, ...
 * @param {number} size — размер в px
 * @returns {string} HTML
 */
export function platformIcon(key, size = 16) {
  const svg = PLATFORM_ICONS[key];
  const p = PLATFORMS[key];
  if (!svg) return p?.icon || '🌐';
  return `<span class="p-icon" style="width:${size}px;height:${size}px;color:${p?.color || 'currentColor'}" aria-hidden="true">${svg}</span>`;
}

const STATUS_ORDER = ['idea', 'planned', 'filming', 'editing', 'published'];

// ═══════════════════════════════════════════════
//  1. ВКЛАДКА «КОНТЕНТ-ПЛАН»
// ═══════════════════════════════════════════════

export function renderContentTab(container, books, settings, callbacks) {
  // Собираем весь контент из всех книг
  const allContent = [];
  for (const book of books) {
    for (const item of (book.contentItems || [])) {
      allContent.push({
        ...item,
        bookId: book.id,
        bookTitle: book.title,
        bookAuthor: book.author,
        bookCover: book.coverUrl || '',
      });
    }
  }

  // Сортировка: по дате (новые сверху)
  allContent.sort((a, b) => {
    const da = a.plannedDate || a.publishedDate || a.createdAt || '';
    const db = b.plannedDate || b.publishedDate || b.createdAt || '';
    return db.localeCompare(da);
  });

  if (!container._contentFilter) container._contentFilter = 'all';
  const currentFilter = container._contentFilter;

  const filters = [
    { id: 'all',       label: `Все (${allContent.length})` },
    { id: 'idea',      label: '💡 Идеи' },
    { id: 'planned',   label: '📅 Запланировано' },
    { id: 'filming',   label: '🎥 Снимаю' },
    { id: 'editing',   label: '✂️ Монтаж' },
    { id: 'published', label: '📤 Опубликовано' },
  ];

  const filtered = currentFilter === 'all'
    ? allContent
    : allContent.filter(c => c.status === currentFilter);

  const groups = groupByDate(filtered);

  container.innerHTML = `
    <div class="filter-bar no-scrollbar">
      ${filters.map(f => `
        <button class="filter-chip ${currentFilter === f.id ? 'active' : ''}" data-cfilter="${f.id}">${f.label}</button>
      `).join('')}
    </div>
    ${filtered.length === 0 ? `
      <div class="empty-state">
        <div class="empty-icon">🎬</div>
        <div class="empty-title">Нет контента</div>
        <div class="empty-text">
          Добавьте контент-элемент к книге —
          распаковку, отзыв, липсинг или подборку
        </div>
        <button id="content-empty-add" class="btn-primary mt-16" style="width:auto">
          ＋ Добавить контент
        </button>
      </div>
    ` : `
      ${groups.map(g => `
        <div class="mb-16">
          <div class="text-small text-muted mb-8" style="font-weight:800;letter-spacing:.04em">${g.label}</div>
          ${g.items.map(c => renderContentCard(c)).join('')}
        </div>
      `).join('')}
    `}
    <button id="content-add-btn" class="btn-primary mt-16">＋ Новый контент</button>
  `;

  // Фильтры
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

  // Клик по карточке → редактирование
  container.querySelectorAll('.content-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('button') || e.target.closest('a')) return;
      callbacks.onEdit(
        findContentItem(books, card.dataset.bookId, card.dataset.contentId),
        card.dataset.bookId
      );
    });
  });

  // Быстрая смена статуса
  container.querySelectorAll('[data-status-btn]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      callbacks.onStatusChange(btn.dataset.contentId, btn.dataset.bookId, btn.dataset.newStatus);
    });
  });

  // Удаление
  container.querySelectorAll('[data-delete-content]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      callbacks.onDelete(btn.dataset.contentId, btn.dataset.bookId);
    });
  });

  // Копирование ссылки
  container.querySelectorAll('[data-copy-url]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard?.writeText(btn.dataset.copyUrl).then(() =>
        showToast('🔗 Ссылка скопирована', 'success'));
    });
  });

  // 🆕 Ленивая загрузка превью публикаций (Microlink)
  loadContentPreviews(container);
}

// ═══════════════════════════════════════════════
//  2. КАРТОЧКА КОНТЕНТА
// ═══════════════════════════════════════════════

function renderContentCard(item) {
  const type = CONTENT_TYPES[item.type] || { icon: '🎬', label: item.type, color: '' };
  const status = CONTENT_STATUSES[item.status] || { icon: '❓', label: item.status, class: '' };
  const platform = PLATFORMS[item.platform] || { icon: '🌐', label: item.platform || '' };

  // Следующий статус для быстрой кнопки
  const idx = STATUS_ORDER.indexOf(item.status);
  const nextStatus = idx < STATUS_ORDER.length - 1 ? STATUS_ORDER[idx + 1] : null;
  const nextInfo = nextStatus ? CONTENT_STATUSES[nextStatus] : null;

  const dateStr = item.publishedDate || item.plannedDate || '';

  return `
    <div class="content-card" data-book-id="${item.bookId}" data-content-id="${item.id}">
      <div class="content-icon ${type.color}">${type.icon}</div>
      <div class="content-info">
        <div class="content-title">${esc(item.title || type.label)}</div>
        <div class="content-book">📕 ${esc(item.bookTitle)}</div>
        <div class="content-meta">
          <span class="content-list-status ${status.class}">${status.icon} ${status.label}</span>
          <span class="platform-badge">${platformIcon(item.platform, 12)} ${platform.label}</span>
          ${dateStr ? `<span class="content-date">📅 ${dateStr}</span>` : ''}
        </div>
        ${item.publishedUrl ? `
          <div class="content-published" data-preview-url="${esc(item.publishedUrl)}">
            <div class="content-meta mt-8">
              <a href="${esc(item.publishedUrl)}" target="_blank" rel="noopener" class="text-small">🔗 Открыть</a>
              <button data-copy-url="${esc(item.publishedUrl)}"
                style="background:none;border:none;cursor:pointer;font-size:.78rem;color:var(--text-muted)">
                📋 Копировать ссылку
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
            title="→ ${nextInfo.label}">
            ${nextInfo.icon}
          </button>
        ` : '<span style="font-size:1.1rem;text-align:center">🏆</span>'}
        <button data-delete-content
          data-book-id="${item.bookId}"
          data-content-id="${item.id}"
          class="icon-btn" style="width:32px;height:32px;font-size:.85rem"
          title="Удалить">
          🗑️
        </button>
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════
//  2.1 ПРЕВЬЮ ПУБЛИКАЦИЙ (Microlink) — НОВОЕ
// ═══════════════════════════════════════════════

/**
 * Лениво подтягивает превью для ссылок publishedUrl.
 * Использует IntersectionObserver + кеш Microlink (IndexedDB).
 * Повторные URL не тратят дневной лимит.
 */
function loadContentPreviews(container) {
  const els = container.querySelectorAll('.content-published[data-preview-url]');
  if (els.length === 0) return;

  // Если браузер не поддерживает IO — грузим сразу
  if (!('IntersectionObserver' in window)) {
    els.forEach(hydratePreview);
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      hydratePreview(entry.target);
    }
  }, { rootMargin: '200px' });

  els.forEach(el => observer.observe(el));
}

/**
 * Запрашивает превью и вставляет карточку над ссылкой.
 */
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
  // Вставляем превью первым элементом (над ссылкой)
  el.insertBefore(card, el.firstChild);
}

// ═══════════════════════════════════════════════
//  3. ФОРМА КОНТЕНТА
// ═══════════════════════════════════════════════

export function openContentForm(item, bookId) {
  const overlay = document.getElementById('content-overlay');
  const title = document.getElementById('content-form-title');
  const body = document.getElementById('content-form-body');
  if (!overlay || !body) return;

  title.textContent = item ? '✏️ Редактировать контент' : '🎬 Новый контент';

  loadBooks().then(books => {
    renderContentFormBody(body, books, item, bookId);
  });

  overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function renderContentFormBody(body, books, item, preselectedBookId) {
  const c = item || {};
  const defaultPlatform = 'youtube';

  body.innerHTML = `
    <!-- Книга -->
    <div class="form-group">
      <label>📕 Книга *</label>
      <select id="cf-book" required>
        <option value="">— Выберите книгу —</option>
        ${books.map(b => `
          <option value="${b.id}" ${(c.bookId || preselectedBookId) === b.id ? 'selected' : ''}>
            ${esc(b.title)} — ${esc(b.author)}
          </option>
        `).join('')}
      </select>
    </div>

    <!-- Тип контента -->
    <div class="form-group">
      <label>🎬 Тип контента *</label>
      <div class="content-type-grid">
        ${Object.entries(CONTENT_TYPES).map(([key, t]) => `
          <button class="content-type-btn ${(c.type || 'unboxing') === key ? 'active' : ''}" data-type="${key}">
            <span class="content-type-icon">${t.icon}</span>
            <span class="content-type-label">${t.label}</span>
          </button>
        `).join('')}
      </div>
    </div>

    <!-- Название -->
    <div class="form-group">
      <label>📝 Название</label>
      <input type="text" id="cf-title" value="${esc(c.title || '')}" placeholder="Распаковка июльской посылки ЭКСМО"/>
      <div class="form-hint">Если пусто — будет использовано название типа</div>
    </div>

    <!-- Площадка -->
    <div class="form-group">
      <label>📱 Площадка</label>
      <div class="platform-grid">
        ${Object.entries(PLATFORMS).map(([key, p]) => `
          <button class="platform-btn ${(c.platform || defaultPlatform) === key ? 'active' : ''}" data-platform="${key}">
            ${platformIcon(key, 15)} ${p.label}
          </button>
        `).join('')}
      </div>
    </div>

    <!-- Статус -->
    <div class="form-group">
      <label>📊 Статус</label>
      <select id="cf-status">
        ${Object.entries(CONTENT_STATUSES).map(([key, s]) => `
          <option value="${key}" ${(c.status || 'idea') === key ? 'selected' : ''}>${s.icon} ${s.label}</option>
        `).join('')}
      </select>
    </div>

    <!-- Даты -->
    <div class="form-row">
      <div class="form-group"><label>📅 Дата плана</label><input type="date" id="cf-planned" value="${c.plannedDate || ''}"/></div>
      <div class="form-group"><label>📤 Дата публикации</label><input type="date" id="cf-published" value="${c.publishedDate || ''}"/></div>
    </div>

    <!-- Ссылка -->
    <div class="form-group">
      <label>🔗 Ссылка на публикацию</label>
      <input type="url" id="cf-url" value="${esc(c.publishedUrl || '')}" placeholder="https://youtube.com/watch?v=..."/>
      <div class="form-hint">Превью подтянется автоматически (Microlink)</div>
    </div>

    <!-- Заметки -->
    <div class="form-group">
      <label>📝 Заметки</label>
      <textarea id="cf-notes" rows="3" placeholder="Идеи для съёмки, сценарий, реквизит...">${esc(c.notes || '')}</textarea>
    </div>

    <div class="btn-group">
      <button id="cf-save" class="btn-primary">💾 Сохранить</button>
      ${item ? `<button id="cf-delete" class="btn-danger">🗑️ Удалить</button>` : ''}
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

  body.querySelector('#cf-save').addEventListener('click', async () => {
    const bookId = body.querySelector('#cf-book').value;
    if (!bookId) { showToast('⚠️ Выберите книгу', 'error'); return; }

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
      createdAt: c.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      if (item) {
        await updateContentInBook(bookId, contentData.id, contentData);
        showToast('✅ Контент обновлён', 'success');
      } else {
        await addContentToBook(bookId, contentData);
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
      if (!confirm('Удалить этот контент?')) return;
      try {
        await removeContentFromBook(body.querySelector('#cf-book').value, c.id);
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

  // При публикации — авто-дата, если не указана
  if (newStatus === 'published') {
    const books = await loadBooks();
    const book = books.find(b => b.id === bookId);
    const item = (book?.contentItems || []).find(c => c.id === contentId);
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

function groupByDate(items) {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  const groups = {};
  for (const item of items) {
    const date = item.plannedDate || item.publishedDate || '';
    let label;
    if (!date) label = '📌 Без даты';
    else if (date === today) label = '📅 Сегодня';
    else if (date === tomorrow) label = '📅 Завтра';
    else if (date === yesterday) label = '📅 Вчера';
    else if (date < today) label = '⏪ Прошедшие';
    else {
      try {
        label = '📅 ' + new Date(date + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
      } catch { label = '📅 ' + date; }
    }
    if (!groups[label]) groups[label] = [];
    groups[label].push(item);
  }

  const order = ['📅 Сегодня', '📅 Завтра'];
  return Object.entries(groups)
    .sort(([a], [b]) => {
      const ai = order.indexOf(a), bi = order.indexOf(b);
      if (ai >= 0 && bi >= 0) return ai - bi;
      if (ai >= 0) return -1;
      if (bi >= 0) return 1;
      if (a === '📌 Без даты') return 1;
      if (b === '📌 Без даты') return -1;
      if (a.startsWith('⏪')) return 1;
      if (b.startsWith('⏪')) return -1;
      return a.localeCompare(b, 'ru');
    })
    .map(([label, items]) => ({ label, items }));
}

// ═══════════════════════════════════════════════
//  6. СТИЛИ ФОРМЫ (инжектируются один раз)
// ═══════════════════════════════════════════════

const CONTENT_FORM_STYLES = `
.content-type-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; }
.content-type-btn {
  display:flex; flex-direction:column; align-items:center; gap:4px;
  padding:10px 4px; border-radius:10px;
  background:var(--bg-input); border:2px solid transparent;
  cursor:pointer; transition:all .2s var(--ease);
  font-size:.72rem; color:var(--text-secondary);
}
.content-type-btn:hover { border-color:var(--border); transform:translateY(-1px); }
.content-type-btn.active {
  border-color:var(--accent); background:var(--accent-dim); color:var(--accent);
}
.content-type-icon { font-size:1.4rem; }
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