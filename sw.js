// 서비스 워커: 인터넷이 되면 항상 최신 파일을 받고, 안 되면 저장해둔 파일로 앱을 연다.
// 파일을 추가했다면 아래 목록에도 넣어주세요. 빠뜨려도 한 번 열 때 저장되지만, 첫 오프라인 실행에는 없을 수 있어요.
const CACHE = 'growlog-v1';
const NETWORK_TIMEOUT = 3000; // 신호가 약할 때 오래 기다리지 않고 저장된 파일을 보여준다
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/burnout.js',
  './js/charts.js',
  './js/dates.js',
  './js/pwa.js',
  './js/sample.js',
  './js/store.js',
  './js/ui.js',
  './js/util.js',
  './js/views/burnout.js',
  './js/views/settings.js',
  './js/views/stats.js',
  './js/views/timer.js',
  './js/views/today.js',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function respond(event) {
  const { request } = event;
  const cache = await caches.open(CACHE);
  // no-cache: 브라우저 캐시에 남은 옛 파일 대신 서버에 새 버전이 있는지 확인한다
  const network = fetch(request, { cache: 'no-cache' }).then((response) => {
    if (response.ok) return cache.put(request, response.clone()).then(() => response);
    return response;
  });
  event.waitUntil(network.catch(() => {})); // 저장된 파일을 먼저 보여줘도 새 파일 저장은 끝까지 한다

  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT));
  const fresh = await Promise.race([network.catch(() => null), timeout]);
  if (fresh) return fresh;

  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  if (request.mode === 'navigate') {
    const page = await cache.match('./index.html');
    if (page) return page;
  }
  return network;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(respond(event));
});
