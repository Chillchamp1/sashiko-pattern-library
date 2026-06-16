# Sashiko Pattern Library — Projektkontext

## Deliverable

**Datei:** `Sashiko — Pattern Library.htm` — self-contained, kein Build-Schritt, kein Server. Einfach im Browser öffnen.

Interaktive Sashiko-Muster-Bibliothek mit animierter Stich-Vorschau. Alle Logik, CSS und Canvas-Rendering in einer einzigen HTML-Datei.

**Workflow-Hinweise (wichtig):**
- Diese Datei (CLAUDE.md) ist die Projektdoku — bei jeder Session lesen und bei Änderungen aktuell halten.
- Farbtöne IMMER aus dem Abschnitt **Farben** unten nehmen (`PHASE_COLORS` + Stoff `#1a3a5c`).
- Neue Muster aus den Büchern (`../Bücher`, PDFs): Geometrie NICHT aus dem Bild raten, sondern mit `tools/pattern_extractor.py` programmatisch extrahieren (siehe Abschnitt **Pattern-Extraktor**).
- **Stickreihenfolge/Routing** IMMER nach den Regeln in `ROUTING.md` (lange Linien, kurze Sprünge). Gilt für alle Muster.

---

## Architektur

Drei getrennte Rendering-Engines:

### 1. Star-Arm Engine (Moyozashi-Stil)
Für Jūji-zashi, Naname Jūji-zashi, Komesashi.

Kurze Arm-Segmente von jedem Gitterpunkt aus in den Richtungen `V`, `H`, `D1`, `D2`. Jede Richtung = ein Pass. Das System optimiert die Reihenfolge der Pässe und ihre Richtung durch Brute-Force über alle Permutationen (4! = 24), um den Inter-Pass-Sprung zu minimieren.

```
const sx = i => PAD + i*G       // x-Koordinate Gitterpunkt i
const sy = j => PAD + (N-1-j)*G // y-Koordinate, j=0 unten
N = 7, G = 50px, PAD = 36px, SIZE = 372px
```

### 2. Hitomezashi Running-Stitch Engine
Für Hitomezashi-Generator, Kōshi, Kaki no Hana, Yamagata-Preset, Fibonacci-Snowflake.

Kanten-Segmente entlang Gitterlinien. Dynamisches Grid (HM_N × HM_N Punkte), `HM_CELL = 300 / (HM_N - 1)` — passt immer in den Canvas.

```
const shx = i => PAD + i*HM_CELL
const shy = j => PAD + j*HM_CELL   // j=0 oben (nicht gespiegelt!)
```

**Mathematisches Modell (explizite Pro-Linie-Bits):**
- Horizontale Kante `(i,j)-(i+1,j)` wird gestickt ⟺ `(i + rowBits[j]) % 2 === 0`
- Vertikale Kante `(i,j)-(i,j+1)` wird gestickt ⟺ `(j + colBits[i]) % 2 === 0`
- `rowBits[j]` = Start-Phase der **Reihe** j (horizontale Stiche, grün), `colBits[i]` = Start-Phase der **Spalte** i (vertikale Stiche, blau). **Reihen und Spalten sind unabhängig** — das ist das echte Hitomezashi-Modell. Der frühere Einzel-`seq`+`off`-Ansatz war der symmetrische Spezialfall `rowBits === colBits`.

**Engine-Einstieg:** `buildHMcore(rowBits, colBits)` (N = `rowBits.length`). 8-Kombinations-Sprung-Optimierung wie zuvor.

**Preset → Bits:** `seqToBits(seq, N)` kachelt eine Periodensequenz auf N explizite Bits und zentriert sie über `findSymOffset(seq, N)` (Palindrom-Offset, sonst 0) — so sieht ein Preset aus wie früher. Danach sind die Bits explizit und einzeln umschaltbar. **Kein N-Snapping mehr** (`nearestSymN` entfernt): jede Gittergröße ist erlaubt; Presets werden bei Größenänderung neu gekachelt. `buildHitomezashi(pat)` ist nur noch ein Wrapper: `buildHMcore(seqToBits(pat.seq,N), …)` für seq-basierte Muster.

### 3. Polyline Engine (Tsuzuki Yamagata)
Für `tsuzuki-yamagata` (`type:'polyline'`). Geometrie programmatisch aus dem Buch-Diagramm extrahiert (siehe **Pattern-Extraktor**), nicht geraten.

