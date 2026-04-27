const CACHE = "book-tracker-v2";
const BASE = "/BookTrackerPro";
const SHELL = [
  `${BASE}/`,
  `${BASE}/index.html`,
  `${BASE}/manifest.json`,
  `${BASE}/icon-192.png`,
  `${BASE}/icon-512.png`
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          const c = r.clone();
          caches.open(CACHE).then((ch) => ch.put(e.request, c));
          return r;
        })
        .catch(async () =>
          (await caches.match(`${BASE}/index.html`)) ||
          (await caches.match(`${BASE}/`))
        )
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cached) => {
      const net = fetch(e.request).then((r) => {
        if (r && r.status === 200 && r.type === "basic") {
          caches.open(CACHE).then((c) => c.put(e.request, r.clone()));
        }
        return r;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
