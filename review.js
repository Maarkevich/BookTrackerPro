// ─────────────────────────────────────────────
// 📦 BookTrackerPro — review.js
// 🔖 v3.2.0 | 2026-07-24
// 📝 Отзывы бук-блогера
//
//    Структура отзыва:
//      ⭐ Оценка (1–5)
//      👍 Плюсы
//      👎 Минусы
//      📝 Текст отзыва
//      💬 Цитаты (с пометкой страницы и «использована»)
//      🎯 Рекомендация (Да / Нет / С оговорками)
//      👥 Для кого (целевая аудитория)
//      🔞 Без спойлеров (флаг)
//
//    Функции:
//      — Список всех отзывов с фильтрами
//      — Форма отзыва со звёздами и цитатами
//      — Копирование отзыва в буфер (для описания видео)
//      — Управление цитатами (добавить / удалить / пометить)
// ─────────────────────────────────────────────

import { saveReviewForBook, removeReviewFromBook, loadBooks } from './db.js';
import { esc, showToast } from './app.js';

// ═══════════════════════════════════════════════
//  1. РЕНДЕР ВКЛАДКИ «ОТЗЫВЫ»
// ═══════════════════════════════════════════════

/**
 * Рендерит вкладку отзывов.
 *
 * @param {HTMLElement} container — #main-content
 * @param {object[]} books — все книги
 * @param {object} callbacks — { onEdit, onDelete, onOpenBook }
 */
export function renderReviewsTab(container, books, callbacks) {
  // Собираем книги с отзывами
  const withReviews = books
    .filter(b => b.review && (b.review.text || b.review.rating > 0))
    .sort((a, b) =>
      (b.review?.updatedAt || '').localeCompare(a.review?.updatedAt || '')
    );

  // Фильтры
  if (!container._reviewFilter) container._reviewFilter = 'all';
  const filter = container._reviewFilter;

  const filters = [
    { id: 'all', label: `Все (${withReviews.length})` },
    { id: 'rated5', label: '⭐ 5' },
    { id: 'rated4', label: '⭐ 4+' },
    { id: 'rated3', label: '⭐ 3+' },
    { id: 'low', label: '⭐ ≤ 2' },
    { id: 'withQuotes', label: '💬 С цитатами' },
  ];

  let filtered = withReviews;
  if (filter === 'rated5') filtered = withReviews.filter(b => b.review.rating === 5);
  else if (filter === 'rated4') filtered = withReviews.filter(b => b.review.rating >= 4);
  else if (filter === 'rated3') filtered = withReviews.filter(b => b.review.rating >= 3);
  else if (filter === 'low') filtered = withReviews.filter(b => b.review.rating > 0 && b.review.rating <= 2);
  else if (filter === 'withQuotes') filtered = withReviews.filter(b => (b.review.quotes || []).length > 0);

  container.innerHTML = `
    <div class="filter-bar no-scrollbar">
      ${filters.map(f => `
        <button class="filter-chip ${filter === f.id ? 'active' : ''}"
                data-rfilter="${f.id}">${f.label}</button>
      `).join('')}
    </div>

    ${filtered.length === 0 ? `
      <div class="empty-state">
        <div class="empty-icon">✍️</div>
        <div class="empty-title">Нет отзывов</div>
        <div class="empty-text">
          Откройте книгу и нажмите «Написать отзыв» —
          оценка, плюсы, минусы, цитаты
        </div>
      </div>
    ` : filtered.map(b => renderReviewCard(b)).join('')}
  `;

  // ── События ──

  // Фильтры
  container.querySelectorAll('[data-rfilter]').forEach(chip => {
    chip.addEventListener('click', () => {
      container._reviewFilter = chip.dataset.rfilter;
      renderReviewsTab(container, books, callbacks);
    });
  });

  // Клик по карточке → открыть книгу
  container.querySelectorAll('.review-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      callbacks.onOpenBook(card.dataset.bookId);
    });
  });

  // Редактировать отзыв
  container.querySelectorAll('[data-edit-review]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      callbacks.onEdit(btn.dataset.editReview);
    });
  });

  // Удалить отзыв
  container.querySelectorAll('[data-del-review]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      callbacks.onDelete(btn.dataset.delReview);
    });
  });

  // Копировать отзыв
  container.querySelectorAll('[data-copy-review]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const book = books.find(b => b.id === btn.dataset.copyReview);
      if (book) copyReviewToClipboard(book);
    });
  });
}

