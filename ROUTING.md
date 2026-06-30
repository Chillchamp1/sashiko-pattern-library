# Stitch-Path Routing Rules

Binding rules for the **order** in which a pattern's stitches are animated / "sewn". Applies to ALL patterns. The geometry (which edges exist) is a separate concern — see CLAUDE.md.

Goal: a stitch path a human embroiderer would actually sew — as continuous as possible, minimal thread waste.

## Selectable routing modes (CAD editor)
The CAD editor exposes four routing logics via the **Routing** dropdown (`cadRoutingMode`, stored per pattern as `routingMode`). All obey the cost model below; they differ in how strokes are formed and ordered. Picked in `buildExpPath(lines, famOrder, routingMode)`.

| # | Mode | value | Covers | How |
|---|---|---|---|---|
| **1** | Straight rows | `default` | Kōshi, Hishi, Tasuki, Kikkō, all pure line grids | Family-by-family; min-deflection strokes (`maxTurn=90°`) ordered by band-snake. Short float at each row end. |
| **2** | Zigzag | `continuous` | Yamagata, Nowaki, all wave/zigzag meshes | Strokes follow connected diagonals through every crossing (`maxTurn=180°`); all chains ordered globally by nearest-neighbour → long zigzag runs edge-to-edge, floats only between runs. |
| **3** | Waves | `contour` | Seigaiha, Shippō, isolated shapes with gaps, curve/arc patterns | `buildContourStrokes` chains arcs into long forward-marching **waves** (scallops), trying 4 sweep axes and keeping the decomposition with the fewest/longest runs (auto horizontal / vertical / diagonal). Within a wave the needle always progresses along the axis, taking the smoothest forward arc at each crossing (`maxTurn=120°`) → long repeating curves, no cusp folds. Waves then swept row-by-row in orientation-aware bands with snaking (`orderStrokesFamily`) — one wave finished before the next row. |
| **4** | One by one (motifs) | `sequential` | **Ishi Guruma**, linked rings/wheels, crests, any pattern of discrete repeated motifs | `_buildMotifPath`: finish each motif completely, then the nearest next one. Motifs are detected automatically — single-linkage clustering of `maxTurn=90°` strokes by endpoint proximity, **cut at the largest natural gap** in the merge distances (strokes inside a motif sit closer than neighbouring motifs, so that gap *is* the boundary — no fixed threshold). Motifs visited nearest-first from the top-left; strokes within (and the entry into) each motif ordered nearest-first. NN is scoped per motif, so it's also far faster than global `continuous` on big tilings. Validated on Ishi Guruma: 20-stroke wheels, each stitched contiguously. |

Legacy values `smooth` (60°) and `fewer-jumps` (120°) are Logik-1 variants kept for backward compatibility; collapsed to `default` on edit.

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

