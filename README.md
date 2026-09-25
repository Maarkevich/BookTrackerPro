# BookTrackerPro

Offline-first PWA для управления личной библиотекой книг: книги, серии, подборки,
челленджи, отзывы, контент-план, календарь, статистика, поиск, ISBN-сканер, OCR
цитат по фото, импорт/экспорт JSON. Работает полностью офлайн и устанавливается
на домашний экран (Android / iPhone / iPad / desktop).

## Запуск

Приложение — набор статических файлов без сборки. Базовый путь жёстко задан как
**`/BookTrackerPro/`** (GitHub Pages project site, manifest `start_url`/`scope`,
Service Worker `BASE` и все абсолютные пути PWA).

### Локальная разработка

1. Любой статический сервер из корня репозитория. Например:

   ```sh
   npx http-server -p 8080 -c-1
   # или
   python3 -m http.server 8080
   ```

2. Открыть `http://localhost:8080/` — приложение работает (HTML/JS используют
   относительные пути).

3. **Service Worker / offline / установка PWA** проверяются только при обращении
   по пути `/BookTrackerPro/`. Для локальной проверки SW смонтируйте корень
   репозитория по этому пути (reverse proxy или сервер с кастомным базовым
   путём), либо задеплойте на GitHub Pages (см. ниже). Локальный `localhost`
   является secure context, поэтому SW-регистрация и install-промпт работают.

### GitHub Pages

- Репозиторий деплоится как project site: содержимое корня — `/BookTrackerPro/`.
- Активный источник версии — **`version.json`** (поля `version` и `cache`;
  сервисы `app.js`, `sw-register.js`, `sw.js` читают только его; устаревший
  `version.js` удалён в P3-4).
- После деплоя новой версии поле `cache` в `version.json` должно совпадать
  с `CACHE_NAME` в `sw.js`; расхождение обнаруживается `verifyCacheFreshness()`
  и принудительно обновляет service worker.

## Тесты

Проект использует **Vitest** (jsdom + fake-indexeddb) без сборки приложения:

```sh
npm install          # vitest, jsdom, fake-indexeddb
npm test             # полный прогон регрессии
npm run test:watch   # watch-режим
```

Запуск одного файла:

```sh
npm test -- tests/clear-all.test.js
```

Регрессии автоматизированы по пунктам аудита (`docs/AUDIT.md`, `docs/ROADMAP.md`):
IndexedDB-сбои, Service Worker (install/activate/update/background sync), PWA
install, OCR, scanner, ISBN, JSON import/export, коллекции, серии, статистика,
календарь, мобильный UI, a11y. CI-проверки добавляются отдельно после
согласования tooling (не переводя приложение на framework/обязательную сборку).

## Архитектура (кратко)

| Слой | Файлы |
|------|-------|
| Вход | `index.html`, `app.js` (init → DOMContentLoaded) |
| Хранилище | `db.js` — IndexedDB (scheme v6, stores: books, covers, settings, collections, challenges, tags, previews, pending-sync) |
| PWA | `sw.js`, `sw-register.js`, `manifest.json`, `version.json` |
| Поиск по ISBN / сканер | `isbn.js`, `scanner.js` (ZXing wasm локально) |
| OCR | `ocr.js` — Tesseract + русская traineddata, Web Worker |
| Модули | `content.js`, `review.js`, `stats.js`, `collections.js`, `challenges.js`, `series.js`, `icons.js`, `utils.js`, `uikit.js` |
| Метаданные | `microlink.js`, Google Books / Open Library / ЛитРес (опционально) |

Android-версия в планах — оболочка поверх этого PWA (Capacitor), единая кодовая база.

## Правила разработки

См. `AGENTS.md` (структура проекта, workflow обработки пунктов аудита,
Definition of Done, запрещённые операции).