# Sashiko — Pattern Library

Interactive Sashiko (刺し子) pattern library with animated stitch-by-stitch preview, built as a single self-contained HTML file — no build step, no server, no dependencies.

**Live demo:** https://chillchamp1.github.io/sashiko-pattern-library/

## What it does

Pick a traditional Sashiko pattern and watch the stitch path animate in the order a hand-embroiderer would actually sew it — long continuous lines first, short jumps between them, colour-coded by pass and phase.

- **Jūji-zashi** (十字刺し) — cross stitch
- **Naname Jūji-zashi** (斜め十字刺し) — diagonal cross stitch
- **Komesashi** (米刺し) — rice stitch (4 passes)
- **Tsuzuki Yamagata** (続き山形) — continuous mountains, geometry extracted programmatically from a book diagram
- **Hitomezashi Generator** (一目刺し) — an interactive generator for any one-stitch pattern, with graphical row/column toggles, named presets (Kōshi, Kaki no Hana), and a Fibonacci Snowflake fractal preset

## Usage

Open [`Sashiko — Pattern Library.htm`](Sashiko%20%E2%80%94%20Pattern%20Library.htm) (or `index.html`, an identical copy used for GitHub Pages) directly in a browser. That's it.

## Project structure

- `Sashiko — Pattern Library.htm` / `index.html` — the entire app: HTML, CSS, and canvas rendering logic in one file
- `CLAUDE.md` — architecture documentation (rendering engines, color palette, generator internals)
- `ROUTING.md` — rules for ordering and colouring the stitch animation path
- `tools/pattern_extractor.py` — reusable tool to extract pattern geometry programmatically from book diagrams (colour-layer separation, grid detection, segment tracing) rather than guessing it by eye

## Notes

This repo intentionally does not include the source book scans used as reference material during development — only the original code and documentation.
