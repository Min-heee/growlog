// 서비스 워커: 앱 파일을 한 벌로 묶어 저장해두고, 인터넷 상태와 상관없이 바로 연다.
// 새 버전은 뒤에서 전부 받은 다음에만 통째로 바꾼다. 받다가 끊겨도 옛 버전이 그대로 남아 파일 버전이 섞이지 않는다.
// 파일을 추가했다면 아래 목록에도 넣어주세요. 빠뜨린 파일은 오프라인에서 열리지 않아요.
const PREFIX = 'growlog-app-';
const COMPLETE = './__complete__'; // 한 벌을 끝까지 저장했다는 표시. 이게 없는 캐시는 쓰지 않는다.
const REFRESH_DELAY = 3000; // 앱이 저장된 파일을 다 읽은 뒤에 확인을 시작한다
const DOWNLOAD_TIMEOUT = 20000;
const MATCH = { ignoreSearch: true, ignoreVary: true };
const TYPES = { '.js': 'javascript', '.css': 'css', '.html': 'html', '/': 'html', '.png': 'image/png', '.webmanifest': 'manifest' };
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/backup.js',
  './js/charts.js',
  './js/contacts.js',
  './js/dates.js',
  './js/insight.js',
  './js/pwa.js',
  './js/sample.js',
  './js/store.js',
  './js/strain.js',
  './js/ui.js',
  './js/util.js',
  './js/views/help.js',
  './js/views/recovery.js',
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

/** 끝까지 저장된 캐시 중 가장 새 것 */
async function currentCache() {
  const versionOf = (name) => Number(name.slice(PREFIX.length));
  const names = (await caches.keys()).filter((name) => name.startsWith(PREFIX)).sort((a, b) => versionOf(b) - versionOf(a));
  for (const name of names) {
    const cache = await caches.open(name);
    if (await cache.match(COMPLETE)) return { name, cache, version: versionOf(name) };
  }
  return null;
}

/** 파일을 모두 받는다. 하나라도 실패하면 전체를 실패로 본다. */
async function download() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT);
  try {
    return await Promise.all(
      FILES.map(async (url) => {
        const response = await fetch(url, { cache: 'no-cache', signal: controller.signal });
        if (!response.ok) throw new Error(`${url}: ${response.status}`);
        const type = response.headers.get('content-type');
        const body = await response.arrayBuffer();
        // 프록시가 200으로 준 다른 내용이 앱을 대신하지 않게 한다
        const wanted = Object.entries(TYPES).find(([ext]) => url.endsWith(ext))?.[1];
        if (!body.byteLength || (wanted && !type?.includes(wanted))) throw new Error(`${url}: ${type}`);
        if (wanted === 'html' && !new TextDecoder().decode(body).includes('src="js/app.js"')) throw new Error(`${url}: 앱이 아닌 페이지`);
        return { url, type, body };
      }),
    );
  } finally {
    clearTimeout(timer);
  }
}

function sameBytes(a, b) {
  const before = new Uint8Array(a);
  const after = new Uint8Array(b);
  return before.length === after.length && before.every((byte, i) => byte === after[i]);
}

async function isDifferent(files, cache) {
  for (const { url, body } of files) {
    const saved = await cache.match(url, MATCH);
    if (!saved || !sameBytes(await saved.arrayBuffer(), body)) return true;
  }
  return false;
}

async function save(files, version) {
  const cache = await caches.open(PREFIX + version);
  await Promise.all(files.map(({ url, type, body }) => cache.put(url, new Response(body, { headers: { 'content-type': type } }))));
  await cache.put(COMPLETE, new Response('ok'));
}

async function removeOldCaches() {
  const current = await currentCache();
  const names = (await caches.keys()).filter((name) => name.startsWith('growlog-') && name !== current?.name);
  await Promise.all(names.map((name) => caches.delete(name)));
}

/** 새 파일을 받아 달라졌으면 저장한다. 바뀌었으면 true */
async function update() {
  const files = await download();
  const current = await currentCache();
  if (current && !(await isDifferent(files, current.cache))) return false;
  // 받는 도중에 새 배포가 올라오면 두 빌드가 섞인다. 한 번 더 받아 같을 때만 저장하고, 아니면 다음 실행에서 다시 받는다.
  const again = await download();
  if (files.some(({ body }, i) => !sameBytes(body, again[i].body))) {
    if (!current) throw new Error('배포 중'); // 저장해둔 새 버전이 없으니 설치를 멈춰 옛 버전을 지킨다
    return false;
  }
  await save(files, (current?.version ?? 0) + 1);
  return true;
}

async function tellPages() {
  const pages = await self.clients.matchAll({ type: 'window' });
  pages.forEach((page) => page.postMessage({ type: 'updated' }));
}

let refreshing = null;

function refresh() {
  refreshing ??= new Promise((resolve) => setTimeout(resolve, REFRESH_DELAY))
    .then(update)
    .then(async (updated) => {
      if (!updated) return;
      await removeOldCaches();
      await tellPages();
    })
    .catch(() => {}) // 인터넷이 없거나 서버 오류면 지금 버전을 그대로 쓴다
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function respond(request) {
  const current = await currentCache();
  return (await current?.cache.match(request, MATCH)) ?? fetch(request);
}

let replaced = false; // sw.js가 바뀐 배포면 설치 단계에서 새 버전을 받으므로, 활성화한 뒤에 알린다
// 기록 형식 2 (js/store.js의 VERSION). 형식이 바뀌면 이 줄도 바꿔서 sw.js가 달라지게 한다. 그래야 새 워커가 설치되어 아래 upgraded로 열린 창을 다시 연다.
let upgraded = false; // 옛 워커를 밀어냈다. 옛 코드가 떠 있는 창은 새 형식의 기록(영역 7~8개, 색 7~10번, 그때그때 다른 일과 끝나고 나니)을 자기 형식으로 줄여 덮어쓴다

self.addEventListener('install', (event) => {
  upgraded = !!self.registration.active;
  event.waitUntil(
    update().then((changed) => {
      replaced = changed && !!self.registration.active;
      return self.skipWaiting();
    }),
  );
});

/**
 * 열린 창을 모두 새 코드로 다시 연다. 다시 여는 요청은 활성화가 끝나야 처리되므로 끝나기를 기다리지 않는다.
 * page.url은 창을 처음 연 주소라 탭을 옮긴 창에서는 # 뒤가 지금과 다르고, # 뒤만 다른 주소로 가면 문서를 다시 읽지 않는다. 그래서 # 앞까지만 연다.
 */
async function reloadPages() {
  const pages = await self.clients.matchAll({ type: 'window' });
  pages.forEach((page) => page.navigate(page.url.split('#')[0]).catch(() => {}));
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    removeOldCaches()
      .then(() => self.clients.claim())
      .then(() => (upgraded ? reloadPages() : replaced ? tellPages() : undefined)),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') event.waitUntil(refresh());
  event.respondWith(respond(request));
});
