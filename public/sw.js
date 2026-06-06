const CACHE = 'ncpa-sound-v3';
const STATIC = [
  '/manifest.json',
  '/icon.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function networkFirst(request) {
  return fetch(request).then(res => {
    if (res.ok && request.method === 'GET') {
      const clone = res.clone();
      caches.open(CACHE).then(c => c.put(request, clone));
    }
    return res;
  }).catch(() => caches.match(request));
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Always go network-first for API calls
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(e.request).catch(() => new Response(JSON.stringify({ error: 'offline' }), {
        headers: { 'Content-Type': 'application/json' }
      }))
    );
    return;
  }

  // HTML, JS and CSS must be network-first so mobile UX fixes deploy immediately.
  if (e.request.mode === 'navigate' || url.pathname.startsWith('/static/')) {
    e.respondWith(networkFirst(e.request));
    return;
  }

  // Cache-first only for stable app assets like icons/manifest.
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      if (res.ok && e.request.method === 'GET') {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }))
  );
});
