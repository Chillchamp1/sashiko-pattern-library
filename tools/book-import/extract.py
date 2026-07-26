# Extract a hitomezashi unit cell from an "Essential Sashiko" template plate.
#
# Usage:  python tools/book-import/extract.py                 # all configured patterns
#         python tools/book-import/extract.py kagome          # one, by key
#         python tools/book-import/extract.py --verify        # extra tiling report
#
# Writes tools/book-import/out/<key>.json — a pattern doc in the library's exact
# schema (unit cell in integer grid units, bbox = tiling period). Writes nothing to
# Firestore and nothing under src/.
#
# WHY A UNIT CELL, NOT THE PLATE: a library pattern stores a repeating cell; the app
# tiles it live via genTiledSegs (bbox = the period) and routes it via buildExpPath.
# Dumping all ~800 plate segments would store one frozen plate that cannot tile.
#
# HOW THE PLATE IS READ:
#   * The templates are VECTOR line art. The photo on each plate is a raster and is
#     ignored (we only read stroked path items).
#   * Each plate draws TWO layers in the same square: a CYAN guide grid (the lattice
#     you mark on the fabric) and a BLACK stitch layer. Only the black layer is
#     geometry; the cyan layer is what gives us the pitch. Counting both together is
#     the classic double-count.
#   * Stitches are drawn as DASHES shorter than the cell they span (the book shows the
#     gap between running stitches). Dash length is NOT the edge length, so each dash
#     is expanded back to the lattice edge it sits on.
#   * A page carries TWO patterns. The template square is DETECTED (never hardcoded)
#     and then matched to its caption, because which square belongs to which name
#     flips between pages.

import argparse
import collections
import json
import math
import os
import re
import sys

try:
    import fitz  # PyMuPDF
except ImportError:
    sys.exit('PyMuPDF missing:  pip install pymupdf')

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
OUT_DIR = os.path.join(HERE, 'out')

def _find_pdf():
    """Locate the source book. Kept out of the repo on purpose (see .gitignore) — the
    path is resolved at run time rather than hardcoded, so no local filename lands in
    this public repository. Override with SASHIKO_BOOK_PDF.
    """
    env = os.environ.get('SASHIKO_BOOK_PDF')
    if env:
        return env
    import glob
    for d in (os.path.join(ROOT, '..', 'Bücher'), os.path.join(ROOT, '..'), ROOT):
        hit = sorted(glob.glob(os.path.join(d, '*Essential Sashiko*.pdf')))
        if hit:
            return hit[0]
    return ''


PDF = _find_pdf()

# Printed page -> PDF index is +0 (the book's page N is d[N]); the "+1" in the brief is
# the same thing counted 1-based. Verified per pattern by reading the caption text.
PATTERNS = [
    dict(key='kagome', page=57, caption='Kagome',
         name='Kagome (Hitomezashi)',
         # book stitch order, from the numbered arrows on the plate
         fam_order=['V', 'D-', 'D+']),
    dict(key='hanasashi', page=60, caption='Hanasashi',
         name='Hanasashi (Flower Stitch)',
         fam_order=['V', 'H', 'D-', 'D+']),
]

SQUARE_PT = 241.0        # nominal template size; detection tolerates ±20
EPS = 0.4                # pt, "is this segment axis-parallel"


# ── colour classification ────────────────────────────────────────────────────
def is_guide(c):
    """Cyan guide grid."""
    return c is not None and abs(c[0]) < .2 and c[1] > .5 and c[2] > .8


def is_stitch(c):
    """Black stitch layer."""
    return c is not None and max(c) < .1


# ── plate detection ──────────────────────────────────────────────────────────
def collect_segments(page):
    """All stroked straight-line items on the page, tagged guide/stitch."""
    guide, stitch = [], []
    for dr in page.get_drawings():
        col = dr.get('color')
        bucket = guide if is_guide(col) else stitch if is_stitch(col) else None
        if bucket is None:
            continue
        for it in dr['items']:
            if it[0] != 'l':
                continue
            p, q = it[1], it[2]
            bucket.append((p.x, p.y, q.x, q.y))
    return guide, stitch


