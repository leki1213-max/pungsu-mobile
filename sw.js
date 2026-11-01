// 풍수모바일 서비스워커: 앱 파일은 인터넷이 되면 최신으로, 안 되면 저장된 것으로. data/ 의 큰 JSON 은 한 번 받으면 저장해 쓴다.
// API 호출(프록시·브이월드·카카오·지도 타일)은 건드리지 않고 그대로 통과시킨다. 앱 파일을 바꿀 때마다 VERSION 을 올린다.
const VERSION = "v3";
const SHELL = `pungsu-shell-${VERSION}`, DATA = `pungsu-data-${VERSION}`;
const FILES = ["./", "./index.html", "./css/app.css", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png",
  "./setup.html", "./js/app.js", "./js/setup-link.js", "./js/transport.js", "./js/vworld.js", "./js/publicdata.js", "./js/reb.js", "./js/xuankong.js", "./js/terrain.js", "./js/dem.js", "./js/nearby.js", "./js/chart.js", "./js/mdtable.js", "./js/kmz.js"];
const CDN = ["https://cdnjs.cloudflare.com/"];

self.addEventListener("install", (e) => { e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => (k.startsWith("pungsu-shell-") || k.startsWith("pungsu-data-")) && k !== SHELL && k !== DATA).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET") return;
  const same = url.origin === location.origin;
  if (same && url.pathname.includes("/data/")) {                               // 큰 자료: 저장된 것 먼저
    e.respondWith(caches.open(DATA).then(async (c) => { const hit = await c.match(req); if (hit) return hit; const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r; }));
    return;
  }
  if (same || CDN.some((p) => req.url.startsWith(p))) {                        // 앱 파일·라이브러리: 인터넷 먼저, 안 되면 저장본
    e.respondWith(fetch(req, same ? { cache: "no-cache" } : undefined).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); } return r; }).catch(() => caches.match(req, { ignoreSearch: true })));
  }
});
