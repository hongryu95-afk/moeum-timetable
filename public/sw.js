// 앱 껍데기만 저장해 두고(오프라인에서도 열리게), 데이터(Supabase)는 항상 네트워크로.
const CACHE = "tt-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) =>
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())),
);
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/_next/static/")) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => (caches.open(CACHE).then((c) => c.put(req, res.clone())), res))));
  } else if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => (caches.open(CACHE).then((c) => c.put("/", res.clone())), res))
        .catch(() => caches.match("/")),
    );
  }
});
