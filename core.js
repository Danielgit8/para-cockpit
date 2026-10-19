// PARA Cockpit: Kernlogik ohne Oberfläche (Abgleich, Konflikte, Sicherung, Suche, Wiederholungen).
// Läuft im Browser als window.PCcore und in Node für die Tests (npm test).
(function(root){
"use strict";

/* ---------- Datum ---------- */
const pad = n => String(n).padStart(2, "0");
const dkey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const parseKey = k => { const [y, m, d] = String(k).split("-").map(Number); return new Date(y, m - 1, d); };
const isoDay = (d = new Date()) => (d.getDay() + 6) % 7 + 1;

/* ---------- Wiederkehrende Aufgaben ---------- */
function stepDate(d, t){
  const r = t.repeat;
  if (r === "daily") return addDays(d, 1);
  if (r === "weekly") return addDays(d, 7);
  if (r === "monthly") { const x = new Date(d.getFullYear(), d.getMonth() + 1, 1); const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate(); x.setDate(Math.min(t.repeatDom || d.getDate(), last)); return x; }
  const days = r === "weekdays" ? [1,2,3,4,5] : (t.repeatDays || []);
  if (!days.length) return addDays(d, 7);
  let x = addDays(d, 1); for (let i = 0; i < 7 && !days.includes(isoDay(x)); i++) x = addDays(x, 1); return x;
}
// Nächster Termin nach heute. repeatDom merkt sich den Monatstag, damit aus dem 31. nach Februar wieder der 31. wird.
function nextDue(t, today = new Date()){
  const d0 = t.due ? parseKey(t.due) : new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const tt = {...t, repeatDom: t.repeatDom || d0.getDate()}; const tk = dkey(today);
  let d = d0; for (let g = 0; g < 2000; g++) { d = stepDate(d, tt); if (dkey(d) > tk) break; }
  return dkey(d);
}

/* ---------- Vergleich ohne Rücksicht auf Schlüssel-Reihenfolge (jsonb sortiert Schlüssel um) ---------- */
function stable(v){
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
  return JSON.stringify(v === undefined ? null : v);
}
const IGNORE = new Set(["updated", "thumb"]);
const content = it => { const o = {}; for (const k of Object.keys(it || {})) if (!IGNORE.has(k)) o[k] = it[k]; return stable(o); };
const sameContent = (a, b) => content(a) === content(b);

/* ---------- Abgleich: Seiten holen mit stabilem Cursor (synced_at, id) ---------- */
// PostgREST-Werte in or()-Filtern in Anführungszeichen, weil Zeitstempel Punkte und Doppelpunkte enthalten.
const pq = v => `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const afterFilter = c => `synced_at.gt.${pq(c.t)},and(synced_at.eq.${pq(c.t)},id.gt.${pq(c.id)})`;
// Alter Cursor war nur ein Zeitstempel-Text
const normCursor = c => !c ? null : typeof c === "string" ? {t:c, id:""} : (c.t ? {t:c.t, id:c.id || ""} : null);
// fetchPage({since, after, limit}) liefert Zeilen sortiert nach synced_at, id.
// Erste Seite: alles ab Cursor minus overlapMs (fängt Schreibvorgänge, die spät bestätigt wurden).
// Danach exakt ab der letzten Zeile, so gehen gleiche Zeitstempel an der Seitengrenze nicht verloren.
async function pullAll(fetchPage, cursor, onRows, {pageSize = 1000, maxPages = 50, overlapMs = 5000} = {}){
  let cur = normCursor(cursor), after = null, since = null;
  if (cur && overlapMs > 0) since = new Date(Date.parse(cur.t) - overlapMs).toISOString(); else if (cur) after = cur;
  for (let p = 0; p < maxPages; p++) {
    const rows = await fetchPage({since, after, limit:pageSize});
    if (rows.length) { onRows(rows); const l = rows[rows.length - 1]; cur = {t:l.synced_at, id:l.id}; after = cur; since = null; }
    if (rows.length < pageSize) return {cursor:cur, done:true};
  }
  return {cursor:cur, done:false};
}

/* ---------- Konflikt: der Server hat eine neuere Fassung und hat unsere abgelehnt ---------- */
// local: unsere Fassung (null = bei uns gelöscht), server: {id, data, updated_at, deleted}
// Ergebnis: take = Fassung, die gilt (null = gelöscht), push = take muss neu hochgeladen werden, copy = unsere Fassung als eigener Eintrag
function resolveRejected(local, server, {hidden = [], now = Date.now(), newId} = {}){
  const take = server.deleted ? null : {...server.data, id:server.id};
  if (!local || !take || sameContent(local, take)) return {take, push:false, copy:null};
  if (local.kind === "habit" && take.kind === "habit") {
    // Häkchen beider Geräte behalten; bei gleichem Tag gilt der Server
    return {take:{...take, log:{...(local.log || {}), ...(take.log || {})}, updated:now}, push:true, copy:null};
  }
  if (hidden.includes(local.kind)) return {take, push:false, copy:null};
  // Anhänge gehören dem Original. Die Kopie verweist nicht darauf, sonst löscht das Entfernen der Kopie die Dateien.
  const copy = {...local, id:newId, title:(local.title || "Ohne Titel") + " (Konfliktkopie)", files:[], shots:[], created:now, updated:now, conflictOf:server.id};
  return {take, push:false, copy};
}

/* ---------- Sicherung prüfen und Import planen ---------- */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
function checkItem(it){
  if (!it || typeof it !== "object" || Array.isArray(it)) return "kein Eintrag";
  if (typeof it.id !== "string" || !ID_RE.test(it.id) || it.id.startsWith("__")) return "ungültige ID";
  if (typeof it.kind !== "string" || !it.kind) return "Art fehlt";
  for (const k of ["title", "body"]) if (it[k] != null && typeof it[k] !== "string") return `„${k}“ ist kein Text`;
  for (const k of ["rel", "links", "files", "tags", "shots"]) if (it[k] != null && !Array.isArray(it[k])) return `„${k}“ ist keine Liste`;
  if ((it.rel || []).some(r => typeof r !== "string")) return "Verknüpfung ist keine ID";
  if ((it.tags || []).some(t => typeof t !== "string")) return "Stichwort ist kein Text";
  if ([...(it.files || []), ...(it.shots || [])].some(f => !f || typeof f !== "object" || (f.path != null && typeof f.path !== "string"))) return "Datei-Angabe kaputt";
  for (const k of ["updated", "created"]) if (it[k] != null && !Number.isFinite(it[k])) return `„${k}“ ist keine Zahl`;
  return "";
}
function parseBackup(j){
  if (!j || typeof j !== "object" || !Array.isArray(j.items)) throw new Error("Keine Sicherung: die Liste „items“ fehlt.");
  if (j.app && j.app !== "para-cockpit") throw new Error("Die Datei stammt aus einer anderen App.");
  const items = [], invalid = [], seen = new Set();
  j.items.forEach((it, i) => {
    const why = checkItem(it);
    if (why) invalid.push({i, why, title:(it && typeof it.title === "string" && it.title) || ""});
    else if (seen.has(it.id)) invalid.push({i, why:"doppelte ID", title:it.title || ""});
    else { seen.add(it.id); items.push(it); }
  });
  const settings = j.settings && typeof j.settings === "object" && !Array.isArray(j.settings) ? j.settings : null;
  return {items, invalid, settings, full:!!settings};
}
// local: Map id -> Eintrag. replace = Gerät exakt auf den Stand der Sicherung bringen.
function planImport(b, local, {keepNewer = true, replace = false} = {}){
  const add = [], over = [], keep = [], same = [], remove = [];
  for (const it of b.items) {
    const l = local.get(it.id);
    if (!l) add.push(it);
    else if (sameContent(l, it)) same.push(it);
    else if (keepNewer && !replace && (l.updated || 0) > (it.updated || 0)) keep.push(it);
    else over.push(it);
  }
  if (replace) { const ids = new Set(b.items.map(i => i.id)); for (const [id, l] of local) if (!ids.has(id) && !id.startsWith("__")) remove.push(l); }
  return {add, over, keep, same, remove};
}
// Zusammenführen: Themen und eigene Arten aus der Sicherung ergänzen, sonst gelten die Einstellungen des Geräts
function mergeSettings(cur, inc){
  const out = {...cur};
  for (const k of ["topics", "kinds"]) {
    const have = new Set((cur[k] || []).map(x => x && x.id));
    out[k] = [...(cur[k] || []), ...(inc[k] || []).filter(x => x && x.id && !have.has(x.id))];
  }
  return out;
}
// Dateipfade gehören zum Konto (erster Ordner = Nutzer-ID). Beim Einspielen in ein anderes Konto umschreiben.
const repath = (path, userId) => { const i = path.indexOf("/"); return i < 0 ? `${userId}/${path}` : `${userId}${path.slice(i)}`; };

/* ---------- ZIP (ohne Bibliothek): schreiben ungepackt, lesen ungepackt oder deflate ---------- */
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8){ let c = ~0; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8); return ~c >>> 0; }
const enc = s => new TextEncoder().encode(s);
// files: [{name, data: Uint8Array}] → Liste von Uint8Array-Stücken (Browser: new Blob(parts))
function zipParts(files){
  const parts = [], central = []; let off = 0;
  const d = new Date(), dosT = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dosD = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = enc(f.name), data = f.data, crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, dosT, true); h.setUint16(12, dosD, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
    h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, dosT, true); c.setUint16(14, dosD, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
  return [...parts, ...central, new Uint8Array(e.buffer)];
}
async function inflateRaw(u8){
  if (typeof DecompressionStream === "undefined") throw new Error("Gepackte ZIP-Dateien werden hier nicht unterstützt.");
  const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
// → Map name -> Uint8Array
async function unzip(u8){
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); let e = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error("Keine gültige ZIP-Datei.");
  const n = v.getUint16(e + 10, true); let p = v.getUint32(e + 16, true); const out = new Map(), dec = new TextDecoder();
  for (let k = 0; k < n; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error("ZIP-Verzeichnis beschädigt.");
    const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true), nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), lo = v.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
    const start = lo + 30 + v.getUint16(lo + 26, true) + v.getUint16(lo + 28, true), raw = u8.subarray(start, start + csize);
    if (!name.endsWith("/")) out.set(name, method === 0 ? raw : method === 8 ? await inflateRaw(raw) : null);
    p += 46 + nl + xl + cl;
  }
  return out;
}

/* ---------- Suche mit Rangfolge ---------- */
const SKIP_K = ["day", "boardlib", "brandtpl"]; // interne Hilfseinträge
const NOFIELD = new Set(["id", "kind", "title", "body", "tags", "links", "files", "shots", "rel", "thumb", "scene", "log", "path"]);
// Weitere Textfelder (Notizen bei Kontakten, Hook bei Videos, Übungsnamen im Training …)
function extraText(i){
  const out = [];
  for (const [k, v] of Object.entries(i)) if (!NOFIELD.has(k) && typeof v === "string" && v.length > 1 && !/^\d{4}-\d\d-\d\d/.test(v)) out.push(v);
  for (const e of i.ex || []) if (e && e.name) out.push(e.name);
  return out.join(" \n ");
}
function searchItems(items, query, {tagsOf = i => i.tags || []} = {}){
  const q = String(query || "").trim().toLowerCase(); if (!q) return [];
  const tq = q.startsWith("#") ? q.slice(1) : null;
  const words = q.split(/\s+/).filter(Boolean);
  const res = [];
  for (const i of items) {
    if (!i || SKIP_K.includes(i.kind)) continue;
    const tags = tagsOf(i).map(t => String(t).toLowerCase());
    let score = 0, where = "";
    if (tq != null) { if (tags.some(t => t === tq)) score = 90; else if (tags.some(t => t.startsWith(tq))) score = 70; where = "tag"; }
    else {
      const title = (i.title || "").toLowerCase(), body = (i.body || "").toLowerCase();
      const more = [(i.links || []).map(l => (l.label || "") + " " + (l.url || "")).join(" "), (i.shots || []).map(s => s.cap || "").join(" "), (i.files || []).map(f => f.name || "").join(" "), extraText(i)].join(" ").toLowerCase();
      const hay = title + " \n " + tags.join(" ") + " \n " + body + " \n " + more;
      if (!words.every(w => hay.includes(w))) continue; // alle Wörter müssen irgendwo vorkommen
      if (title === q) score += 100; else if (title.startsWith(q)) score += 80; else if (new RegExp("(^|[^\\p{L}\\p{N}])" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u").test(title)) score += 60; else if (title.includes(q)) score += 50;
      for (const w of words) { if (title.includes(w)) score += 12; if (tags.some(t => t.includes(w))) score += 10; if (body.includes(w)) score += 4 + Math.min(4, body.split(w).length - 2); if (more.includes(w)) score += 2; }
      where = title.includes(words[0]) ? "title" : body.includes(words[0]) ? "body" : "more";
    }
    if (!score) continue;
    if (i.archived) score -= 40;
    res.push({item:i, score, where});
  }
  return res.sort((a, b) => b.score - a.score || (b.item.updated || 0) - (a.item.updated || 0));
}
// Textausschnitt rund um den ersten Treffer
function snippet(text, query, len = 140){
  const t = String(text || "").replace(/\s+/g, " ").trim(); const w = String(query || "").trim().toLowerCase().split(/\s+/)[0] || "";
  const at = w ? t.toLowerCase().indexOf(w) : -1;
  if (at < 0) return t.slice(0, len) + (t.length > len ? " …" : "");
  const s = Math.max(0, at - Math.floor(len / 3));
  return (s ? "… " : "") + t.slice(s, s + len) + (s + len < t.length ? " …" : "");
}

const api = {pad, dkey, addDays, parseKey, isoDay, stepDate, nextDue, stable, sameContent, afterFilter, normCursor, pullAll, resolveRejected,
  checkItem, parseBackup, planImport, mergeSettings, repath, crc32, zipParts, unzip, searchItems, snippet, SKIP_K};
if (typeof module === "object" && module.exports) module.exports = api; else root.PCcore = api;
})(typeof window !== "undefined" ? window : globalThis);
