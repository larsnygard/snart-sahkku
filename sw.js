// SnartSáhkku SW — cache-first for alle assets (installbar, offlinespill)
const CACHE = 'sahkku-v60';
const ASSETS = [
  './', './index.html', './manifest.webmanifest',
  './css/style.css', './js/engine.js', './js/fen.js', './js/spg.js', './js/zip.js', './js/cpu.js', './js/ui.js',
  './js/share.js', './js/i18n.js', './js/remote.js', './js/exif.js', './js/lobby.js',
  './i18n/nb.json', './i18n/nn.json', './i18n/se.json', './i18n/en.json',
  './js/online.js', './js/archive.js', './js/engines.js', './js/main.js',
  './engines/engines.json', './engines/nais2.js', './icons/icon.svg',
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
// ---- Web Share Target ---------------------------------------------------
// Android (og Chrome på skrivebordet) POST-ar ei multipart-form hit når nokon
// deler ei fil til SnartSáhkku. Vi legg bytes i cachen og sender brukaren til
// appen, som les og importerer dei. Ei POST-førespurnad kan ikkje svarast med
// ei vanleg side (og redirect må vere 303), so cachen er mellomlaget.
const SHARE_CACHE = 'sahkku-share-v1';
const SHARE_KEY = '/__shared__';

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.pathname.endsWith('/share')) {
    e.respondWith((async () => {
      try {
        const form = await e.request.formData();
        const files = form.getAll('files').filter((f) => f && f.size);
        if (files.length) {
          const f = files[0];
          const c = await caches.open(SHARE_CACHE);
          await c.put(SHARE_KEY, new Response(await f.arrayBuffer(), {
            headers: {
              'Content-Type': f.type || 'application/octet-stream',
              'X-Filename': encodeURIComponent(f.name || 'shared')
            }
          }));
        }
      } catch (err) {
        // forma var ikkje multipart — gå vidare til appen likevel
      }
      return Response.redirect('./?share=1', 303);
    })());
    return;
  }
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
