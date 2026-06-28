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
| `src/engine-polyline.js` | Tsuzuki Yamagata polyline engine | ~235 |
| `src/render.js` | Animation state, render dispatcher, `loadPattern`, zoom/pan | ~300 |
| `src/generator.js` | Generator UI, playback, thumbnails | ~240 |
| `src/gallery.js` | `buildGallery`, `filterGallery`, view switching | ~101 |
| `src/experimental.js` | Custom Patterns (experimental), Firebase sync, family auto-assignment, trash, edit-pattern, deep links | ~1175 |
| `src/cad-engine.js` | CAD editor, family colors, play animation, spacing, init | ~560 |

**Build:** `python build.py` writes `Sashiko — Pattern Library.htm` + `index.html` (identical).

**GitHub Actions** (`.github/workflows/build.yml`): runs automatically on every push to `src/` — builds and commits the deliverable files — GitHub Pages deploys `index.html` live.

**Edit workflow:**
1. Edit the desired `src/` file (e.g. `src/cad-engine.js` for CAD changes)
2. Test locally with `python build.py`
3. Commit the change locally (`git add` + `git commit`)
4. Push only when asked — Actions builds + deploys automatically on push

**NEVER** edit `Sashiko — Pattern Library.htm` or `index.html` directly — those are build artefacts.

---

## Debugging Routing (headless — no browser, no clicking)

`tools/routing/` runs the **real** router from `src/` in Node against real pattern geometry, so routing changes can be measured before touching the browser. Plain Node (v18+), no deps — works under Claude Code, opencode/DeepSeek, or a human shell. See `tools/routing/README.md`.

```bash
node tools/routing/fetch-patterns.js        # pull all patterns from Firestore → test/patterns/*.json (public read, unattended)
node tools/routing/route.js                 # metrics for every fixture in its saved mode
node tools/routing/route.js seigaiha        # one pattern (id or name substring), all 3 modes
node tools/routing/route.js shippo contour  # one pattern, one mode
node tools/routing/route.js --snapshot      # write golden test/routing-snapshots.json
node tools/routing/route.js --check         # diff vs golden, exit 1 on any change
```

