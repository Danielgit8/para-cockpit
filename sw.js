// Offline-Cache: App-Dateien sofort aus dem Speicher, im Hintergrund aktualisieren.
const CACHE = "para-cockpit-v1";
const SHELL = ["./", "./index.html", "./supabase.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (!sameOrigin && !isFont) return; // Supabase-Anfragen gehen direkt ans Netz
  const key = req.mode === "navigate" ? "./index.html" : req;
  const fresh = fetch(req).then(async res => {
    if (res && (res.ok || res.type === "opaque")) { const c = await caches.open(CACHE); await c.put(key, res.clone()); }
    return res;
  });
  e.waitUntil(fresh.catch(() => {}));
  e.respondWith(caches.match(key, {ignoreSearch: true}).then(hit => hit || fresh));
});
