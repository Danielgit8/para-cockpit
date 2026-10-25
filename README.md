# PARA Cockpit

Persönliches Dashboard nach der PARA-Methode (Projekte, Bereiche, Ressourcen, Archiv) mit Aufgaben, Gewohnheiten, Kalender, Training, Brand & Business und Whiteboards. Die App läuft offline im Browser und gleicht sich über Supabase zwischen Laptop und Handy ab.

Live: https://danielgit8.github.io/para-cockpit/

## Aufbau

| Datei | Inhalt |
|---|---|
| `index.html` | Oberfläche und App-Logik |
| `core.js` | Logik ohne Oberfläche: Abgleich (Cursor, Konflikte), Sicherung (Prüfung, Importplan, ZIP), Suche, wiederkehrende Aufgaben. Wird in `tests/` geprüft |
| `sw.js` | Service Worker für den Offline-Betrieb |
| `supabase.js` | Supabase-Bibliothek, lokal mitgeliefert (supabase-js **2.117.2**) |
| `vendor/excalidraw/` | Whiteboard, gebaut aus `../board-build` (Excalidraw **0.18.1**, React 18.3.1, esbuild 0.25) |
| `vendor/barcode/` | Barcode-Leser für Browser ohne eingebaute Erkennung (barcode-detector **3.2.3**, zxing-wasm **3.1.6**) |
| `data/` | Offline-Lebensmitteldatenbank: Schweizer Nährwertdatenbank und Produkte von Open Food Facts |
| `supabase-setup.sql` | Tabelle, Trigger, Zugriffsregeln und Dateispeicher |
| `tests/core.test.js` | Tests, laufen bei jedem Push über GitHub Actions |

Es gibt keinen Build-Schritt für die App. Alles wird so ausgeliefert, wie es im Repo liegt.

## Einrichten

1. Auf supabase.com ein Projekt anlegen (Region Frankfurt).
2. Im SQL Editor den ganzen Inhalt von `supabase-setup.sql` ausführen. Die Datei lässt sich jederzeit erneut ausführen, zum Beispiel nach einem Update. Vorhandene Daten bleiben erhalten.
3. Authentication → Sign In / Providers → Email: „Confirm email“ ausschalten.
4. Authentication → URL Configuration: Site URL auf die App-Adresse setzen.
5. Project URL und Publishable Key (`sb_publishable_…`) in `index.html` bei `const CONFIG` eintragen. Der Key ist öffentlich gedacht, die Daten schützt die Zugriffsregel (Row Level Security). Niemals einen Secret- oder service_role-Key eintragen.
6. Nach der eigenen Registrierung „Allow new users to sign up“ ausschalten.

## Veröffentlichen

GitHub Pages aus dem Zweig `main`, Ordner `/`. Bei jeder Änderung:

- `APP_VERSION` in `index.html` hochzählen. Die App vergleicht den Wert beim Öffnen mit dem Server und lädt sich neu.
- `CACHE` in `sw.js` hochzählen, damit der Offline-Speicher erneuert wird.

## Tests

```bash
npm test
```

Braucht nur Node 18 oder neuer, keine Pakete. Geprüft werden unter anderem:

- Abgleich: 1.001 Einträge mit gleichem Zeitstempel gehen nicht verloren, Folgeabrufe setzen genau an der letzten Zeile an.
- Konflikte: neuere Fassung gewinnt, die ältere bleibt als Konfliktkopie erhalten, Häkchen von Gewohnheiten werden zusammengeführt.
- Sicherung: Prüfung der Einträge, Importplan (neu, überschreiben, behalten, ersetzen), ZIP schreiben und lesen.
- Wiederkehrende Aufgaben an Monats- und Jahresgrenzen, Schaltjahr.
- Suche: Rangfolge, mehrere Wörter, alle Bereiche.

Browsertests für Anmelden, Bearbeiten und Offline fehlen noch. Sie bräuchten ein eigenes Supabase-Testkonto.

## Wie der Abgleich funktioniert

