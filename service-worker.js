const CACHE_NAME = "campuspark-v1";

self.addEventListener("install", () => {
  console.log("[ServiceWorker] Install");
  self.skipWaiting();
});

self.addEventListener("activate", () => {
  console.log("[ServiceWorker] Activate");
  return self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
