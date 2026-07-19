// Service Worker — Levantamento de Obra
const CACHE = 'levantamento-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/levantamento.css',
  './js/app.js',
  './js/store.js',
  './js/calc.js',
  './js/viewer.js',
  './js/deteccao.js',
  './js/tabela.js',
  './js/orcamento.js',
  './js/avanco.js',
  './vendor/pdf.min.mjs',
  './vendor/pdf.worker.min.mjs',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
