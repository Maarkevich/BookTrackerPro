// ─────────────────────────────────────────────
// 📦 BookTrackerPro — isbn.js
// 🔖 v3.2.0 | 2026-07-24
// 📝 ISBN валидация + каскадный поиск книг
//
//    Каскад по ISBN:
//      1. Google Books (бесплатно, без ключа)
//      2. Open Library (бесплатно, без ключа)
//      3. ЛитРес Catalit r_search_arts (нужны ключи)
//      4. Обложка из Open Library
//
//    Поиск по названию/автору:
//      1. Google Books (langRestrict=ru)
//      2. Open Library
//      3. ЛитРес Catalit
//
// ⚠️ ТЕСТОВЫЕ КЛЮЧИ ЛИТРЕС:
//    Catalit:  анонимный доступ (login: Anonymous, pwd: 0)
//              — работает с лимитом запросов
//    Partner:  partner_id = 16
//              secret_key = 93w4jfhs8imksGo-oa3s85d6Akmkkbnsi9
//              — тестовые из документации
//
//    📋 Как заменить на свои:
//    1. Зарегистрируйтесь: litres.ru/pages/reader_partner/
//    2. Напишите: partners@litres.ru → запросите App ID + Secret Key
//    3. Вставьте в Настройки → ЛитРес API
//    4. Или замените значения в app.js (S.settings)
// ─────────────────────────────────────────────

// ═══════════════════════════════════════════════
//  1. ВАЛИДАЦИЯ ISBN
// ═══════════════════════════════════════════════

/**
 * Убирает пробелы, дефисы, тире. Приводит к верхнему регистру.
 * @param {string} input
 * @returns {string}
 */
export function cleanISBN(input) {
  return (input || '').replace(/[\s\-–—]/g, '').toUpperCase();
}

/**
 * Проверяет корректность ISBN-10 или ISBN-13.
 * @param {string} input
 * @returns {boolean}
 */
export function validateISBN(input) {
  const s = cleanISBN(input);
  if (s.length === 10) return checkISBN10(s);
  if (s.length === 13) return checkISBN13(s);
  return false;
}

/**
 * Контрольная сумма ISBN-10.
 * Сумма d[i] * (10-i) для i=0..8 + check, делится на 11.
 */
function checkISBN10(s) {
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const d = parseInt(s[i], 10);
    if (isNaN(d)) return false;
    sum += d * (10 - i);
  }
  const c = s[9] === 'X' ? 10 : parseInt(s[9], 10);
  return !isNaN(c) && (sum + c) % 11 === 0;
}

/**
 * Контрольная сумма ISBN-13.
 * Сумма d[i] * (1 или 3), делится на 10.
 */
function checkISBN13(s) {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = parseInt(s[i], 10);
    if (isNaN(d)) return false;
    sum += d * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10 === parseInt(s[12], 10);
}

/**
 * Конвертирует ISBN-10 → ISBN-13 (добавляет префикс 978).
 * @param {string} isbn10
 * @returns {string|null}
 */
export function isbn10to13(isbn10) {
  const s = cleanISBN(isbn10);
  if (s.length !== 10) return null;
  const base = '978' + s.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(base[i], 10) * (i % 2 === 0 ? 1 : 3);
  }
  return base + String((10 - (sum % 10)) % 10);
}

/**
 * Определяет, российский ли ISBN.
 * Префиксы: 978-5 (Россия), 979-8 (Россия, новые).
 * @param {string} isbn
 * @returns {boolean}
 */
export function isRussianISBN(isbn) {
  const s = cleanISBN(isbn);
  const i13 = s.length === 10 ? isbn10to13(s) : s;
  if (!i13) return false;
  return i13.startsWith('9785') || i13.startsWith('9798');
}

/**
 * Форматирует ISBN для отображения: 978-5-17-098765-8
 * @param {string} isbn
 * @returns {string}
 */
