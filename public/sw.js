const CACHE_NAME = 'giscard-ai-v1';
// Vite's hashed bundles under /assets/ are cached as they load.
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/favicon.svg',
  '/favicon-96x96.png',
  '/apple-touch-icon.png',
  '/web-app-manifest-192x192.png',
  '/web-app-manifest-512x512.png',
  '/icon-maskable-192.png',
  '/icon-maskable-512.png'
];

// Install Event
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

// Activate Event: drop caches from older versions
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Fetch Event (Network-First Strategy): online visitors always get the latest
// deploy, and the cache is only used offline.
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  // API calls always go to the network and are never cached.
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then(cached =>
          cached || (request.mode === 'navigate' ? caches.match('/index.html') : Response.error())
        )
      )
  );
});