**Implementation:** Build a vertex/edge graph. At every vertex, **pair the incident edges by minimum deflection** (straightest through-passage; deflection 0 = collinear opposite, π = fold straight back). A stroke follows these pairings → straight through crossings, smoothly along curves, breaking only where the smoothest available turn exceeds `MAXTURN` or no edge remains. `MAXTURN = 90°` for custom patterns (the user's rule: *sharp turns should almost never happen* — a turn sharper than a right angle breaks the stroke into two rather than forcing an ugly fold). Greedy "alternate direction at every crossing" is WRONG — it produces the maximum number of direction changes.

Functions: `tracePaired(edges)` for the built-in lattice patterns (collinear pairing); `buildExpPath` + `matchVertex` for custom patterns (general min-deflection matching, handles curves).

**Arcs are atomic traversal units — a stroke can only START an arc at one of its endpoints, never mid-arc.** Each drawn arc (its flattened segments share an `aid`) is pulled out by `extractArcStrokes` as ONE whole polyline running endpoint→endpoint, *before* the line matcher / wave tracer runs. A wave may **chain** one arc into the next at a shared endpoint, but can never enter or leave an arc in its middle. This means:

- **Logik 1/2** (`buildStrokesForFamily`): arcs are emitted whole and only straight lines go through min-deflection matching. Arcs do not merge with crossing lines/other arcs into one stroke.
- **Logik 3 / contour** (`buildContourStrokes`): each arc is a **super-edge** between its two endpoints; the axis-wave tracer chains whole arcs at shared endpoints. Tangent-smooth meets chain into one long run (e.g. **Shippō**'s diagonal sine curves); cusp meets exceed `maxTurn` and stay separate (e.g. **Seigaiha**'s scallops) — but the needle always starts at a drawn endpoint either way.

The stroke ordering only ever enters a stroke at one of its two ends, so the needle always begins an **open** arc at a drawn endpoint. (Closed full-circle arcs have *no* endpoint, so this rule doesn't apply to them: `default`/`contour` rotate the closed loop to start at the point nearest the needle — `_rotateClosedEntry`, shortest jump — while `continuous` starts it at the drawn start. `orderStrokesFamily` carries `first`/`last` for zero-length closed strokes and drops degenerate <2-point strokes so curve patterns don't crash.) The headless harness's `midArc` metric counts only open-arc violations and is expected to be 0.

## Rule 2 — Short jumps between strokes
When a continuous stroke ends and the next begins, the "jump" (re-inserting the needle) should be as short as possible.

**Implementation:** Sequence strokes by **nearest-neighbour** — after a stroke ends, pick the next stroke whose nearer endpoint is closest, traversing it in reverse if needed. Also keep the total number of strokes small (follows from Rule 1).

Function: `orderNN(chains)`.

## Rule 3 — Pass order and row sweeping (snake)
Complete one family/direction entirely (e.g. horizontal), then move to the next (vertical). Rules 1 and 2 apply within each pass.

**For custom (exp) patterns — order first, then strokes-first band-snake.** The user's overriding priority: the path must look *ordered and predictable*, even if that costs a few extra jumps. Strokes are formed by Rule 1 *before* any grouping (a curve stays whole), then ordered:

1. **Movement type** — group by the stroke's turning profile and sweep the groups **straight → zigzag → curve** (Σ|turn| small ⇒ straight; turns keep one sign ⇒ curve; turns alternate ⇒ zigzag). Keeps "similar movements next to each other" (e.g. all zigzags together, alternating down/up).
2. **Orientation family** — 30° bins within each type.
3. **Bands + snake** — group by the perpendicular coordinate of the centroid, sweep bands in order, **snake** (reverse alternate bands). The first stroke is oriented to flow into the second, and each subsequent stroke is entered from the end nearest the needle — so a row/column of arches flows like an **S** (and touching arches merge into one stroke via Rule 1). Monotonic progress ⇒ every jump hops into **unstitched** area, never back over finished stitches.

**Coordinate space:** routing runs in grid **(u,v)** coordinates. For isometric patterns this means the sweep follows the **iso grid lines** (the lattice is axis-aligned in (u,v)), which is how iso sashiko is actually sewn. The visible square is expressed as a convex region in (u,v); every tiled segment is **clipped** to it so nothing routes off-screen and the whole square is filled.

Functions: `buildExpPath` (Phase 2), `matchVertex`, `computeExpLayout`/`genTiledSegs`/`clipSegConvex`.

## Rule 4 — Colour by translation equivalence class
A path's colour encodes its **translation equivalence class**: same shade if and only if one path maps onto (part of) the other via a pattern symmetry translation. A path shifted purely left/right or up/down = identical. An edge-clipped piece = identical to the full path if its unclipped portion appears shifted elsewhere. A mirror image (half-period offset, NOT a lattice vector) = its own class/colour.

Do NOT colour by band parity / median coordinate — that gives non-translates the same colour (bug). Functions: `classifyTranslation`, `latContains`.

## Verification
Before shipping: cross-check in Python — **100% edge coverage** (every edge exactly once), compare direction-change count and total jump length before/after. Then check for console errors in the browser (`.claude/launch.json` + Claude_Preview MCP).
