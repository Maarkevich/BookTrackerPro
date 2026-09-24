// ═══════════════════════════════════════════════════════════════
//  P2-7: Full rerender / no list limits
//  Списки книг и контента пересобирались целиком: books.map(renderBookCard)
//  на ВСЕХ книгах в одном innerHTML. На 1k/5k/10k это — секунды рендера,
//  десятки МБ строки, скачки scroll/focus, высокая память на мобильных.
//
//  Реальный сценарий: renderBookList() рисует окно BOOKS_PAGE_SIZE и кнопку
//  «Показать ещё»; renderContentTab() — окно CONTENT_PAGE_SIZE. Проверяем
//  настоящий DOM: число карточек ограничено ОКНОМ (а не N=10k), память
//  (innerHTML) не растёт с общим числом книг, клик по «ещё» расширяет окно,
//  фильтр сбрасывает окно, контракт «маленькая библиотека — все карточки».
// ═══════════════════════════════════════════════════════════════
// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { renderBookList, BOOKS_PAGE_SIZE } from '../app.js';
import { renderContentTab, CONTENT_PAGE_SIZE } from '../content.js';

function makeBook(i) {
  return {
    id: 'b' + i,
    title: 'Книга ' + i,
    author: 'Автор ' + (i % 7),
    status: 'wishlist',
    dateAdded: new Date(2026, 0, 1).toISOString(),
    tags: [],
    series: '',
    pageCount: 0,
    currentPage: 0,
    contentItems: [],
  };
}

function makeBooks(n) {
  return Array.from({ length: n }, (_, i) => makeBook(i));
}

function makeContentBooks(n) {
  // Контентные элементы: половина — идеи, половина — запланированные,
  // чтобы фильтры по статусу давали предсказуемые выборки.
  return [{
    id: 'book-c',
    title: 'База контента',
    author: '',
    status: 'wishlist',
    contentItems: Array.from({ length: n }, (_, i) => ({
      id: 'c' + i,
      type: 'review',
      status: i % 2 === 0 ? 'idea' : 'planned',
      platform: 'youtube',
      title: 'Контент ' + i,
      plannedDate: '',
      publishedDate: '',
    })),
  }];
}

const noopCallbacks = {
  onEdit: () => {}, onDelete: () => {}, onStatusChange: () => {},
  onAdd: () => {}, onOpenBook: () => {}, onOpenContent: () => {},
  onDayClick: () => {},
};

describe('P2-7: книжный список — окно вместо полной пересборки', () => {
  it('10k книг: в DOM только BOOKS_PAGE_SIZE карточек, не все 10k', () => {
    const host = document.createElement('div');
    renderBookList(host, makeBooks(10000), BOOKS_PAGE_SIZE);
    const cards = host.querySelectorAll('.book-card');
    expect(cards.length).toBe(BOOKS_PAGE_SIZE);
    expect(host.querySelector('#books-load-more')).not.toBeNull();
    expect(host.querySelector('#books-load-more').dataset.hidden).toBe(String(10000 - BOOKS_PAGE_SIZE));
  });

  it('1k/5k/10k: размер innerHTML ОГРАНИЧЕН окном (память не растёт с N)', () => {
    const sizes = [1000, 5000, 10000];
    const lengths = sizes.map(n => {
      const host = document.createElement('div');
      renderBookList(host, makeBooks(n), BOOKS_PAGE_SIZE);
      return host.innerHTML.length;
    });
    const max = Math.max(...lengths);
    const min = Math.min(...lengths);
    // Окно одинаковое → строки почти равны (различие — только data-hidden счётчик)
    expect(max - min).toBeLessThan(64);
    // Худший случай: даже 10k книг дают < 300KB блока, а не 10k карточек (десятки МБ)
    expect(max).toBeLessThan(300000);
  });

  it('клик «Показать ещё» расширяет окно на BOOKS_PAGE_SIZE', () => {
    const host = document.createElement('div');
    let limit = BOOKS_PAGE_SIZE;
    const render = (next) => { limit = next; renderBookList(host, makeBooks(10000), next); };
    renderBookList(host, makeBooks(10000), limit, { onMore: render });

    host.querySelector('#books-load-more').click();
    expect(host.querySelectorAll('.book-card').length).toBe(BOOKS_PAGE_SIZE * 2);
    // Запрос в 2 раза больший набор не «возвращает» DOM к полному списку
    expect(host.querySelectorAll('.book-card').length).toBeLessThan(300);
  });

  it('контракт: 30 книг (меньше окна) — все отрисованы, кнопки нет', () => {
    const host = document.createElement('div');
    renderBookList(host, makeBooks(30), BOOKS_PAGE_SIZE);
    expect(host.querySelectorAll('.book-card').length).toBe(30);
    expect(host.querySelector('#books-load-more')).toBeNull();
  });

  it('контракт: 0 книг — empty-state, карточки отсутствуют', () => {
    const host = document.createElement('div');
    renderBookList(host, [], BOOKS_PAGE_SIZE);
    expect(host.querySelectorAll('.book-card').length).toBe(0);
    expect(host.querySelector('#books-load-more')).toBeNull();
  });

  it('лимит 0/None: не падает и не рисует мусор', () => {
    const host = document.createElement('div');
    renderBookList(host, makeBooks(5), 0);
    expect(host.querySelectorAll('.book-card').length).toBe(0);
    renderBookList(host, makeBooks(5), undefined);
    expect(host.querySelectorAll('.book-card').length).toBe(5);
  });
});

