# Stitch-Path Routing Rules

Binding rules for the **order** in which a pattern's stitches are animated / "sewn". Applies to ALL patterns. The geometry (which edges exist) is a separate concern — see CLAUDE.md.

Goal: a stitch path a human embroiderer would actually sew — as continuous as possible, minimal thread waste.

## The human-makability cost (how we decide between two routings)
A complete route covers every segment exactly once, as an ordered list of continuous **strokes** with **jumps** (needle re-insertions) between them. We approximately minimise, in strict priority order:

```
Cost = A·(number of jumps)            // dominant — every jump = stop, pull thread to back, re-insert
     + B·(total jump length)          // back-thread waste; long carries snag
     + C·(turn sharpness in strokes)  // sum of (θ/π)² over interior turns; gentle curve turns ≈ 0
     + D·(retrace)                    // jumps that run back over already-stitched line
with A ≫ B ≫ C, D.
```

Key consequence: the turn-sharpness term **C** decides where a stroke continues vs. breaks, and minimising it *also* minimises the jump term **A** — because every place a stroke fails to continue becomes a stroke endpoint = a potential jump. So forming the smoothest strokes and forming the fewest strokes are the same objective. A curve made of many tiny segments is therefore **one stroke**, not one-per-angle.

## Rule 1 — Long, smooth strokes / few direction changes
Within a continuous stroke the needle should run as **straight or smoothly-curving** as possible, only breaking at true endpoints or near-reversals. Multiple angles within one stroke are fine (a half-circle is one stroke).

**Implementation:** Build a vertex/edge graph. At every vertex, **pair the incident edges by minimum deflection** (straightest through-passage; deflection 0 = collinear opposite, π = fold straight back). A stroke follows these pairings → straight through crossings, smoothly along curves, breaking only where the smoothest available turn exceeds `MAXTURN` (135°) or no edge remains. Greedy "alternate direction at every crossing" is WRONG — it produces the maximum number of direction changes.

Functions: `tracePaired(edges)` for the built-in lattice patterns (collinear pairing); `buildExpPath` + `matchVertex` for custom patterns (general min-deflection matching, handles curves).

## Rule 2 — Short jumps between strokes
When a continuous stroke ends and the next begins, the "jump" (re-inserting the needle) should be as short as possible.

**Implementation:** Sequence strokes by **nearest-neighbour** — after a stroke ends, pick the next stroke whose nearer endpoint is closest, traversing it in reverse if needed. Also keep the total number of strokes small (follows from Rule 1).

Function: `orderNN(chains)`.

## Rule 3 — Pass order and row sweeping (snake)
Complete one family/direction entirely (e.g. horizontal), then move to the next (vertical). Rules 1 and 2 apply within each pass.

**For custom (exp) patterns — strokes first, then band-snake:** strokes are formed by Rule 1 *before* any grouping (so a curve stays whole). Each stroke is then placed by its overall orientation (chord, or bbox major axis for loops) into an **orientation family** (30° bins; horizontal families stitched before vertical — Rule 3). Within a family, strokes are grouped into parallel **bands** by the perpendicular coordinate of their centroid, the bands are swept in order, and the sweep **snakes** (band 0 → forward, band 1 → reverse, …). Because progression along the sweep is monotonic, every jump is a short hop into **unstitched** territory — never back over finished stitches. A band may legitimately contain strokes of slightly different angles if that minimises jumps (e.g. a row of arches).

Functions: `buildExpPath` (Phase 2), `matchVertex`.

## Rule 4 — Colour by translation equivalence class
A path's colour encodes its **translation equivalence class**: same shade if and only if one path maps onto (part of) the other via a pattern symmetry translation. A path shifted purely left/right or up/down = identical. An edge-clipped piece = identical to the full path if its unclipped portion appears shifted elsewhere. A mirror image (half-period offset, NOT a lattice vector) = its own class/colour.

Do NOT colour by band parity / median coordinate — that gives non-translates the same colour (bug). Functions: `classifyTranslation`, `latContains`.

## Verification
Before shipping: cross-check in Python — **100% edge coverage** (every edge exactly once), compare direction-change count and total jump length before/after. Then check for console errors in the browser (`.claude/launch.json` + Claude_Preview MCP).
