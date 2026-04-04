// Passive service worker — no caching, no forced takeover
self.addEventListener("install", (event) => {
  // Do NOT call skipWaiting() — let the normal SW lifecycle run
  // so pages are not interrupted mid-load
  event.waitUntil(Promise.resolve());
});

self.addEventListener("activate", (event) => {
  // Do NOT call clients.claim() — avoids forcing a page reload
  event.waitUntil(Promise.resolve());
});

self.addEventListener("fetch", (event) => {
  // Always go straight to network — no caching
  event.respondWith(fetch(event.request));
});
