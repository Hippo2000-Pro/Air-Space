const CACHE_NAME = 'air-space-app-v19';
const APP_SHELL = [
  '/',
  '/index.html',
  '/boutique.html',
  '/app-page.html',
  '/admin.html',
  '/styles.css',
  '/admin.css',
  '/app.js',
  '/boutique.css',
  '/boutique.js',
  '/site-pages.css',
  '/site-pages.js',
  '/vendor/three.core.js',
  '/vendor/three.module.js',
  '/admin.js',
  '/manifest.webmanifest',
  '/air-space-icon.svg',
  '/air-space-team-icon.svg',
  '/agenda',
  '/creations',
  '/spectacles',
  '/air-ar',
  '/air-lab',
  '/airbot',
  '/air-vote',
  '/ecotracker',
  '/air-points',
  '/reservation',
  '/contact',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('air-space-app-') && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then((response) => {
        if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
        return response;
      }).catch(async () => (await caches.match(request)) || (await caches.match('/index.html'))),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
      return response;
    })),
  );
});

