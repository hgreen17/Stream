const CACHE = 'elemental-battle-v3';
const ASSETS = [
  '/app.html',
  '/shop.html',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.url.includes('wss://') || e.request.url.includes('/ws')) return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
