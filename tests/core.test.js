// Tests für core.js. Ausführen: npm test (braucht nur Node 18+, keine Pakete)
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../core.js");

/* ---------- Abgleich: Seitengrenze bei gleichen Zeitstempeln ---------- */
// Nachbau der Datenbank-Abfrage: sortiert nach (synced_at, id), Filter wie in index.html
function fakeServer(rows){
  rows = rows.slice().sort((a, b) => a.synced_at.localeCompare(b.synced_at) || a.id.localeCompare(b.id));
  return async ({since, after, limit}) => rows.filter(r =>
    after ? (r.synced_at > after.t || (r.synced_at === after.t && r.id > after.id))
    : since ? Date.parse(r.synced_at) > Date.parse(since) : true).slice(0, limit);
}
const ts = s => `2026-10-19T08:00:${String(s).padStart(2, "0")}.000000+00:00`;
const iso = s => new Date(Date.parse(ts(s))).toISOString(); // gleicher Zeitpunkt, andere Schreibweise

test("1.001 Einträge mit gleichem Zeitstempel kommen alle an", async () => {
  const rows = Array.from({length:1001}, (_, i) => ({id:"i" + String(i).padStart(4, "0"), synced_at:ts(1)}));
  const got = new Set();
  const res = await C.pullAll(fakeServer(rows), null, rs => rs.forEach(r => got.add(r.id)));
  assert.equal(got.size, 1001);
  assert.equal(res.done, true);
  assert.deepEqual(res.cursor, {t:ts(1), id:"i1000"});
});

test("Folgeabruf holt nur Neues und verliert nichts an der Grenze", async () => {
  const rows = Array.from({length:2500}, (_, i) => ({id:"x" + String(i).padStart(4, "0"), synced_at:ts(i < 1500 ? 1 : 2)}));
  const seen = new Set();
  const r1 = await C.pullAll(fakeServer(rows.slice(0, 1200)), null, rs => rs.forEach(r => seen.add(r.id)), {pageSize:500});
  const r2 = await C.pullAll(fakeServer(rows), r1.cursor, rs => rs.forEach(r => seen.add(r.id)), {pageSize:500, overlapMs:0});
  assert.equal(seen.size, 2500);
  assert.equal(r2.cursor.id, "x2499");
});

test("Überlappung holt kurz zuvor bestätigte Zeilen erneut", async () => {
  const rows = [{id:"a", synced_at:ts(10)}, {id:"spaet", synced_at:ts(8)}];
  const got = [];
  await C.pullAll(fakeServer(rows), {t:ts(10), id:"a"}, rs => got.push(...rs.map(r => r.id)), {overlapMs:5000});
  assert.ok(got.includes("spaet"));
});

test("maxPages bricht ab und meldet, dass noch etwas fehlt", async () => {
  const rows = Array.from({length:30}, (_, i) => ({id:"p" + String(i).padStart(2, "0"), synced_at:ts(i)}));
  const res = await C.pullAll(fakeServer(rows), null, () => {}, {pageSize:10, maxPages:2});
  assert.equal(res.done, false);
  assert.equal(res.cursor.id, "p19");
});

test("alter Cursor (nur Text) wird übernommen", () => {
  assert.deepEqual(C.normCursor(ts(3)), {t:ts(3), id:""});
  assert.equal(C.normCursor(null), null);
});

test("Filter für PostgREST setzt Werte in Anführungszeichen", () => {
  assert.equal(C.afterFilter({t:"2026-10-19T08:00:01.5+00:00", id:"ab\"c"}),
    'synced_at.gt."2026-10-19T08:00:01.5+00:00",and(synced_at.eq."2026-10-19T08:00:01.5+00:00",id.gt."ab\\"c")');
});

/* ---------- Konflikte ---------- */
const srv = (data, extra = {}) => ({id:data.id, data, updated_at:data.updated, deleted:false, ...extra});