def find_plates(guide, stitch):
    """Cluster segments into blocks and keep the ones shaped like a template square.

    Single-linkage on a coarse occupancy raster, so it does not care where on the
    page the square sits or how many squares there are.
    """
    segs = guide + stitch
    if not segs:
        return []
    CELL = 6.0
    occ = collections.defaultdict(list)
    for i, (x0, y0, x1, y1) in enumerate(segs):
        n = max(2, int(math.hypot(x1 - x0, y1 - y0) / CELL) + 1)
        for t in range(n + 1):
            f = t / n
            occ[(int((x0 + (x1 - x0) * f) // CELL),
                 int((y0 + (y1 - y0) * f) // CELL))].append(i)

    seen, blocks = set(), []
    for start in list(occ):
        if start in seen:
            continue
        stack, cells = [start], []
        seen.add(start)
        while stack:
            cx, cy = stack.pop()
            cells.append((cx, cy))
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    nb = (cx + dx, cy + dy)
                    if nb in occ and nb not in seen:
                        seen.add(nb)
                        stack.append(nb)
        idx = {i for c in cells for i in occ[c]}
        xs = [v for i in idx for v in (segs[i][0], segs[i][2])]
        ys = [v for i in idx for v in (segs[i][1], segs[i][3])]
        rect = (min(xs), min(ys), max(xs), max(ys))
        w, h = rect[2] - rect[0], rect[3] - rect[1]
        if abs(w - SQUARE_PT) < 20 and abs(h - SQUARE_PT) < 20 and abs(w - h) < 6:
            blocks.append(rect)
    return blocks


def caption_boxes(page, caption):
    out = []
    for b in page.get_text('blocks'):
        if re.search(r'\b' + re.escape(caption) + r'\b', b[4], re.I):
            out.append((b[0], b[1], b[2], b[3]))
    return out


def plate_for(page, caption):
    """Pick the template square that belongs to `caption`.

    A plate's caption always sits ABOVE it, so choose the square whose top edge is
    below the caption and closest to it. This is the check that stops us grabbing the
    other pattern on the same page — the photo/template sides swap between pages, so
    "first square" or "left square" are both wrong.
    """
    guide, stitch = collect_segments(page)
    plates = find_plates(guide, stitch)
    if not plates:
        raise SystemExit('no template square detected on page %d' % page.number)
    caps = caption_boxes(page, caption)
    if not caps:
        raise SystemExit('caption %r not found on page %d' % (caption, page.number))

    best = None
    for (cx0, cy0, cx1, cy1) in caps:
        for r in plates:
            gap = r[1] - cy0
            if gap < 0:
                continue
            if best is None or gap < best[0]:
                best = (gap, r)
    if best is None:
        raise SystemExit('no square below caption %r on page %d' % (caption, page.number))
    rect = best[1]
    pad = 2.0
    box = fitz.Rect(rect[0] - pad, rect[1] - pad, rect[2] + pad, rect[3] + pad)
    inside = lambda s: (fitz.Point(s[0], s[1]) in box and fitz.Point(s[2], s[3]) in box)
    return (rect,
            [s for s in guide if inside(s)],
            [s for s in stitch if inside(s)])


# ── guide grid ───────────────────────────────────────────────────────────────
def guide_rules(guide, axis, span):
    """Constant-coordinate positions of the guide rules along one axis.

    Clusters by coordinate and keeps clusters whose drawn length actually spans the
    plate, so it works whether the grid is one long rule per line (Kagome) or many
    short per-cell ticks (Hanasashi).
    """
    total = collections.defaultdict(float)
    pts = collections.defaultdict(list)
    for x0, y0, x1, y1 in guide:
        if axis == 0:
            if abs(x0 - x1) > EPS:
                continue
            c, ln = (x0 + x1) / 2, abs(y1 - y0)
        else:
            if abs(y0 - y1) > EPS:
                continue
            c, ln = (y0 + y1) / 2, abs(x1 - x0)
        total[round(c, 1)] += ln
        pts[round(c, 1)].append(c)

    groups = []
    for k in sorted(total):
        if groups and k - groups[-1][-1] < 1.0:
            groups[-1].append(k)
        else:
            groups.append([k])
    out = []
    for g in groups:
        if sum(total[k] for k in g) > span * .30:
            vals = [c for k in g for c in pts[k]]
            out.append(sum(vals) / len(vals))
    return sorted(out)


# ── stitches -> lattice edges ────────────────────────────────────────────────
def direction(x0, y0, x1, y1):
    dx, dy = x1 - x0, y1 - y0
    if abs(dy) < EPS:
        return 'H'
    if abs(dx) < EPS:
        return 'V'
    return 'D+' if dx * dy > 0 else 'D-'


def true_span(s):
    """Dash extent (in guide-cell units) -> the extent of the edge it sits on.

    The dash is drawn short to show the gap between running stitches; the shortening
    is a fixed ratio on some plates and a fixed absolute gap on others, so instead of
    assuming either we take the smallest lattice extent that leaves the dash between
    55% and 85% of it. Every class on both plates resolves uniquely.
    """
    if s < 0.15:            # axis-parallel dash: no extent on this axis
        return 0.0
    for t in (0.5, 1.0, 1.5, 2.0, 2.5, 3.0):
        if .55 <= s / t <= .85:
            return t
    raise SystemExit('dash extent %.3f fits no lattice edge' % s)


def integer_step(values):
    """Largest (step, phase) the endpoints land on, in guide-cell units.

    The phase is solved for rather than assumed: the first guide rule is not
    necessarily a stitch-lattice point, and measuring residuals from it makes a
    perfectly regular lattice look irregular. Returns the coarsest step that fits.
    """
    best = None
    for step in (1.0, 0.5, 0.25):
        fr = [(v / step) % 1.0 for v in values]
        # circular mean -> the phase that centres the residuals
        sx = sum(math.cos(2 * math.pi * f) for f in fr)
        sy = sum(math.sin(2 * math.pi * f) for f in fr)
        phase = (math.atan2(sy, sx) / (2 * math.pi)) % 1.0
        res = sorted(min(abs(f - phase), 1 - abs(f - phase)) for f in fr)
        p99 = res[int(len(res) * .99) - 1]
        # 0.15 of a step ~= 1 pt here, about the width of a drawn stitch. Snapping stays
        # unambiguous up to 0.5, so this is loose enough for the book's drawing slop and
        # still rejects a step that is genuinely too coarse (those land near 0.5).
        if p99 < .15:
            best = (step, phase)
            break
    if best is None:
        raise SystemExit('endpoints do not land on a common lattice step')
    return best


def extract_edges(stitch, gx, gy):
    """Every stitch dash as an integer-lattice edge, in guide-cell units."""
    ox, oy = gx[0], gy[0]
    px = (gx[-1] - gx[0]) / (len(gx) - 1)
    py = (gy[-1] - gy[0]) / (len(gy) - 1)

    raw = []
    for x0, y0, x1, y1 in stitch:
        d = direction(x0, y0, x1, y1)
        mx = ((x0 + x1) / 2 - ox) / px
        my = ((y0 + y1) / 2 - oy) / py
        tx = true_span(abs(x1 - x0) / px)
        ty = true_span(abs(y1 - y0) / py)
        sy = 1 if (x1 - x0) * (y1 - y0) > 0 else -1
        raw.append((d, mx, my, tx, ty, sy))

    # Drop dashes cut off by the edge of the plate: they are partial stitches, so their
    # endpoints sit off the lattice and would drag the detected step down to a fraction
    # of the real one. Keep only the modal extent per direction class.
    modal = {}
    for d, mx, my, tx, ty, sgn in raw:
        modal.setdefault(d, collections.Counter())[(tx, ty)] += 1
    modal = {d: c.most_common(1)[0][0] for d, c in modal.items()}
    raw = [r for r in raw if (r[3], r[4]) == modal[r[0]]]

    coords_x, coords_y = [], []
    for d, mx, my, tx, ty, sy in raw:
        coords_x += [mx - tx / 2, mx + tx / 2]
        coords_y += [my - ty / 2, my + ty / 2]
    sx, phx = integer_step(coords_x)
    sy_step, phy = integer_step(coords_y)

    # The two axes can quantise to different PHYSICAL steps (Kagome: 1 guide cell
    # across, half a guide cell down). A 'square' gridType renders one unit as the same
    # length on both axes, so emitting those raw indices would stretch the pattern.
    # Re-express both axes in the finer step so a unit is isotropic.
    phys_x, phys_y = sx * px, sy_step * py
    base = min(phys_x, phys_y)
    mul_x, mul_y = int(round(phys_x / base)), int(round(phys_y / base))
    qx = lambda v: int(round(v / sx - phx)) * mul_x
    qy = lambda v: int(round(v / sy_step - phy)) * mul_y

    edges = []
    for d, mx, my, tx, ty, sgn in raw:
        ax, bx = mx - tx / 2, mx + tx / 2
        if sgn > 0 or d in ('H', 'V'):
            ay, by = my - ty / 2, my + ty / 2
        else:
            ay, by = my + ty / 2, my - ty / 2
        e = (qx(ax), qy(ay), qx(bx), qy(by))
        if (e[2], e[3]) < (e[0], e[1]):
            e = (e[2], e[3], e[0], e[1])
        edges.append((d, e))
    # origin_pt: page coordinate of lattice index 0 on each axis (see qx/qy above)
    origin = (phx * mul_x * base, phy * mul_y * base)
    return edges, base, mul_x, mul_y, px, py, origin


# ── unit cell ────────────────────────────────────────────────────────────────
def find_period(edge_set, umax, vmax):
    """Smallest (pu, pv) whose translation maps the interior of the plate onto itself.

    Only the interior is tested: edges near the border have no partner simply because
    the plate is cropped there, which would otherwise veto every real period.
    """
    def ok(pu, pv):
        mu, mv = abs(pu) + 2, abs(pv) + 2
        checked = 0
        for (u0, v0, u1, v1) in edge_set:
            if not (mu <= u0 <= umax - mu and mv <= v0 <= vmax - mv):
                continue
            checked += 1
            if (u0 + pu, v0 + pv, u1 + pu, v1 + pv) not in edge_set:
                return False
        return checked > 20

    # Smallest pure-u and pure-v translations that hold. Both holding is enough to make
    # (pu, pv) a tiling period; it may not be the smallest possible cell (a glide
    # symmetry could halve it), but it is always a correct one.
    pu = next((p for p in range(1, umax // 2 + 1) if ok(p, 0)), None)
    pv = next((p for p in range(1, vmax // 2 + 1) if ok(0, p)), None)
    if pu is None or pv is None:
        raise SystemExit('no tiling period found')
    return pu, pv


def unit_cell(edges, pu, pv, umax, vmax):
    """Representative edges of one period.

    Sampled from the plate interior only, so stitches the plate happens to cut off at
    its border cannot invent a cell line that is not really there. The representative
    is anchored at 0 (u0 % pu) so that tiling by whole periods reproduces the original
    coordinates exactly.
    """
    m = max(pu, pv) + 2
    cell, seen = [], set()
    for d, (u0, v0, u1, v1) in edges:
        if not (m <= u0 <= umax - m and m <= v0 <= vmax - m):
            continue
        ru, rv = u0 % pu, v0 % pv
        du, dv = u1 - u0, v1 - v0
        key = (ru, rv, du, dv, d)
        if key in seen:
            continue
        seen.add(key)
        # Anchoring on the start point alone can leave the far end outside the cell box
        # (a diagonal that crosses the boundary). Every fixture in the live library keeps
        # its line coords inside the bbox, so shift by whole periods to the placement
        # that does — the edge is the same edge either way.
        best = None
        for i in (-1, 0, 1):
            for j in (-1, 0, 1):
                a = (ru + i * pu, rv + j * pv)
                b = (a[0] + du, a[1] + dv)
                over = max(0, -min(a[0], b[0]), -min(a[1], b[1]),
                           max(a[0], b[0]) - pu, max(a[1], b[1]) - pv)
                if best is None or over < best[0]:
                    best = (over, (a[0], a[1], b[0], b[1]))
        cell.append((d, best[1]))
    return cell


def verify_tiling(cell, pu, pv, edge_set, umax, vmax):
    """Tile the cell back over the plate and compare to what was actually extracted."""
    rebuilt = set()
    for _, (u0, v0, u1, v1) in cell:
        for i in range(-2, umax // pu + 3):
            for j in range(-2, vmax // pv + 3):
                e = (u0 + i * pu, v0 + j * pv, u1 + i * pu, v1 + j * pv)
                if (e[2], e[3]) < (e[0], e[1]):
                    e = (e[2], e[3], e[0], e[1])
                rebuilt.add(e)
    m = 2
    interior = {e for e in edge_set
                if m <= e[0] <= umax - m and m <= e[1] <= vmax - m
                and m <= e[2] <= umax - m and m <= e[3] <= vmax - m}
    hit = len(interior & rebuilt)
    recall = hit / len(interior) if interior else 0
    extra = {e for e in rebuilt
             if m <= e[0] <= umax - m and m <= e[1] <= vmax - m
             and m <= e[2] <= umax - m and m <= e[3] <= vmax - m} - interior
    prec = hit / (hit + len(extra)) if hit + len(extra) else 0
    return recall, prec, len(interior)


# ── emit ─────────────────────────────────────────────────────────────────────
def build_doc(spec, cell, pu, pv, created):
    fam_names = [f for f in spec['fam_order'] if any(d == f for d, _ in cell)]
    fam_index = {f: i for i, f in enumerate(fam_names)}

    lines, families = [], []
    for d, (u0, v0, u1, v1) in sorted(cell, key=lambda c: (fam_index[c[0]], c[1])):
        lines.append({'start': [u0, v0], 'end': [u1, v1]})
        families.append(fam_index[d])

    bbox = {'minU': 0, 'minV': 0, 'maxU': pu, 'maxV': pv}
    tiles = 6
    return {
        'id': 'exp_%d' % created,
        'type': 'exp',
        'name': spec['name'],
        'lines': lines,
        'bbox': bbox,
        'families': families,
        'famOrder': list(range(len(fam_names))),
        'gridType': 'square',
        'bboxRotated': False,
        'routingMode': 'default',
        'patMacro': round(tiles * max(pu, pv) / 10, 4),
        'gridMacro': 2,
        'spacing': 0,
        'spacingY': 0,
        'thumbCells': tiles,
        'published': False,
        'traditional': True,
        'community': False,
        'communityName': '',
        'embroidery': False,
        'famRouting': {},
        'famColors': {},
        'stitchColors': False,
        'fabric': '',
        'stitchView': False,
        'stitchLen': 8,
        'stitchRatio': 'standard',
        'stitchGrid': False,
        'createdAt': created,
        'creatorId': 'book-import',
        'source': 'Essential Sashiko (Boutique-Sha), printed p.%d' % spec['page'],
    }


def run(spec, verbose):
    doc = fitz.open(PDF)
    page = doc[spec['page']]
    rect, guide, stitch = plate_for(page, spec['caption'])
    w, h = rect[2] - rect[0], rect[3] - rect[1]

    gx = guide_rules(guide, 0, h)
    gy = guide_rules(guide, 1, w)
    edges, base, mul_x, mul_y, px, py, _org = extract_edges(stitch, gx, gy)

    eset = {e for _, e in edges}
    us = [v for e in eset for v in (e[0], e[2])]
    vs = [v for e in eset for v in (e[1], e[3])]
    umax, vmax = max(us), max(vs)
    pu, pv = find_period(eset, umax, vmax)
    cell = unit_cell(edges, pu, pv, umax, vmax)
    recall, prec, n_int = verify_tiling(cell, pu, pv, eset, umax, vmax)

    kinds = collections.Counter(d for d, _ in edges)
    print('%-10s plate (%.1f,%.1f)-(%.1f,%.1f)  %.1f x %.1f pt' %
          (spec['key'], rect[0], rect[1], rect[2], rect[3], w, h))
    print('           guide grid %dx%d rules, pitch %.4f x %.4f pt' %
          (len(gx), len(gy), px, py))
    print('           lattice unit %.4f pt (isotropic; x steps %d, y steps %d)' %
          (base, mul_x, mul_y))
    print('           stitch dashes %d  %s' % (len(edges), dict(kinds)))
    print('           unit cell %d x %d units, %d lines' % (pu, pv, len(cell)))
    print('           tiling check: recall %.1f%%  precision %.1f%%  (%d interior edges)' %
          (recall * 100, prec * 100, n_int))
    if verbose:
        for d, e in sorted(cell):
            print('             %-3s %s' % (d, e))

    created = 1785000000000 + spec['page'] * 1000
    out = build_doc(spec, cell, pu, pv, created)
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, spec['key'] + '.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    print('           -> %s' % os.path.relpath(path, ROOT))
    return recall, prec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('key', nargs='?', help='pattern key (default: all)')
    ap.add_argument('--verify', action='store_true', help='print the unit cell')
    a = ap.parse_args()

    if not PDF or not os.path.exists(PDF):
        sys.exit('Source book not found. Put the "Essential Sashiko" PDF next to the '
                 'repo (../Bücher/) or set SASHIKO_BOOK_PDF.')
    todo = [p for p in PATTERNS if not a.key or p['key'] == a.key]
    if not todo:
        sys.exit('unknown key %r (have: %s)' % (a.key, ', '.join(p['key'] for p in PATTERNS)))

    bad = False
    for spec in todo:
        r, p = run(spec, a.verify)
        if r < .98 or p < .98:
            bad = True
        print()
    if bad:
        sys.exit('tiling check below 98% — unit cell does not reproduce the plate')


if __name__ == '__main__':
    main()
