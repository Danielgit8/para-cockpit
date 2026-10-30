// Offline-Cache. Wichtig: Installieren und Aktivieren warten nie auf das Netz,
// sonst kann ein hängender Download ein Update dauerhaft blockieren.
const CACHE = "para-cockpit-v57";
const IMG = "para-cockpit-img"; // Produktbilder von Open Food Facts, bleiben über Updates hinweg erhalten
const SHELL = ["./index.html", "./core.js", "./supabase.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png", "./img/morgen.jpg", "./img/abend.jpg", "./img/bretagne.jpg", "./img/gebet.jpg", "./data/foods-ch.json", "./data/foods-off.json"];
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== IMG).map(k => caches.delete(k)))).then(() => self.clients.claim()));
  // App-Dateien im Hintergrund vorladen (für offline), ohne die Aktivierung aufzuhalten
  caches.open(CACHE).then(c => Promise.all(SHELL.map(u =>
    withTimeout(fetch(u, {cache: "no-store"}), 15000).then(res => res.ok ? c.put(u, res) : null).catch(() => null)
  ))).catch(() => {});
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (req.cache === "no-store") return; // Update-Prüfung der App geht immer ans Netz
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  // Produktbilder: einmal geladen, danach auch offline; höchstens 600 Bilder, die ältesten fliegen raus
  if (url.hostname === "images.openfoodfacts.org") {
    e.respondWith(caches.open(IMG).then(c => c.match(req).then(hit => hit || fetch(req).then(res => {
      if (res && res.ok) { c.put(req, res.clone()); c.keys().then(k => { if (k.length > 600) k.slice(0, k.length - 600).forEach(x => c.delete(x)); }); }
      return res;
    }))));
    return;
  }
  if (!sameOrigin && !isFont) return; // Supabase-Anfragen gehen direkt ans Netz
  // App-Seite: zuerst frisch aus dem Netz (damit Updates sofort ankommen), nach 3 s oder offline aus dem Speicher
  if (req.mode === "navigate") {
    const net = withTimeout(fetch("./index.html", {cache: "no-store"}), 20000).then(async res => {
      if (res && res.ok) { const c = await caches.open(CACHE); await c.put("./index.html", res.clone()); }
      return res;
    });
    e.waitUntil(net.catch(() => {}));
    const fallback = () => caches.match("./index.html", {ignoreSearch: true});
    e.respondWith(Promise.race([
      net.then(res => res && res.ok ? res : fallback()).catch(fallback),
      new Promise(r => setTimeout(r, 3000)).then(fallback).then(hit => hit || net)
    ]).then(res => res || fetch(req)));
    return;
  }
  // core.js gehört zur Seite: wie index.html zuerst frisch holen, damit beide immer zusammenpassen
  if (sameOrigin && url.pathname.endsWith("/core.js")) {
    const net = withTimeout(fetch(req, {cache: "no-store"}), 3000).then(async res => {
      if (res && res.ok) { const c = await caches.open(CACHE); await c.put("./core.js", res.clone()); return res; }
      throw new Error("bad");
    });
    e.respondWith(net.catch(() => caches.match("./core.js", {ignoreSearch: true}).then(hit => hit || fetch(req))));
    return;
  }
  const fresh = withTimeout(fetch(req), 20000).then(async res => {
    if (res && (res.ok || res.type === "opaque")) { const c = await caches.open(CACHE); await c.put(req, res.clone()); }
    return res;
  });
  e.waitUntil(fresh.catch(() => {}));
  e.respondWith(caches.match(req, {ignoreSearch: true}).then(hit => hit || fresh));
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