test("Konflikt: neuere Serverfassung gilt, eigene wird Konfliktkopie ohne Anhänge", () => {
  const local = {id:"n1", kind:"note", title:"Plan", body:"Handy", files:[{path:"u/n1/a.pdf", name:"a.pdf"}], updated:100};
  const server = {id:"n1", kind:"note", title:"Plan", body:"Laptop", files:[{path:"u/n1/a.pdf", name:"a.pdf"}], updated:200};
  const r = C.resolveRejected(local, srv(server), {newId:"k1", now:300});
  assert.equal(r.take.body, "Laptop");
  assert.equal(r.copy.id, "k1");
  assert.equal(r.copy.body, "Handy");
  assert.equal(r.copy.title, "Plan (Konfliktkopie)");
  assert.deepEqual(r.copy.files, []);
  assert.equal(r.copy.conflictOf, "n1");
});

test("Konflikt: gleicher Inhalt in anderer Schlüssel-Reihenfolge ist kein Konflikt", () => {
  const local = {id:"n1", kind:"note", title:"A", body:"B", tags:["x"], updated:1};
  const server = {updated:2, tags:["x"], body:"B", title:"A", kind:"note", id:"n1"};
  assert.equal(C.resolveRejected(local, srv(server)).copy, null);
});

test("Konflikt: auf dem Server gelöscht (später) gewinnt die Löschung", () => {
  const local = {id:"n1", kind:"note", title:"A", updated:1};
  const r = C.resolveRejected(local, {id:"n1", data:{}, updated_at:5, deleted:true});
  assert.equal(r.take, null);
  assert.equal(r.copy, null);
});

test("Konflikt: bei uns gelöscht, auf dem Server später bearbeitet → Eintrag bleibt", () => {
  const server = {id:"n1", kind:"task", title:"Neu", updated:9};
  const r = C.resolveRejected(null, srv(server));
  assert.equal(r.take.title, "Neu");
  assert.equal(r.copy, null);
});

test("Konflikt: Gewohnheiten führen Häkchen zusammen statt Kopie", () => {
  const local = {id:"h1", kind:"habit", title:"Lesen", log:{"2026-10-17":true, "2026-10-18":true}, updated:1};
  const server = {id:"h1", kind:"habit", title:"Lesen 20 min", log:{"2026-10-18":2, "2026-10-19":true}, updated:2};
  const r = C.resolveRejected(local, srv(server), {now:50});
  assert.equal(r.copy, null);
  assert.equal(r.push, true);
  assert.equal(r.take.title, "Lesen 20 min");
  assert.deepEqual(r.take.log, {"2026-10-17":true, "2026-10-18":2, "2026-10-19":true});
});

test("Konflikt: interne Arten (z. B. Training) übernehmen den Server ohne Kopie", () => {
  const r = C.resolveRejected({id:"w", kind:"workout", note:"a", updated:1}, srv({id:"w", kind:"workout", note:"b", updated:2}), {hidden:["workout"]});
  assert.equal(r.copy, null);
  assert.equal(r.take.note, "b");
});

/* ---------- Sicherung ---------- */
test("Sicherung: ungültige Einträge werden gemeldet, gültige bleiben", () => {
  const b = C.parseBackup({app:"para-cockpit", items:[
    {id:"ok1", kind:"note", title:"A"},
    {id:"bad id!", kind:"note"},
    {id:"ok2"},
    {id:"ok3", kind:"task", tags:"keine Liste"},
    {id:"ok1", kind:"note", title:"doppelt"},
    {id:"__settings", kind:"x"},
    {id:"ok4", kind:"note", updated:"gestern"},
  ]});
  assert.deepEqual(b.items.map(i => i.id), ["ok1"]);
  assert.equal(b.invalid.length, 6);
  assert.equal(b.full, false);
});

test("Sicherung: fremde App oder ohne items wird abgelehnt", () => {
  assert.throws(() => C.parseBackup({app:"brand-weg", items:[]}), /anderen App/);
  assert.throws(() => C.parseBackup({foo:1}), /items/);
});

