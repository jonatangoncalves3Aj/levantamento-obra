// Service Worker — Levantamento de Obra
const CACHE = 'levantamento-v13';
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
  './js/exportar-xlsx.js',
  './js/relatorio.js',
  './js/nuvem.js',
  './js/rdo.js',
  './js/ia.js',
  './js/instalacoes.js',
  './vendor/inter-latin.woff2',
  './vendor/pdf.min.mjs',
  './vendor/pdf.worker.min.mjs',
  './vendor/xlsx.full.min.js',
  './vendor/jspdf.umd.min.js',
  './vendor/jspdf.plugin.autotable.min.js',
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

// Rede primeiro (mantendo o cache atualizado); cache só quando offline.
// Assim toda atualização publicada chega na próxima abertura com internet.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Não intercepta chamadas externas (ex.: API do banco de dados na nuvem)
  if (!e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetch(e.request)
      .then(resp => {
        if (resp.ok) {
          const copia = resp.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, copia));
        }
        return resp;
      })
      .catch(() => caches.match(e.request))
  );
});
