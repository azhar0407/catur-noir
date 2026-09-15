// Catur Noir — Minimal Offline Service Worker
// ponytail: Cache-first for assets/vendor/pieces, Network-first for shell.
const CACHE_NAME = 'noir-v1';

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/game.html',
  '/css/style.css',
  '/manifest.json',
  '/js/vendor/chess.esm.js',
  '/js/vendor/stockfish-18-lite-single.js',
  '/js/vendor/stockfish-18-lite-single.wasm',
  '/fonts/cinzel-latin.woff2',
  '/fonts/cinzel-latin-ext.woff2',
  '/pieces/wP.svg', '/pieces/wR.svg', '/pieces/wN.svg', '/pieces/wB.svg', '/pieces/wQ.svg', '/pieces/wK.svg',
  '/pieces/bP.svg', '/pieces/bR.svg', '/pieces/bN.svg', '/pieces/bB.svg', '/pieces/bQ.svg', '/pieces/bK.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Lewati API & WebSocket
  if (url.pathname.startsWith('/api/') || e.request.headers.get('Upgrade') === 'websocket') {
    return;
  }

  // Navigasi / HTML: Network first, cache fallback
  if (e.request.mode === 'navigate' || e.request.headers.get('accept')?.includes('text/html')) {
    e.respondWith(
      fetch(e.request).catch(async () => {
        const cached = await caches.match(e.request);
        if (cached) return cached;
        return caches.match(url.pathname === '/game' ? '/game.html' : '/index.html');
      })
    );
    return;
  }

  // Aset statis: Cache first, network fallback
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((resp) => {
        if (resp.ok && (url.pathname.startsWith('/pieces/') || url.pathname.startsWith('/fonts/') || url.pathname.startsWith('/js/vendor/'))) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return resp;
      });
    })
  );
});
