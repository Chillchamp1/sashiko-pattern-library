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
| `src/download.js` | Gallery "About" toggle; pattern-viewer Download dropdown (self-contained animated-GIF encoder; PDF/STL placeholders) | ~210 |

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

Metrics: `strokes`, `jumps`, `jumpLen`, `maxTurn` (sharpest in-stroke turn), `midArc` (strokes that start mid-arc — **must be 0**). `load-routing.js` loads the live `src/` functions (no copy-paste, can't drift). Fixtures in `test/patterns/` and the snapshot are committed. When a routing change is intentional, re-run `--snapshot`. The four routing modes are `default`, `continuous`, `contour`, `sequential` (see `ROUTING.md`); `route.js` tests all four (`MODES`).

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

Dropdown (`#filtSelect` → `setFilterSelect`): **All (0) · 1 · 2 · 3 · 4 · 5+ (value 5) · Traditional (trad)**.
`filterGallery` matches a card's `data-p` (pass/family count): exact for 1–4, `>=5` for the "5+" bucket;
`trad` matches `pat.traditional`. (Legacy `data-f` button values map the same way via `setFilter`.)

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
- **Live-Tiling toolbar** is likewise grouped (Play + speed · Stitch-view toggle). The realistic-stitch controls (`#cadStitchControls`) sit **below** the canvas (so toggling them never shifts the canvas). Stitch length is a **+/− stepper** (`cadStepStitchLen`, range 3–40, default 8, number in the middle), not a slider. The **Hub** fine-tune slider is removed from the CAD UI (HTML commented out; `cadSetHubScale`/`_starHubScale` kept in code). The gallery Advanced popover uses the same stitch stepper (`galStepStitchLen`).
- **Leaving the editor** (`showGalleryFromCAD`, used by both gallery and sandbox back) calls `_stopTilePlay()` first, so any running tile-play animation is stopped + reset.
- **Thumbnail preview** (`cadUpdateThumbPreview`) **always renders in stitch view** (forces `galStitch`/len/ratio from cad state, `EXP_sz=EXP_szRef`, then restores) — independent of the Live-Tiling Stitch-view toggle, so it matches the gallery cards. The −/+ control sets a **concrete cell count** (`cadThumbCells`, min 1, shown as "N cells" — no "auto"); it lazy-initialises to the natural fit count. Stepping the count **auto-grows the Tiles** (`cadPatMacro`, capped at 12) so the thumbnail always has enough tiled cells to fill. Saved as `thumbCells`.

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
- Controls appear only when ON (`#cadStitchControls`, below the canvas): **Stitch length** +/− stepper (`cadStitchLen` px, range 3–40, default 8) and **Ratio** dropdown (`cadStitchRatio`, stitch : pause) — `CAD_STITCH_RATIOS` = Standard 3:1 (default, gap ≈ ⅓ stitch), Relaxed 2:1, Long 3:2, Even 1:1. **The fabric grid is always on in the Live Tiling stitch view and looks exactly like the gallery object** (`_cadDrawStitchGrid(...,dotsOnly=true)` = plain-white dots, every grid unit + larger at `CAD_MICRO`, no lines; threads toned to 0.4 so the grid reads as foreground). There is no Grid checkbox. The **thumbnail preview** does NOT show the grid (it renders via the gallery path with `galStitchGrid=false`, full-opacity stitches). `cadStitchGrid`/`cadToggleStitchGrid` are retained but unused by the always-on Live-Tiling grid.
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
- **Download dropdown** at the bottom of the pattern viewer (`#downloadBar` / `toggleDownloadMenu`): **Animated GIF** (works), **PDF** + **STL template** (placeholders → "coming soon" alert).
- **GIF export** (`downloadGIF` → async `_buildGIF`): **one frame per stitch** (`_gifStitchCount` = exp stitch-scene count, else `TOTAL`), so every stitch is drawn one after the other; capped at `GIF_FRAME_CAP` (400 — above it the timeline is evenly sampled to 400, since tiled patterns can have thousands of stitches). **Streaming**: each frame is rendered off `cv` (zoom=1), quantised against a shared median-cut palette (`_medianCut`, sampled from ~24 representative frames) and LZW-encoded (`_lzwEncode`, Kevin-Weiner) straight into a list of byte chunks → `Blob([...chunks])`. Only the current frame's pixels are ever in RAM (flat memory regardless of stitch count). Runs async with `await` yields every 8 frames so the tab stays responsive and the Download item shows live % progress. Per-frame delay = `clamp(round(1200/F),3,7)` centiseconds (~12 s target loop). Restores the live zoom/step afterwards. Fully self-contained (no library/worker). NB: backgrounded/headless tabs throttle `setTimeout(0)` to ~1 s, so the preview harness encodes far slower than a real foreground tab.

## CAD Live Tiling grid + sizing (2026-06-29/30)
- **Grid min = 1** for both **Grid** (`cadMacro`, `cadStepMacro`) and **Tiles** (`cadPatMacro`, `cadStepPatMacro`); inputs `min="1"`. Auto-shrink floor lowered to 1 (empty canvas still defaults to 2).
- **Live-Tiling grid matches the Draw grid:** `cadBakeRight` now mirrors `cadBakeLeft` — per-unit sub-dots, larger dots at every `CAD_MICRO` point, and a grid line at every cell (was: coarse `CAD_MICRO`-only dots + tile-boundary lines). Per-unit sub-dots only baked when `cadPTile>=3`.
- **Stitches/line invariant to Tiles count (stitch view):** `_cadLayStitches(strokes, sceneScale)` rescales the stitch length to the grid (anchored to `cadBase`, the Draw-canvas px/unit) so changing the display size shrinks the stitches with the cells instead of dropping stitches. `_cadStitchSig` now includes `cadMacro`.

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
