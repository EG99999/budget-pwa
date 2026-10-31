const CACHE = 'budget-v11';
const SHELL = [
  './',
  './index.html',
  './icon.svg', './icon-180.png', './icon-192.png', './icon-512.png', './icon-maskable-512.png',
  './manifest.json',
  'https://cdn.jsdelivr.net/npm/@azure/msal-browser@2.38.3/lib/msal-browser.min.js',
  'https://cdn.jsdelivr.net/npm/lucide@0.468.0/dist/umd/lucide.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  if (url.includes('graph.microsoft.com') ||
      url.includes('login.microsoftonline.com') ||
      url.includes('microsoftonline.com')) return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
