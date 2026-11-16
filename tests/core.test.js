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

test("Konflikt: feste Aufgaben (gtask) führen Häkchen zusammen, obwohl sie versteckt sind", () => {
  const local = {id:"gt-morgengebet", kind:"gtask", title:"Morgengebet", goal:"basics", log:{"2026-11-13":true}, updated:1};
  const server = {id:"gt-morgengebet", kind:"gtask", title:"Morgengebet", goal:"basics", log:{"2026-11-12":true}, updated:2};
  const r = C.resolveRejected(local, srv(server), {hidden:["gtask"], now:50});
  assert.equal(r.copy, null);
  assert.equal(r.push, true);
  assert.deepEqual(r.take.log, {"2026-11-12":true, "2026-11-13":true});
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

test("Gerät mit altem Stand überschreibt beim Abgleich keine Trainingspläne", () => {
  // Server: Pläne am 20.10. angelegt. Altes Gerät kennt sie nicht und ändert nur das Design.
  const srv = {theme:"dark", training:{plans:[{id:"p1"}]}, _t:{training:20}, updated:20};
  const old = {theme:"dark", training:{plans:[]}, updated:5};
  const base = C.settingsBase(old);
  old.theme = "light"; C.stampSettings(old, base, 30); old.updated = 30;
  assert.deepEqual(old._t, {theme:30});
  const out = C.syncSettings(old, srv);
  assert.equal(out.theme, "light");
  assert.deepEqual(out.training.plans.map(p => p.id), ["p1"]);
  assert.deepEqual(out._t, {theme:30, training:20});
  assert.equal(out.updated, 30);
});

test("Eigene neuere Änderung an einem Bereich bleibt beim Abgleich", () => {
  const loc = {training:{plans:[{id:"neu"}]}, _t:{training:40}};
  const srv = {training:{plans:[{id:"alt"}]}, ns:{v:1}, _t:{training:20}};
  const out = C.syncSettings(loc, srv);
  assert.deepEqual(out.training.plans.map(p => p.id), ["neu"]);
  assert.deepEqual(out.ns, {v:1});
});

test("Gelöschter Bereich zählt als Änderung", () => {
  const s = {a:1, b:2}, base = C.settingsBase(s);
  delete s.b; C.stampSettings(s, base, 9);
  assert.deepEqual(s._t, {b:9});
  assert.equal("b" in C.syncSettings(s, {a:1, b:2}), false);
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

/* ---------- Content Studio ---------- */
test("Content Studio: jeder Status geht ohne Haken, nur erfundene nicht", () => {
  assert.equal(C.csCanStatus({}, "geplant"), true);
  assert.equal(C.csCanStatus({status:"check"}, "live"), true);
  assert.equal(C.csCanStatus({}, "gibtsnicht"), false);
  assert.equal(C.csGateOk, undefined); assert.equal(C.csChecksOk, undefined);
});

test("Content Studio: Säulen-Balance zeigt, was zu kurz kommt und was dominiert", () => {
  const ps = [{id:"a"}, {id:"b"}, {id:"c"}, {id:"d"}];
  const pieces = [{pillar:"a"}, {pillar:"a"}, {pillar:"a"}, {pillar:"b"}, {pillar:"c"}, {pillar:""}, {pillar:"a", archived:true}];
  const r = C.csBalance(pieces, ps);
  assert.equal(r.total, 6);
  assert.equal(r.none, 1);
  assert.deepEqual(r.rows.map(x => x.n), [3, 1, 1, 0]);
  assert.equal(r.rows[0].high, true);
  assert.equal(r.rows[3].low, true);
  assert.equal(r.rows[1].low, false);
  assert.deepEqual(C.csBalance([{pillar:"a"}], ps).rows.map(x => x.low || x.high), [false, false, false, false]);
});


test("csKeepIds: gleicher Text behält id, geänderte Zeile erbt id, neue Zeile bekommt neue id", () => {
  let n = 0; const mk = () => "new" + (++n);
  const old = [{id:"a", text:"Eins"}, {id:"b", text:"Zwei"}, {id:"c", text:"Drei"}];
  assert.deepEqual(C.csKeepIds(["Drei", "Eins"], old, mk), [{id:"c", text:"Drei"}, {id:"a", text:"Eins"}]);
  assert.deepEqual(C.csKeepIds(["Eins", "Zwei geändert"], old, mk), [{id:"a", text:"Eins"}, {id:"b", text:"Zwei geändert"}]);
  assert.deepEqual(C.csKeepIds(["Eins", "Zwei", "Drei", "Vier", " ", ""], old, mk).map(x => x.id), ["a", "b", "c", "new1"]);
  assert.deepEqual(C.csKeepIds([], old, mk), []);
});
test("csSrcGuess: Art aus dem Link", () => {
  assert.equal(C.csSrcGuess("https://www.instagram.com/someone/"), "creator");
  assert.equal(C.csSrcGuess("youtu.be/abc"), "video");
  assert.equal(C.csSrcGuess("https://pubmed.ncbi.nlm.nih.gov/123/"), "study");
  assert.equal(C.csSrcGuess("https://open.spotify.com/show/x"), "podcast");
  assert.equal(C.csSrcGuess("https://www.reddit.com/r/nutrition"), "forum");
  assert.equal(C.csSrcGuess("https://wikipeatia.org/wiki/Main_Page"), "web");
  assert.equal(C.csSrcGuess(""), "creator");
});

/* ---------- Geld: Lebensmittel-Kosten und Ausgaben (14.11.2026) ---------- */
test("moneyNum liest deutsche Beträge", () => {
  assert.equal(C.moneyNum("1,29"), 1.29);
  assert.equal(C.moneyNum("1.250"), 1250);
  assert.equal(C.moneyNum("12,50 €"), 12.5);
  assert.equal(C.moneyNum("3.5"), 3.5);
  assert.equal(C.moneyNum(""), null);
  assert.equal(C.moneyNum("abc"), null);
});
test("foodCost rechnet Preis pro Packung auf die Menge um", () => {
  assert.equal(C.foodCost(250, "1,29", 500), 0.645);
  assert.equal(C.foodCost(0, "2", 500), 2);      // schnell eingetragen: Preis für den Eintrag
  assert.equal(C.foodCost(100, "2", ""), 2);     // ohne Packung: Preis für den Eintrag
  assert.equal(C.foodCost(100, "", 500), null);  // ohne Preis: unbekannt
});
test("weekCost nimmt pro Wochentag den zugeordneten Plan", () => {
  const plans = [{id:"a", c:5}, {id:"b", c:8, days:[6, 7]}];
  assert.equal(C.weekCost(plans, "a", p => p.c), 5 * 5 + 8 * 2);
  assert.equal(C.weekCost([{id:"a", c:4}], "a", p => p.c), 28);
  assert.equal(C.weekCost([], "", p => 1), 0);
});
test("spentIn summiert einen Monat und eine Kategorie", () => {
  const L = [{date:"2026-11-02", amount:"10,50", cat:"food"}, {date:"2026-11-20", amount:4, cat:"online"}, {date:"2026-10-31", amount:99, cat:"food"}];
  assert.equal(C.spentIn(L, "2026-11"), 14.5);
  assert.equal(C.spentIn(L, "2026-11", "food"), 10.5);
});

/* ---------- Wochenkalender: Layout, Raster, Wochen, Adapter ---------- */
const lay = list => Object.fromEntries(C.calLayout(list).map(x => [x.id, x]));
test("calLayout: zwei überlappende Termine teilen sich die Breite", () => {
  const r = lay([{id:"a", s:540, e:600}, {id:"b", s:570, e:630}]);
  assert.deepEqual([r.a.col, r.a.cols, r.a.leftPct, r.a.widthPct], [0, 2, 0, 50]);
  assert.deepEqual([r.b.col, r.b.cols, r.b.leftPct, r.b.widthPct], [1, 2, 50, 50]);
  assert.ok(r.b.z > r.a.z);
});
test("calLayout: drei verschachtelte Termine bekommen drei Spalten", () => {
  const r = lay([{id:"lang", s:540, e:720}, {id:"mitte", s:570, e:690}, {id:"kurz", s:600, e:630}]);
  assert.deepEqual(["lang", "mitte", "kurz"].map(k => r[k].col), [0, 1, 2]);
  for (const k of ["lang", "mitte", "kurz"]) { assert.equal(r[k].cols, 3); assert.ok(Math.abs(r[k].widthPct - 100 / 3) < 1e-9); }
  assert.ok(Math.abs(r.kurz.leftPct - 200 / 3) < 1e-9);
});
test("calLayout: Kette A–B–C braucht nur zwei Spalten, C nimmt die Spalte von A", () => {
  const r = lay([{id:"A", s:540, e:600}, {id:"B", s:580, e:660}, {id:"C", s:620, e:700}]);
  assert.deepEqual([r.A.col, r.B.col, r.C.col], [0, 1, 0]);
  assert.ok(["A", "B", "C"].every(k => r[k].cols === 2));
});
test("calLayout: Ende gleich Start ist keine Überschneidung", () => {
  const r = lay([{id:"a", s:540, e:600}, {id:"b", s:600, e:660}]);
  assert.equal(r.a.cols, 1); assert.equal(r.b.cols, 1); assert.equal(r.b.leftPct, 0);
});
test("calLayout: Gruppen sind unabhängig, ein später Termin bleibt volle Breite", () => {
  const r = lay([{id:"a", s:540, e:600}, {id:"b", s:550, e:580}, {id:"c", s:800, e:860}]);
  assert.equal(r.a.cols, 2); assert.equal(r.c.cols, 1); assert.equal(r.c.widthPct, 100);
});
test("calLayout: Zeitpunkt ohne Dauer belegt Platz für die Beschriftung", () => {
  const r = lay([{id:"p", s:600, e:600, pt:true}, {id:"x", s:605, e:660}]);
  assert.equal(r.p.cols, 2); assert.equal(r.x.col, 1);
  assert.deepEqual(C.calLayout([]), []);
});
test("snapMin rundet auf 15 Minuten, pxToMin rechnet Pixel um", () => {
  assert.deepEqual([7, 8, 52, 53, 0, 1439].map(m => C.snapMin(m)), [0, 15, 45, 60, 0, 1440]);
  assert.equal(C.snapMin(22, 30), 30);
  assert.equal(C.pxToMin(0, 5, 48), 300);
  assert.equal(C.pxToMin(48 * 4 + 12, 5, 48), 300 + 240 + 15);
  assert.equal(C.snapMin(C.pxToMin(100, 5, 48)), 420); // 100 px = 125 Min. nach 05:00 = 07:05 -> 07:00
});
test("clampSpan: Mitternacht, Mindestdauer, Tagesgrenzen", () => {
  assert.deepEqual(C.clampSpan(1380, 60), {s:1380, e:1440});   // 23:00 bis 01:00 endet um 24:00
  assert.deepEqual(C.clampSpan(1430, 1475), {s:1425, e:1440}); // 23:50 + 45 passt nicht mehr, rutscht auf 23:45
  assert.deepEqual(C.clampSpan(-30, 30), {s:0, e:30});
  assert.deepEqual(C.clampSpan(600, 605), {s:600, e:615});     // mindestens 15 Minuten
  assert.deepEqual(C.clampSpan(600, null), {s:600, e:615});
  assert.equal(C.m2hm(1440), "24:00"); assert.equal(C.endHM(1440), "23:59"); assert.equal(C.hm2m("07:30"), 450); assert.equal(C.hm2m(""), null);
});
test("weekKeys: Montag bis Sonntag, über Jahreswechsel und Zeitumstellung", () => {
  assert.deepEqual(C.weekKeys("2026-11-15"), ["2026-11-09","2026-11-10","2026-11-11","2026-11-12","2026-11-13","2026-11-14","2026-11-15"]);
  assert.deepEqual(C.weekKeys("2026-12-31"), ["2026-12-28","2026-12-29","2026-12-30","2026-12-31","2027-01-01","2027-01-02","2027-01-03"]);
  assert.deepEqual(C.weekKeys("2026-03-29"), ["2026-03-23","2026-03-24","2026-03-25","2026-03-26","2026-03-27","2026-03-28","2026-03-29"]); // Sommerzeit
  assert.deepEqual(C.weekKeys("2026-10-26"), ["2026-10-26","2026-10-27","2026-10-28","2026-10-29","2026-10-30","2026-10-31","2026-11-01"]);
  assert.deepEqual(C.weekKeys("2026-10-24", 3), ["2026-10-24","2026-10-25","2026-10-26"]); // Winterzeit mittendrin
  assert.equal(C.weekStart("2026-11-09"), "2026-11-09");
});
test("calExpand: feste Aufgaben stehen nur an ihren Wochentagen, auch über den Wochenwechsel", () => {
  const keys = C.weekKeys("2026-11-15", 3).concat(["2026-11-17"]); // So, Mo, Di + Di
  const items = [{id:"g1", kind:"gtask", title:"Sport", days:[1, 3], log:{"2026-11-16":true}}, {id:"g2", kind:"gtask", title:"Wasser", days:[], log:{}}];
  const evs = C.calExpand(items, C.weekKeys("2026-11-15", 3), {today:"2026-11-16"});
  const sport = evs.filter(e => e.src === "g1");
  assert.deepEqual(sport.map(e => e.date), ["2026-11-16"]);
  assert.equal(sport[0].done, true); assert.equal(sport[0].allDay, true); assert.equal(sport[0].id, "habit_g1_2026-11-16");
  assert.equal(sport[0].meta.editable, true);
  assert.equal(evs.filter(e => e.src === "g2").length, 3);
  assert.equal(evs.find(e => e.src === "g2" && e.date === "2026-11-15").meta.editable, false);
  assert.ok(keys.length);
});
test("calExpand: Gewohnheiten mit Uhrzeit stehen im Raster, ohne Dauer als Zeitpunkt", () => {
  const items = [{id:"b", kind:"gtask", title:"Ins Bett", days:[], log:{}, at:"21:00"}, {id:"l", kind:"gtask", title:"Lernen", days:[1], log:{}, at:"07:30", dur:60}, {id:"x", kind:"gtask", title:"Spät", days:[], log:{}, at:"24:00"}];
  const evs = C.calExpand(items, ["2026-11-16"], {today:"2026-11-16"});
  const b = evs.find(e => e.src === "b"), l = evs.find(e => e.src === "l"), x = evs.find(e => e.src === "x");
  assert.deepEqual([b.allDay, b.s, b.e, b.meta.pt], [false, 1260, 1260, true]);
  assert.deepEqual([l.allDay, l.s, l.e, l.meta.pt], [false, 450, 510, false]);
  assert.ok(x.s < 1440 && x.e === x.s);
});
test("calExpand: alte Habits fragen hdone und kennen rückwirkendes Abhaken", () => {
  const h = {id:"h", kind:"habit", title:"Lesen", log:{"2026-11-10":5}, mode:"number", goal:10};
  const evs = C.calExpand([h], ["2026-11-10", "2026-11-20"], {today:"2026-11-15", hdone:(x, k) => (x.log[k] || 0) >= 10, streak:() => 4});
  assert.deepEqual(evs.map(e => [e.date, e.done, e.meta.editable, e.meta.streak]), [["2026-11-10", false, true, 4], ["2026-11-20", false, false, 4]]);
});
test("calExpand: Aufgaben mit Uhrzeit sind Blöcke, nur mit Datum ganztägig, ohne Datum fehlen sie", () => {
  const items = [{id:"t1", kind:"task", title:"Mail", due:"2026-11-16", at:"09:30", dur:30, prio:"hoch"}, {id:"t2", kind:"task", title:"Zahnarzt", due:"2026-11-16"},
    {id:"t3", kind:"task", title:"Irgendwann"}, {id:"t4", kind:"task", title:"Alt", due:"2026-11-16", archived:true}, {id:"t5", kind:"task", title:"Ohne Dauer", due:"2026-11-17", at:"10:00"}];
  const evs = C.calExpand(items, C.weekKeys("2026-11-16"));
  const by = Object.fromEntries(evs.map(e => [e.src, e]));
  assert.deepEqual([by.t1.s, by.t1.e, by.t1.allDay, by.t1.meta.prio], [570, 600, false, "hoch"]);
  assert.equal(by.t2.allDay, true); assert.equal(by.t3, undefined); assert.equal(by.t4, undefined);
  assert.equal(by.t5.e - by.t5.s, 45);
});
test("calExpand: Training geplant und absolviert, Content-Veröffentlichung und Schritte, Termine", () => {
  const items = [
    {id:"wp", kind:"wplan", date:"2026-11-17", at:"17:00", dur:60, plan:"p1", day:"d1"},
    {id:"wo", kind:"workout", title:"Unterkörper", date:"2026-11-16", done:true, ex:[{name:"Kniebeuge"}]},
    {id:"cp", kind:"cpiece", title:"Reel Zucker", status:"produktion", date:"2026-11-20", steps:[{id:"s1", step:"dreh", date:"2026-11-18", at:"14:00", dur:90, done:false}]},
    {id:"ev", kind:"event", title:"Arzt", date:"2026-11-19", from:"23:00", to:"01:00"},
    {id:"ev2", kind:"event", title:"Urlaub", date:"2026-11-14", dateTo:"2026-11-17", from:"10:00"},
    {id:"ev3", kind:"event", title:"Ins Bett", date:"2026-11-19", from:"22:00"}];
  const evs = C.calExpand(items, C.weekKeys("2026-11-16"), {planDay:(p, d) => p === "p1" && d === "d1" ? {name:"Oberkörper", ex:[{name:"Bankdrücken"}]} : null});
  const f = id => evs.filter(e => e.src === id);
  assert.deepEqual([f("wp")[0].title, f("wp")[0].meta.planned, f("wp")[0].meta.ex, f("wp")[0].s, f("wp")[0].e, f("wp")[0].done], ["Oberkörper", true, ["Bankdrücken"], 1020, 1080, false]);
  assert.deepEqual([f("wo")[0].allDay, f("wo")[0].done, f("wo")[0].meta.planned], [true, true, false]);
  assert.deepEqual([f("cp.pub")[0].allDay, f("cp.pub")[0].meta.type, f("cp.pub")[0].date], [true, "publish", "2026-11-20"]);
  assert.deepEqual([f("cp.s1")[0].title, f("cp.s1")[0].s, f("cp.s1")[0].e, f("cp.s1")[0].meta.step], ["Dreh: Reel Zucker", 840, 930, "dreh"]);
  assert.deepEqual([f("ev")[0].s, f("ev")[0].e], [1380, 1440]);
  assert.deepEqual(f("ev2").map(e => [e.date, e.allDay, e.meta.multi]), [["2026-11-16", true, true], ["2026-11-17", true, true]]);
  assert.deepEqual([f("ev3")[0].s, f("ev3")[0].e, f("ev3")[0].meta.pt], [1320, 1320, true]);
  assert.equal(new Set(evs.map(e => e.id)).size, evs.length); // keine doppelten ids
});
test("calBacklog: Aufgaben ohne Datum und offene Content-Schritte", () => {
  const items = [{id:"t1", kind:"task", title:"A"}, {id:"t2", kind:"task", title:"B", done:true}, {id:"t3", kind:"task", title:"C", due:"2026-11-20"},
    {id:"c1", kind:"cpiece", title:"Reel", status:"entwurf", steps:[{id:"s1", step:"skript", done:true}, {id:"s2", step:"dreh", date:"2026-11-18"}]},
    {id:"c2", kind:"cpiece", title:"Fertig", status:"live"}, {id:"c3", kind:"cpiece", title:"Neu"}];
  const b = C.calBacklog(items);
  assert.deepEqual(b.filter(x => x.domain === "task").map(x => x.src), ["t1"]);
  assert.deepEqual(b.filter(x => x.domain === "content").map(x => x.src), ["c1.schnitt", "c3.skript", "c3.dreh", "c3.schnitt"]);
  assert.equal(b.find(x => x.src === "c3.skript").title, "Skript: Neu");
});
test("calPatch: Verschieben, Resize, Einplanen und Entplanen je Bereich", () => {
  const t = {id:"t", kind:"task", due:"2026-11-16", at:"09:00", dur:45};
  assert.deepEqual(C.calPatch({domain:"task", meta:{}}, {date:"2026-11-18", s:615, e:690}, t), {due:"2026-11-18", at:"10:15", dur:75});
  assert.deepEqual(C.calPatch({domain:"task", meta:{}}, {date:"2026-11-18", s:null}, t), {due:"2026-11-18", at:""});
  assert.deepEqual(C.calPatch({domain:"task", meta:{}}, {unplan:true}, t), {due:"", at:""});
  assert.deepEqual(C.calPatch({domain:"task", meta:{}}, {date:"2026-11-18", s:600}, t), {due:"2026-11-18", at:"10:00", dur:45}); // aus dem Backlog: 45 Min.
  assert.deepEqual(C.calPatch({domain:"termin", meta:{type:"event"}}, {date:"2026-11-19", s:1410, e:1500}, {}), {date:"2026-11-19", dateTo:"", from:"23:30", to:"23:59"});
  assert.deepEqual(C.calPatch({domain:"termin", meta:{type:"event", pt:true}}, {date:"2026-11-19", s:600}, {}), {date:"2026-11-19", dateTo:"", from:"10:00", to:""});
  assert.equal(C.calPatch({domain:"termin", meta:{multi:true}}, {date:"2026-11-19", s:600}, {}), null);
  assert.deepEqual(C.calPatch({domain:"workout", meta:{planned:true}}, {date:"2026-11-20", s:1020, e:1110}, {}), {date:"2026-11-20", at:"17:00", dur:90});
  assert.equal(C.calPatch({domain:"habit", meta:{}}, {date:"2026-11-20", s:600}, {}), null);
  const cp = {id:"c", kind:"cpiece", steps:[{id:"s1", step:"dreh", date:"2026-11-18", at:"14:00", dur:90, done:false}]};
  const moved = C.calPatch({domain:"content", meta:{type:"step", stepId:"s1", step:"dreh"}}, {date:"2026-11-19", s:900, e:960}, cp);
  assert.deepEqual(moved.steps, [{id:"s1", step:"dreh", date:"2026-11-19", at:"15:00", dur:60, done:false}]);
  assert.equal(cp.steps[0].date, "2026-11-18"); // Original bleibt unberührt
  const added = C.calPatch({domain:"content", meta:{type:"step", step:"schnitt", stepId:""}}, {date:"2026-11-21", s:600}, cp, () => "neu");
  assert.deepEqual(added.steps[1], {id:"neu", step:"schnitt", date:"2026-11-21", at:"10:00", dur:45, done:false});
  assert.deepEqual(C.calPatch({domain:"content", meta:{type:"step", stepId:"s1", step:"dreh"}}, {unplan:true}, cp).steps[0].date, "");
  assert.deepEqual(C.calPatch({domain:"content", meta:{type:"publish"}}, {date:"2026-11-22", s:null}, cp), {date:"2026-11-22"});
  assert.equal(C.calPatch({domain:"content", meta:{type:"publish"}}, {date:"2026-11-22", s:600}, cp), null);
  assert.throws(() => C.calPatch({domain:"quatsch", meta:{}}, {date:"x", s:1}, {}));
});

test("Kalender nach Review: Zeitpunkt aus calExpand belegt Platz, 23:59 = 24:00, gleiches Von/Bis, Nacht-Termin", () => {
  const evs = C.calExpand([{id:"p", kind:"event", title:"Ins Bett", date:"2026-11-16", from:"10:00"}, {id:"t", kind:"task", title:"A", due:"2026-11-16", at:"10:15", dur:30}], ["2026-11-16"]);
  const r = Object.fromEntries(C.calLayout(evs, 28).map(x => [x.src, x]));
  assert.equal(r.p.cols, 2); assert.notEqual(r.p.col, r.t.col);
  const r2 = Object.fromEntries(C.calLayout([{id:"a", s:600, e:615}, {id:"b", s:615, e:630}], 28).map(x => [x.id, x]));
  assert.equal(r2.a.cols, 2); // gezeichnet 20 px hoch, würden sich sonst überdecken
  assert.equal(C.endMin("23:59"), 1440); assert.equal(C.endMin("10:00"), 600);
  assert.deepEqual(C.clampSpan(600, 600), {s:600, e:615});
  const late = C.calExpand([{id:"e", kind:"event", date:"2026-11-16", from:"23:00", to:"23:59"}, {id:"n", kind:"event", date:"2026-11-16", from:"23:00", to:"01:00"}], ["2026-11-16"]);
  assert.equal(late.find(x => x.src === "e").e, 1440);
  const night = late.find(x => x.src === "n"); assert.equal(night.meta.overnight, true);
  assert.equal(C.calPatch(night, {date:"2026-11-17", s:600}, {}), null);
});
test("calPatch Content: ohne stepId nur offener Schritt ohne Datum, geplante bleiben, fehlender Schritt ohne Art = null", () => {
  const cp = {steps:[{id:"d1", step:"dreh", date:"2026-11-18", at:"14:00", dur:90, done:false}, {id:"d0", step:"dreh", date:"", done:true}]};
  const p = C.calPatch({domain:"content", meta:{type:"step", step:"dreh", stepId:""}}, {date:"2026-11-20", s:600}, cp, () => "neu");
  assert.equal(p.steps.length, 3); assert.equal(p.steps[0].date, "2026-11-18"); assert.equal(p.steps[2].id, "neu");
  assert.equal(C.calPatch({domain:"content", meta:{type:"step", stepId:"weg"}}, {date:"2026-11-20", s:600}, cp), null);
});

/* ---------- Journal-Tage: zusammenführen statt überschreiben ---------- */
test("Journal: Einträge beider Seiten bleiben, gelöschte kommen nicht zurück", () => {
  const a = {id:"jd-2026-11-16", kind:"jday", date:"2026-11-16", bits:[{id:"b1", t:1, text:"Handy"}, {id:"b3", t:3, text:"weg"}], shots:[{path:"u/1.jpg"}], gone:["b2"], updated:5};
  const b = {id:"jd-2026-11-16", kind:"jday", date:"2026-11-16", bits:[{id:"b2", t:2, text:"gelöscht"}, {id:"b4", t:4, text:"MCP"}, {id:"b3", t:3, text:"weg"}], shots:[{path:"u/1.jpg"}, {path:"u/2.jpg"}], sum:"Zusammenfassung", gone:["u/9.jpg"], updated:9};
  const m = C.mergeJday(a, b);
  assert.deepEqual(m.bits.map(x => x.id), ["b1", "b3", "b4"], "b2 ist gelöscht, Rest sortiert nach Zeit");
  assert.deepEqual(m.shots.map(x => x.path), ["u/1.jpg", "u/2.jpg"]);
  assert.equal(m.sum, "Zusammenfassung"); assert.equal(m.updated, 9, "andere Felder von b");
  assert.deepEqual(m.gone.sort(), ["b2", "u/9.jpg"]);
  assert.deepEqual(C.mergeJday({kind:"jday", bits:[{id:"x", t:1}]}, {kind:"jday"}).bits.map(x => x.id), ["x"], "fehlende Listen gehen");
});
test("Journal: abgelehnter Tag wird zusammengeführt und neu hochgeladen", () => {
  const local = {id:"j1", kind:"jday", date:"2026-11-16", bits:[{id:"b1", t:1, text:"Handy"}], updated:5};
  const r = C.resolveRejected(local, {id:"j1", data:{kind:"jday", date:"2026-11-16", bits:[{id:"b2", t:2, text:"Claude"}], sum:"S", updated:7}, updated_at:7, deleted:false}, {hidden:["jday"], now:50});
  assert.equal(r.push, true); assert.equal(r.copy, null); assert.equal(r.take.updated, 50); assert.equal(r.take.sum, "S");
  assert.deepEqual(r.take.bits.map(x => x.id), ["b1", "b2"]);
  assert.equal(C.resolveRejected(local, {id:"j1", data:{}, updated_at:7, deleted:true}).take, null, "auf dem Server gelöscht bleibt gelöscht");
});
test("Journal: welcher Tag gilt bei mehreren für ein Datum", () => {
  const old1 = {id:"zz", kind:"jday", date:"2026-11-15", created:20}, old2 = {id:"aa", kind:"jday", date:"2026-11-15", created:10};
  assert.equal(C.jdayPick([old1, old2], "2026-11-15").id, "aa", "ohne feste id gilt der älteste");
  assert.equal(C.jdayPick([old1, old2, {id:"jd-2026-11-15", kind:"jday", date:"2026-11-15", created:99}], "2026-11-15").id, "jd-2026-11-15");
  assert.equal(C.jdayPick([old1], "2026-11-16"), null);
  assert.equal(C.jdayId("2026-11-16"), "jd-2026-11-16");
});
test("Journal: Zusammenfassung kommt von der Seite mit der neueren Auswertung, egal in welcher Reihenfolge", () => {
  const altHandy = {kind:"jday", bits:[{id:"h", t:5}], sum:"ALT", ins:["alt"], done:100, updated:500};
  const neuServer = {kind:"jday", bits:[{id:"s", t:6}], sum:"NEU", ins:["neu"], done:900, updated:400};
  for (const m of [C.mergeJday(neuServer, altHandy), C.mergeJday(altHandy, neuServer)]) {
    assert.equal(m.sum, "NEU"); assert.deepEqual(m.ins, ["neu"]); assert.equal(m.done, 900);
    assert.deepEqual(m.bits.map(x => x.id), ["h", "s"]);
  }
  const ohne = C.mergeJday({kind:"jday", sum:"A", done:5}, {kind:"jday", bits:[]});
  assert.equal(ohne.sum, "A", "ohne Auswertung auf b bleibt die von a"); assert.equal(ohne.done, 5);
  const keins = C.mergeJday({kind:"jday"}, {kind:"jday"});
  assert.ok(!("sum" in keins) && !("done" in keins));
});

/* ---------- Einkaufsliste ---------- */
test("Einkaufsliste: Summe, offen, fehlende Preise und Läden", () => {
  const s = C.shopSum([
    {qty:2, price:"1,29", store:"Lidl"}, {qty:1, price:"3", store:"Lidl", done:true},
    {qty:3, price:"0,50", store:""}, {qty:1, price:"", store:"Carrefour"}, {qty:0, price:"2", store:" Carrefour "}]);
  assert.equal(Math.round(s.total * 100), 258 + 300 + 150 + 200);
  assert.equal(Math.round(s.open * 100), 258 + 150 + 200, "abgehakt zählt nicht zu offen");
  assert.equal(s.miss, 1);
  assert.deepEqual(s.stores.map(g => g.store), ["Carrefour", "Lidl", ""], "Läden alphabetisch, ohne Laden am Ende");
  assert.equal(s.stores[0].miss, 1); assert.equal(Math.round(s.stores[1].total * 100), 558);
  assert.deepEqual(C.shopSum([]), {total:0, open:0, miss:0, stores:[]});
});
