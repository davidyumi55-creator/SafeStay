/* =========================================================
   SAFE-STAY OFFLINE SERVICE WORKER (public/sw.js)
   Caches core UI shell so installed phones can still open
   SAFE-STAY and print Paper Backups if internet drops.
   ========================================================= */

const CACHE_NAME = "safestay-shell-v4";
const CORE_ASSETS = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/roleDashboards.js",
  "/qrcode.js",
  "/logo.jpg",
  "/manifest.json"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  // Never cache live API or SSE streams
  if (url.pathname.startsWith("/api/") || event.request.method !== "GET") {
    return;
  }
  event.respondWith(
    fetch(event.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
