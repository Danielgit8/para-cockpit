// Offline-Cache: App-Dateien sofort aus dem Speicher, im Hintergrund aktualisieren.
const CACHE = "para-cockpit-v6";
const SHELL = ["./", "./index.html", "./supabase.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, {cache: "reload"})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (req.cache === "no-store") return; // Update-Prüfung der App geht immer ans Netz
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (!sameOrigin && !isFont) return; // Supabase-Anfragen gehen direkt ans Netz
  // App-Seite: zuerst frisch aus dem Netz (damit Updates sofort ankommen), nach 3 s oder offline aus dem Speicher
  if (req.mode === "navigate") {
    const net = fetch("./index.html", {cache: "no-store"}).then(async res => {
      if (res && res.ok) { const c = await caches.open(CACHE); await c.put("./index.html", res.clone()); }
      return res;
    });
    e.waitUntil(net.catch(() => {}));
    const fallback = () => caches.match("./index.html", {ignoreSearch: true});
    e.respondWith(Promise.race([
      net.then(res => res && res.ok ? res : fallback()).catch(fallback),
      new Promise(r => setTimeout(r, 3000)).then(fallback).then(hit => hit || net)
    ]));
    return;
  }
  const key = req;
  const fresh = fetch(req).then(async res => {
    if (res && (res.ok || res.type === "opaque")) { const c = await caches.open(CACHE); await c.put(key, res.clone()); }
    return res;
  });
  e.waitUntil(fresh.catch(() => {}));
  e.respondWith(caches.match(key, {ignoreSearch: true}).then(hit => hit || fresh));
});

// Tipp auf eine Erinnerung: App öffnen und den Eintrag zeigen
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const d = e.notification.data || {};
  const url = new URL("./" + (d.id ? "#open=" + d.id : d.view ? "#view=" + d.view : ""), self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({type: "window", includeUncontrolled: true}).then(list => {
    for (const c of list) if ("focus" in c) { c.postMessage({type: "open", id: d.id, view: d.view}); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
