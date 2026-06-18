# Sashiko Pattern Library — Project Context

## Deliverable

**File:** `Sashiko — Pattern Library.htm` — self-contained, no build step, no server. Open directly in a browser.

Interactive Sashiko pattern library with animated stitch-by-stitch preview. All logic, CSS and canvas rendering in a single HTML file.

**Workflow notes (important):**
- This file (CLAUDE.md) is the project documentation — read it at the start of every session and keep it current when things change.
- Colours ALWAYS from the **Colours** section below (`PHASE_COLORS` + fabric `#1a3a5c`).
- New patterns are drawn in the **CAD Editor** — geometry comes from what the user draws on the grid, not from book scans.
- **Stitch order / routing** ALWAYS per the rules in `ROUTING.md` (long lines, short jumps). Applies to all patterns.

## Build System

**Source:** `src/` — split into small, focused files:

| File | Contents | Lines |
|---|---|---|
| `src/template.html` | HTML skeleton with injection markers | ~163 |
| `src/styles.css` | All CSS styles | ~178 |
| `src/patterns.js` | `PATTERNS` array + generator presets | ~65 |
| `src/engine-star.js` | Canvas setup + star-arm engine | ~54 |
| `src/engine-hm.js` | Hitomezashi engine | ~153 |
| `src/engine-polyline.js` | Tsuzuki Yamagata polyline engine | ~225 |
| `src/render.js` | Animation state, render dispatcher, `loadPattern` | ~170 |
| `src/generator.js` | Generator UI, playback, thumbnails | ~240 |
| `src/gallery.js` | `buildGallery`, `filterGallery`, view switching | ~77 |
| `src/experimental.js` | Custom Patterns (experimental), Firebase sync, CAD save/open | ~300 |
| `src/cad-engine.js` | CAD editor + init | ~320 |

**Build:** `python build.py` writes `Sashiko — Pattern Library.htm` + `index.html` (identical).

**GitHub Actions** (`.github/workflows/build.yml`): runs automatically on every push to `src/` — builds and commits the deliverable files — GitHub Pages deploys `index.html` live.

**Edit workflow:**
1. Edit the desired `src/` file (e.g. `src/cad-engine.js` for CAD changes)
2. Test locally with `python build.py`
3. Push — Actions builds + deploys automatically

**NEVER** edit `Sashiko — Pattern Library.htm` or `index.html` directly — those are build artefacts.

---

## Architecture

Three separate rendering engines:

### 1. Star-Arm Engine (Moyozashi style)
For Juji-zashi, Naname Juji-zashi, Komesashi.

Short arm segments from each grid point in directions `V`, `H`, `D1`, `D2`. Each direction = one pass. The system optimises pass order and direction by brute-force over all permutations (4! = 24) to minimise inter-pass jumps.

```
const sx = i => PAD + i*G       // x coordinate of grid point i
const sy = j => PAD + (N-1-j)*G // y coordinate, j=0 at bottom
N = 7, G = 50px, PAD = 36px, SIZE = 372px
```

### 2. Hitomezashi Running-Stitch Engine
For Hitomezashi Generator, Koshi, Kaki no Hana, Yamagata preset, Fibonacci Snowflake.

Edge segments along grid lines. Dynamic grid (HM_N x HM_N points), `HM_CELL = 300 / (HM_N - 1)` — always fits the canvas.

```
const shx = i => PAD + i*HM_CELL
const shy = j => PAD + j*HM_CELL   // j=0 at top (not mirrored)
```

**Mathematical model (explicit per-line bits):**
- Horizontal edge `(i,j)-(i+1,j)` is stitched if `(i + rowBits[j]) % 2 === 0`
- Vertical edge `(i,j)-(i,j+1)` is stitched if `(j + colBits[i]) % 2 === 0`
- `rowBits[j]` = start phase of **row** j (horizontal stitches, green), `colBits[i]` = start phase of **column** i (vertical stitches, blue). **Rows and columns are independent** — this is the true Hitomezashi model.

**Engine entry point:** `buildHMcore(rowBits, colBits)` (N = `rowBits.length`). 8-combination jump optimisation.

**Preset to bits:** `seqToBits(seq, N)` tiles a period sequence to N explicit bits and centres them via `findSymOffset(seq, N)` (palindrome offset, otherwise 0). No more N-snapping (`nearestSymN` removed): any grid size is allowed; presets re-tile on size change. `buildHitomezashi(pat)` is just a wrapper: `buildHMcore(seqToBits(pat.seq,N), ...)` for seq-based patterns.

### 3. Polyline Engine (Tsuzuki Yamagata + Asanoha)
For `type:'polyline'` (Tsuzuki Yamagata and Asanoha). Geometry is encoded as a unit cell + lattice generators (derived once and verified, not guessed by eye).

