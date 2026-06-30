# Sashiko — Pattern Library

Interactive Sashiko (刺し子) pattern library with animated stitch-by-stitch preview, built as a single self-contained HTML file

**Live demo:** https://chillchamp1.github.io/sashiko-pattern-library/

## What it does

Pick a traditional Sashiko pattern and watch the stitch path animate in the order a hand-embroiderer would actually sew it — long continuous lines first, short jumps between them, colour-coded by pass and phase.

- **Jūji-zashi** (十字刺し) — cross stitch
- **Naname Jūji-zashi** (斜め十字刺し) — diagonal cross stitch
- **Komesashi** (米刺し) — rice stitch (4 passes)
- **Tsuzuki Yamagata** (続き山形) — continuous mountains
- **Asanoha** (麻の葉) — interlocking hemp-leaf stars (4 passes)
- **Hitomezashi Generator** (一目刺し) — an interactive generator for any one-stitch pattern, with graphical row/column toggles, named presets (Kōshi, Kaki no Hana), and a Fibonacci Snowflake fractal preset
- **Custom Patterns (experimental)** — draw your own pattern in the built-in CAD editor (lines + arcs, isometric or square grid); it tiles and animates with the same routing engine

## Usage

Open [`Sashiko — Pattern Library.htm`](Sashiko%20%E2%80%94%20Pattern%20Library.htm) (or `index.html`, an identical copy used for GitHub Pages) directly in a browser. That's it.

## Project structure

- `Sashiko — Pattern Library.htm` / `index.html` — the entire app: HTML, CSS, and canvas rendering logic in one file
- `src/` — split source files; `python build.py` assembles them into the deliverable (GitHub Actions does this on every push)
- `CLAUDE.md` — architecture documentation (rendering engines, color palette, generator internals)
- `ROUTING.md` — rules for ordering and colouring the stitch animation path
