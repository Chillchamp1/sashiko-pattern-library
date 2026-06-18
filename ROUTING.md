# Stitch-Path Routing Rules

Binding rules for the **order** in which a pattern's stitches are animated / "sewn". Applies to ALL patterns. The geometry (which edges exist) is a separate concern — see `tools/pattern_extractor.py` and CLAUDE.md.

Goal: a stitch path a human embroiderer would actually sew — as continuous as possible, minimal thread waste. For custom (exp) patterns, the additional rule is **row/column sweeping with snake ordering** (see Rule 3 extension below).

## Rule 1 — Long lines / few direction changes
Within a continuous stroke the needle should run **straight** as long as possible and only turn at true turning points. The "zigzag legs" should be long.

**Implementation:** At every grid point, **pair** the adjacent edges by collinearity (opposite directions together). A stroke follows these pairings → it goes straight through crossings and only turns where no collinear continuation exists (peak / valley / edge). Greedy "alternate direction at every crossing" is WRONG — it produces the maximum number of direction changes. (For Tsuzuki Yamagata: direction changes 144 → 50.)

Function: `tracePaired(edges)` in the source; collinear-preference extension in `buildExpPath` for custom patterns.

## Rule 2 — Short jumps between strokes
When a continuous stroke ends and the next begins, the "jump" (re-inserting the needle) should be as short as possible.

**Implementation:** Sequence strokes by **nearest-neighbour** — after a stroke ends, pick the next stroke whose nearer endpoint is closest, traversing it in reverse if needed. Also keep the total number of strokes small (follows from Rule 1).

Function: `orderNN(chains)`.

## Rule 3 — Pass order and row sweeping
Complete one family/direction entirely (e.g. horizontal), then move to the next (vertical). Rules 1 and 2 apply within each pass.

**For custom (exp) patterns — row/column sweep:** within a direction family, segments are grouped into rows (all segs at the same perpendicular coordinate). Rows are swept in order; the needle snakes back and forth (row 0 → forward, row 1 → reverse, row 2 → forward, …) to keep row-to-row jumps short. This mirrors how a human stitcher works: complete one row, flip direction, stitch the next. Within each row, collinear chains are formed first (Rule 1), then NN-ordered (Rule 2).

## Rule 4 — Colour by translation equivalence class
A path's colour encodes its **translation equivalence class**: same shade if and only if one path maps onto (part of) the other via a pattern symmetry translation. A path shifted purely left/right or up/down = identical. An edge-clipped piece = identical to the full path if its unclipped portion appears shifted elsewhere. A mirror image (half-period offset, NOT a lattice vector) = its own class/colour.

Do NOT colour by band parity / median coordinate — that gives non-translates the same colour (bug). Functions: `classifyTranslation`, `latContains`.

## Verification
Before shipping: cross-check in Python — **100% edge coverage** (every edge exactly once), compare direction-change count and total jump length before/after. Then check for console errors in the browser (`.claude/launch.json` + Claude_Preview MCP).