**Generic N-pass model:** `PL_passes = [{start, label, glyph, col}]` describes the passes (col = `PHASE_COLORS` key). TY has 2 passes, Asanoha 4. `buildJumpBar`, `updateInfoPL` and the jump bar all read `PL_passes`. Per-pattern render scale: `PL_N` (units across canvas), `PL_HU=(SIZE-2*PAD)/PL_N`, `PL_guideStep` (grid lines every n units) — set in `loadPattern` depending on `pat.engine`. `tracePaired`/`orderNN`/`renderPolyline`/`drawPLFront` are shared.

The pattern is the union of straight running-stitch lines in four slopes: **shallow +/-1/2** (wide 2x1 diamonds, flow horizontally) and **steep +/-2** (tall 1x2 diamonds, flow vertically). Lines cross — mountain-range mesh. Encoded on a **half-grid** as a 16-edge unit cell `TY_CELL` + generators `TY_G1=[4,4]`, `TY_G2=[8,0]`. Verified: reproduces the extracted edge dataset 100% (0 false positives).

```
PL_NHU = 20           // half-units across the canvas (= 10 "grid squares")
PL_HU  = (SIZE-2*PAD)/PL_NHU
plPx(c) = PAD + c*PL_HU
```

- `genTYedges(NHU)` — tile unit cell over grid, edges in half-grid coords.
- `traceZig(edges, axis)` — trace continuous zigzag lines: at each crossing go straight in +axis, alternate the perpendicular step. 100% edge coverage verified.
- `buildTsuzukiYamagata(NHU)` — steep edges to horizontally marching zigzags (pass 1), shallow to same rotated 90 degrees (pass 2).
- **Pass 1 = horizontal** (green `H` shades), **Pass 2 = vertical** (blue `V` shades). Two shades per family = the two translation classes (see **Colour Assignment**). Boundary at `PL_shCount`. Viewport: `PL_NHU=28`.

#### Asanoha (Hemp Leaf) — `engine:'asanoha'`
Geometry derived from **Essential Sashiko p.13**, verified 100% recall / 98% precision. Interlocking six-pointed hemp-leaf stars.

- **Square grid, unit = grid square/4** (84px in the book, u=21px). Vertical grid lines every 4u, horizontal every 2u (book cell 2:1 wide, 168x84px).
- Four edge families: **V (0,1)**, **H (1,0)**, **shallow diagonal (2,+/-1)** (slope 1/2, long spoke lines), **steep diagonal (2,+/-3)** (slope 3/2, short leaf zigzags). 12-pointed stars at hubs.
- **34-edge unit cell `ASA_CELL` + generators `ASA_G1=[8,4]`, `ASA_G2=[0,8]`** (in u). `genAsanohaEdges(NQ)` tiles them. Viewport: `ASA_NQ=32`.
- **4 passes in traditional stitch order** (book): 1 Vertical V, 2 shallow diagonals D1, 3 steep leaf zigzags D2, 4 Horizontal H (last, carried behind the cloth). Two shades per diagonal pass = the two slope orientations (mirror classes). `buildAsanoha(NQ)` traces each family with `tracePaired`+`orderNN`.

---

## Gallery Patterns

```javascript
const PATTERNS = [
  { id:'generator',         type:'generator', ...  },  // Hitomezashi Generator, always first
  { id:'juji',              passes:['V','H'],  ... },
  { id:'naname',            passes:['D1','D2'], ... },
  { id:'komesashi',         passes:['V','H','D1','D2'], ... },
  { id:'tsuzuki-yamagata',  type:'polyline',  ... },                   // Polyline Engine, 2 passes
  { id:'asanoha',           type:'polyline', engine:'asanoha', ... },  // Polyline Engine, 4 passes
];
```

Koshi and Kaki no Hana are **not** separate gallery entries — they are generator presets.

Removed (not verifiable as traditional patterns): `yarai`, `yokoyarai`, `mittsu`.

---

## Hitomezashi Generator

State:
```javascript
let GEN_rowBits=[], GEN_colBits=[];  // explicit per-line phases (length = GEN_n)
let GEN_n=12;                         // grid size (= number of rows/columns)
let GEN_preset='kaki';                // 'koshi'|'kaki'|'snowflake'|null (null = Custom)
let GEN_snowOrder=2;                  // always 2
```

