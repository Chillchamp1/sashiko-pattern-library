// Runs the extracted unit cells through the REAL router from src/ (via the routing
// harness, so it can't drift), reports the routing metrics per mode, and writes an SVG
// of the tiled result so the geometry can be eyeballed against the book plate.
//
// Usage:  node tools/book-import/verify.js
//         node tools/book-import/verify.js kagome
//
// Reads tools/book-import/out/*.json. Touches nothing else.

const fs = require('fs');
const path = require('path');
const { loadRouting } = require('../routing/load-routing.js');

const OUT = path.join(__dirname, 'out');
const MODES = ['default', 'continuous', 'contour', 'sequential'];
const R = loadRouting();

const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

function metrics(pat, mode) {
  const segs = R.genTiledSegs({ ...pat, routingMode: mode });
  const p = R.buildExpPath(segs, pat.famOrder, mode,
    { iso: pat.gridType === 'isometric', famRouting: pat.famRouting || null });
  let strokes = 0, jumps = 0, jumpLen = 0, maxTurn = 0, prevEnd = null;
  for (let i = 0; i < p.length; i++) {
    const s = p[i];
    if (s.jump || i === 0) {
      strokes++;
      if (i > 0 && prevEnd) { jumps++; jumpLen += dist(prevEnd, s.start); }
    } else {
      const a = p[i - 1];
      const d1 = [a.end[0] - a.start[0], a.end[1] - a.start[1]];
      const d2 = [s.end[0] - s.start[0], s.end[1] - s.start[1]];
      const l1 = Math.hypot(...d1) || 1, l2 = Math.hypot(...d2) || 1;
      const dot = Math.max(-1, Math.min(1, (d1[0] * d2[0] + d1[1] * d2[1]) / (l1 * l2)));
      maxTurn = Math.max(maxTurn, Math.acos(dot) * 180 / Math.PI);
    }
    prevEnd = s.end;
  }
  return { segs: segs.length, strokes, jumps, jumpLen: +jumpLen.toFixed(1), maxTurn: Math.round(maxTurn) };
}

// Every tiled segment must be covered exactly once by the routed path.
function coverage(pat, mode) {
  const segs = R.genTiledSegs({ ...pat, routingMode: mode });
  const p = R.buildExpPath(segs, pat.famOrder, mode,
    { iso: pat.gridType === 'isometric', famRouting: pat.famRouting || null });
  const k = s => {
    const a = [s.start[0].toFixed(3), s.start[1].toFixed(3)].join(),
          b = [s.end[0].toFixed(3), s.end[1].toFixed(3)].join();
    return a < b ? a + '|' + b : b + '|' + a;
  };
  const want = new Map();
  segs.forEach(s => want.set(k(s), (want.get(k(s)) || 0) + 1));
  const got = new Map();
  p.forEach(s => got.set(k(s), (got.get(k(s)) || 0) + 1));
  let missing = 0, dupe = 0;
  for (const [key, n] of want) {
    const m = got.get(key) || 0;
    if (m < n) missing += n - m;
    if (m > n) dupe += m - n;
  }
  return { total: segs.length, missing, dupe };
}

function svg(pat, mode, file) {
  const segs = R.genTiledSegs({ ...pat, routingMode: mode });
  const lay = R.computeExpLayout(pat);
  const S = R.SIZE || 372;
  const COL = ['#88c4a4', '#9cbcd8', '#e0b890', '#b0a0e0', '#cccccc'];
  const parts = [`<rect width="${S}" height="${S}" fill="#1a3a5c"/>`];
  for (const s of segs) {
    const a = lay.g2s(s.start), b = lay.g2s(s.end);
    if (Math.max(a.x, b.x) < -5 || Math.min(a.x, b.x) > S + 5) continue;
    if (Math.max(a.y, b.y) < -5 || Math.min(a.y, b.y) > S + 5) continue;
    parts.push(`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${COL[(s.fam ?? 4) % COL.length]}" stroke-width="2.4" stroke-linecap="round"/>`);
  }
  fs.writeFileSync(file,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">${parts.join('')}</svg>`);
}

const only = process.argv[2];
const files = fs.readdirSync(OUT).filter(f => f.endsWith('.json') && (!only || f === only + '.json'));
if (!files.length) { console.error('nothing in', OUT); process.exit(1); }

let bad = false;
for (const f of files) {
  const pat = JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
  console.log(`\n${pat.name}   cell ${pat.bbox.maxU}x${pat.bbox.maxV}, ${pat.lines.length} lines, ${new Set(pat.families).size} families`);
  console.log('  mode         segs  strokes  jumps   jumpLen  maxTurn   cover');
  for (const m of MODES) {
    const x = metrics(pat, m);
    const c = coverage(pat, m);
    const ok = c.missing === 0 && c.dupe === 0;
    if (m === pat.routingMode && !ok) bad = true;
    console.log('  %s %s %s %s %s %s   %s',
      m.padEnd(11), String(x.segs).padStart(5), String(x.strokes).padStart(7),
      String(x.jumps).padStart(6), String(x.jumpLen).padStart(9),
      String(x.maxTurn).padStart(7),
      ok ? 'exact' : `MISSING ${c.missing} DUPE ${c.dupe}`);
  }
  const out = path.join(OUT, f.replace('.json', '.svg'));
  svg(pat, pat.routingMode, out);
  console.log('  preview ->', path.relative(path.join(__dirname, '..', '..'), out));
}
process.exit(bad ? 1 : 0);