Das Muster ist die Vereinigung gerader Running-Stitch-Linien in vier Steigungen: **flach ±1/2** (breite Rauten 2×1, fließen horizontal) und **steil ±2** (hohe Rauten 1×2, fließen vertikal). Die Linien kreuzen sich → Bergketten-Mesh. Kodiert auf einem **Halbraster** als 16-Kanten-Einheitszelle `TY_CELL` + Generatoren `TY_G1=[4,4]`, `TY_G2=[8,0]`. Verifiziert: reproduziert den extrahierten Kanten-Datensatz zu 100 % (0 false positives).

```
PL_NHU = 20           // Halbeinheiten über den Canvas (= 10 "grid squares")
PL_HU  = (SIZE-2*PAD)/PL_NHU
plPx(c) = PAD + c*PL_HU
```

- `genTYedges(NHU)` — Einheitszelle über Gitter kacheln, Kanten im Halbraster.
- `traceZig(edges, axis)` — durchgehende Zickzack-Linien tracen: an jeder Kreuzung geradeaus in +axis weiter, Senkrechtschritt alternieren → eine Zickzack-Linie, die über den Stoff marschiert (wie der rote Buch-Pfad). 100 % Kantenabdeckung verifiziert.
- `buildTsuzukiYamagata(NHU)` — steile Kanten → horizontal marschierende Zickzacks (Pass 1), flache → dasselbe um 90° gedreht (Pass 2).
- **Pass 1 = horizontal** (grüne `H`-Töne), **Pass 2 = vertikal** (blaue `V`-Töne). Zwei Töne je Familie = die zwei Translations-Klassen (siehe **Farb-Zuordnung**). Grenze bei `PL_shCount`. Ausschnitt: `PL_NHU=28`.

---

## Galerie-Patterns

```javascript
const PATTERNS = [
  { id:'generator',         type:'generator', ...  },  // Hitomezashi-Generator, immer zuerst
  { id:'juji',              passes:['V','H'],  ... },
  { id:'naname',            passes:['D1','D2'], ... },
  { id:'komesashi',         passes:['V','H','D1','D2'], ... },
  { id:'tsuzuki-yamagata',  type:'polyline',  ... },   // Polyline Engine, s.o.
];
```

Kōshi und Kaki no Hana sind **nicht** als separate Gallery-Einträge vorhanden — sie sind Generator-Presets.

Entfernt (nicht verifizierbar als traditionelle Muster): `yarai`, `yokoyarai`, `mittsu`.

---

## Hitomezashi Generator

Zustand:
```javascript
let GEN_rowBits=[], GEN_colBits=[];  // explizite Pro-Linie-Phasen (Länge = GEN_n)
let GEN_n=12;                         // Gittergröße (= Anzahl Reihen/Spalten)
let GEN_preset='kaki';                // 'koshi'|'kaki'|'snowflake'|null (null = Custom)
let GEN_snowOrder=2;                  // 1|2|3
```

### Grafischer Linien-Editor (das Kern-Feature)
Toggle-Buttons **rund um die Live-Vorschau**, exakt auf die Gitterpunkte ausgerichtet:
- **Links** (`#hmRowToggles`): `ceil(N/2)` Buttons (obere Hälfte) → kippt `GEN_rowBits[j]` und spiegelt auf `GEN_rowBits[N-1-j]` → **grüne** horizontale Stiche.
- **Oben** (`#hmColToggles`): `ceil(N/2)` Buttons (linke Hälfte) → kippt `GEN_colBits[i]` und spiegelt auf `GEN_colBits[N-1-i]` → **blaue** vertikale Stiche.
- **Symmetrie:** Muster ist immer bilateral symmetrisch (oben↔unten, links↔rechts). Nur die erste Hälfte der Toggles ist sichtbar; die andere Hälfte wird automatisch gespiegelt. `resizeBitsSymmetric(a, N)` beim Resize.
- DOM-Overlay in `.hm-frame` (CSS-Grid `[gutter auto / gutter auto]`, Gutter = `HM_GUT=30px` via `.hm-on`-Klasse). Position je Button: `left=shx(i)-bs/2` / `top=shy(j)-bs/2`; Größe `bs=clamp(11, HM_CELL-3, 22)`, Ziffer 0/1 nur wenn `bs≥14`. `buildLineToggles()` baut sie neu.
- Jeder Toggle setzt `GEN_preset=null` (→ Custom) und ruft `refreshGen(true)`.
- **`refreshGen(showFull)`** = einziger Einstieg nach jeder Änderung: `applyGeneratorInternal()` (baut Engine, setzt `HM_CELL`/`TOTAL`) → `updateGenUI` → `buildLineToggles` → `syncGrid` → `setGenTitle` → `buildJumpBar` → bei `showFull` `step=TOTAL` und `render`. **Editieren zeigt sofort das volle Muster** (Vorhersage), nicht die Animation; Play/Reset starten die Animation neu.
- **`#genSlider`** sitzt direkt unter dem Canvas (zwischen `#hmFrame` und `#info`), immer sichtbar wenn Generator aktiv. Universeller Slider: bei normalen Presets Label „Grid", Range 6–20; bei Snowflake Label „Size", Range 8–32.
- `setGridN(N)`: Preset aktiv → neu kacheln (`seqToBits`); Custom → Bits erhalten/symmetrisch auffüllen (`resizeBitsSymmetric`).