Metrics: `strokes`, `jumps`, `jumpLen`, `maxTurn` (sharpest in-stroke turn), `midArc` (strokes that start mid-arc — **must be 0**). `load-routing.js` loads the live `src/` functions (no copy-paste, can't drift). Fixtures in `test/patterns/` and the snapshot are committed. When a routing change is intentional, re-run `--snapshot`.

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
let TICK_MS = 160;  // per-tick ms, derived from the speed slider via updateSpeed()
// Speed slider (render.js): `_animSpeedV` 0..100 → `_speedTotal(v)` = total animation
// duration in ms (v=100 → 10s fastest, v=0 → 90s slowest = 3× the old "Slow").
// TICK_MS = _speedTotal(_animSpeedV)/TOTAL. The gallery slider is #animSpeed; the CAD
// tile-play slider is #cadSpeed (own `_cadSpeedV`, same `_speedTotal` mapping).

let step = 0;        // 0 = start, TOTAL = finished
let playing = false;
let raf = null;
```

**Keyboard:** Space = Play/Pause, ArrowLeft/Right = one stitch forward/back.

**Idle info-bar:** at `step===0` the info bar is hidden entirely (`setIdleInfo()` sets `display:none`, no "press to begin" prompt); each `updateInfo` restores `display:''` for `step>0`. `onInfoClick` remains wired but is inert while hidden.

### Zoom & Pan

Mouse wheel over the animation canvas zooms in/out (1×–8×). Zoom is always centered on the current view position (respects pan). Middle/right-click or Ctrl+left-click drag to pan. Pan is clamped so at least 60px of the pattern remains visible. At minimum zoom (1×), pan is locked to center.

Zoom uses **both** canvas resolution scaling (for sharpness) and CSS `transform: scale()` on `.stage` (for visual enlargement). Line widths and dot grid sizes scale inversely with zoom via helpers `zlw(w)` and `zds(s)` so they maintain consistent visual thickness regardless of zoom level.

**Zoom state in `render.js`:**
```javascript
let _zoom = 1, _panX = 0, _panY = 0;
function _setupCanvasSize(w, h)  // applies canvas resolution + CSS transform
function _clampPan()             // constrains pan so pattern stays visible
function _resetZoom()            // called at start of every loadPattern
function initAnimZoom()          // attaches wheel + pointer listeners to cv
```

### Dot Grid & Fabric

No more horizontal fabric lines. All pattern types have a dot grid — sub-grid dots everywhere, larger dots at main guide line intersections. Guide lines (star, polyline, exp) at 0.15 opacity.

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
  //            — rendered in STITCH VIEW (denim + off-white, no grid) using the
  //              pattern's saved stitchLen/stitchRatio; renderThumb saves/restores
  //              galStitch* + EXP_uRange/vRange so the viewer's state isn't disturbed.
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
| `computeExpLayout(pat)` | Square tiled-view layout for exp patterns; visible square as a convex (u,v) region (`planes`) |
| `convexPlanes(poly)` / `clipSegConvex(p0,p1,planes)` | Build inward half-planes / clip a segment to the visible region |
| `genTiledSegs(pat)` | Tile instances covering the square, each clipped to it (no off-screen routing) |
| `buildExpPath(segs)` | Min-deflection strokes + type/family/band/snake ordering ("order first", ROUTING.md) |
| `matchVertex(d,cost,maxCost)` | Min-deflection maximal edge matching at one vertex (brute force ≤8, greedy above) |
| `renderExp(step)` | Animated render for custom exp patterns |
| `rerouteExp()` | Re-run the router on the current custom pattern (🔀 Re-route button) |

---

## Known Decisions / Constraints

- **Speed:** continuous slider (`#animSpeed` gallery, `#cadSpeed` CAD) → `_speedTotal(v)` total duration 10s (fast) … 90s (slow); `TICK_MS=_speedTotal(v)/TOTAL`
- **Line width scales with HM_CELL:** `lw = max(1, min(3, HM_CELL * 0.15))` — looks good from Order 1 (100px cells) to Order 3 (4.5px cells)
- **Generator always shows `step=TOTAL`:** editing/preset/order immediately renders the full pattern (preview). Play restarts the animation.
- **Back-thread / jump lines REMOVED** — no dotted lines showing needle jumps between stitches (drawBack, drawHMBack, renderExp back-thread all stripped)
- **No `el.onclick=null`** in update functions — breaks the Reset/Play button
- **Arc resolution in CAD editor:** max 30 segments per full circle (`Math.max(3, Math.round(sweep/2pi * 30))`) — sashiko stitching needs low-poly curves
- **Drawn shapes are kept whole (NOT auto-split at intersections):** each line/arc drawn in one piece stays a single `cadLines` entry, so the router's arc-atomicity (each `aid` = one atomic stroke, `extractArcStrokes` in `experimental.js`) makes it stitch as ONE continuous line (e.g. Maru Shippō circles route as full loops). The **Cut tool** (`erase`) still segments a whole shape on demand: `cadHoveredSeg` computes break points from intersections dynamically, so you can cut at any crossing without the geometry being pre-split. The old auto-splitter (`cadSplitOffGrid`) and the **Split tool** (`cadSplitAt`/`cadMergeAllAt`/`cadIsSplitPoint`/`cadIsMergePoint`/`_splitArc`) were removed — they were an earlier approach that broke shapes into segments and hurt routing.

## Custom Pattern Features (Experimental)

### Family Auto-Assignment (`autoAssignFamilies`)
When saving a new pattern from the CAD editor, lines are automatically grouped into families by screen-space orientation angle:
- Angles mapped to `[0, π)` — opposite directions (same stitch line drawn backwards) share the same color
- Lines within **5°** of each other get the same family
- Arc segments (drawn with arc tool) all share **one** family regardless of their segment angles
- Families are numbered 0,1,2,… sorted by angle
- Palette: `FAM_PALETTE` (10 colors) in `render.js`

### CAD Editor Family Colors
Lines are colored by family in real-time as you draw. Both the Draw canvas and Live Tiling panel show family colors. The color assignment is stored in `cadFamilies[]` and recomputed via `cadAutoAssign()` on every change (called from `cadUpdateAll()`).

### Edit Pattern (Admin)
- ✎ button on custom pattern cards (gallery + My Patterns) — requires admin password `'111'`
- Loads pattern lines into CAD editor; grid/macro sizes clamped to valid select options
- Save updates the **existing** pattern (preserves ID, createdAt, published status)
- Families preserved if line count unchanged; otherwise auto-assigned
- `cadEditId` tracks which pattern is being edited; only cleared when leaving CAD view

### Stitching Order Settings
- Click a color swatch to select, then click lines on the unit cell canvas to assign
- Toggle families on/off via jump bar buttons
- Community profiles: save/share/load stitching orders per pattern
- Cat avatar system for profile creators

### Deletion (permanent)
- Deleting a pattern (gallery ✕ or My Patterns ✕) removes it permanently after one confirm dialog — no trash/recovery
- `removeExpPattern` (in `experimental.js`) deletes from `EXP_PATTERNS`, records the id in `sashiko_deleted` (so Firestore sync won't resurrect it), and calls `_deleteFromFirestore`
- The old trash system (1-week retention, Restore, `sashiko_trash`) was removed

### Deep Links
- URL hash `#pattern-id` opens that pattern directly (e.g. `#juji`, `#exp_123`)
- Hash updated when opening a pattern, cleared when returning to gallery
- Works with both built-in and custom patterns

### CAD Tile Preview Play
- ▶ Play button below the Live Tiling panel
- Animates stitch-by-stitch on the right canvas using the **same** `genTiledSegs` + `buildExpPath` routing as the main animation view
- Stitches scaled to fit the 500×500 tile canvas with the grid background visible

### CAD Spacing Control
- Dropdown (0–12) adds padding between tiled pattern units in both Live Tiling and Play views
- Stored in `cadSpacing` variable, read by `cadUpdateSettings()`

### Realistic Stitch View (denim + off-white yarn)
- **🪡 Stitch view** toggle switch in the Live Tiling toolbar (`#cadStitchToggle` → `cadToggleStitchView`). OFF = coloured family view (as before); ON = indigo-denim fabric with off-white running stitches on the **same** right canvas (`patCanvas`), both static and Play.
- Controls appear only when ON (`#cadStitchControls`): **Stitch length** slider (`cadStitchLen` px, range 3–40, default 8), **Ratio** dropdown (`cadStitchRatio`, stitch : pause) — `CAD_STITCH_RATIOS` = Standard 3:1 (default, gap ≈ ⅓ stitch), Relaxed 2:1, Long 3:2, Even 1:1 — and a **Grid** checkbox (`cadStitchGrid`) overlaying the fabric grid via the scene transform (`_cadDrawStitchGrid`, main lines every `CAD_MICRO`).
- **Round-cap inset:** stitches use round line-caps (puffy thread look), which add `w/2` past each drawn endpoint; `_cadLayStitches` insets the drawn endpoints by exactly `_cadStitchW()/2` so the *visible* thread spans the intended stitch length and the gaps match the chosen ratio (without this, every gap reads shorter than the stitch).
- **Sashiko stitch rules enforced** by `_layStitches(strokes, len, ratioKey, w)` (the shared engine): running stitches are laid by arc-length along each routed stroke; a clear denim **gap straddles every crossing and corner** ("stitches meet at the gaps, never over an intersection" — thread dips under). Anchors = endpoints + sharp corners (turn > `CAD_STITCH_CORNER` 35°, so curve vertices ≈6° aren't corners) + crossings with other strokes. Crossings use `_segCross` (intersection **inclusive of shared grid vertices**, parallel→null) so vertex-crossings count. **Clearance fix:** at each corner/crossing anchor a clearance `max(G/2, w/2+0.75)` is reserved — ≥ thread half-width — so perpendicular threads can't overlap at a crossing (the old half-gap version let them overlap when gap < thread width). Each sub-run fits a whole number of evenly-spaced stitches in the span between clearances; round-cap inset keeps gaps on-ratio.
- Shared helpers (all in `cad-engine.js`, hoisted so `render.js`/`experimental.js` can call them): `_layStitches`, `_buildStrokesFromPath(path,T)` (group routed segs into strokes via the `jump` flag), `_segCross`, `_ptAlong`, `_stitchW(len)`, `_cadDrawDenim(x,w,h)`, `_cadDrawStitch`, `_cadDrawStitchGrid(x,scene)`. Denim baked once in `_cadDenimBuf`. Colours `CAD_DENIM`/`CAD_YARN`.
- **CAD pipeline:** `_cadStitchScene()` mirrors `cadTilePlay`'s pat build → `genTiledSegs`/`buildExpPath`/`filterVisiblePath`/fit → `_buildStrokesFromPath` → `_cadLayStitches` (= `_layStitches` with cad params). Cached by `_cadStitchSig()`. `cadDrawPattern` (static) and `_renderTileFrame` (Play) branch on `cadStitchView`.
- **Gallery animation viewer** (`experimental.js` `renderExp`): same stitch view, scoped to **custom (exp) patterns**. `#stitchViewBar` (shown when `isEXP`) has a 🪡 toggle (`galToggleStitch`) and an **Advanced ▾** dropdown (`#galAdv`, hidden until opened) with the same length/ratio/grid controls — defaults come from the pattern's saved `stitchView`/`stitchLen`/`stitchRatio`/`stitchGrid` (written by `cadSaveToLibrary`/`cadPublishToLibrary`), overridable per session. State `galStitch*`; scene via `_galStitchScene()` (built from `EXP_path` + `EXP_g2s`, cached by path ref + params); animation shows the first `round(N·step/TOTAL)` stitches. Grid overlay uses `EXP_uRange`/`EXP_vRange`.
- Play animation uses `requestAnimationFrame` (`_tpLoop` / gallery `tick`) — rAF is throttled in hidden/headless tabs, so Play can't be observed in the preview harness, only the synchronous static/full render.

## Known Issues / Gotchas

- **Syntax errors are fatal** — the entire script is one IIFE; an extra `}` anywhere (like the one found in `drawPLGuide`) prevents ALL JavaScript from executing, causing "is not defined" for every onclick handler
- **Build artifacts cause merge conflicts** — CI rebuilds on every push; always use `git stash; git pull --rebase; git stash pop` before pushing
- **`file://` protocol may block Firebase CDN scripts** — test via `http://localhost` or GitHub Pages URL
- **`genTiledSegs` / `buildExpPath` path entries use `start`/`end` (grid `[u,v]`), NOT `p0`/`p1` (screen `{x,y}`)** — convert with `lay.g2s()` if needed
- **CAD `cadFamilies` includes redundant lines** — always filter with `cadFamilies.filter((_,i)=>!redSet.has(i))` when creating pattern families
- **Zoom constants in `render.js`:** `_zoom` range 1–8, helper functions `zlw(w)` and `zds(s)` for zoom-aware line widths and dot sizes

---

## Open Items (ideas, not yet implemented)

- Export as SVG or PNG.
