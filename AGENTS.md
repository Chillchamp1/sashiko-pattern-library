# Agent guide

Project context and conventions live in **`CLAUDE.md`** — read it first (build system,
architecture, colours, routing rules). This file is the same guidance for non-Claude agents
(opencode/DeepSeek, etc.).

## Key rules

- Deliverable is `Sashiko — Pattern Library.htm` (+ `index.html`), built by `python build.py`
  from `src/`. **Never edit the `.htm`/`index.html` directly** — they're build artefacts.
- Stitch routing follows `ROUTING.md`.

## Debugging stitch routing — headless, no browser

Run the real router from `src/` in Node against real patterns:

```bash
node tools/routing/fetch-patterns.js        # refresh fixtures from the live library (no auth/clicking)
node tools/routing/route.js                 # metrics per pattern (strokes/jumps/jumpLen/maxTurn/midArc)
node tools/routing/route.js <name> <mode>   # drill into one pattern+mode
node tools/routing/route.js --check         # regression-check against test/routing-snapshots.json
```

Details: `tools/routing/README.md`.
