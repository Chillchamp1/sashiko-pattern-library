# Headless routing harness

Debug stitch routing **without the browser**. Runs the real router from `src/` in Node
against real pattern geometry, and prints numbers you can reason about and diff.

Plain Node (v18+), zero dependencies. Works the same under Claude Code, opencode/DeepSeek,
or a human shell. **No app, no clicking, no manual export.**

## When to use it

You changed something in the routing pipeline (`buildExpPath`, `buildStrokesForFamily`,
`buildContourStrokes`, `orderStrokesFamily`, `extractArcStrokes`, `genTiledSegs`, …) and
want to know what it did to real patterns — before touching the browser.

## Commands

```bash
# Refresh fixtures from the live library (Firestore, public read — unattended)
node tools/routing/fetch-patterns.js

# Every pattern in its saved mode
node tools/routing/route.js

# One pattern, all 3 modes (match by id OR name substring)
node tools/routing/route.js seigaiha
node tools/routing/route.js exp_1782421629701

# One pattern, one mode
node tools/routing/route.js shippo contour

# Regression check: did a code change move any metric?
node tools/routing/route.js --snapshot     # write golden test/routing-snapshots.json
node tools/routing/route.js --check        # diff vs golden; exit 1 on any change
```

## Reading the metrics

| column | meaning | want |
|---|---|---|
| `strokes` | continuous needle runs | fewer = more continuous |
| `jumps` | needle re-insertions (`strokes - 1`) | fewer |
| `jumpLen` | total back-thread carry (grid units) | shorter |
| `maxTurn` | sharpest turn **inside** any stroke (deg) | low unless the pattern is genuinely zigzag |
| `midArc` | strokes that START in the middle of an arc | **always 0** (the arc-routing rule) |

`midArc > 0` is a bug: an arc is being entered partway along its curve instead of at an
endpoint. A `maxTurn` that jumps from ~6° to ~90° usually means arcs are being chained
across joins they shouldn't be (this is why Seigaiha looks wrong in `contour`).

## The three routing modes

| value | name | best for | distinguishing trait |
|---|---|---|---|
| `default` | Straight rows | line grids, discrete units (Seigaiha) | break strokes at turns > 90°; band-snake order |
| `continuous` | Zigzag | zigzag & wave meshes (Tsuzuki Yamagata) | follow any turn (180°); nearest-neighbour order |
| `contour` | Waves | flowing curves & arcs (Shippō) | chain whole arcs into waves; break at cusps > 120° |

The additive **v2 modes** (`zigzag2`, `waves2` — see ROUTING.md "Routing v2")
are testable via the explicit mode arg (`node tools/routing/route.js asanoha rows2`) but are
deliberately NOT in `MODES`, so `--snapshot`/`--check` keep guarding the v1 engine only.

See `../../ROUTING.md` for the full rules.

## Files

- `load-routing.js` — loads the real `src/` router into Node in a DOM-stub sandbox
  (no copy-paste, so it can't drift from what ships). `require()` it: `loadRouting()` →
  `{ buildExpPath, genTiledSegs, computeExpLayout, buildContourStrokes, … }`.
- `fetch-patterns.js` — pulls all patterns from Firestore → `test/patterns/*.json`.
- `route.js` — the inspector / snapshot tool above.
- `../../test/patterns/*.json` — committed pattern fixtures (geometry source of truth).
- `../../test/routing-snapshots.json` — golden metrics for `--check`.

## Workflow for a routing change

1. `node tools/routing/route.js --snapshot` (baseline, if not current).
2. Make the code change in `src/`.
3. `node tools/routing/route.js --check` → see exactly which patterns/modes moved.
4. Inspect a specific one: `node tools/routing/route.js <name> <mode>`.
5. When happy, `python build.py` and verify in the browser; re-snapshot.