### Generator-Presets
Ein Preset **füllt nur** `GEN_rowBits`/`GEN_colBits` (`loadPreset(key)` → `seqToBits`); danach frei umschaltbar.
```javascript
const GEN_PRESETS = {
  koshi:    { seq:[0],          n:12, label:'Kōshi'        },
  kaki:     { seq:[0,0,1,0,1], n:12, label:'Kaki no Hana' },
  snowflake:{ label:'Snowflake' },   // seq/n via snowSeq(2) + GEN_snowGrid
};
```
(Yamagata ist KEIN Generator-Preset mehr.)

### Fibonacci Snowflake (immer Order 2)
Nur Order 2 ist implementiert (8-Element-Fibonacci-Wort gespiegelt → 16-Element-Palindrom):
```javascript
function snowSeq(ord){ const h=snowHalf(ord); return [...h, ...[...h].reverse()]; }
// Nur snowSeq(2) wird genutzt — kein Order-Menü mehr.
```
- **`GEN_snowGrid`** (default 16): Grid-Größe des Snowflake; der universelle Slider (`#genSlider`, Range 8–32) steuert ihn. `loadPreset('snowflake')` kachelt `snowSeq(2)` via `seqToBits(snowSeq(2), GEN_snowGrid)` auf beliebige Größe.
- Linien-Toggles ausgeblendet (Snowflake hat keine frei editierbaren Bits — Preset-Struktur soll erhalten bleiben).
- `#genSnowInfo` zeigt `N×N grid · TOTAL stitches`; kein Order-Untermenü.

---

## Farben

```javascript
const PHASE_COLORS = {
  V:  ['#cde0f4', '#9cbcd8'],  // Vertical: hell/dunkel
  H:  ['#c4ebd6', '#88c4a4'],  // Horizontal
  D1: ['#f5e0c8', '#e0b890'],  // Diagonal ⟋ (orange/amber)
  D2: ['#ddd0f2', '#b0a0e0'],  // Diagonal ⟍ (violett)
};
```
- Zwei Farbtöne pro Richtung: `lp=0` (gerade Zeilen, heller), `lp=1` (versetzte Zeilen, dunkler)
- Stoff: `#1a3a5c` (dunkles Marineblau)
- **Tsuzuki Yamagata** nutzt dieselbe Palette: flache (horizontale) Linien → `PHASE_COLORS.H`, steile (vertikale) → `PHASE_COLORS.V`.
- **Diese Palette ist verbindlich** — für neue Muster keine neuen Farben erfinden, sondern hier wählen (ggf. erweitern und dokumentieren).

### Farb-Zuordnung = Translations-Äquivalenzklasse (verbindlich, auch für künftige Muster)
Die Farbe eines Pfades kodiert seine **Translations-Klasse**: zwei Pfade bekommen genau dann denselben Farbton, wenn der eine durch eine **Muster-Symmetrie-Verschiebung** auf (einen Teil) des anderen abgebildet wird. Ein nur nach links/rechts oder oben/unten verschobener Pfad = identisch. Ein am Rand **abgeschnittenes** Stück = identisch zum vollen Pfad, wenn sein ungeschnittener Teil verschoben woanders auftaucht. Ein Spiegelbild (Halbperioden-Versatz, KEIN Gittervektor) = eigene Klasse.