test("Importplan: neu, überschreiben, neuere lokale behalten, unverändert", () => {
  const local = new Map([
    ["a", {id:"a", kind:"note", title:"A", updated:10}],
    ["b", {id:"b", kind:"note", title:"B lokal neu", updated:50}],
    ["c", {id:"c", kind:"note", title:"C alt", updated:5}],
    ["d", {id:"d", kind:"note", title:"nur lokal", updated:1}],
  ]);
  const b = C.parseBackup({app:"para-cockpit", settings:{}, items:[
    {id:"a", kind:"note", title:"A", updated:99},
    {id:"b", kind:"note", title:"B Sicherung", updated:20},
    {id:"c", kind:"note", title:"C Sicherung", updated:20},
    {id:"e", kind:"note", title:"neu"},
  ]});
  const m = C.planImport(b, local);
  assert.deepEqual(m.add.map(i => i.id), ["e"]);
  assert.deepEqual(m.over.map(i => i.id), ["c"]);
  assert.deepEqual(m.keep.map(i => i.id), ["b"]);
  assert.deepEqual(m.same.map(i => i.id), ["a"]);
  assert.deepEqual(m.remove, []);
  const all = C.planImport(b, local, {keepNewer:false});
  assert.deepEqual(all.over.map(i => i.id).sort(), ["b", "c"]);
  const rep = C.planImport(b, local, {replace:true});
  assert.deepEqual(rep.remove.map(i => i.id), ["d"]);
  assert.deepEqual(rep.over.map(i => i.id).sort(), ["b", "c"]);
});

test("Einstellungen zusammenführen ergänzt nur fehlende Themen", () => {
  const out = C.mergeSettings({theme:"dark", topics:[{id:"a", name:"A"}]}, {theme:"light", topics:[{id:"a", name:"anders"}, {id:"b", name:"B"}]});
  assert.equal(out.theme, "dark");
  assert.deepEqual(out.topics.map(t => t.name), ["A", "B"]);
});

test("Dateipfade werden aufs eigene Konto umgeschrieben", () => {
  assert.equal(C.repath("alt-uuid/item1/x-a.pdf", "neu"), "neu/item1/x-a.pdf");
});

test("ZIP: schreiben und wieder lesen, auch mit Umlauten", async () => {
  const enc = s => new TextEncoder().encode(s);
  const bin = new Uint8Array(70000).map((_, i) => (i * 31) & 255);
  const parts = C.zipParts([{name:"backup.json", data:enc('{"a":"ä"}')}, {name:"dateien/u/ü.bin", data:bin}]);
  const blob = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { blob.set(p, o); o += p.length; }
  const z = await C.unzip(blob);
  assert.equal(new TextDecoder().decode(z.get("backup.json")), '{"a":"ä"}');
  assert.deepEqual(Buffer.from(z.get("dateien/u/ü.bin")), Buffer.from(bin));
});