### Graphical Line Editor (the core feature)
Toggle buttons **around the live preview**, precisely aligned to grid points:
- **Left** (`#hmRowToggles`): `ceil(N/2)` buttons (upper half) — toggles `GEN_rowBits[j]` and mirrors to `GEN_rowBits[N-1-j]` — **green** horizontal stitches.
- **Top** (`#hmColToggles`): `ceil(N/2)` buttons (left half) — toggles `GEN_colBits[i]` and mirrors to `GEN_colBits[N-1-i]` — **blue** vertical stitches.
- **Symmetry:** pattern is always bilaterally symmetric (top/bottom, left/right). Only the first half of the toggles is visible; the other half is mirrored automatically. `resizeBitsSymmetric(a, N)` on resize.
- `buildLineToggles()` rebuilds the buttons. Each toggle sets `GEN_preset=null` (Custom) and calls `refreshGen(true)`.
- **`refreshGen(showFull)`** = sole entry point after every change. Editing immediately shows the full pattern (preview); Play/Reset restart the animation.
- `setGridN(N)`: preset active — re-tile; Custom — preserve bits / symmetrically pad.

### Generator Presets
A preset **only fills** `GEN_rowBits`/`GEN_colBits` (`loadPreset(key)` -> `seqToBits`); freely editable afterwards.
```javascript
const GEN_PRESETS = {
  koshi:    { seq:[0],          n:12, label:'Koshi'        },
  kaki:     { seq:[0,0,1,0,1], n:12, label:'Kaki no Hana' },
  snowflake:{ label:'Snowflake' },
};
```
Yamagata is NO LONGER a generator preset.

### Fibonacci Snowflake (always Order 2)
Only Order 2 is implemented (8-element Fibonacci word mirrored to 16-element palindrome). `GEN_snowGrid` (default 16) controls the grid size via the universal slider (range 8-32).

---

## Colours

```javascript
const PHASE_COLORS = {
  V:  ['#cde0f4', '#9cbcd8'],  // Vertical: light/dark
  H:  ['#c4ebd6', '#88c4a4'],  // Horizontal
  D1: ['#f5e0c8', '#e0b890'],  // Diagonal (orange/amber)
  D2: ['#ddd0f2', '#b0a0e0'],  // Diagonal (violet)
};
```
- Two shades per direction: `lp=0` (even rows, lighter), `lp=1` (offset rows, darker)
- Fabric: `#1a3a5c` (dark navy blue)
- **Tsuzuki Yamagata** uses the same palette: shallow (horizontal) lines to `PHASE_COLORS.H`, steep (vertical) to `PHASE_COLORS.V`.
- **This palette is binding** — do not invent new colours; choose from here (extend and document if necessary).

### Colour Assignment = Translation Equivalence Class
A path's colour encodes its **translation class**: two paths get the same shade if and only if one maps onto (part of) the other via a pattern symmetry translation. A mirror image (half-period offset, NOT a lattice vector) = its own class.

Implementation (Tsuzuki Yamagata, 2 classes per family):
- `classifyTranslation(chains)` — groups paths; `latContains(big,small)` tests for lattice vector containment over `TY_LAT`.
- Geometric invariant: steep chains H (f=1): `startY % 8 === 4` -> class 0 (light), `=== 0` -> class 1 (dark). Shallow chains V (f=2): `startX % 8 === 4` -> class 0, `=== 0` -> class 1.
- V-family: sort by x before NN to avoid large edge-to-edge jumps.
- NOT by band parity / median coordinate.

---

## Animation Engine

```javascript
const TICK_MS = 40;  // fixed speed, ~25 stitches/sec

let step = 0;        // 0 = start, TOTAL = finished
let playing = false;
let raf = null;
```

**Keyboard:** Space = Play/Pause, ArrowLeft/Right = one stitch forward/back.

**Idle info-bar:** `onInfoClick()` checks `classList.contains('idle')` — onclick stays set always, `setIdleInfo()` restores the `idle` class (prevents onclick from breaking after Reset).

---

## Jump Bar

Jumps directly to pass boundaries. HM patterns: pass 1 (horizontal) vs. pass 2 (vertical). Polyline patterns: one button per `PL_passes` entry (TY 2, Asanoha 4) — boundaries from `PL_passes[i].start`.

---

## Filter System

```
data-f="0"  -> All
data-f="2"  -> 2 passes
data-f="4"  -> 4 passes
data-f="hm" -> Hitomezashi (Generator card only)
```

Search matches: name, jp, en, id, plus generator keywords (`koshi kaki persimmon lattice snowflake hitomezashi`) and polyline keywords (`yamagata mountain continuous asanoha hemp leaf star`).

Polyline patterns (TY, Asanoha) have `passes.length===0` — appear only under "All". Badge: Asanoha "Hemp leaf", TY "Continuous".

---

## Thumbnails

