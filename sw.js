// SnartSáhkku SW — cache-first for alle assets (installbar, offlinespill)
const CACHE = 'sahkku-v15';
const ASSETS = [
  './', './index.html', './manifest.webmanifest',
  './css/style.css', './js/engine.js', './js/fen.js', './js/spg.js', './js/cpu.js', './js/ui.js',
  './js/online.js', './js/nn-adapter.js', './js/main.js', './icons/icon.svg',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-180.png',
  './net/pkg/snart_sahkku_net.js', './net/pkg/snart_sahkku_net_bg.wasm'
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) {
    // relays/mobiler: nettressurs, ingen caching
    return;
  }
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const fetchP = fetch(e.request).then((res) => {
        if (res && res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || fetchP;
    })
  );
});
