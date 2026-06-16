"""
Sashiko pattern extractor.
Extracts the coordinate grid + stitch segments from a book diagram image so a
pattern can be reconstructed exactly instead of eyeballed.

Layers in the Boutique-Sha "Essential Sashiko" diagrams:
  - cyan thin lines  -> the coordinate grid ("1 grid square" reference)
  - black lines      -> the actual stitch pattern
  - pink/red arrows  -> the recommended stitching ORDER (guide, not part of cloth)

Usage:
  python pattern_extractor.py <image.png>            # diagnostics
  from pattern_extractor import extract; extract(img) # programmatic
"""
import sys, cv2, numpy as np


def color_masks(img):
    """Split a diagram into (cyan_grid, red_guide, black_pattern) boolean masks."""
    b, g, r = img[..., 0].astype(int), img[..., 1].astype(int), img[..., 2].astype(int)
    cyan = (b > 130) & (g > 130) & (r < 170) & ((g - r) > 25) & ((b - r) > 25)
    red  = (r > 130) & ((r - g) > 45) & (g < 150)
    dark = (r < 120) & (g < 120) & (b < 120)
    return cyan, red, dark


def _peaks(proj, min_frac=0.25, min_gap=6):
    """Return sorted indices of strong, well-separated peaks in a 1-D projection."""
    if proj.max() == 0:
        return []
    thr = proj.max() * min_frac
    cand = [i for i in range(1, len(proj) - 1)
            if proj[i] >= thr and proj[i] >= proj[i - 1] and proj[i] >= proj[i + 1]]
    # merge peaks closer than min_gap, keep the strongest
    peaks = []
    for i in cand:
        if peaks and i - peaks[-1] < min_gap:
            if proj[i] > proj[peaks[-1]]:
                peaks[-1] = i
        else:
            peaks.append(i)
    return peaks


def grid_geometry(cyan):
    """Detect grid line positions and the regular spacing from the cyan mask."""
    xs = _peaks(cyan.sum(0))   # vertical lines  -> x positions
    ys = _peaks(cyan.sum(1))   # horizontal lines -> y positions
    def spacing(p):
        d = np.diff(p)
        return float(np.median(d)) if len(d) else 0.0
    return {"xs": xs, "ys": ys, "dx": spacing(xs), "dy": spacing(ys)}


def extract_segments(dark, x0, y0, G, ni, nj, jmin=0):
    """
    Sample every candidate diamond edge on a half-grid lattice and keep the dark ones.

    The Tsuzuki-Yamagata lines run at slopes +/-1/2 and +/-2. On a lattice of
    half-grid steps (u = G/2) those edges are the vectors (2,+/-1) and (1,+/-2).
    Returns a list of edges in HALF-GRID integer coords: ((i1,j1),(i2,j2)).
    """
    u = G / 2.0
    dmask = cv2.dilate(dark.astype(np.uint8), np.ones((3, 3), np.uint8))
    H, W = dmask.shape
    vecs = [(2, 1), (2, -1), (1, 2), (1, -2)]
    ts = np.linspace(0.14, 0.86, 11)
    edges = []
    def px(i, j): return (x0 + i * u, y0 + j * u)
    for i in range(0, ni + 1):
        for j in range(jmin, nj + 1):
            x1, y1 = px(i, j)
            for dx, dy in vecs:
                i2, j2 = i + dx, j + dy
                if i2 < 0 or i2 > ni or j2 < jmin or j2 > nj:
                    continue
                x2, y2 = px(i2, j2)
                hit = 0
                for t in ts:
                    xx = int(round(x1 + (x2 - x1) * t))
                    yy = int(round(y1 + (y2 - y1) * t))
                    if 0 <= xx < W and 0 <= yy < H and dmask[yy, xx]:
                        hit += 1
                if hit / len(ts) >= 0.72:
                    edges.append(((i, j), (i2, j2)))
    return edges


def classify(edges):
    """Split edges into the shallow (+/-1/2) and steep (+/-2) families."""
    shallow, steep = [], []
    for (a, b) in edges:
        dx, dy = b[0] - a[0], b[1] - a[1]
        (shallow if abs(dx) == 2 else steep).append((a, b))
    return shallow, steep


def overlay(crop_path, edges, x0, y0, G, out_path):
    img = cv2.imread(crop_path)
    u = G / 2.0
    sh, st = classify(edges)
    for col, group in [((60, 60, 255), sh), ((60, 220, 60), st)]:
        for (a, b) in group:
            p1 = (int(round(x0 + a[0] * u)), int(round(y0 + a[1] * u)))
            p2 = (int(round(x0 + b[0] * u)), int(round(y0 + b[1] * u)))
            cv2.line(img, p1, p2, col, 2)
    cv2.imwrite(out_path, img)


def main(path):
    img = cv2.imread(path)
    if img is None:
        print("could not read", path); return
    cyan, red, dark = color_masks(img)
    print("image", img.shape)
    print("cyan px", int(cyan.sum()), "| red px", int(red.sum()), "| dark px", int(dark.sum()))
    geo = grid_geometry(cyan)
    print("grid x-lines:", len(geo["xs"]), "spacing dx=%.1f" % geo["dx"])
    print("grid y-lines:", len(geo["ys"]), "spacing dy=%.1f" % geo["dy"])
    print("x positions:", geo["xs"][:20])
    print("y positions:", geo["ys"][:20])
    # dump masks for visual check
    base = path.rsplit(".", 1)[0]
    cv2.imwrite(base + "_mask_cyan.png", (cyan * 255).astype(np.uint8))
    cv2.imwrite(base + "_mask_red.png",  (red * 255).astype(np.uint8))
    cv2.imwrite(base + "_mask_dark.png", (dark * 255).astype(np.uint8))
    print("wrote mask PNGs next to", path)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else r"G:\Meine Ablage\Sashiko\Code\tools\ty_diagram.png")