// ═══════════════════════════════════════════════
//  2. КАРТОЧКА ОТЗЫВА
// ═══════════════════════════════════════════════

function renderReviewCard(book) {
  const r = book.review || {};
  const stars = '⭐'.repeat(r.rating || 0) + '☆'.repeat(5 - (r.rating || 0));
  const quotesCount = (r.quotes || []).length;
  const usedQuotes = (r.quotes || []).filter(q => q.used).length;

  return `
    <div class="review-card" data-book-id="${book.id}">
      <div class="review-header">
        ${book.coverUrl
          ? `<img class="review-cover" src="${book.coverUrl}" alt="" loading="lazy"/>`
          : `<div class="review-cover" style="display:flex;align-items:center;justify-content:center;font-size:1.5rem">📕</div>`}
        <div style="flex:1;min-width:0">
          <div class="review-title">${esc(book.title)}</div>
          <div class="review-author">${esc(book.author)}</div>
          <div class="review-stars">${stars}</div>
        </div>
      </div>

      ${r.pros ? `<div class="review-pros">👍 ${esc(r.pros)}</div>` : ''}
      ${r.cons ? `<div class="review-cons">👎 ${esc(r.cons)}</div>` : ''}

      ${r.text ? `<div class="review-text">${esc(r.text)}</div>` : ''}

      ${quotesCount > 0 ? `
        <div class="text-small text-muted mt-8">
          💬 ${quotesCount} цитат${usedQuotes > 0 ? ` · ✅ ${usedQuotes} использовано` : ''}
        </div>
      ` : ''}

      ${r.recommendation ? `
        <div class="text-small mt-8">🎯 ${esc(r.recommendation)}</div>
      ` : ''}

      <div class="flex gap-8 mt-8" style="flex-wrap:wrap">
        <button data-edit-review="${book.id}" class="btn-secondary"
                style="padding:6px 12px;font-size:0.78rem">
          ✏️ Изменить
        </button>
        <button data-copy-review="${book.id}" class="btn-secondary"
                style="padding:6px 12px;font-size:0.78rem">
          📋 Копировать
        </button>
        <button data-del-review="${book.id}" class="btn-danger"
                style="padding:6px 12px;font-size:0.78rem">
          🗑️
        </button>
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════
//  3. ФОРМА ОТЗЫВА
// ═══════════════════════════════════════════════

/**
 * Открывает форму отзыва для книги.
 * @param {string} bookId
 */
export function openReviewForm(bookId) {
  const overlay = document.getElementById('review-overlay');
  const title = document.getElementById('review-form-title');
  const body = document.getElementById('review-form-body');

  if (!overlay || !body) return;

  loadBooks().then(books => {
    const book = books.find(b => b.id === bookId);
    if (!book) {
      showToast('❌ Книга не найдена', 'error');
      return;
    }

    title.textContent = `✍️ Отзыв: ${book.title}`;
    renderReviewFormBody(body, book);
    overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  });
}

function renderReviewFormBody(body, book) {
  const r = book.review || {};
  const quotes = r.quotes || [];

  body.innerHTML = `
    <!-- Книга (инфо) -->
    <div class="flex gap-8 items-center mb-16">
      ${book.coverUrl
        ? `<img src="${book.coverUrl}" style="width:48px;height:72px;border-radius:6px;object-fit:cover"/>`
        : `<div style="width:48px;height:72px;border-radius:6px;background:var(--bg-input);display:flex;align-items:center;justify-content:center">📕</div>`}
      <div>
        <div style="font-weight:700;font-size:0.95rem">${esc(book.title)}</div>
        <div class="text-small text-muted">${esc(book.author)}</div>
      </div>
    </div>

    <!-- Оценка (звёзды) -->
    <div class="form-group">
      <label>⭐ Оценка</label>
      <div class="star-rating" id="rf-stars">
        ${[1,2,3,4,5].map(i => `
          <span class="star ${(r.rating || 0) >= i ? 'filled' : ''}" data-star="${i}">★</span>
        `).join('')}
      </div>
      <input type="hidden" id="rf-rating" value="${r.rating || 0}"/>
    </div>

    <!-- Плюсы -->
    <div class="form-group">
      <label>👍 Плюсы</label>
      <textarea id="rf-pros" rows="2"
                placeholder="Что понравилось: язык, сюжет, персонажи...">${esc(r.pros || '')}</textarea>
    </div>

    <!-- Минусы -->
    <div class="form-group">
      <label>👎 Минусы</label>
      <textarea id="rf-cons" rows="2"
                placeholder="Что не понравилось: затянуто, предсказуемо...">${esc(r.cons || '')}</textarea>
    </div>

    <!-- Текст отзыва -->
    <div class="form-group">
      <label>📝 Текст отзыва</label>
      <textarea id="rf-text" rows="5"
                placeholder="Развёрнутый отзыв для видео или поста...">${esc(r.text || '')}</textarea>
    </div>

    <!-- Цитаты -->
    <div class="form-section">
      <h3>💬 Цитаты для контента</h3>
      <div id="rf-quotes-list">
        ${quotes.map((q, i) => renderQuoteRow(q, i)).join('')}
      </div>
      <div class="flex gap-8 mt-8">
        <input type="text" id="rf-quote-text" placeholder="Текст цитаты..."
               style="flex:1"/>
        <input type="number" id="rf-quote-page" placeholder="Стр."
               style="width:70px" min="0"/>
        <button id="rf-quote-add" class="btn-secondary" style="width:auto;flex-shrink:0">＋</button>
      </div>
    </div>

    <!-- Рекомендация -->
    <div class="form-group">
      <label>🎯 Рекомендация</label>
      <select id="rf-recommendation">
        <option value="" ${!r.recommendation ? 'selected' : ''}>— Не указано —</option>
        <option value="Да, рекомендую" ${r.recommendation === 'Да, рекомендую' ? 'selected' : ''}>
          👍 Да, рекомендую
        </option>
        <option value="Нет, не рекомендую" ${r.recommendation === 'Нет, не рекомендую' ? 'selected' : ''}>
          👎 Нет, не рекомендую
        </option>
        <option value="С оговорками" ${r.recommendation === 'С оговорками' ? 'selected' : ''}>
          🤔 С оговорками
        </option>
      </select>
    </div>

    <!-- Для кого -->
    <div class="form-group">
      <label>👥 Для кого</label>
      <input type="text" id="rf-audience" value="${esc(r.targetAudience || '')}"
             placeholder="Для любителей фэнтези, возраст 16+"/>
    </div>

    <!-- Без спойлеров -->
    <div class="toggle-row">
      <span class="toggle-label">🔞 Без спойлеров</span>
      <div class="toggle ${r.spoilerFree !== false ? 'active' : ''}" id="rf-spoiler"></div>
    </div>

    <!-- Кнопки -->
    <div class="btn-group mt-16">
      <button id="rf-save" class="btn-primary">💾 Сохранить отзыв</button>
      <button id="rf-copy" class="btn-secondary">📋 Копировать</button>
    </div>
    <div class="btn-group">
      <button id="rf-delete" class="btn-danger">🗑️ Удалить отзыв</button>
    </div>
  `;

  // ── Состояние ──
  let currentRating = r.rating || 0;
  let currentQuotes = [...quotes];

  // ── Звёзды ──
  const starsEl = body.querySelector('#rf-stars');
  starsEl.querySelectorAll('.star').forEach(star => {
    star.addEventListener('click', () => {
      currentRating = parseInt(star.dataset.star);
      body.querySelector('#rf-rating').value = currentRating;
      starsEl.querySelectorAll('.star').forEach(s => {
        s.classList.toggle('filled', parseInt(s.dataset.star) <= currentRating);
      });
    });

    // Hover-эффект
    star.addEventListener('mouseenter', () => {
      const val = parseInt(star.dataset.star);
      starsEl.querySelectorAll('.star').forEach(s => {
        s.classList.toggle('filled', parseInt(s.dataset.star) <= val);
      });
    });
  });

  starsEl.addEventListener('mouseleave', () => {
    starsEl.querySelectorAll('.star').forEach(s => {
      s.classList.toggle('filled', parseInt(s.dataset.star) <= currentRating);
    });
  });

  // ── Цитаты ──
  const quotesList = body.querySelector('#rf-quotes-list');

  // Добавить цитату
  body.querySelector('#rf-quote-add').addEventListener('click', () => {
    const textEl = body.querySelector('#rf-quote-text');
    const pageEl = body.querySelector('#rf-quote-page');
    const text = textEl.value.trim();
    if (!text) {
      showToast('⚠️ Введите текст цитаты', 'error');
      return;
    }

    currentQuotes.push({
      text,
      page: parseInt(pageEl.value) || 0,
      used: false
    });

    textEl.value = '';
    pageEl.value = '';
    rerenderQuotes();
  });

  // Enter в поле цитаты
  body.querySelector('#rf-quote-text').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      body.querySelector('#rf-quote-add').click();
    }
  });

  function rerenderQuotes() {
    quotesList.innerHTML = currentQuotes.map((q, i) => renderQuoteRow(q, i)).join('');
    bindQuoteEvents();
  }

  function bindQuoteEvents() {
    // Удалить цитату
    quotesList.querySelectorAll('[data-quote-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.quoteDel);
        currentQuotes.splice(idx, 1);
        rerenderQuotes();
      });
    });

    // Пометить «использована»
    quotesList.querySelectorAll('[data-quote-used]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.quoteUsed);
        currentQuotes[idx].used = !currentQuotes[idx].used;
        rerenderQuotes();
      });
    });

    // Копировать цитату
    quotesList.querySelectorAll('[data-quote-copy]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.quoteCopy);
        const q = currentQuotes[idx];
        const text = `«${q.text}»${q.page ? ` (с. ${q.page})` : ''} — ${book.title}, ${book.author}`;
        navigator.clipboard?.writeText(text).then(() => {
          showToast('📋 Цитата скопирована', 'success');
        });
      });
    });
  }

  bindQuoteEvents();

  // ── Спойлер toggle ──
  body.querySelector('#rf-spoiler').addEventListener('click', function() {
    this.classList.toggle('active');
  });

  // ── Сохранение ──
  body.querySelector('#rf-save').addEventListener('click', async () => {
    const review = {
      rating: currentRating,
      pros: body.querySelector('#rf-pros').value.trim(),
      cons: body.querySelector('#rf-cons').value.trim(),
      text: body.querySelector('#rf-text').value.trim(),
      quotes: currentQuotes,
      recommendation: body.querySelector('#rf-recommendation').value,
      targetAudience: body.querySelector('#rf-audience').value.trim(),
      spoilerFree: body.querySelector('#rf-spoiler').classList.contains('active'),
      createdAt: r.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      await saveReviewForBook(book.id, review);
      showToast('✅ Отзыв сохранён', 'success');
      closeReviewForm();
      document.dispatchEvent(new CustomEvent('data-changed'));
    } catch (e) {
      showToast('❌ Ошибка сохранения', 'error');
      console.error('[Review] Save error:', e);
    }
  });

  // ── Копирование отзыва ──
  body.querySelector('#rf-copy').addEventListener('click', () => {
    copyReviewToClipboard({ ...book, review: {
      rating: currentRating,
      pros: body.querySelector('#rf-pros').value.trim(),
      cons: body.querySelector('#rf-cons').value.trim(),
      text: body.querySelector('#rf-text').value.trim(),
      quotes: currentQuotes,
      recommendation: body.querySelector('#rf-recommendation').value,
      targetAudience: body.querySelector('#rf-audience').value.trim(),
    }});
  });

  // ── Удаление ──
  body.querySelector('#rf-delete').addEventListener('click', async () => {
    if (!confirm('Удалить отзыв?')) return;
    try {
      await removeReviewFromBook(book.id);
      showToast('🗑️ Отзыв удалён', 'info');
      closeReviewForm();
      document.dispatchEvent(new CustomEvent('data-changed'));
    } catch (e) {
      showToast('❌ Ошибка удаления', 'error');
    }
  });
}

// ═══════════════════════════════════════════════
//  4. СТРОКА ЦИТАТЫ
// ═══════════════════════════════════════════════

function renderQuoteRow(quote, index) {
  return `
    <div class="quote-item" style="align-items:center">
      <div style="flex:1;min-width:0">
        <div>«${esc(quote.text)}»</div>
        <div class="flex gap-8 mt-8" style="align-items:center">
          ${quote.page ? `<span class="quote-page">с. ${quote.page}</span>` : ''}
          ${quote.used
            ? '<span class="quote-used">✅ Использована</span>'
            : '<span class="text-small text-muted">Не использована</span>'}
        </div>
      </div>
      <div class="flex gap-8" style="flex-shrink:0">
        <button data-quote-used="${index}" class="icon-btn"
                style="width:28px;height:28px;font-size:0.8rem"
                title="${quote.used ? 'Снять пометку' : 'Пометить как использованную'}">
          ${quote.used ? '↩️' : '✅'}
        </button>
        <button data-quote-copy="${index}" class="icon-btn"
                style="width:28px;height:28px;font-size:0.8rem"
                title="Копировать цитату">
          📋
        </button>
        <button data-quote-del="${index}" class="icon-btn"
                style="width:28px;height:28px;font-size:0.8rem"
                title="Удалить цитату">
          🗑️
        </button>
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════
//  5. КОПИРОВАНИЕ ОТЗЫВА В БУФЕР
// ═══════════════════════════════════════════════

/**
 * Форматирует отзыв как текст для вставки
 * в описание видео / пост.
 *
 * Формат:
 *   📕 Название — Автор
 *   ⭐⭐⭐⭐⭐ 5/5
 *   👍 Плюсы: ...
 *   👎 Минусы: ...
 *   📝 Текст отзыва...
 *   💬 «Цитата» (с. 42)
 *   🎯 Рекомендация: Да
 *   👥 Для: ...
 *
 * @param {object} book — книга с review
 */
export function copyReviewToClipboard(book) {
  const r = book.review || {};
  const lines = [];

  // Заголовок
  lines.push(`📕 ${book.title} — ${book.author}`);
  lines.push('');

  // Оценка
  if (r.rating > 0) {
    lines.push(`${'⭐'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)} ${r.rating}/5`);
    lines.push('');
  }

  // Плюсы / Минусы
  if (r.pros) {
    lines.push(`👍 Плюсы: ${r.pros}`);
  }
  if (r.cons) {
    lines.push(`👎 Минусы: ${r.cons}`);
  }
  if (r.pros || r.cons) lines.push('');

  // Текст
  if (r.text) {
    lines.push(r.text);
    lines.push('');
  }

  // Цитаты
  const quotes = r.quotes || [];
  if (quotes.length > 0) {
    lines.push('💬 Цитаты:');
    for (const q of quotes) {
      lines.push(`  «${q.text}»${q.page ? ` (с. ${q.page})` : ''}`);
    }
    lines.push('');
  }

  // Рекомендация
  if (r.recommendation) {
    lines.push(`🎯 Рекомендация: ${r.recommendation}`);
  }

  // Для кого
  if (r.targetAudience) {
    lines.push(`👥 Для: ${r.targetAudience}`);
  }

  // Спойлеры
  if (r.spoilerFree !== false) {
    lines.push('🔞 Без спойлеров');
  }

  const text = lines.join('\n');

  navigator.clipboard?.writeText(text).then(() => {
    showToast('📋 Отзыв скопирован! Вставьте в описание видео', 'success');
  }).catch(() => {
    // Фолбэк: показываем текст в alert
    prompt('Скопируйте отзыв:', text);
  });
}

// ═══════════════════════════════════════════════
//  6. УДАЛЕНИЕ ОТЗЫВА (для app.js)
// ═══════════════════════════════════════════════

/**
 * Удаляет отзыв из книги.
 * @param {string} bookId
 */
export async function deleteReview(bookId) {
  await removeReviewFromBook(bookId);
}

// ═══════════════════════════════════════════════
//  7. ЗАКРЫТИЕ ФОРМЫ
// ═══════════════════════════════════════════════

function closeReviewForm() {
  const overlay = document.getElementById('review-overlay');
  if (overlay) {
    overlay.classList.add('hidden');
    document.body.style.overflow = '';
  }
}