export function formatISBN(isbn) {
  const s = cleanISBN(isbn);
  if (s.length === 13) {
    return `${s.slice(0,3)}-${s.slice(3,4)}-${s.slice(4,7)}-${s.slice(7,12)}-${s.slice(12)}`;
  }
  if (s.length === 10) {
    return `${s.slice(0,1)}-${s.slice(1,4)}-${s.slice(4,9)}-${s.slice(9)}`;
  }
  return s;
}

// ═══════════════════════════════════════════════
//  2. КАСКАДНЫЙ ПОИСК ПО ISBN
// ═══════════════════════════════════════════════

/**
 * Ищет книгу по ISBN через каскад источников.
 *
 * @param {string} isbn — ISBN-10 или ISBN-13
 * @param {object|null} litres — { appId, secretKey } или null
 * @returns {Promise<object|null>} — данные книги или null
 */
export async function fetchBookByIsbn(isbn, litres = null) {
  const s = cleanISBN(isbn);
  const isbn13 = s.length === 10 ? isbn10to13(s) : s;
  if (!isbn13) return null;

  // ── Уровень 1: Google Books ──
  // Бесплатно, без ключа. Покрывает ЭКСМО, АСТ, МИФ,
  // Азбуку, Альпину, Росмэн и другие крупные издательства.
  const gb = await tryGoogleBooks(isbn13);
  if (gb) return gb;

  // ── Уровень 2: Open Library ──
  // Бесплатно, без ключа. Зарубежные + часть русских.
  const ol = await tryOpenLibrary(isbn13);
  if (ol) return ol;

  // ── Уровень 3: ЛитРес Catalit ──
  // Нужны ключи (app_id + secret_key).
  // Лучшее покрытие российских книг, включая мелкие издательства.
  // Без ключей пробуем анонимный доступ (тестовый режим).
  const lrKeys = litres || getAnonymousLitresKeys();
  const lr = await tryLitresSearch(isbn13, lrKeys);
  if (lr) return lr;

  // ── Уровень 4: Только обложка ──
  const cover = await tryCoverOnly(isbn13);
  if (cover) return cover;

  return null;
}

// ═══════════════════════════════════════════════
//  3. ПОИСК ПО НАЗВАНИЮ / АВТОРУ
// ═══════════════════════════════════════════════

/**
 * Ищет книги по текстовому запросу (название, автор).
 * Возвращает массив результатов из всех источников.
 *
 * @param {string} query
 * @param {object|null} litres — { appId, secretKey }
 * @returns {Promise<object[]>}
 */