All thumbnails use the real animation pipeline (`ctx` redirected to thumb canvas, build + draw, then restore). `buildGallery` uses `setTimeout(..., 0)` so thumbnails render even when the tab is hidden.

```javascript
function renderThumb(canvas, pat) {
  // exp:       computeExpLayout + buildExpPath(genTiledSegs) + renderExp(TOTAL)
  // polyline:  buildTsuzukiYamagata/buildAsanoha -> renderPolyline(TOTAL)
  // hitomezashi/generator: seqToBits -> buildHMcore -> renderHM(TOTAL)
  // star-arm:  buildPasses -> drawFabric + drawGuide + frontAll
}
```

Exp pattern thumbnails use `height:auto` CSS for non-square iso canvases.

---

## Key Functions

| Function | Purpose |
|---|---|
| `findSymOffset(seq, N)` | Palindrome offset (else 0) — for `seqToBits` |
| `seqToBits(seq, N)` | Period sequence -> N explicit, centred bits |
| `buildHMcore(rowBits, colBits)` | Hitomezashi engine: HM_path + HM_fronts, 8-combination jump opt. |
| `buildHitomezashi(pat)` | Wrapper: `buildHMcore(seqToBits(pat.seq,N),...)` |
| `buildLineToggles()` | Builds row/column toggles around the canvas |
| `loadPreset(key)` | Fills GEN_rowBits/colBits from preset or snowSeq |
| `setGridN(N)` | Change grid size (re-tile preset / pad custom) |
| `refreshGen(showFull)` | Sole entry point after any generator change |
| `snowSeq(ord)` / `snowHalf(ord)` | Fibonacci snowflake sequence |
| `genTYedges(NHU)` | Tsuzuki Yamagata: tile unit cell -> half-grid edges |
| `buildTsuzukiYamagata(NHU)` | Edges -> zigzags -> 2 passes |
| `genAsanohaEdges(NQ)` | Asanoha: tile ASA_CELL via ASA_G1/G2 -> edges |
| `buildAsanoha(NQ)` | Per family tracePaired+orderNN -> 4 passes |
| `buildPasses(pl, n)` | Star-arm passes with permutation optimisation |
| `loadPattern(pat)` | Dispatcher for all pattern types |
| `computeExpLayout(pat)` | Tiled-view scale/origin for exp patterns (patMacro-based) |
| `genTiledSegs(pat)` | All tile instances covering the canvas (with edge overlap) |
| `buildExpPath(segs)` | Min-deflection stroke formation + family/band/snake ordering (ROUTING.md cost model) |
| `matchVertex(d,cost,maxCost)` | Min-deflection maximal edge matching at one vertex (brute force ≤8, greedy above) |
| `renderExp(step)` | Animated render for custom exp patterns |

---

## Known Decisions / Constraints

- **Line width scales with HM_CELL:** `lw = max(1, min(3, HM_CELL * 0.15))` — looks good from Order 1 (100px cells) to Order 3 (4.5px cells)
- **Generator always shows `step=TOTAL`:** editing/preset/order immediately renders the full pattern (preview). Play restarts the animation.
- **Rows/columns independent:** toggles can make the pattern asymmetric. Presets restore symmetry (`rowBits === colBits`).
- **Yamagata preset removed:** was only a Hitomezashi approximation; the real Tsuzuki Yamagata lives in the Polyline Engine/Gallery.
- **No speed slider:** toggle only — slow `TICK_MS=160` (~6 stitches/sec), fast `TICK_MS=80` (~12 stitches/sec)
- **No `el.onclick=null`** in update functions — breaks the Reset/Play button
- **Arc resolution in CAD editor:** max 30 segments per full circle (`Math.max(3, Math.round(sweep/2pi * 30))`) — sashiko stitching needs low-poly curves
- **Exp pattern routing (human-makability cost):** `buildExpPath` minimises `A·jumps + B·jumpLen + C·turnSharpness + D·retrace` (A≫B≫C,D). Phase 1: build a vertex/edge graph, pair edges at each vertex by **minimum deflection** (`matchVertex`), trace strokes following the pairings — so a whole curve = one stroke (breaks only at endpoints or turns > 135°). Phase 2: group strokes into 30° orientation families (H before V — Rule 3), then into parallel bands by centroid, sweep bands with a **snake** (reverse alternate bands) so jumps always move into unstitched area. Verified: 100% edge coverage; a 4-arch row routes as 4 strokes (3 jumps), not ~44. See `ROUTING.md`.
- **Exp canvas borders:** iso patterns use canvas height = SIZE/sqrt(3) so the parallelogram diamond tips land exactly at the four canvas edges

---

## Open Items (ideas, not yet implemented)

- Export as SVG or PNG.