Umsetzung (Tsuzuki Yamagata, Symmetriegitter aus `(4,4)`+`(8,0)` Halbeinheiten → 2 Klassen je Familie):
- `classifyTranslation(chains)` — gruppiert Pfade; `latContains(big,small)` testet `∃ Gittervektor t: (small+t) ⊆ big` über `TY_LAT` (Brute-Force aller Gittervektoren). Subset deckt die Rand-Stücke ab.
- **Geometrisches Invariant statt Heuristik (gilt für beide Familien):** `classifyTranslation` versagt bei kurzen Rand-Stücken (n=4), weil kleines |t|² zufällig die falsche Klasse trifft.
  - Steile Ketten H (f=1): `startY % 8 === 4 → Klasse 0` (hell), `=== 0 → Klasse 1` (dunkel).
  - Flache Ketten V (f=2): `startX % 8 === 4 → Klasse 0` (hell), `=== 0 → Klasse 1` (dunkel).
- **V-Familie: sort-before-NN gegen große Sprünge:** `tracePaired` liefert V-Ketten in der Reihenfolge x=4…24 (voll), dann x=0,x=28 (Rand). NN lässt die x=0-Rand-Ketten als letztes übrig → Sprung von x=28 nach x=0. Fix: `items.sort((a,b)=>a.poly[0][0]-b.poly[0][0])` vor `orderNN` → x=0-Rand zuerst, dann x=4…24 voll, dann x=28-Rand. **Für neue Muster mit Rand-Ketten auf gegenüberliegenden Seiten dasselbe Muster anwenden.**
- NICHT per Band-Parität / mittlerer Koordinate (war falsch — gab Nicht-Translaten dieselbe Farbe).

---

## Animations-Engine

```javascript
const TICK_MS = 40;  // feste Geschwindigkeit, ~25 Stiche/Sek, kein Slider

let step = 0;        // 0 = Anfang, TOTAL = fertig
let playing = false;
let raf = null;
```

**Idle-Info-Bar Bug-Fix:** `el.classList.contains('idle')` wird in `onInfoClick()` geprüft — onclick-Attribut bleibt immer gesetzt, `setIdleInfo()` stellt die `idle`-Klasse wieder her. Dieses Pattern verhindert, dass onclick nach Reset nicht mehr funktioniert.

**Tastatur:** Space = Play/Pause, ArrowLeft/Right = ein Stich vor/zurück.

---

## Jump-Bar

Springt direkt zu Pass-Grenzen. Beim HM-Muster: Pass 1 (horizontal) vs. Pass 2 (vertikal). Bei Tsuzuki Yamagata: Pass 1 (horizontal/flach) vs. Pass 2 (vertikal/steil), Grenze bei `PL_shCount`.

---

## Filter-System

```
data-f="0"  → Alle
data-f="2"  → 2 Pässe
data-f="4"  → 4 Pässe
data-f="hm" → Hitomezashi (nur Generator-Card)
```

Suche matcht auf: name, jp, en, id, plus Generator-Keywords (`koshi kaki persimmon lattice snowflake hitomezashi yamagata mountain 山形 格子 柿の花 雪`).

---

## Thumbnails

```javascript
function renderThumb(canvas, pat) {
  if (pat.type === 'generator') → renderHMThumb(canvas, [0,0,1,0,1], 11);
  if (pat.type === 'hitomezashi') → renderHMThumb(canvas, pat.seq, pat.thumbN||11);
  if (pat.type === 'polyline')  → renderPLThumb(canvas);   // Tsuzuki Yamagata Mesh
  default: → Star-Arm-Thumbnails (5×5 Grid)
}
```

---

## Schlüsselfunktionen