export async function searchBooks(query, litres = null) {
  const results = [];
  const seen = new Set();

  const add = (book) => {
    if (!book || !book.title) return;
    const key = (book.title + '|' + book.author).toLowerCase().trim();
    if (key === '|' || seen.has(key)) return;
    seen.add(key);
    results.push(book);
  };

  // ── Google Books (приоритет русским) ──
  try {
    const r = await fetchT(
      `https://www.googleapis.com/books/v1/volumes` +
      `?q=${encodeURIComponent(query)}` +
      `&maxResults=10&langRestrict=ru`,
      8000
    );
    if (r.ok) {
      const data = await r.json();
      for (const item of (data.items || [])) {
        if (item.volumeInfo?.title) {
          add(normalizeGoogle(item.volumeInfo));
        }
      }
    }
  } catch { /* offline */ }

  // ── Open Library ──
  try {
    const r = await fetchT(
      `https://openlibrary.org/search.json` +
      `?q=${encodeURIComponent(query)}&limit=5` +
      `&fields=title,author_name,cover_i,isbn,publisher,` +
      `first_publish_year,number_of_pages,subject`,
      8000
    );
    if (r.ok) {
      const data = await r.json();
      for (const doc of (data.docs || [])) {
        if (!doc.title) continue;
        add({
          title: doc.title,
          author: (doc.author_name || []).join(', '),
          cover: doc.cover_i
            ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`
            : '',
          description: '',
          genre: (doc.subject || [])[0] || '',
          publisher: (doc.publisher || [])[0] || '',
          publishedDate: doc.first_publish_year
            ? String(doc.first_publish_year) : '',
          pageCount: doc.number_of_pages || 0,
          isbn: (doc.isbn || [])[0] || '',
          source: 'openlibrary'
        });
      }
    }
  } catch { /* offline */ }

  // ── ЛитРес Catalit ──
  const lrKeys = litres || getAnonymousLitresKeys();
  try {
    const lrResults = await litresSearch(lrKeys, query, 5);
    for (const b of lrResults) add(b);
  } catch { /* ignore */ }

  return results;
}

// ═══════════════════════════════════════════════
//  4. GOOGLE BOOKS API
//     Бесплатно, без ключа.
//     Docs: developers.google.com/books
// ═══════════════════════════════════════════════

async function tryGoogleBooks(isbn) {
  try {
    const r = await fetchT(
      `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=1`,
      8000
    );
    if (!r.ok) return null;
    const data = await r.json();
    const v = data.items?.[0]?.volumeInfo;
    if (!v?.title) return null;
    return normalizeGoogle(v);
  } catch {
    return null;
  }
}

function normalizeGoogle(v) {
  // Обложка: лучший размер, http → https
  let cover = v.imageLinks?.extraLarge
    || v.imageLinks?.large
    || v.imageLinks?.medium
    || v.imageLinks?.thumbnail
    || '';
  if (cover) {
    cover = cover.replace(/^http:/, 'https:').replace('&edge=curl', '');
  }

  // ISBN: предпочитаем ISBN_13
  const ids = v.industryIdentifiers || [];
  const isbn = ids.find(i => i.type === 'ISBN_13')?.identifier
    || ids.find(i => i.type === 'ISBN_10')?.identifier
    || '';

  return {
    title: v.title + (v.subtitle ? `. ${v.subtitle}` : ''),
    author: (v.authors || []).join(', '),
    cover,
    description: v.description || '',
    genre: (v.categories || [])[0] || '',
    publisher: v.publisher || '',
    publishedDate: v.publishedDate || '',
    pageCount: v.pageCount || 0,
    isbn,
    source: 'google'
  };
}

// ═══════════════════════════════════════════════
//  5. OPEN LIBRARY API
//     Бесплатно, без ключа.
//     Docs: openlibrary.org/developers/api
// ═══════════════════════════════════════════════

async function tryOpenLibrary(isbn) {
  try {
    const r = await fetchT(
      `https://openlibrary.org/api/books` +
      `?bibkeys=ISBN:${isbn}&format=json&jscmd=data`,
      8000
    );
    if (!r.ok) return null;
    const data = await r.json();
    const key = Object.keys(data)[0];
    if (!key) return null;
    const d = data[key];
    if (!d.title) return null;

    return {
      title: d.title,
      author: (d.authors || []).map(a => a.name).join(', ')
        || d.by_statement || '',
      cover: d.cover?.large || d.cover?.medium
        || `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`,
      description: typeof d.notes === 'string' ? d.notes : '',
      genre: (d.subjects || [])[0]?.name || '',
      publisher: (d.publishers || [])[0]?.name || '',
      publishedDate: d.publish_date || '',
      pageCount: d.number_of_pages || 0,
      isbn,
      source: 'openlibrary'
    };
  } catch {
    return null;
  }
}

/**
 * Пробует получить только обложку из Open Library.
 * Возвращает объект с пустыми полями, но с обложкой.
 */
async function tryCoverOnly(isbn) {
  try {
    const url = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`;
    const r = await fetch(url, { method: 'HEAD' });
    const len = r.headers.get('content-length');
    // Если картинка > 800 байт — это реальная обложка, не заглушка
    if (r.ok && len && Number(len) > 800) {
      return {
        title: '',
        author: '',
        cover: url,
        description: `ISBN: ${formatISBN(isbn)}`,
        genre: '',
        publisher: '',
        publishedDate: '',
        pageCount: 0,
        isbn,
        source: 'cover'
      };
    }
  } catch { /* ignore */ }
  return null;
}

// ═══════════════════════════════════════════════
//  6. ЛИТРЕС CATALIT API
//     Docs: docs.litres.ru/public/6424374.html
//     Endpoint: POST https://catalit.litres.ru/catalitv2
//
//     Авторизация:
//       app  — ID приложения
//       time — ISO-таймстемп
//       sha  — SHA-256(time + secret_key)
//       sid  — сессия (создаётся через w_create_sid)
//
//     Поиск: r_search_arts
//       q     — текстовый запрос (ISBN, название, автор)
//       strict — 'exact' | 'no'
//       limit  — ['offset', 'count']
//       anno   — '1' (с аннотацией)
//
// ⚠️ ТЕСТОВЫЙ РЕЖИМ:
//    Без ключей используется анонимный доступ:
//    login: 'Anonymous', pwd: '0'
//    Работает с ограничением по числу запросов.
//    Для продакшена получите ключи на partners@litres.ru
// ═══════════════════════════════════════════════

const CATALIT_URL = 'https://catalit.litres.ru/catalitv2';

// Кеш SID (живёт ~50 минут)
let _sid = null;
let _sidExpires = 0;
let _sidKeys = null; // какие ключи использовались для текущего SID

/**
 * Тестовые (анонимные) ключи ЛитРес.
 * Работают с лимитом запросов — только для тестирования.
 * Замените на свои после получения от partners@litres.ru
 */
function getAnonymousLitresKeys() {
  return {
    appId: '',       // пусто = анонимный режим
    secretKey: '',   // пусто = анонимный режим
    anonymous: true  // флаг анонимного доступа
  };
}

/**
 * Создаёт или возвращает кешированный SID.
 * Для анонимного доступа: login=Anonymous, pwd=0
 * Для авторизованного: app + time + sha256(time+secret)
 */
async function getLitresSid(keys) {
  // Проверяем, не протух ли SID и те ли ключи
  const keysKey = JSON.stringify(keys);
  if (_sid && Date.now() < _sidExpires && _sidKeys === keysKey) {
    return _sid;
  }

  try {
    let bodyData;

    if (keys.anonymous || (!keys.appId && !keys.secretKey)) {
      // ── Анонимная авторизация (тестовый режим) ──
      bodyData = {
        requests: [{
          func: 'w_create_sid',
          id: 'auth',
          param: {
            login: 'Anonymous',
            pwd: '0'
          }
        }]
      };
    } else {
      // ── Авторизованная авторизация ──
      const time = new Date().toISOString();
      const sha = await sha256(time + keys.secretKey);

      bodyData = {
        app: keys.appId,
        time,
        sha,
        requests: [{
          func: 'w_create_sid',
          id: 'auth',
          param: {}
        }]
      };
    }

    const body = new URLSearchParams({
      jdata: JSON.stringify(bodyData)
    });

    const r = await fetchT(CATALIT_URL, 8000, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });

    const data = await r.json();
    const sid = data?.auth?.sid;

    if (sid) {
      _sid = sid;
      _sidExpires = Date.now() + 50 * 60 * 1000; // 50 минут
      _sidKeys = keysKey;
    }
    return sid || null;
  } catch {
    return null;
  }
}

/**
 * Поиск книги по ISBN через ЛитРес Catalit.
 * ISBN ищется как текстовый запрос с strict=exact.
 */
async function tryLitresSearch(isbn, keys) {
  try {
    const sid = await getLitresSid(keys);
    if (!sid) return null;

    const result = await litresRequest(sid, keys, 'r_search_arts', {
      q: isbn,
      strict: 'exact',
      limit: ['0', '3'],
      anno: '1'
    });

    const arts = result?.arts || [];
    // Ищем точное совпадение ISBN
    const match = arts.find(a =>
      a.isbn && cleanISBN(a.isbn) === cleanISBN(isbn)
    ) || arts[0];

    if (!match?.title) return null;
    return normalizeLitres(match);
  } catch {
    return null;
  }
}

/**
 * Поиск по названию/автору через ЛитРес Catalit.
 * @param {object} keys — { appId, secretKey } или anonymous
 * @param {string} query
 * @param {number} limit
 * @returns {Promise<object[]>}
 */
async function litresSearch(keys, query, limit = 5) {
  const sid = await getLitresSid(keys);
  if (!sid) return [];

  const result = await litresRequest(sid, keys, 'r_search_arts', {
    q: query,
    strict: 'no',
    limit: ['0', String(limit)],
    anno: '1'
  });

  return (result?.arts || [])
    .filter(a => a.title)
    .map(normalizeLitres);
}

/**
 * Универсальный запрос к Catalit API.
 */
async function litresRequest(sid, keys, func, param) {
  let bodyData;

  if (keys.anonymous || (!keys.appId && !keys.secretKey)) {
    bodyData = { sid, requests: [{ func, id: 'req', param }] };
  } else {
    const time = new Date().toISOString();
    const sha = await sha256(time + keys.secretKey);
    bodyData = {
      app: keys.appId,
      time,
      sha,
      sid,
      requests: [{ func, id: 'req', param }]
    };
  }

  const body = new URLSearchParams({
    jdata: JSON.stringify(bodyData)
  });

  const r = await fetchT(CATALIT_URL, 10000, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  const data = await r.json();

  // Если SID протух — сбрасываем кеш
  if (!data?.success && data?.error_code) {
    _sid = null;
    _sidExpires = 0;
    _sidKeys = null;
    return null;
  }

  return data?.req || null;
}

/**
 * Нормализация ответа ЛитРес → формат BookTracker.
 *
 * Обложка: https://cv{N}.litres.ru/pub/c/cover_{size}/{id}.jpg
 *   N = предпоследняя цифра ID книги (десяток)
 *   size: 100, 215, 415, 800
 *
 * Авторы: persons с type=1
 * Жанры: genres[].name
 * Аннотация: annotation (HTML)
 */
function normalizeLitres(art) {
  const id = String(art.id);
  const tens = id.length >= 2 ? id[id.length - 2] : '0';
  const cover = `https://cv${tens}.litres.ru/pub/c/cover_415/${id}.jpg`;

  const authors = (art.persons || [])
    .filter(p => String(p.type) === '1')
    .map(p => p.full_name)
    .join(', ');

  const genre = (art.genres || [])[0]?.name || '';
  const description = art.annotation ? stripHtml(art.annotation) : '';

  return {
    title: art.title + (art.subtitle ? `. ${art.subtitle}` : ''),
    author: authors,
    cover,
    description,
    genre,
    publisher: art.publisher || '',
    publishedDate: art.year_written || '',
    pageCount: 0, // ЛитРес не отдаёт число страниц
    isbn: art.isbn || '',
    source: 'litres',
    // Дополнительные данные ЛитРес
    litresId: art.id,
    litresRating: art.lvl ? Number(art.lvl) : 0,
    litresLang: art.lang || 'rus',
    litresMinAge: art.minage ? Number(art.minage) : 0,
    litresSeries: (art.sequences || []).map(s => ({
      name: s.name,
      number: s.sequence_number || null
    }))
  };
}

// ═══════════════════════════════════════════════
//  7. ЛИТРЕС PARTNER API
//     Docs: docs.litres.ru/public/205502033.html
//     Base: https://api.litres.ru/integrations
//
//     Авторизация: HMAC-SHA-256
//       Signature = HMAC-SHA-256("{timestamp}.{partner_id}", secret_key)
//       Headers: Timestamp, Signature
//
//     ⚠️ Поиск по ISBN НЕ поддерживается!
//     Можно получить данные только по известным ID/UUID.
//     Полезно для расширения данных после Catalit-поиска.
//
//     Тестовые ключи (из документации):
//       partner_id = 16
//       secret_key = 93w4jfhs8imksGo-oa3s85d6Akmkkbnsi9
// ═══════════════════════════════════════════════

const PARTNER_URL = 'https://api.litres.ru/integrations';

/**
 * Получить данные книг по ID через Partner API.
 * Максимум 10 книг за запрос.
 *
 * @param {number[]} ids — массив LitRes ID
 * @param {object} partner — { partnerId, secretKey }
 * @returns {Promise<object[]>}
 */
export async function litresGetByIds(ids, partner) {
  if (!ids.length || ids.length > 10) return [];
  if (!partner?.partnerId || !partner?.secretKey) return [];

  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await hmacSha256(
      `${timestamp}.${partner.partnerId}`,
      partner.secretKey
    );

    const r = await fetchT(
      `${PARTNER_URL}/api/partner/catalog/list` +
      `?partner_id=${partner.partnerId}` +
      `&ids=${ids.join(',')}`,
      10000,
      {
        headers: {
          'Timestamp': String(timestamp),
          'Signature': signature
        }
      }
    );

    if (!r.ok) return [];
    const data = await r.json();
    return (data?.payload?.data || []).map(normalizePartnerBook);
  } catch {
    return [];
  }
}

function normalizePartnerBook(book) {
  // cover_url — относительный путь, дополняем доменом
  const cover = book.cover_url
    ? `https://cv0.litres.ru${book.cover_url}`
    : '';

  const authors = (book.persons || [])
    .filter(p => p.role === 0) // role=0 = Автор текста
    .map(p => p.full_name)
    .join(', ');

  return {
    title: book.title + (book.subtitle ? `. ${book.subtitle}` : ''),
    author: authors,
    cover,
    description: book.html_annotation
      ? stripHtml(book.html_annotation) : '',
    genre: (book.genres || [])[0]?.title || '',
    publisher: (book.copyrights || [])[0]?.title || '',
    publishedDate: book.year_written_at || '',
    pageCount: 0,
    isbn: book.isbn || '',
    source: 'litres-partner',
    litresId: book.id,
    litresUuid: book.uuid,
    litresRating: book.yearly_rating || 0,
    litresTags: (book.tags || []).map(t => t.title),
    litresSeries: (book.series || []).map(s => ({
      name: s.title,
      number: s.number
    })),
    livelib: book.livelib_data ? {
      rating: book.livelib_data.rated_avg,
      readers: book.livelib_data.readers_count
    } : null
  };
}

/**
 * Дерево жанров ЛитРес.
 * НЕ требует авторизации!
 * Можно использовать для автоподстановки жанров.
 *
 * @returns {Promise<object[]>}
 */
export async function fetchLitresGenres() {
  try {
    const r = await fetchT(
      `${PARTNER_URL}/foundation/api/genres?art_group=0&subgenre_depth=2`,
      10000
    );
    if (!r.ok) return [];
    const data = await r.json();
    return data?.payload?.data || [];
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════
//  8. УТИЛИТЫ
// ═══════════════════════════════════════════════

/**
 * fetch с таймаутом.
 * @param {string} url
 * @param {number} ms — таймаут в мс
 * @param {object} opts — параметры fetch
 * @returns {Promise<Response>}
 */
function fetchT(url, ms, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal })
    .finally(() => clearTimeout(timer));
}

/**
 * SHA-256 хеш (для Catalit API).
 * @param {string} message
 * @returns {Promise<string>} — hex-строка
 */
async function sha256(message) {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(message)
  );
  return bufToHex(buf);
}

/**
 * HMAC-SHA-256 (для Partner API).
 * @param {string} message
 * @param {string} key
 * @returns {Promise<string>} — hex-строка
 */
async function hmacSha256(message, key) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    enc.encode(message)
  );
  return bufToHex(sig);
}

/**
 * ArrayBuffer → hex-строка.
 */
function bufToHex(buf) {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Убирает HTML-теги из строки.
 * @param {string} html
 * @returns {string}
 */
function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}