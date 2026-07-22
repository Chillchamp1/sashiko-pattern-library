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
| `src/experimental.js` | Custom Patterns (experimental), Firebase sync, family auto-assignment, routing (v1 + additive v2 pipeline), edit-pattern, deep links | ~2760 |
| `src/cad-engine.js` | CAD editor, family colors, play animation, spacing, init | ~560 |
| `src/download.js` | Gallery "About" toggle; pattern-viewer Download dropdown (self-contained animated-GIF encoder; one-page A4 PDF stitching sheet; STL placeholder) | ~360 |

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

Metrics: `strokes`, `jumps`, `jumpLen`, `maxTurn` (sharpest in-stroke turn), `midArc` (strokes that start mid-arc — **must be 0**; NB the metric false-positives on closed circles assembled from several open arcs, which v1 `default` triggers on Maru Shippō — the v2 modes report 0 there). `load-routing.js` loads the live `src/` functions (no copy-paste, can't drift). Fixtures in `test/patterns/` and the snapshot are committed. When a routing change is intentional, re-run `--snapshot`. The four v1 routing modes are `default`, `continuous`, `contour`, `sequential` (see `ROUTING.md`); `route.js` tests all four (`MODES`, = the snapshot surface). The two **v2 modes** `zigzag2`, `waves2` (additive pipeline, ROUTING.md "Routing v2") are testable per pattern via the explicit mode arg, e.g. `node tools/routing/route.js asanoha zigzag2` — deliberately not in `MODES`, so the golden snapshot keeps guarding v1. (Retired 2026-07-22 after checking live Firestore usage: `rows2`/`rows2e` (owner migrated their two patterns to `waves2` first; waves2 keeps the shared band-snake machinery) plus legacy `smooth`/`fewer-jumps` remnants. Unknown saved modes collapse to `default` on CAD load and route as `default` via the `maxTurnMap` fallback. `fetch-patterns.js` now skips tombstoned docs and prunes stale fixture files — before that, 41 dead patterns inflated the fixtures and mis-attributed which modes were unused.)

---

## Routing Engine Versioning — published patterns are LOCKED to their engine

A pattern stores only **geometry** (`lines`, `families`, `famOrder`, `routingMode`, `patMacro`), never the routed stitch order — the stitch path (`EXP_path`) is recomputed **live** on every open and every tile-count change via `genTiledSegs` + `buildExpPath`. So editing those functions would silently re-route **every** pattern, including ones already published to the gallery.

To prevent that, published gallery patterns are **pinned** to the routing engine they were published with (`pat.routingEngine`); sandbox / new / remix / edit patterns always use the current engine (authoring gets the newest routing). Implemented in `experimental.js` (just above `genTiledSegs`):

- `ROUTING_ENGINE_CURRENT` (currently `1`) + `ROUTING_ENGINES = {1:{genTiledSegs, buildExpPath}}`.
- `routingEngineFor(pat)` → published: `pat.routingEngine || 1` (missing field = pre-versioning = engine 1); unpublished: current.
- `tiledSegsFor(pat)` / `expPathFor(segs, pat)` — **use these at every GALLERY-facing routing call site**, not the bare functions. Wired in: `render.js` (`loadPattern`, `_reloadExpWithTiles`), `generator.js` (`renderThumb`), `experimental.js` (`loadStitchingProfile`, `rerouteExp`, `_galDraftShapes`). CAD-editor call sites (`cad-engine.js`) deliberately stay on the bare/current engine — the editor is authoring.
- **Stamping:** `cadPublishToLibrary` new publish → `ROUTING_ENGINE_CURRENT`; re-publish/edit of an existing pattern → preserves the pinned value. `publishExpPattern` (promote sandbox→gallery) → stamps current. `cadSaveToLibrary` preserves it on edit. The Firestore rules cap keys at 80 (not a whitelist), so the new field needs no rules change; `_pushToFirestore` spreads all fields so it round-trips.

**Today there is ONE engine (v1 === the live functions), so the whole layer is a transparent pass-through — zero behavioral change** (verified: `route.js --check` diff is identical with/without the layer; it's fixture drift only).

**Custom family THREAD colours (2026-07-22, Community patterns only):** double-clicking a family swatch in the
CAD editor (`cadFamColorPick`, panel `#cadFamColorPanel` under the fam bar, built by `_cadBuildFamColorUI`;
swatches from `OLYMPUS_SASHIKO`+`GAL_PASTEL` + ↺ off-white chip) assigns a **thread colour** to that family —
state `cadFamColors` {editor famIdx→hex}. **The editor display is untouched**: draw canvas, Live Tiling, Play,
fam-bar swatches and routing chips all keep the classic `FAM_PALETTE` (`famColor`); the assigned thread colour
shows as a **small square below the family swatch** (`.cad-fam-thread` in `.cad-fam-col`). Assigning a colour
switches the community-only **🎨 Coloured thread** checkbox ON (`#cadStitchColorsWrap` in `#cadStitchControls`,
state `cadStitchColors`) so the stitch view updates INSTANTLY; `_cadThreadColor(fam)` dyes the running stitches
at both `_cadDrawStitch` call sites. **Gated on the Community flag**: with Community unchecked the picker
refuses (alert) and existing entries go dormant (a non-community save stores `{}`). **Fabric preview
(2026-07-23, community-only):** a `Fabric` dropdown in `#cadStitchControls` (`#cadFabricWrap`, `cadSetFabric`,
state `cadFabric`, ids = `SASHIKO_FABRICS`) swaps the stitch-view background via `_cadDrawFabricBg` ('indigo'
default = the classic `_cadDrawDenim`, so non-community stays byte-identical); `_cadEditorGrid` draws its dots
dark on a light cloth (Natural), same adaptation as the gallery grid. Saved as `pat.fabric` on community saves,
restored on edit, carried by remix, reset in `showCAD`. **Gallery (2026-07-23):** a community pattern saved
with a fabric OPENS on that cloth — `loadPattern` sets `galFabric=pat.fabric` for it, everything else falls
back to `_galFabricUser` (the visitor's sticky choice, updated by `galSetFabric`); thumbnails do the same
(`renderThumb` sets/restores `galFabric`). So the creator's cloth is the default view, the visitor's own pick
still wins on every pattern without a saved fabric and can override per view. Saved as `famColors` (remapped via `_cadRemapFamColors(cf.map)`, same compaction
as famRouting) + `stitchColors:bool`; restored in `editExpPattern`, carried by `remixPattern` (re-activates when
the remixer re-checks Community), reset in `showCAD`. **Gallery viewer + thumbnails**: for community patterns
saved with `stitchColors`, `galThreadColors` initialises from `pat.famColors` (loadPattern in render.js,
`renderThumb` in generator.js) — visitors can still repaint/reset via the 🎨 Color popover; traditional patterns
always start off-white. Round-trips via the field spread + 80-key rule (no Firestore rules change).

**Per-colour routing overrides (2026-07-22):** `pat.famRouting` = `{famIdx→mode}` lets individual colours (families) route with a different logic than the pattern's `routingMode`. `buildExpPath` partitions families by effective mode and routes each group with the normal single-mode logic, concatenated in `famOrder` position — additive, byte-identical without overrides (`route.js --check` verified; no engine fork, same reasoning as the v2 modes). Threaded through the opts param (`famRouting` next to `iso`): `expPathFor`, both CAD call sites, `route.js`. CAD UI: **▾** button next to the Routing dropdown (`#cadFamRoutingBtn`, `cadToggleFamRouting`) opens `#cadFamRoutingPanel` below the Live-Tiling canvas (built by `_cadBuildFamRoutingUI`, refreshed from `cadBuildFamBar`); state `cadFamRouting` keyed by **editor** fam indices, remapped via `_compactFamilies(...).map` on save (`_cadRemapFamRouting`, prunes entries equal to the base mode), restored in `editExpPattern`, reset in `remixPattern`/`showCAD` (`_cadSyncFamRoutingUI`). `_cadStitchSig` includes it. Round-trips via the field spread + 80-key rule (no Firestore rules change). The ▾ tints amber while overrides are active.

**Routing v2 modes are NOT an engine fork:** `zigzag2`/`waves2` are additive mode *values* dispatched from `buildExpPath` into a separate `buildExpPathV2` pipeline (`_isV2Mode`, section "Routing v2" in `experimental.js`; rules in ROUTING.md "Routing v2"). The four original mode values behave byte-identically (verified vs the golden snapshot), so no published pattern changes until a pattern is explicitly saved/published with a v2 mode. The gallery viewer additionally has a **view-only routing switcher** (`#galRoutingSel` in `#stitchViewBar`; `galSetRouting`/`_galRouteOverride`/`_expPathForView` in `experimental.js`) to preview any of the eight modes per pattern without saving; it resets on every pattern load (`_galResetRouting` in `loadPattern`) and also drives `_reloadExpWithTiles`, so the tile-count picker keeps the override. `buildExpPath` gained an optional 4th param `v2opts` (`{iso}`, threaded through `expPathFor`, the engine-1 wrapper and the CAD call sites) — only the v2 traditional family classification (H→V→diagonal→curves) reads it.

**>>> WHEN YOU CHANGE ROUTING, FORK FIRST:**
1. Copy the current `genTiledSegs` + `buildExpPath` + their private helpers (`buildStrokesForFamily`, `matchVertex`, `orderStrokesFamily`, `buildContourStrokes`, `_buildMotifPath`, …) to frozen `*_v1` versions — never edit those again.
2. `ROUTING_ENGINES[1] = {genTiledSegs:genTiledSegs_v1, buildExpPath:buildExpPath_v1}`.
3. Write the new algorithm as the live `genTiledSegs` / `buildExpPath`.
4. `ROUTING_ENGINES[2] = {genTiledSegs, buildExpPath}` and bump `ROUTING_ENGINE_CURRENT = 2`.

Every already-published pattern (stamped `routingEngine:1` or no field → 1) keeps v1; everything published afterward gets v2. The registry indirection is what makes the fork a mechanical copy-paste-rename of one block. (The headless `route.js` calls the bare functions directly, so it always measures the *current* engine — that's intended for iterating on new routing.)

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

## Register-card tabs + Filter System (2026-07-07)

The gallery front page is organised by **three register-card tabs** (`.gal-tabs`/`.gal-tab` in template.html,
`galSetTab` in gallery.js) — the old category dropdown (`#filtSelect`/`setFilterSelect`) is **gone**:
- **Traditional** (the standard, default-active tab) = built-in `PATTERNS` + published exp patterns that are **not**
  `community` (traditional-flagged OR unflagged — it's the catch-all so no published pattern hides).
- **Community** = published exp with `community===true`.
- **Sandbox** = **unpublished** exp patterns — the old full-screen `#myPatsView` overlay is **retired** and folded in
  here (its DOM stays in template.html but is never shown; the stray `getElementById('myPatsView')…remove('open')`
  calls are harmless no-ops). The **+ New Pattern** button (`#galNewBtn`) appears **only** on this tab.

`_galTab` (gallery.js, default `'traditional'`) drives `buildGallery`, which renders that tab's list — helpers
`_expTradList`/`_expCommunityList`/`_expSandboxList` (all skip `_getDeleted`), and `_buildExpCard(pat,sandbox)`
(one card builder for both — sandbox cards add the 📌 Publish button + use `removeExpPattern`, published cards are
admin drag-reorderable). Tab labels carry live counts (`#galCountTrad` etc.). The register cards are deliberately
**prominent but not dominant** (compact, bottom-border accent on the active one). `rebuildMyPatsView()` is now a thin
shim → `buildGallery()`+`filterGallery()`, so every old save/publish/delete caller still works.

**Nav round-trips restored to the right tab:** `openExpPattern` sets `_animSource` from `_galTab` (sandbox vs not);
`showGallery` re-shows `#galleryView` and calls `galSetTab(_galTab)` (sandbox source → sandbox tab); `showCAD` /
`showGalleryFromCAD` return to the pattern's tab (gallery source) or the Sandbox tab (`_cadSource!=='gallery'`).

**Within a tab: search + checkbox filters (2026-07-11).** The toolbar keeps the search box (`#searchInput` →
`filterGallery`) plus a row of **filter checkboxes** (`.filt-checks` in template.html, state `_galFilters`
in gallery.js, all **checked by default** = show everything; handler `setGalFilters` reads them). Two groups:
- **Shape** — `Angled` (`#filtAngular`) / `Curved` (`#filtCurved`), visible on **every** tab.
- **Technique** — `Sashiko` (`#filtSashiko`) / `Embroidery` (`#filtEmbroidery`), visible **only on the
  Community tab** (`galSetTab` toggles `#fcSashiko`/`#fcEmbroidery` display; Traditional/Sandbox show only the
  shape pair). Technique = `pat.embroidery` (true → embroidery, else sashiko); it only narrows the Community tab.
Multiple boxes can be on at once; a card shows when its shape's box AND (on Community) its technique's box are
checked. The old shape dropdown (`#shapeSelect`/`setShapeFilter`/`_shapeFilter`) is replaced; the old
`activeFilters`/`setFilter`/`_filtKey`/pass-count machinery was already removed.

**Shape = curved vs angular (auto-derived, no tagging).** `window.patIsCurved(pat)` = `pat.lines.some(l=>l.arc)`
(experimental.js; safely `false` for built-ins with no `.lines`). The published set splits cleanly — arc-fraction is
~1 or ~0, never ambiguous — so a pattern with any arc reads "curved/round", everything else "angular". Search also
matches the shape words.

**Admin gallery ordering (drag-to-reorder).** Published exp cards carry a numeric `pat.order` (lower = earlier).
`buildGallery` sorts the published set by `_expGalleryOrder` (order asc, then `createdAt` desc for any pattern
without one — the old newest-first default). When signed in as **admin** the whole card becomes `draggable`
(grab cursor via `body.is-admin`, no separate grip handle — dragging works anywhere on the card; `_updateAdminUI`
live-toggles `draggable` so no thumbnail rebuild on sign-in). Dropping runs `_onExpDrop` → renumbers the whole published set to dense indices and `_pushToFirestore`s
each pattern whose `order` actually changed (first curation = one write per pattern; later drags = a few). `order`
rides the field-spread + 80-key rule (no rules change) and — like all published-pattern writes — is **admin-gated
by the Firestore rules**: a non-admin can't drag (not `draggable`) and even a forced write is rejected server-side.
**Engagement sorts first (2026-07-22):** hearts are now GLOBAL — one Firestore doc per visitor under
`patterns/{id}/likes/{authUid}` (mirrors the comments model; **needs the `/likes` rules block in
`firestore.rules` deployed** — until then everything degrades gracefully to the old per-device localStorage
hearts). `_expGalleryOrder` sorts published cards by engagement score `3×hearts + 1×comments + viewBonus` — the view
bonus (2026-07-22) comes from `PATTERN_CLICKS` (30-day unique pattern opens; GoatCounter events `pattern/<id>`
tracked in `loadPattern`, refreshed **weekly** by `.github/workflows/weekly.yml` → `tools/stats/fetch-clicks.js`
→ `pattern-clicks.json` → build inject), log-scaled + capped (`min(4,floor(log2(views/8+1)))`: 8 views ≈ 1
comment, ~56 ≈ 1 heart) so a much-viewed pattern low in the list catches up while top-card click advantage
saturates. The same weekly workflow also opens the photo-review issue. The About dropdown shows `≈ N visitors
per day` from GoatCounter's public counter endpoint (`_loadAboutVisitors`, download.js; fetched on first open,
hidden on failure)
(`_engagement` in gallery.js; counts cached in `_likeCounts`/`_commentCounts`, prefetched by
`_refreshEngagement` after the Firestore fetch, re-sorting via `_resortGalleryIfChanged` only when the
visible order actually changed): equal hearts → comments break the tie; a commented zero-heart pattern
outranks a silent one; one heart outweighs two comments. The admin drag order is the tiebreak within equal
scores (in practice: the all-zero majority), so curation still shapes the default layout. `_syncMyLikes`
pushes a device's pre-global local hearts to the cloud once (retries each session until the rules exist). **Editing preserves the
position (2026-07-22):** the edit branches of `cadSaveToLibrary`/`cadPublishToLibrary` MERGE the new save over the
stored pattern (`{...old,...pat}` + explicit id/createdAt/creatorId/published), so edit-invisible fields — the
`order` sort key, `remixOf`/`remixes` links, the original `creatorId` — survive a re-save; before this, re-saving
dropped `order` and the card jumped to the un-curated createdAt tail.

**Community patterns.** The CAD header stacks a **Community** checkbox (`#cadCommunity` → `cadUpdateCommunity`)
**below** Traditional (`.cad-flags` column); checking it reveals an optional name field (`#cadCommunityName`,
`cadUpdateCommunityName`) in the space beside it. The field toggles **`visibility`** (not `display`) so it keeps
its reserved width and the Save button never shifts. **Traditional and Community are mutually exclusive** —
checking one clears the other (in both `cadUpdateTraditional`/`cadUpdateCommunity`). Saved as `community:bool` +
`communityName:string` on the pattern (round-trips via `_pushToFirestore` spread +
the 80-key rule — no rules change). **The name field also shows for Traditional patterns (2026-07-22):**
`_cadSyncCommunityUI` reveals `#cadCommunityName` when `cadCommunity||cadTraditional`; saves keep the name
under the same `communityName` key for either flag (empty when neither is set). **Cards credit contributors only on the Community tab** (`.pcard-by` in `_buildExpCard` + `expCardHTML`:
`by <name>`, community + non-empty name only). Traditional patterns show their `added by: <name>` **only in
the pattern DETAIL view** (appended to the `#animTitle` subtitle in `loadPattern`, render.js) — the traditional
gallery grid stays focused on the patterns; the name is never mandatory. `editExpPattern`/`remixPattern`/`showCAD` restore or reset the fields via `_cadSyncCommunityUI()`
(cad-engine.js). Search also matches `communityName` (and `embroidery` for embroidery-flagged patterns).

**Embroidery = community-only single-motif flag (2026-07-11).** Checking Community also reveals an optional
**Embroidery** checkbox (`#cadEmbroidery` in `#cadEmbroideryWrap`, `visibility`-toggled like the name field;
state `cadEmbroidery`, handler `cadUpdateEmbroidery`, synced/restored via `_cadSyncCommunityUI`). Meaning: the
drawing is a **standalone motif, never tiled/repeated** — every surface shows exactly ONE instance:
- **CAD editor:** `_cadTiles()` (cad-engine.js) = `cadEmbroidery?1:cadPatMacro` drives `_cadRefreshTiling`,
  `_cadStitchScene` and `cadTilePlay`; the colored `cadDrawPattern` renders a single `_renderAt(0,0)` (no
  offset loops, so no iso diamond-corner spillover either). The Tiles stepper (`#cadTilesCtl`) shows `1×1`
  and is greyed/inert (`_cadSyncTilesLabel`) while embroidery is on. Unchecking Community (or checking
  Traditional) clears the flag and restores tiling.
- **Routing/geometry:** `genTiledSegs` (experimental.js) has an additive `pat.embroidery` branch that emits
  exactly one untiled instance. No pre-existing pattern carries the flag, so tiled output is byte-identical
  for everything else — same additive reasoning as the v2 routing modes, **no engine fork** (`route.js --check`
  verified unchanged).
- **Gallery viewer:** `loadPattern` (render.js) forces `_tileCells=1` and hides the tile-count picker
  (`#tileCellsCtrl`) for embroidery patterns.
- **Saved as** `embroidery:cadCommunity&&cadEmbroidery`; `patMacro`/`thumbCells` are stamped at 1 tile
  (`_cadTiles()`) so thumbnails/layout open at natural single-motif scale. Round-trips via the field spread +
  80-key rule (no Firestore rules change). `remixPattern` carries the parent's flag (re-applies once the
  remixer re-checks Community); `showCAD` resets it.

**Pass count is automatic.** Each card's `data-p` = number of stitch families ("passes"):
- Built-in: `pat.passes.length`.
- Custom (exp): `expFamilyCount(pat)` (in `experimental.js`, exposed on `window`) — counts the pattern's
  saved `families` (flat `famIdx`/line or grouped `[lines]` form), or derives them via
  `detectSymmetryFamilies(pat)` when none are saved. Same families `genTiledSegs`/`buildExpPath`
  colour by, so the filter always reflects what's actually stitched — no manual tagging.

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
- **Arc tool sweep is continuous (2026-07-05):** click centre → click radius → then **move** the mouse to sweep the arc (the sweep is *accumulated* in `pointermove` as the cursor circles the centre: `cadArcSweep` += per-move angle delta, `cadArcPrevAng`) → click to finish. So the arc can be **any size** (incl. >180°) and closes a **full circle whichever direction** you sweep — `cadGenArcSweep(center,start,sweep)` builds it from the signed accumulated angle (snaps to ±2π near a full turn), replacing the old shortest-path `cadGenArc(center,start,end)` at the preview + finalize call sites. `cadArcSweep` resets on tool switch / Esc / finish. Partial arcs still supported; still click-based (3 clicks: centre, radius, finish).
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

### CAD Editor Layout / UX
- **Header:** name input (`#cadPatName`, placeholder **"Unnamed pattern"**, starts empty) + **Traditional** checkbox (`#cadTraditional`, moved here from the settings bar) + Save / Publish. Save & Publish **require a name** — empty → `alert('Please name your pattern…')` and the field is focused; no silent "Custom Pattern" default.
- **Both panels** (Draw + Live Tiling) put their pre-canvas controls in a `.cad-panel-head`; `cadAlignHeads()` (called from `cadInit` + on window resize) measures both and sets a shared min-height to the taller, so the **two canvases line up** (same top, same size) regardless of how the toolbars wrap.
- **Left-panel toolbar** is grouped with `.cad-tool-sep` dividers: **draw tools** (Draw/Arc/Cut/Color) · **move + transform** (the Move ↑↓←→ arrows — now inline in the toolbar via `.cad-move-inline`, not a panel below the canvas — plus ↻ 45° rotate and ◇ 45° tiling) · **actions** (Undo/Clear/Reset). Undo sits in this toolbar directly above the Draw canvas.
- **Live-Tiling toolbar** is likewise grouped (Play + speed · Stitch-view toggle). The realistic-stitch controls (`#cadStitchControls`) sit **below** the canvas (so toggling them never shifts the canvas). Stitch length is a **+/− stepper** (`cadStepStitchLen`, range 1–40, default 8, number in the middle), not a slider. The **Hub** fine-tune slider is removed from the CAD UI (HTML commented out; `cadSetHubScale`/`_starHubScale` kept in code). The gallery Advanced popover uses the same stitch stepper (`galStepStitchLen`).
- **Leaving the editor** (`showGalleryFromCAD`, used by both gallery and sandbox back) calls `_stopTilePlay()` first, so any running tile-play animation is stopped + reset.
- **Thumbnail preview widget was removed** (2026-07-05) — see the dated note under "Tiles = literal N×N". The card thumbnail is generated automatically on save; no live preview in the editor.

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
- `removeExpPattern` (in `experimental.js`) removes from `EXP_PATTERNS`, records the id in `sashiko_deleted`, and calls `_deleteFromFirestore`
- **Delete = shared tombstone, NOT a hard delete.** `_deleteFromFirestore` writes `{deleted:true,deletedAt}` (merge) instead of `.delete()`. Why: a hard delete only removes the cloud doc; any *other* device still holding a stale local copy sees it "missing from remote" on its next `_fetchFromFirestore` and **re-uploads it** (the local→remote "new pattern" push), resurrecting it for everyone — and `sashiko_deleted` is per-device localStorage, so the old tombstone never travelled. Fix: the tombstone lives in Firestore, so `_fetchFromFirestore` (a) folds remote tombstone ids into local `sashiko_deleted`, (b) marks **every** remote id `seen` (even tombstoned) so the local→remote push can't re-create it, (c) never re-pushes an id in the deleted set, and (d) drops tombstoned patterns from `EXP_PATTERNS`. `_seedLocalFromBackup` also skips `deleted`/tombstoned ids. NB: patterns hard-deleted before this fix and since resurrected just need deleting once more (now creates a tombstone).
- The old trash system (1-week retention, Restore, `sashiko_trash`) was removed

### Firebase auth & security (`firestore.rules`)
- The Firebase web `apiKey` in `experimental.js` is **public by design** (it ships in `index.html`); it identifies the project, it does not grant access. Don't rotate it; GitGuardian flagging it is a false positive. The real boundary is the Firestore rules.
- **Two-tier auth** (`firebase-auth-compat`): everyone gets an **anonymous** session (so the open sandbox stays writable); the owner signs in with **Google** to become **admin**. `_initFirebase`'s `onAuthStateChanged` keeps a session alive (re-anon when signed out, never clobbers a Google session), tracks `_authUid`, and sets `_adminUser` when the session is non-anonymous. `_authReady`/`_awaitAuth` (4 s cap) gate writes. `_ensureAdmin()` prompts Google sign-in (`signInWithPopup`); `adminLogin()`/`adminLogout()` toggle it; `_updateAdminUI()` toggles `body.is-admin` and the **Admin login** button.
- **Model = gallery is the protected asset, sandbox is open.** Sandbox (unpublished) patterns: any signed-in visitor can create/edit/tombstone. Gallery (published) patterns + **publishing**: admin only. Client gates: `cadPublishToLibrary` and gallery `deletePattern` require `_ensureAdmin()`; `editExpPattern` requires admin only when `pat.published` (sandbox edits stay open). Gallery `#pgrid` edit/delete buttons + the CAD **Publish** button are CSS-hidden unless `body.is-admin` (the `#myPatsView` sandbox keeps its own controls).
- **`firestore.rules`** (deploy via console paste or `firebase deploy --only firestore:rules`; enable Console → Authentication → **Anonymous** AND **Google**): public read; `create` needs auth + valid + (unpublished OR admin); `update` needs `isAdmin()` OR (auth + valid + stays-unpublished) — so only admin can publish or touch a gallery pattern; **`delete: if false`** (deletes are tombstone *writes*, collection can't be wiped). `isAdmin()` = verified Google email in the allowlist (paste your address; rules are server-side/private so it isn't exposed). `creatorId` is attribution only now (not enforced).
- The old client-side admin password `'111'` is **gone** — replaced by Google sign-in + rules.
- **Client admin UI is gated on `ADMIN_EMAIL_HASHES`** (experimental.js) — the SHA-256 hash of the admin Google e-mail, so the e-mail itself is never in the public client. `_verifyAdmin(user)` hashes `user.email` (`_sha256hex`) and sets `_adminVerified`; `_isAdmin()` = signed-in Google account AND `_adminVerified`. Anyone can *authenticate* with any Google account (that's how Google sign-in works), but non-admins don't see the admin UI and `_ensureAdmin` signs a non-allowed account back to anonymous. To set yours: deploy, "Admin login", run `sashikoAdminHash()` in the console, paste the printed hash. While the placeholder remains it's "unconfigured" → any Google sign-in shows admin UI (so you're not locked out before setting it). The CAD **Publish** button's visibility is set inline by `cadBuildFamBar`/`_updateAdminUI` (admin && !published), not just CSS. The **plaintext** e-mail lives only in the private server-side `firestore.rules` (`isAdmin()`), never in the repo. `sashikoMigrateNames()` (admin, console) rewrites stored names to the "Japanese / English" slash format.
- **CAD stitch-view grid is its own function** (`_cadEditorGrid`, cad-engine.js), SEPARATE from the gallery's `_cadDrawStitchGrid` — change one without affecting the other. The editor grid covers the WHOLE 500px canvas (range found by inverse-mapping the canvas corners via `tf.s2g`) and the editor draws stitches at **full contrast** (the subdue-under-grid 0.4 alpha is a **gallery-only** feature). Both static (`_cadDrawStitchStatic`) and Play (`_renderTileFrame`) use it.
- **Pattern names display as "Japanese / English"** via `_displayName()` (gallery.js): `"Romaji (English)"` and `"Romaji · English"` → `"Romaji / English"`; names without a pairing untouched. Display-only (stored name unchanged); applied in `buildGallery`, `expCardHTML`, and the exp animation title.
- **Sync conflict resolution uses `updatedAt`, NOT `createdAt`.** Editing a pattern preserves `createdAt`, so it can't distinguish an edited remote doc from a stale local/embedded-backup seed (`SEED_PATTERNS`) with the same `createdAt`. `_pushToFirestore` stamps `pat.updatedAt=Date.now()` on every save; `_fetchFromFirestore` keeps the local copy only if it is **strictly newer** (`local.updatedAt||createdAt > remote.…`) — so on a tie the remote (shared truth) wins and the backup seed can't override live edits. (Bug symptom before the fix: edited patterns like Jūji/Komesashi reverted to their old saved cell count / `thumbCells` in the gallery thumbnail.)

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
- Controls appear only when ON (`#cadStitchControls`, below the canvas): **Stitch length** +/− stepper (`cadStitchLen` px, range 1–40, default 8) and **Ratio** dropdown (`cadStitchRatio`, stitch : pause) — `CAD_STITCH_RATIOS` = Standard 3:1 (default, gap ≈ ⅓ stitch), Relaxed 2:1, Long 3:2, Even 1:1. **The fabric grid is always on in the Live Tiling stitch view and looks exactly like the gallery object** (`_cadDrawStitchGrid(...,dotsOnly=true)` = plain-white dots, every grid unit + larger at `CAD_MICRO`, no lines; threads toned to 0.4 so the grid reads as foreground). There is no Grid checkbox. `cadStitchGrid`/`cadToggleStitchGrid` are retained but unused by the always-on Live-Tiling grid.
- **Saved stitch params are restored on load.** `stitchLen`/`stitchRatio`/`stitchView`/`stitchGrid` are saved on the pattern; `editExpPattern`/`remixPattern` restore them into `cadStitchLen`/etc. and `showCAD` resets them to defaults, all via `_cadSyncStitchUI()` (reflects state → the `#cadStitchToggle`/`#cadStitchLenVal`/`#cadStitchRatio` controls). Without this, re-editing reset the stitch params to defaults and the next save overwrote the saved values (the gallery viewer already restored them via `render.js`, but the editor did not).
- **Round-cap inset:** stitches use round line-caps (puffy thread look), which add `w/2` past each drawn endpoint; `_cadLayStitches` insets the drawn endpoints by exactly `_cadStitchW()/2` so the *visible* thread spans the intended stitch length and the gaps match the chosen ratio (without this, every gap reads shorter than the stitch).
- **Sashiko junction rules** in `_layStitches(strokes, len, ratioKey, w)` (the shared engine): running stitches are laid by arc-length; clearance at each junction is decided by its **ray count** (number of distinct incident directions, 12° buckets). A **node graph** is built (grid-clustered, `mergeR=max(0.5·L,5)`) from stroke endpoints + sharp corners (turn > `CAD_STITCH_CORNER` 35°) + crossings (`_segCross`, inclusive of shared vertices). For each node, every nearby segment (`_segNear`) adds its direction(s) → ray count `R`:
  - **`R=2` corner (rays at an angle) → asymmetric**: exactly ONE stitch touches the corner — the incoming arm REACHES it (the thread dips down on the corner, crisp "I"), then a normal standard gap `G` before the next stitch on the other arm. Per-anchor `clrL`/`clrR` (gap before the starting sub-run / after the ending sub-run): in-stroke corners set `clrL=G,clrR=0`; corners formed by two separate strokes meeting at a node are fixed in a post-pass (`endAnch`/`byNode`) — the ending arm reaches, the others gap. `R=2` collinear (straight pass) and `R=1` (free end) just reach (clearance 0).
  - **`R=3–4` = X crossing / T-junction → `cCross=max(0.35·L, 0.9·w)` each side** (gap ≈ 0.7·L, ≥ thread width — perpendicular threads never touch).
  - **`R≥5` = star hub → radial `min(2.5·L, max(cCross, S·(0.36−0.06·ln R)·L/(2·tan(π/R))))`** where S = `_starHubScale` (default 1.0, tunable via Advanced→Hub slider). The `(0.36−0.06·ln R)` factor is calibrated from real patterns: 0.25 at R=6 (6-arm star), 0.20 at R=14 (Kamon). Hub slider is a final fine-tune multiplier.
  Anchors = endpoints + sharp corners + interior crossings (`aInt`/`bInt`), each tagged with its node's clearance; curve vertices are NOT nodes so curves keep long stitches. Each sub-run fits a whole number of evenly-spaced stitches between clearances; round-cap inset keeps gaps on-ratio.
- Shared helpers (all in `cad-engine.js`, hoisted so `render.js`/`experimental.js` can call them): `_layStitches`, `_buildStrokesFromPath(path,T)` (group routed segs into strokes via the `jump` flag), `_segCross`, `_segNear` (point-near-segment), `_ptAlong`, `_stitchW(len)`, `_cadDrawDenim(x,w,h)`, `_cadDrawStitch(x,s,w,color)`, `_cadDrawStitchGrid(x,scene)`. Denim baked once in `_cadDenimBuf`. Colours `CAD_DENIM`/`CAD_YARN`.
- **CAD pipeline:** `_cadStitchScene()` mirrors `cadTilePlay`'s pat build → `genTiledSegs`/`buildExpPath`/`filterVisiblePath`/fit → `_buildStrokesFromPath` → `_cadLayStitches` (= `_layStitches` with cad params). Cached by `_cadStitchSig()`. `cadDrawPattern` (static) and `_renderTileFrame` (Play) branch on `cadStitchView`.
- **Gallery animation viewer** (`experimental.js` `renderExp`): stitch view is the **standard and only** view for custom (exp) patterns — `galStitch` is forced true on load; there is no coloured-line view and no on/off toggle. `#stitchViewBar` (shown when `isEXP`) has two popover buttons: **🎨 Thread colours** (`galToggleColours`) and **⚙ Advanced** (`galToggleAdv`, length/ratio/grid). The jump bar is empty for exp.
- **Tile count is scale-only (static stitches):** the tile-count picker (`stepTileCells` ± in render.js, 1–8) just changes how many cells fill the canvas — it must NOT change the number of stitches on a given line. Stitch length is expressed in grid units relative to `EXP_szRef` (the layout scale `sz` frozen at the pattern's natural `patMacro`, set in `loadPattern`). `setupExpCanvas` tracks the current scale in `EXP_sz`; `_galStitchScene` lays stitches at `len = galStitchLen · EXP_sz/EXP_szRef` (width via `_stitchW(len)`), so more tiles → smaller cells → proportionally shorter stitches → identical per-line stitch count. The whole scene scales uniformly. `renderThumb` saves/restores `EXP_sz`/`EXP_szRef` and forces ratio 1 (thumbs render at natural scale).
- **Grid overlay = CAD draw grid (dots only):** the **Grid** toggle (`galToggleStitchGrid`/`galStitchGrid`) calls `_cadDrawStitchGrid(...,dotsOnly=true)`, which in dotsOnly mode draws a **plain white** dot at **every grid unit** (sub) plus larger dots at each `CAD_MICRO` cell point — the exact resolution of the CAD draw canvas (`cadBakeLeft`), so the gallery grid is the same grid the pattern was drawn on (no lines). The CAD stitch-view grid keeps the coarser `M/2` blue-ish sub-grid. In grid (or draft) mode the threads are toned down to **0.4 alpha** so the white dots / draft lines read as the foreground.
- **Draft mode** (`galToggleDraft`/`galDraft`, **Draft** checkbox next to Grid): drafting help lines for makers. Draft brings the white dot grid along (`overlay = galStitchGrid||galDraft` decides whether the grid is drawn) but **stitches render at full opacity** (only *grid* mode tones the threads to 0.4). `_galDrawDraft()` overlays the help lines in pale white (`zlw(0.7)`): straight guides are drawn **ruler-style** — each line extended right across the frame via `_clipInfiniteLine` and de-duped per infinite line — and **every arc recovered as its FULL circle** (so the maker drafts the whole circle, then stitches only the arc). `_galDraftShapes()` tiles via `genTiledSegs({...curPat,patMacro:_tileCells})`, groups segs by `aid` (arc id), and fits each group's circle with `_circumcircle(pts[0],pts[1/3],pts[2/3])`; cached by `EXP_path` ref (`_galDraftCache`). **Grid and Draft are mutually exclusive** (each toggle clears the other). Reset to off per pattern load; `renderThumb` saves/restores `galDraft` and forces it off for thumbs.
- **Thread-colour preview** (`#galColours`): optional — paint each family a thread colour so users can preview stitching in colour; default is all off-white (`CAD_YARN`). Tab order (`galSetPalette`): **↺ All white** (reset, `galResetColours`) · **Sashiko** (default, `galPalette='sashiko'`) · **Pastel**. **Sashiko** = `GAL_SASHIKO` (hex list), the full **Olympus Sashiko Thread** #42 lineup — 40 colours in `OLYMPUS_SASHIKO` (`{code,name,hex,brand:'olympus'}`, the **official catalogue names + hex codes** from olympus-thread.com #42). `brand:'olympus'` + the `OLYMPUS_HEXES` set are internal-only (for future filtering). **Pastel** = `GAL_PASTEL` (`{name,hex}`, a soft-but-not-too-pale named set). `_galPaletteArr()` returns `{hex,name}` for the active palette. A fixed palette is the right picker here, not a free colour wheel. **Names without bloat:** the 40 swatches stay compact circles; each swatch's name (Sashiko shows `#code Name`) is the `title` tooltip and updates a single live caption (`#galSwName`, `_galSetSwName`) on hover/selection — no per-swatch labels. UI = family chips (`#galFamChips`, click to pick the active family) + a swatch row (`#galSwatches`, off-white reset + palette) + the name caption → `galApplyColour(hex|null)`; `galResetColours()` clears all. State: `galThreadColors{fam→hex}`, `galPalette`, `galActiveFam` (reset per pattern). `_cadDrawStitch(x,s,w,color)` takes the per-family colour. Defaults still read saved `stitchLen`/`stitchRatio`/`stitchGrid`. Scene via `_galStitchScene()` (`EXP_path`+`EXP_g2s`, cached by path ref + len/ratio); animation shows the first `round(N·step/TOTAL)` stitches. Grid overlay uses `EXP_uRange`/`EXP_vRange`.
- Play animation uses `requestAnimationFrame` (`_tpLoop` / gallery `tick`) — rAF is throttled in hidden/headless tabs, so Play can't be observed in the preview harness, only the synchronous static/full render.

## Download / About / misc UI (`src/download.js`)
- **Gallery header:** big `.g-title` (32px) + a deliberately **subtle** `About this library ▾` link (`toggleAbout`, `.about-toggle` borderless/muted) under the title, expanding the mission + donation blurb (`#aboutBody`).
- **Bottom action bar** (`#actionBar`, single centred flex row): **Download · Remix · ♥ Heart · Comments**, in that order. The Download dropdown (`#downloadBar` / `toggleDownloadMenu`: **Animated GIF**, **PDF** one-page A4 sheet, **STL** placeholder) sits first; **Remix + Heart** are injected into `#likeRow` by `renderLikeButtons` (moved OUT of the top `.back-row` — detail order is now Remix then Heart; `#likeRow` shows only for exp patterns); the **Comments** button is last. `.action-bar .like-row{margin-left:0}` overrides the card-view `margin-left:auto`.
- **Comments** (`#commentBtn` / `toggleCommentMenu`): NOT a popover — clicking expands the **inline `#cmPanel`** (`position:static`) **below** the action bar (caret ▾/▴). Panel = photo strip (`#cmPhotos`, see next bullet) + scrollable list (`#cmList`) + handle input (`#cmHandle`, persisted to `localStorage.sashiko_handle`) + comment textarea (`#cmText`) → **Post** (`postComment`). Stored per-pattern in Firestore subcollection **`patterns/{id}/comments/{cid}`** = `{id,handle,text,created,uid}` (`_fetchCommentsFromFirestore`/`_saveCommentToFirestore`/`renderCommentList`/`_loadComments` in experimental.js; `_resetCommentBar` called from `loadPattern`).
- **Pattern photos (2026-07-22, no Firebase Storage needed):** visitors can attach ONE photo of their stitched piece per pattern — stored as a **compressed base64 JPEG inside a Firestore doc** `patterns/{id}/photos/{authUid}` = `{uid,handle,data,created,approved}`. Anti-junk design: the doc id **must equal the uploader's auth uid** (rules-enforced → hard one-photo-per-person cap; re-upload replaces) and `data` is capped < 400 KB in the rules. **Post-moderation (owner decision):** photos show **immediately** for everyone — `approved` is NOT a display gate but the admin's **archive flag**: only ✓-ticked photos enter the monthly git backup (`backup/photos/<id>.json`, uid stripped; git history is forever, so nothing unreviewed gets baked in). Rules still force `approved:false` on non-admin writes. Instead of routine checking, the weekly Action (`weekly.yml` → `tools/stats/check-photos.js`) opens a **GitHub issue** (label `photo-review`, → e-mail) while unreviewed photos exist — one open issue max, close it after handling. Client pipeline (`experimental.js`): `pickPhoto`→`cmPhotoChange`→`_compressPhoto` (canvas downscale ≤1000 px, JPEG quality stepped down until < 280 KB dataURL); strip UI `_renderPhotos` in `#cmPhotos` at the top of the comments panel (admin sees unarchived photos marked + **✓ keep**; ✕ delete for owner/admin), fullscreen `#photoLightbox` on click. The 📷 button hides itself (probe read) until the **`/photos` rules block is deployed** (firestore.rules). **Requires a `firestore.rules` redeploy** (`match /comments/{cid}`: public read; signed-in create with text≤500/handle≤40; **delete if author (`request.auth.uid == resource.data.uid`) or admin**; admin-only update) — until deployed, reads/writes/deletes are denied.
- **Delete your own comment** (`deleteComment(cid)` / `_deleteCommentFromFirestore`): each comment stores the author's `uid` (`_authUid`, the persistent anonymous-auth uid); `renderCommentList` shows a ✕ (`.cm-del`, right-aligned in `.cm-item-head`) only when `c.uid===_authUid` (or `_isAdmin()`), and deleting **hard-deletes** the Firestore doc so it's gone for everyone. Hard delete is safe here (comments aren't cached+re-pushed locally like patterns, so no tombstone/resurrection needed). Ownership is enforced **server-side** by the `allow delete` rule above — a non-author can't delete even by forging the call. NB the author link is the browser's anonymous uid: clearing site storage or switching device mints a new uid and forfeits delete rights on old comments (admin can still remove them).
- **Comment count badge** on gallery/sandbox cards: a **`💬 N`** span (`.cm-count`) shown next to the `♥` heart in each exp card's `.like-row`, **only when N>0** (matches the heart). `_commentCounts{id→n}` caches per-pattern counts; `_fetchCommentCount(id)` uses a `.count()` aggregation when available, else falls back to `.get().size` (**Firebase 9.23 compat here has NO `.count()`, so the fallback fetches the comment docs** — fine at current volume, sparse comments). `_renderCommentBadge(id)` (called from `_buildExpCard` via `setTimeout`) fetches+caches then re-runs `renderLikeButtons`. The detail Comments button label also shows the count (`#cmBtnLabel` → "Comments (N)"), refreshed on load and after Post (which busts the cache).
- **PDF export** (`downloadPDF` → `_buildPDF`): a printable **single A4 page** for a custom pattern, **print-friendly = no dark filled areas** (all windows on white). Layout: two equal-size main windows side by side — **Pattern** (`_pdfStitchWindow`: **white** paper + dark dot grid + the running stitches as **dark ink dashes**, drawn from `_galStitchScene()`; a family with an assigned thread colour keeps a print-darkened version via `_pdfInk`, else dark navy — deliberately **not** the denim/fabric view) and **Drafting lines** (`_pdfDraftWindow`: the **same content the gallery Draft toggle shows, but as lines** — dot grid + `_galDraftShapes()` ruler-extended straight guides + every arc as its **full pre-drawn circle** (weak) + the stitch-path lines **highlighted** on top; *not* the individual stitches) — then, only when the pattern has **≥2 families**, a row/grid of smaller **pass windows** (`_pdfPassWindow`, one per family, lines in a print-darkened family colour). `_pdfPassLayout` fits all passes + labels on the page. Windows render to an offscreen canvas (anim coords 0..SIZE, supersampled ~3×) → embedded as **JPEG image XObjects** (DCTDecode). Footer + subtitle carry **`sashikolib.org`**. Non-custom patterns fall back to a single centred snapshot. Written by hand in `_pdfSerialize` (Catalog·Pages·Page·Contents·Helvetica·N images; correct xref; titles ASCII-folded via `_pdfAscii`) — **fully self-contained, no library**. Verified across 1/2/4/12-family patterns + Seigaiha (draft circles); white bg confirmed (corner pixel 255,255,255).
- **Fabric picker** — a curated set of sashiko cloths `SASHIKO_FABRICS` (cad-engine.js: **Indigo, Midnight, Black, Slate grey, Natural, Kakishibu**), each baked once into a 500×500 woven texture (`_bakeFabric`, cached in `_fabricBufs`; twill sheen + fibre speckle + vignette tuned to cloth lightness). `_drawFabric(x,id,w,h)` replaces the hard-coded denim in the **gallery viewer only** — the CAD editor, thumbnails **and the (print) PDF** do not use it. State `galFabric` **persists across pattern loads** (an aesthetic preference, unlike per-family thread colours). The **thread keeps its true colour on any cloth** — `_galDefaultYarn` is always off-white (`CAD_YARN`); we never silently recolour a thread for contrast (the user picks a darker thread themselves if they want more contrast on a light fabric). Only the non-thread overlays adapt: on a **light** cloth (`_fabricById(galFabric).light`, e.g. Natural) the dot grid + `_galDrawDraft` guides draw **dark** (`_cadDrawStitchGrid(...,dark)`). Not saved to the pattern.
- **Gallery stitch-view bar** (`#stitchViewBar`) is now: **`🎨 Color ▾`** popover · a compact **Off · Grid · Draft** segmented control · **`⚙ Advanced ▾`**. The old per-pattern **routing test dropdown was removed from the gallery** (routing selection lives only in the CAD editor now; `galSetRouting`/`_galRouteOverride`/`_expPathForView` stay in code but the override is never set → gallery always uses the saved/pinned mode).
  - **Color popover** (`#galColorPop`, `galToggleColor`) has **two tabs, each with a little preview image**, **Thread first**: **Thread** (tab icon = the 🧵 spool emoji in the HTML; content = the sectioned thread panel) and **Fabric** (tab icon = the current cloth texture painted into a 20×20 canvas by `galBuildColorTabs`; content = the 6 fabric swatches, `galBuildFabricUI`). `galColorTab(mode)` switches; `galColorMode` (default `'thread'`) remembers the last tab.
  - **Thread panel** = one panel, palettes as **labelled sections** `Default`/`Olympus`/`Pastel` from `_galPaletteSections()` (extensible). Old palette tab buttons (`galSetPalette`) removed.
  - **Overlay** `galSetOverlay('none'|'grid'|'draft')` replaces the two checkboxes (`galToggleStitchGrid`/`galToggleDraft` removed); `_galSyncOverlaySeg` reflects state. `galToggleColor`/`galToggleAdv` share `_galClosePops` (one popover at a time).
- **GIF export** (`downloadGIF` → async `_buildGIF`): **one frame per stitch** (`_gifStitchCount` = exp stitch-scene count, else `TOTAL`), so every stitch is drawn one after the other; capped at `GIF_FRAME_CAP` (400 — above it the timeline is evenly sampled to 400, since tiled patterns can have thousands of stitches). **Streaming**: each frame is rendered off `cv` (zoom=1), quantised against a shared median-cut palette (`_medianCut`, sampled from ~24 representative frames) and LZW-encoded (`_lzwEncode`, Kevin-Weiner) straight into a list of byte chunks → `Blob([...chunks])`. Only the current frame's pixels are ever in RAM (flat memory regardless of stitch count). Runs async with `await` yields every 8 frames so the tab stays responsive and the Download item shows live % progress. Per-frame delay = `clamp(round(1200/F),3,7)` centiseconds (~12 s target loop). Restores the live zoom/step afterwards. Fully self-contained (no library/worker). NB: backgrounded/headless tabs throttle `setTimeout(0)` to ~1 s, so the preview harness encodes far slower than a real foreground tab.

## Tiles = literal N×N repeat count (2026-07-04)
The **Tiles** control (`cadPatMacro` in CAD, `_tileCells` in the gallery viewer) is a **whole tile-repeat count N** → an **N×N** tiling of the drawn motif. **Tiles=1 shows exactly one tile** (what's drawn on the left / the pattern's unit cell), filling the canvas.
- **Storage is unchanged — published patterns are byte-identical.** `pat.patMacro` still means *(micro-units across canvas)/10*; N is a UI concept only. Conversion helpers in `experimental.js` (just after `computeExpLayout`): `patTilePeriod(pat)` = motif tile size = `max(dU,dV)` of the bbox; `patMacroForTiles(pat,N)=N·period/10` (→ `computeExpLayout` `ptc=N·period` → N tiles); `tilesForPatMacro(pat)=round(patMacro·10/period)`. Exact inverses, so a pattern opens at exactly the N it was saved with and old patterns just get an **honest label** (the old `_tileCells=patMacro` label lied when `dU≠10`). **No routing-engine fork needed** — `genTiledSegs`/`computeExpLayout`/`buildExpPath` are untouched (`route.js --check` unchanged). Call sites converted: `render.js` (`loadPattern`, `_reloadExpWithTiles`, `stepTileCells` clamp 1..12), `experimental.js` (`_galDraftShapes`), `cad-engine.js` (`_cadStitchScene`, `cadTilePlay`, `cadUpdateThumbPreview`, `_cadRefreshTiling`), save (`patMacroForTiles`), load (`tilesForPatMacro`).
- **Colored Live-Tiling view** (`cadDrawPattern` + `cadBakeRight`): `ptc=cadPatMacro·period` (was `cadPatMacro·cadMacro·CAD_MICRO`), computed live in `_cadRefreshTiling(force)` (module var `cadPtc`; sig-guarded so it only re-bakes when the committed motif/settings change, not every draw-move). Square anchors top-left so Tiles=1 fills cleanly; iso is centred so Tiles=1 shows the central tile + natural diamond-corner spillover (inherent to a diamond tile in a square canvas). Stitch view / Play / thumbnail all use the same N via the conversion, so every surface agrees.
- **Grid & Tiles are readouts, not number inputs.** `#cadGridSizeVal` shows `(cadMacro·10)×(cadMacro·10)` (e.g. Grid=3 → "30×30"); `#cadPatSizeVal` shows `N×N`. `cadUpdateSettings` reads `cadMacro`/`cadPatMacro` from **state** (set by `cadStepMacro`/`cadStepPatMacro`/load), not the DOM. `_cadSyncGridLabel`/`_cadSyncTilesLabel` refresh the readouts.
- **Grid size now persists:** patterns store `gridMacro:cadMacro`; `editExpPattern`/`remixPattern` restore it as `min(12,max(1,ceil(maxDim/CAD_MICRO),gridMacro))` — **no more forced min-2** (the old `Math.max(2,…)` was why Grid=1 "flipped back to 2" on reopen). New Firestore field round-trips via the key-count rule (no rules change).
- **CAD Thumbnail-preview widget REMOVED (2026-07-05).** The `#cadThumbCanvas` preview + `cadUpdateThumbPreview` were deleted — the card thumbnail is generated automatically on save from the main draw canvas (`#cadCanvas.toDataURL`) and the gallery re-renders from geometry via `renderThumb`, so a live preview widget was redundant. `thumbCells:cadPatMacro` is still saved on the pattern (unrelated field). The `.cad-thumb-btn` class is kept — it's reused by the stitch-length ± steppers.

## CAD Live Tiling grid + sizing (2026-06-29/30)
- **Grid min = 1** for both **Grid** (`cadMacro`, `cadStepMacro`) and **Tiles** (`cadPatMacro`, `cadStepPatMacro`); steppers clamp 1..12. Auto-shrink floor lowered to 1 (empty canvas still defaults to 2).
- **Live-Tiling grid matches the Draw grid:** `cadBakeRight` now mirrors `cadBakeLeft` — per-unit sub-dots, larger dots at every `CAD_MICRO` point, and a grid line at every cell (was: coarse `CAD_MICRO`-only dots + tile-boundary lines). Per-unit sub-dots only baked when `cadPTile>=3`.
- **Stitches/line invariant to Tiles count (stitch view):** `_cadLayStitches(strokes, sceneScale)` rescales the stitch length to the grid (anchored to `cadBase`, the Draw-canvas px/unit) so changing the display size shrinks the stitches with the cells instead of dropping stitches. `_cadStitchSig` now includes `cadMacro`.

## 45° (rotated) tiling: even-period fix (2026-07-04)
The **◇ 45° tiling** toggle (`bboxRotated`) tiles the motif along the diagonal axes P=u+v, Q=u−v.
`genTiledSegs` steps each tile by `ou=(a·sP+b·sQ)/2`, `ov=(a·sP−b·sQ)/2`. Those offsets land on the
integer fabric grid **only when sP and sQ are even**; when odd, every "a+b odd" tile is shifted **half
a grid cell** off the dots — unstitchable tiles sitting between the holes (the "sometimes motifs are
shifted by 0.5 grid" bug). sP=extent+spacing, so an **odd spacing** flips an even motif to odd too
(that was Ishi Guruma: raw diagonal extent 16 + spacing 9 = 25 → half of its tiles off-grid).
- **Fix:** round each diagonal period **up to the next even integer** (`evenUp=x=>2*Math.ceil(x/2)`)
  in `genTiledSegs` (experimental.js, rotated branch) and in the CAD dashed-bbox guide (cad-engine.js).
  Adds ≤1 unit of diagonal spacing, never overlaps. Even-integer periods (e.g. Ajiro sP=12) are
  **unchanged → byte-identical**. Verified headless (`tools/routing/`): the only fixture whose output
  changes is Ishi Guruma (off-grid endpoints 1176→0; same stroke count, jump distances shift as tiles
  snap to grid). Non-rotated and even-period patterns untouched.
- **Engine note (deliberate doctrine exception):** this edits **engine v1 in place** rather than
  forking to v2 (contra "WHEN YOU CHANGE ROUTING, FORK FIRST"). Rationale: the affected pattern is
  **published** (pinned to v1), and a v2 fork can only fix *new* patterns — it cannot correct a live
  pinned pattern without a separate Firestore migration. The change is a pure geometry bug fix whose
  *only* effect on any published pattern is turning off-grid tiles into on-grid ones, so re-baselining
  v1 is correct here. Snapshot re-taken (`route.js --snapshot`).

## Stitch:gap ratios — verified correct (2026-07-04)
Audited `_layStitches` (`CAD_STITCH_RATIOS`: standard 3:1, relaxed 2:1, long 3:2, even 1:1). `G=L·g/s`,
then each span fits a whole number of stitches and rescales so **stitch:gap = s:g exactly**. Measured
against the real engine: straight strokes exact (3.00/2.00/1.50/1.00), curves within ~1% (only a
degenerate R=10 arc hits 14%), real patterns 100% on-ratio within a stroke. All renderers (gallery
`_cadDrawStitch`, PDF `_pdfStitchWindow`, CAD) use `lineCap='round'`, matching the `w/2` inset — no
butt-cap shortfall. The only sub-nominal thread coverage is the **junction keepout** (crossings/hubs
insert gaps larger than the ratio gap so perpendicular threads don't touch — full-scene coverage
67–69% vs nominal 75% on crossing-heavy patterns); that is the sashiko junction rule, by design.
Absolute stitch length can drift ±~8% from the set value (whole-number fitting) but the **ratio is
preserved**. No code change needed.

## Admin CAD toolbar rearrange (2026-07-05)
The CAD editor toolbars are **flattened** into two flat drag zones — `.cad-toolbar[data-dragzone="cadLeft"]`
(Draw/Arc/Cut/Color · separators · the Move cluster as one unit · Undo/Clear/Reset) and `[data-dragzone="cadRight"]`
(Play+speed cluster · Stitch-view toggle). Each tool is a direct child with a stable `data-did`. The group-wrapper
`<span>`s were removed except the compound clusters (Move/Play/Stitch stay single draggable units); spacing is
unchanged because `.cad-tool-group` and `.cad-toolbar` share `gap:6px`.
- **Row break item.** `sep2` is a `.cad-tool-break` (full-width `flex-basis:100%`) instead of a thin divider, so
  everything after it wraps to a new toolbar row at any width/zoom (the committed layout puts it before `cut`, pinning
  cut→undo to the last row). CAD tool padding/gap were trimmed (`6px 9px` / gap 5) so those 5 buttons fit one row in
  the ~424px panel. Browser zoom scales uniformly, so wrapping is zoom-invariant.
- **Drag-reorder is admin-only.** When `body.is-admin`, every `[data-did]` becomes `draggable`; dropping reorders
  it **within its own zone** (`_cadInitToolbarDrag`, insert-before/after by cursor half). `_updateAdminUI` live-toggles
  `draggable` via `_cadTbSetDraggable`. Non-admins can't drag; clicks still work (drag only starts on movement).
- **Global layout lives in the repo, NOT Firebase.** The committed `cad-toolbar.json` (`{cadLeft:[dids],cadRight:[dids]}`)
  is baked into the build (`<!-- INJECT:cad-toolbar.json -->` → `const CAD_TOOLBAR_LAYOUT`, mirrors `backup-patterns.json`)
  and applied on load via `_cadTbApply(CAD_TOOLBAR_LAYOUT)` — so **every visitor gets it** and only the repo owner can
  change it (a push). `_cadTbApply` reorders each zone's children to the saved `did` order (unknown/new dids keep their
  natural position). An admin's in-browser drag persists to a **localStorage draft** (`sashiko_cadtoolbar`, applied on
  top of the committed layout **for that admin only**). **Publishing is a commit, not a live sync** (browsers can't push
  to GitHub): the admin arranges, then clicks the admin-only **📋 Copy layout** header button (`#cadCopyLayoutBtn`,
  `.cad-admin-tool`, shown via `body.is-admin`; handler `cadCopyToolbarLayout` → `_cadCopyText` clipboard-with-execCommand
  fallback + always console-logs the JSON), pastes it into `cad-toolbar.json`, and pushes → CI rebuilds → everyone sees
  it. (`sashikoToolbarLayout()` is the console equivalent.) No Firestore/rules involved (deliberately simpler than the
  gallery's Firestore order, since this is a single-admin, rarely-changed, global setting).

## ◆ Diamond re-cut ("kitties" cut) — square grid only (2026-07-17)
`cadDiamondCut()` (cad-engine.js, button `#cadBtnDiamond` in the Move cluster) **REPLACES** the drawn
motif with its boundary-cut version: a copy shifted by the **integer half-period**
`(h,k)=(round(W/2),round(H/2))` is cut at the tile edges and lands in the corners; the original is
**removed** (user decision 2026-07-17 — the freed middle is for drawing the ALTERNATE motif of the
diamond arrangement; drawing the same motif back in the middle gives the classic one-motif diamond).
Like the traditional cat-face patterns: draw the face whole, the unit cell carries it cut through the
middle. One-shot geometry transform (Undo restores), applied to `cadLines`:
- Emits the four period-sibling offsets `(h,k)`, `(h−W,k)`, `(h,k−H)`, `(h−W,k−H)`, each **clipped to
  the tile bbox** (`_dcClipSeg` Liang-Barsky; `_dcClipArc` cuts arcs at the four infinite boundary
  lines and keeps inside sub-arcs — tested incl. negative sweeps, corner circles, tangent merge). The
  offsets differ by exactly one period, so adjacent tiles reassemble the pieces into a whole motif at
  every tile corner. Everything stays on-grid (integer h,k). NB a line parallel to the offset (e.g. a
  centre diagonal) maps onto its own line and visibly "stays" — correct, it's wrap-invariant.
- **Containment skip** (`_dcContainedSeg`/`_dcContainedArc`): a piece fully inside an already-kept
  piece is dropped (symmetric motifs map two source lines onto the same piece; keeping both would
  make `cadFindRedundant` drop BOTH at save time).
- A piece lying wholly ON a max edge is dropped (its congruent twin exists at the min edge).
- Applying it switches ◇ 45° tiling OFF (it would diamond the diamond).
- Square grid only: `cadUpdateSettings` hides the button on isometric; the function also guards.
- Caveat: if the pieces don't reach the old bbox edges (motif content invariant-free around the
  half-period lines, e.g. bars only at x=0 and x=W), the bbox — and thus the tiling period — shrinks.
  Rare; Undo restores.
- Purely a CAD-editor authoring action — no routing-engine change (`route.js --check` unchanged).

## Isometric view: round circles + screen-cardinal move arrows (2026-07-05)
The iso projection is anisotropic (`x=(u−v)cos30`, `y=(u+v)sin30`), which distorted two things:
- **Arcs rendered as ellipses.** Fixed in the arc flatteners: `_isoRoundArcPts(center,r,a1,a2,segs)`
  (experimental.js) places points at `center + invIso(r·(cosφ,sinφ))`, swept between the projected screen-angles of the
  arc's endpoints in the drawn direction, so `g2s(pt)` traces a TRUE round screen arc of radius `r`. `_flattenArc`
  (gains an `iso` param, passed from `genTiledSegs`) and `cadFlattenArc` (uses `cadGridType`) branch to it for **all iso
  arcs — full circles AND partial arcs** (2026-07-05: partial arcs added). A partial arc's endpoints land on the round
  circle (radius `r`), so they shift slightly off the `(u,v)` ellipse — fine for standalone arcs; a *connected* arc
  endpoint would move. Square grids and non-arc iso patterns are byte-identical (`route.js --check` unchanged; no
  fixture is iso+arc). Verified: iso circle + half-arc screen-roundness went 1.7 → 1.0. NB draft-mode circle recovery
  (`_galDraftShapes` `_circumcircle`) still assumes a `(u,v)` circle — a minor cosmetic gap for iso draft/PDF.
- **↑↓←→ moved the pattern diagonally.** `cadMovePattern` remaps in iso so the arrows move screen-cardinally with an
  on-grid step: vertical → `(±1,±1)`, horizontal → `(±1,∓1)` (`if(iso){if(du!==0)dv=-du;else du=dv;}`). Horizontal
  steps are √3× the vertical (inherent to the lattice); square grid unchanged.

The admin **📋 Copy layout** button now also pops a `window.prompt` pre-filled with the layout JSON (selected, so it
always copies with Ctrl/Cmd+C even when the async Clipboard API is blocked) — paste it to Claude or into cad-toolbar.json.

## Gallery grid phase — off-grid rotated motifs (2026-07-06)
A motif drawn then rotated (e.g. **Ishi Guruma**, via `cadRotate45`) stores **fractional (√2) coordinates**, so its
stitch vertices sit at a constant non-integer offset from the fabric grid. The **CAD editor** re-centres the bbox on an
integer grid point when it loads (`editExpPattern`: shift `gc−bboxCentre`, `gc=macroVal·CAD_MICRO/2` always integer),
which lands those vertices back on the dots — so it reads as **on-grid** there. The **gallery** anchored the dot grid at
plain integers (`u=0`), so the same vertices fell **between** dots — the pattern looked "shifted off the grid" even
though the geometry was identical.
- **Fix (display-only):** the gallery dot grid registers to the motif's own **grid phase**. `_galGridPhase(pat)`
  (experimental.js, after `computeExpLayout`) finds, per axis, the fractional offset the most stitch vertices share
  (clustered), gated so it only returns non-zero when a clear majority beats the integer grid — **integer-coordinate
  patterns and arc-noise patterns stay phase 0 (byte-identical)**. `renderExp` passes `{phaseU,phaseV}` into
  `_cadDrawStitchGrid`, whose dot loop shifts the lattice by that phase (main-dot test `round(u−phU)%M===0`). For Ishi
  the computed phase (0.657) equals the editor's `bboxCentre mod 1`, so **gallery now matches the editor exactly**.
- **NOT a geometry change** — `genTiledSegs`/`buildExpPath`/`computeExpLayout` untouched; nothing re-routes, no
  published pattern's stitches move (only where the *dots* are drawn under them). Only `_cadDrawStitchGrid` (gallery
  dotsOnly path) and the new helper. The CAD-editor grid (`_cadEditorGrid`) and PDF are unaffected. Verified live:
  Ishi Guruma on-grid, Yotsukumi Hishi (integer) unchanged. (`route.js --check` shows only pre-existing fixture drift,
  identical with/without this change.)

## Background sketch image in the CAD editor (2026-07-22)

**🖼 Image** button in the left toolbar (`data-did="bgimg"`, → hidden `#cadBgFile` input) loads a picture behind the Draw canvas for tracing contours. State in cad-engine.js: `cadBgImg` + position/size in **grid units** (`cadBgU/V/W`), so the image pans/zooms with the grid; drawn in `cadDrawWorkspace` right after the baked grid at low alpha (`cadBgAlpha`, default 0.22 — deliberately pale, pattern lines render at full contrast on top). **Moving:** Alt+drag on the canvas (free/fractional, `cadBgDrag` in the pointer handlers) or the nudge arrows in `#cadBgControls` below the canvas (0.5-unit steps); the controls row also has size −/+ (`cadBgZoom`), an opacity slider (`cadBgSetAlpha`, 5–60%) and ✕ remove. **Session-only**: never saved with the pattern, cleared by `showCAD` (New Pattern); the 🖼 button tints amber while an image is loaded (`_cadBgSyncUI`).

## Monthly Firestore backup → git (2026-07-22)

`tools/backup/backup-firestore.js` (public-read REST, no auth) snapshots every pattern doc **including
tombstones** into `backup/patterns/<id>.json` and each pattern's comments (anonymous `uid` stripped) into
`backup/comments/<id>.json`; deterministic output (sorted keys, no timestamps) so unchanged data = empty
diff. `.github/workflows/backup.yml` runs it on the **1st of every month** (+ manual `workflow_dispatch`)
and commits only on change — the git history is the backup timeline. No secrets involved; the collection is
public-read by design, and the backup carries no private data (see `tools/backup/README.md`, incl. manual
restore notes). NB GitHub auto-disables cron workflows after ~60 days without repo activity — re-enable via
the Actions tab if the repo ever goes quiet that long.

## Editor load centring is phase-aware (2026-07-22)

`editExpPattern` centres the motif with shift `s = round(gc−centre+φ)−φ` where φ = `_cadGridPhaseOf(pat.lines)` (cad-engine.js: majority fractional endpoint offset per axis, ≥50%-share gate). The old raw shift `gc−centre` was a **half-integer whenever the bbox extent was odd**, pushing the whole motif 0.5 off the dots on every editor open (19 of 85 live patterns affected). φ-aware snapping keeps 45°-rotated constant-phase motifs (Ishi Guruma) landing on the dots exactly as before, gives integer motifs an integer shift, and **auto-heals patterns that were saved half-shifted** by the old bug (the next save persists the healed coords). `cadMovePattern` (arrow keys) also cancels a detected constant off-grid phase along with the move — manual one-keypress fix for stale motifs; on-grid patterns are untouched.

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
