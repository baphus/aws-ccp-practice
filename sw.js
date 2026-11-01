/* ============================================================================
   AWS CCP Practice — service worker

   Strategy:
   - App shell + DATA (questions.json, exams.json): cache-first. Huge data file,
     changes rarely, and offline studying is the whole point.
   - Code (html/js/css/manifest): NETWORK-FIRST, cache as fallback. Otherwise a
     deployed update could never reach an installed user, because caches.match
     would keep returning the old app.js forever.

   To ship an update: bump VERSION, deploy. Old caches are purged on activate.
   ========================================================================== */

const VERSION = '9';

const CACHE = `ccp-shell-v${VERSION}`;

/** All relative, so the GitHub Pages subpath, localhost and any future host work. */
const PRECACHE = [
  './',
  './index.html',
  './sets.html',
  './app.js',
  './style.css',
  './manifest.webmanifest',
  './assets/favicon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-512-maskable.png',
  './data/questions.json',
  './data/exams.json',
];

/** Files that should always prefer a fresh copy from the network when online. */
function isCode(url) {
  return /\.(html|js|css|webmanifest)$/.test(url.pathname) || url.pathname.endsWith('/');
}

/** The question bank: large, rarely changes, must work offline. */
function isData(url) {
  return url.pathname.includes('/data/');
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        // addAll fails the whole install if one file 404s; add individually instead.
        Promise.all(
          PRECACHE.map((url) =>
            cache.add(url).catch((err) => console.warn('[sw] precache miss', url, err))
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never intercept cross-origin

  /* DATA — cache-first: fast, offline-first, rarely changes. */
  if (isData(url)) {
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
      )
    );
    return;
  }

  /* CODE — network-first so updates actually land; fall back to cache offline. */
  if (isCode(url) || req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req, { ignoreSearch: true }).then((cached) => {
            if (cached) return cached;
            if (req.mode === 'navigate') return caches.match('./index.html');
            return new Response('', { status: 504, statusText: 'Offline' });
          })
        )
    );
    return;
  }

  /* Everything else (icons etc.) — cache-first. */
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
    )
  );
});
