# Book import (scoped experiment)

Extracts a **unit cell** from an *Essential Sashiko* (Boutique-Sha) template plate and
emits it as a pattern doc in the library's schema.

> **This is an exception to the CLAUDE.md rule that new pattern geometry comes from the
> CAD editor.** It was authorised for a two-pattern test only. Output goes to the
> **sandbox** (`published:false`), never straight to the gallery.

```bash
python tools/book-import/extract.py            # both patterns -> out/*.json
python tools/book-import/extract.py kagome     # one
python tools/book-import/extract.py --verify   # also print the unit cell

node tools/book-import/verify.js               # route through the real src/ engine
```

`extract.py` needs `pymupdf`. `verify.js` is plain Node and reuses
`tools/routing/load-routing.js`, so it measures the router that actually ships.

## What it produces

A **unit cell**, not a plate dump. Library patterns store a repeating cell (median 34
lines across the 95 live fixtures); the app tiles it via `genTiledSegs` using `bbox` as
the period and routes it live. Storing all ~800 plate segments would freeze one plate
that cannot tile.

| | cell | lines | families | lattice |
|---|---|---|---|---|
| Kagome (p57) | 8 × 4 | 12 | V, D-, D+ | 6.693 pt |
| Hanasashi (p60) | 2 × 2 | 12 | V, H, D-, D+ | 15.064 pt |

## Reading a plate — the parts that are easy to get wrong

1. **Two patterns per page.** The template square is *detected*, then matched to its
   caption (the caption always sits above its own square). Picking "the first square"
   or "the left square" fails: the photo/template sides swap between pages. Both
   patterns in the original brief were the *other* pattern on their page.
2. **Two layers per square.** A cyan guide grid and a black stitch layer are drawn in
   the same box. Only black is geometry; cyan gives the pitch. Counting both is how you
   get ~1010 "segments" out of a plate that has ~500.
3. **Stitches are dashes.** They are drawn shorter than the cell they span, to show the
   gap between running stitches — the shortening is a fixed ratio on some plates and a
   fixed absolute gap on others, so each dash is expanded back to the lattice edge it
   sits on rather than trusting its drawn length.
4. **The axes can quantise differently.** Kagome's lattice steps one guide cell across
   but half a guide cell down. `gridType:'square'` renders a unit as the same length on
   both axes, so both axes are re-expressed in the finer step; otherwise the pattern
   comes out stretched 2:1.
5. **The template is a 241 pt square whose position varies.** Never hardcode a clip rect
   — a wrong rect returns zero segments with no error.

## Verification

`extract.py` tiles the extracted cell back over the plate and reports recall/precision
against every stitch edge it read from the interior; it exits non-zero below 98 %.
Both patterns currently report **100 % / 100 %**.

`verify.js` additionally checks that the live router covers every tiled segment exactly
once (no missing, no duplicates) in all four v1 modes.

## Routing mode

Both are `default` (Straight rows). ROUTING.md mode 1 covers "all pure line grids", and
these are exactly that: `maxTurn` is 0 in every mode, and the stroke and jump counts are
identical across modes — only `jumpLen` differs. With the dominant cost term (number of
jumps) tied, ROUTING.md's stated priority for custom patterns applies: the path should
read as *ordered and predictable*, which is the band-snake row sweep. It also matches
how hitomezashi is actually sewn, family by family.

`famOrder` is the book's own numbered pass order, read off the pink arrows on each
plate — Kagome 1 vertical, 2 up-right diagonal, 3 up-left diagonal; Hanasashi 1
vertical, 2 horizontal, 3 up-right diagonal, 4 up-left diagonal.

## Importing to the sandbox

The extractor deliberately does **not** write to Firestore: `firestore.rules` requires
`request.auth != null`, and a service account in this repo is not worth it for a
two-pattern test. Import through the app's own sync path instead — signed in, in the
browser console:

```js
const pat = /* paste out/kagome.json */;
EXP_PATTERNS.unshift(pat); _saveLocal(); await _pushToFirestore(pat); rebuildExpGallery();
```

The sandbox is world-readable (`allow read: if true`), so an imported pattern is visible
to any visitor on the Sandbox tab immediately — `published:false` gates the *gallery*,
not visibility.