- Jede Änderung landet zuerst in IndexedDB auf dem Gerät und wird dann hochgeladen.
- Der Datenbank-Trigger `items_touch` lehnt eine Fassung ab, deren `updated_at` älter ist als die gespeicherte. So überschreibt eine alte Offline-Bearbeitung keine neuere Fassung und holt keinen gelöschten Eintrag zurück.
- Abgelehnte Fassungen holt die App vom Server und legt die eigene als „(Konfliktkopie)“ daneben. Bei Gewohnheiten werden die Häkchen beider Geräte zusammengeführt. Interne Einträge (Training, Tagespläne, Videos, Kontakte) übernehmen die Serverfassung.
- Gelöschte Einträge bleiben als Löschmarke (`deleted = true`) in der Tabelle, damit alle Geräte die Löschung mitbekommen.
- Heruntergeladen wird seitenweise, sortiert nach `synced_at` und `id`. Der Cursor merkt sich beides, damit bei gleichen Zeitstempeln nichts übersprungen wird.

Grenzen: `updated_at` kommt von der Uhr des Geräts. Geht eine Uhr stark falsch, kann ihre Fassung verlieren oder gewinnen, obwohl sie jünger oder älter ist. Bei normal gestellten Uhren spielt das keine Rolle.

## Sicherung

- **Sicherung herunterladen:** JSON mit allen Einträgen und Einstellungen. Hochgeladene Dateien stehen darin nur als Verweis.
- **Sicherung mit Dateien:** ZIP mit `backup.json` und allen Dateien unter `dateien/`. Damit lässt sich alles wiederherstellen, auch wenn der Supabase-Speicher verloren ist. Kostenlose Supabase-Projekte werden nach längerer Pause angehalten, deshalb lohnt sich ab und zu eine solche Sicherung.
- **Sicherung einspielen:** nimmt JSON oder ZIP. Die App prüft jeden Eintrag, zeigt eine Vorschau (neu, überschrieben, behalten, ungültig) und bietet zwei Wege:
  - *Zusammenführen:* fügt hinzu und überschreibt. Mit „Neuere Fassungen auf dem Gerät behalten“ bleiben Einträge, die auf dem Gerät jünger sind.
  - *Ersetzen* (nur bei vollständigen Sicherungen mit Einstellungen): stellt genau den Stand der Sicherung her und löscht alles andere, auf allen Geräten. Braucht einen zweiten Klick.
- Teil-Dateien mit einzelnen Einträgen (`{"app":"para-cockpit","version":2,"items":[…]}`, ohne `settings`) gehen genauso. Ein `updated` mit aktuellem Zeitstempel sorgt dafür, dass sie bestehende Einträge überschreiben.

## Offline-Grenzen

- Ansehen, Anlegen und Bearbeiten gehen ohne Internet. Der Abgleich läuft, sobald wieder Netz da ist.
- Dateien hochladen, öffnen und herunterladen braucht Internet, ebenso die Sicherung mit Dateien.
- Erinnerungen kommen nur, solange die App offen oder im Hintergrund aktiv ist. Für zuverlässige Erinnerungen gibt es die Kalender-Datei (`.ics`).

## Bibliotheken aktualisieren

Supabase:

```bash
npm view @supabase/supabase-js version
curl -s -o supabase.js https://cdn.jsdelivr.net/npm/@supabase/supabase-js@<version>/dist/umd/supabase.js
```

Danach die Version oben in der Tabelle eintragen und `CACHE` in `sw.js` hochzählen.

Whiteboard (im Ordner `board-build` neben dem Repo):

```bash
npm install @excalidraw/excalidraw@<version>
npm run build -- ../para-cockpit-app/vendor/excalidraw
```

Lebensmitteldatenbank (Ordner `food-db` neben dem Repo):

```bash
python build_food_db.py <Schweizer_Nahrwertdatenbank.xlsx> <off_de.json> ../para-cockpit-app/data
```

Quellen der Nährwerte in `data/`:
- Schweizer Nährwertdatenbank V 7.1, Bundesamt für Lebensmittelsicherheit und Veterinärwesen (BLV), [naehrwertdaten.ch](https://naehrwertdaten.ch). Nutzung mit Quellenvermerk erlaubt.
- [Open Food Facts](https://openfoodfacts.org), Daten unter der Open Database License (ODbL), Produktbilder unter CC BY-SA.

Barcode-Leser: [barcode-detector](https://github.com/Sec-ant/barcode-detector) 3.2.3 und [zxing-wasm](https://github.com/Sec-ant/zxing-wasm) 3.1.6 (MIT) in `vendor/barcode`, nur genutzt, wenn der Browser keine eingebaute BarcodeDetector-API hat.