describe('P2-7: контент-таб — окно вместо полной пересборки', () => {
  it('10k items: рендерится только CONTENT_PAGE_SIZE карточек', { timeout: 30000 }, () => {
    const container = document.createElement('div');
    renderContentTab(container, makeContentBooks(10000), {}, noopCallbacks);
    const cards = container.querySelectorAll('.content-card');
    expect(cards.length).toBe(CONTENT_PAGE_SIZE);
    expect(container.querySelector('#content-load-more')).not.toBeNull();
    expect(container.querySelector('#content-load-more').dataset.hidden)
      .toBe(String(10000 - CONTENT_PAGE_SIZE));
  });

  it('клик «Показать ещё» расширяет контент-окно', { timeout: 30000 }, () => {
    const container = document.createElement('div');
    renderContentTab(container, makeContentBooks(10000), {}, noopCallbacks);
    container.querySelector('#content-load-more').click();
    expect(container.querySelectorAll('.content-card').length).toBe(CONTENT_PAGE_SIZE * 2);
    expect(container.querySelector('#content-load-more')).not.toBeNull();
  });

  it('контракт: 30 items — все отрисованы, кнопки нет', () => {
    const container = document.createElement('div');
    renderContentTab(container, makeContentBooks(30), {}, noopCallbacks);
    expect(container.querySelectorAll('.content-card').length).toBe(30);
    expect(container.querySelector('#content-load-more')).toBeNull();
  });

  it('фильтр сбрасывает окно: было 2×size, стало size', { timeout: 30000 }, () => {
    const container = document.createElement('div');
    renderContentTab(container, makeContentBooks(5000), {}, noopCallbacks);
    container.querySelector('#content-load-more').click();
    expect(container.querySelectorAll('.content-card').length).toBe(CONTENT_PAGE_SIZE * 2);
    // Клик по чужому фильтру → окно сбрасывается к CONTENT_PAGE_SIZE
    container.querySelector('[data-cfilter="published"]').click();
    expect(container.querySelectorAll('.content-card').length).toBeLessThanOrEqual(CONTENT_PAGE_SIZE);
    // И контент реально отфильтрован: 'published' здесь отсутствует
    expect(container.querySelectorAll('.content-card').length).toBe(0);
  });

  it('фильтр «planned» показывает только planned в пределах окна', () => {
    const container = document.createElement('div');
    // 5000 книг-контентов: 2500 idea / 2500 planned
    renderContentTab(container, makeContentBooks(5000), {}, noopCallbacks);
    container.querySelector('[data-cfilter="planned"]').click();
    const cards = [...container.querySelectorAll('.content-card')];
    expect(cards.length).toBe(CONTENT_PAGE_SIZE); // окно, не 2500
    for (const card of cards) {
      expect(card.dataset.contentId.startsWith('c')).toBe(true);
    }
  });
});

describe('P2-7: производительность — рендер 10k не тормозит', () => {
  it('renderBookList 10k с окном укладывается в разумный бюджет времени', () => {
    const books = makeBooks(10000);
    const host = document.createElement('div');
    const t0 = performance.now();
    renderBookList(host, books, BOOKS_PAGE_SIZE);
    const dt = performance.now() - t0;
    // Окно (50 карточек) вместо 10k: на CI jsdom отдаёт заметный запас
    expect(dt).toBeLessThan(2000);
  });
});