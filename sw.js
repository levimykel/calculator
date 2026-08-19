/* Calcutron service worker: precache the whole app so it runs offline. */

/* Kept in step with version.js by `npm run set-version` and enforced by the
   test suite. It lives here rather than being imported so that this file's own
   bytes change every release — that is what browsers compare when deciding
   whether a new worker exists. */
const VERSION = '3.7.0';

const CACHE = `calcutron-${VERSION}`;

const ASSETS = [
  './',
  'index.html',
  'version.js',
  'css/styles.css',
  'js/app.js',
  'js/calculator.js',
  'js/feedback.js',
  'js/haptics.js',
  'js/history.js',
  'js/update.js',
  'manifest.webmanifest',
  'icons/calcutron.svg',
  'icons/favicon-32.png',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  // No skipWaiting() here on purpose: a new version waits until the user
  // accepts it from the version chip, so the app never swaps out mid-sum.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  // Cache-first for everything, including navigations. The whole app is
  // precached as one versioned set, so serving from it means launches are
  // instant and the page can never mix new HTML with old scripts. Updates
  // arrive through the worker lifecycle instead.
  event.respondWith(
    caches.match(request, { ignoreSearch: request.mode === 'navigate' })
      .then((cached) => cached || fetchAndCache(request))
      .catch(() => caches.match('index.html'))
  );
});

function fetchAndCache(request) {
  return fetch(request).then((response) => {
    if (response.ok && response.type === 'basic') {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(request, copy));
    }
    return response;
  });
}