| Funktion | Zweck |
|---|---|
| `findSymOffset(seq, N)` | Palindrom-Offset (sonst 0) — für `seqToBits` |
| `seqToBits(seq, N)` | Periodensequenz → N explizite, zentrierte Bits |
| `buildHMcore(rowBits, colBits)` | Hitomezashi-Engine: HM_path + HM_fronts, 8-Kombinations-Sprung-Opt. |
| `buildHitomezashi(pat)` | Wrapper: `buildHMcore(seqToBits(pat.seq,N),…)` |
| `buildLineToggles()` | Baut die Reihen-/Spalten-Toggles ums Canvas |
| `loadPreset(key)` | Füllt GEN_rowBits/colBits aus Preset bzw. snowSeq |
| `setGridN(N)` | Gittergröße ändern (Preset neu kacheln / Custom auffüllen) |
| `refreshGen(showFull)` | Einziger Einstieg nach jeder Generator-Änderung |
| `applyGenerator()` | Legacy-Alias → `refreshGen(true)` |
| `snowSeq(ord)` / `snowHalf(ord)` | Fibonacci-Snowflake-Sequenz (Order 1/2/3) |
| `genTYedges(NHU)` | Tsuzuki Yamagata: Einheitszelle kacheln → Kanten im Halbraster |
| `buildTsuzukiYamagata(NHU)` | Kanten → gerade Linien → 2 Pässe (PL_path, PL_fronts, PL_shCount) |
| `buildPasses(pl, n)` | Star-Arm Pässe mit Permutations-Optimierung |
| `loadPattern(pat)` | Dispatcher für alle Pattern-Typen |

---

## Bekannte Entscheidungen / Einschränkungen

- **Linewidth skaliert mit HM_CELL:** `lw = max(1, min(3, HM_CELL * 0.15))` — sieht gut aus von Order 1 (100px Zellen) bis Order 3 (4.5px Zellen)
- **Generator zeigt immer `step=TOTAL`:** Editieren/Preset/Order rendert sofort das volle Muster (Vorhersage). Snowflake Order 3 (68×68, ~4572 Stiche) baut in ~14 ms — kein Lang-Animations-Problem mehr. Play startet die Animation neu.
- **Reihen/Spalten unabhängig:** Toggles können das Muster asymmetrisch machen (genau das gewünschte freie Explorieren). Presets stellen die Symmetrie wieder her (`rowBits === colBits`).
- **Yamagata-Preset entfernt:** war nur eine Hitomezashi-Annäherung; der echte Tsuzuki Yamagata lebt in der Polyline-Engine/Gallery.
- **Tsuzuki Yamagata in Gallery:** Polyline-Engine, Geometrie aus Buch S.44 extrahiert (Essential Sashiko: "mountain ranges overlap and flow"). Verifiziert 100 % gegen Original.
- **Kein Speed-Slider:** entfernt, feste `TICK_MS=40`
- **Kein `el.onclick=null`** in update-Funktionen, weil das den Reset-Play-Button bricht

---

## Pattern-Extraktor (`tools/pattern_extractor.py`)

Wiederverwendbares Werkzeug, um Muster-Geometrie programmatisch aus Buch-Diagrammen zu gewinnen — NICHT per Auge raten (das ging mehrfach schief). Deps: `pymupdf`, `opencv-python`, `numpy` (installiert).

Bewährter Ablauf für ein neues Muster:
1. PDF-Seite rendern (Poppler ist NICHT installiert, daher PyMuPDF): `fitz.open(pdf)[seite].get_pixmap(matrix=fitz.Matrix(300/72,300/72))`.
2. Diagramm zuschneiden.
3. `color_masks()` trennt **Cyan** (Gitter) / **Schwarz** (Muster) / **Rot** (Stick-Reihenfolge-Pfeile).
4. `grid_geometry()` misst Gitter-Ursprung + Abstand.
5. `extract_segments()` tastet jede Kandidaten-Kante im Halbraster ab → echte Liniensegmente.
6. Per `overlay()` / Side-by-Side verifizieren, Einheitszelle ableiten, nach JS portieren.
7. JS-Logik in Python gegenrendern, BEVOR man es dem User zeigt.

Die roten Pfeile/Zahlen im Buch = empfohlene Stich-Reihenfolge (bei Tsuzuki: 1-2 horizontal, 3-4 vertikal).

---

## Noch offene Punkte (als Ideen, nicht implementiert)

- Weitere Muster aus `../Bücher` per Extraktor: Asanoha (Hemp Leaf), Kikko (Tortoiseshell), Sugi Aya (Herringbone, Buch S.44) wären gute nächste Additions.
- Export als SVG oder PNG.