test("ZIP: gepackte Dateien (deflate) aus anderen Programmen lassen sich lesen", async () => {
  const zlib = require("node:zlib");
  const data = new TextEncoder().encode("hallo hallo hallo hallo");
  const def = zlib.deflateRawSync(data);
  // Ein Eintrag, Methode 8
  const name = new TextEncoder().encode("backup.json");
  const crc = C.crc32(data);
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(def.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(def.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(name.length, 28);
  const cdOff = 30 + name.length + def.length;
  const eo = Buffer.alloc(22); eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(1, 8); eo.writeUInt16LE(1, 10); eo.writeUInt32LE(46 + name.length, 12); eo.writeUInt32LE(cdOff, 16);
  const z = await C.unzip(new Uint8Array(Buffer.concat([lh, name, def, cd, name, eo])));
  assert.equal(new TextDecoder().decode(z.get("backup.json")), "hallo hallo hallo hallo");
});

test("CRC32 stimmt mit dem Standardwert überein", () => {
  assert.equal(C.crc32(new TextEncoder().encode("123456789")), 0xCBF43926);
});

/* ---------- Wiederkehrende Aufgaben an Monats- und Jahresgrenzen ---------- */
const at = k => C.parseKey(k);
test("monatlich am 31.: Februar bekommt den letzten Tag, März wieder den 31.", () => {
  const t = {repeat:"monthly", repeatDom:31};
  assert.equal(C.dkey(C.stepDate(at("2026-01-31"), t)), "2026-02-28");
  assert.equal(C.dkey(C.stepDate(at("2026-02-28"), t)), "2026-03-31");
  assert.equal(C.dkey(C.stepDate(at("2027-01-31"), t)), "2027-02-28");
  assert.equal(C.dkey(C.stepDate(at("2028-01-31"), t)), "2028-02-29"); // Schaltjahr
});
test("monatlich über den Jahreswechsel", () => {
  assert.equal(C.dkey(C.stepDate(at("2026-12-15"), {repeat:"monthly"})), "2027-01-15");
});
test("täglich und wöchentlich über den Jahreswechsel", () => {
  assert.equal(C.dkey(C.stepDate(at("2026-12-31"), {repeat:"daily"})), "2027-01-01");
  assert.equal(C.dkey(C.stepDate(at("2026-12-29"), {repeat:"weekly"})), "2027-01-05");
});
test("werktags: Freitag → Montag", () => {
  assert.equal(C.dkey(C.stepDate(at("2026-10-16"), {repeat:"weekdays"})), "2026-10-19");
});
test("bestimmte Tage (Di, Do)", () => {
  const t = {repeat:"days", repeatDays:[2, 4]};
  assert.equal(C.dkey(C.stepDate(at("2026-10-20"), t)), "2026-10-22");
  assert.equal(C.dkey(C.stepDate(at("2026-10-22"), t)), "2026-10-27");
});
test("nextDue springt über verpasste Termine bis nach heute", () => {
  assert.equal(C.nextDue({repeat:"monthly", due:"2026-01-31"}, at("2026-04-10")), "2026-04-30");
  assert.equal(C.nextDue({repeat:"monthly", due:"2026-01-31"}, at("2026-04-30")), "2026-05-31");
  assert.equal(C.nextDue({repeat:"daily", due:"2026-12-30"}, at("2026-12-31")), "2027-01-01");
});

/* ---------- Suche ---------- */
const items = [
  {id:"1", kind:"note", title:"Einkauf", body:"Milch und Brot", tags:["haushalt"], updated:1},
  {id:"2", kind:"resource", title:"Brot backen", body:"Rezept", updated:2},
  {id:"3", kind:"workout", title:"Push Tag", note:"", ex:[{name:"Bankdrücken"}], updated:3},
  {id:"4", kind:"contact", title:"Lena", note:"Kennt sich mit Brot aus", updated:4},
  {id:"5", kind:"day", title:"Brot", updated:5},
  {id:"6", kind:"note", title:"Brot", archived:true, updated:6},
];
test("Suche: Titeltreffer vor Texttreffern, Archiv weiter hinten, interne Arten nie", () => {
  const ids = C.searchItems(items, "brot").map(h => h.item.id);
  assert.equal(ids[0], "2");
  assert.ok(!ids.includes("5"));
  assert.ok(ids.indexOf("6") > ids.indexOf("2"));
  assert.ok(ids.includes("1") && ids.includes("4"));
});
test("Suche: Training, Kontakte, mehrere Wörter, Stichwörter, keine Begrenzung auf 12", () => {
  assert.deepEqual(C.searchItems(items, "bankdrücken").map(h => h.item.id), ["3"]);
  assert.deepEqual(C.searchItems(items, "milch brot").map(h => h.item.id), ["1"]);
  assert.deepEqual(C.searchItems(items, "#haus").map(h => h.item.id), ["1"]);
  const many = Array.from({length:40}, (_, i) => ({id:"m" + i, kind:"note", title:"Ding " + i}));
  assert.equal(C.searchItems(many, "ding").length, 40);
});
test("Ausschnitt rund um den Treffer", () => {
  const t = "a ".repeat(100) + "Zielwort " + "b ".repeat(100);
  const s = C.snippet(t, "zielwort", 60);
  assert.ok(s.includes("Zielwort") && s.startsWith("…"));
});
