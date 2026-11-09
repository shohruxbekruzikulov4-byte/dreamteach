/* DreamTeach service worker: keeps the app shell, catalog and posters on the device so the app opens without internet.
   Lesson videos are stored by the app itself (IndexedDB) when the learner taps "Yuklab olish". */
const CACHE = 'dreamteach-v5';
const SHELL = ["./", "index.html", "app.css", "js/engine.js", "js/store.js", "js/cloud.js", "js/app.js", "data/courses.json", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png", "media/ai-1.jpg", "media/ai-2.jpg", "media/en-1.jpg", "media/en-2.jpg", "media/ex-1.jpg", "media/ex-2.jpg"];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.includes('/api/') || /\.(mp4|webm|mov)$/.test(url.pathname) || url.pathname.includes('/uploads/')) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put('index.html', copy)); return r; })
      .catch(() => caches.match('index.html')));
    return;
  }
  // stale-while-revalidate: answer from the device at once, refresh in the background when online
  e.respondWith(caches.open(CACHE).then((c) => c.match(req, { ignoreSearch: true }).then((hit) => {
    const net = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  })));
});
