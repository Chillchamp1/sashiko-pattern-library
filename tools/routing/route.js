// Headless routing inspector. Runs the REAL router (via load-routing.js) on the
// fixtures in test/patterns/ and prints metrics that matter for debugging:
//   strokes      — needle runs (fewer = more continuous)
//   jumps        — needle re-insertions (cost driver)
//   jumpLen      — total back-thread carry length (grid units)
//   maxTurn      — sharpest turn inside any stroke (degrees)
//   midArc       — strokes that START in the middle of an arc (should be 0)
//
// Usage:
//   node tools/routing/route.js                 # every fixture, in its saved mode
//   node tools/routing/route.js <id>            # one pattern, all 3 modes
//   node tools/routing/route.js <id> <mode>     # one pattern, one mode
//   node tools/routing/route.js --all-modes     # every fixture × every mode
//   node tools/routing/route.js --snapshot      # write golden metrics
//   node tools/routing/route.js --check         # diff against golden, exit 1 on change
//
// Modes: default (straight rows) | continuous (zigzag) | contour (waves)

const fs = require('fs');
const path = require('path');
const { loadRouting } = require('./load-routing');

const PAT_DIR = path.join(__dirname, '..', '..', 'test', 'patterns');
const SNAP = path.join(__dirname, '..', '..', 'test', 'routing-snapshots.json');
const MODES = ['default', 'continuous', 'contour'];
const R = loadRouting();

const Q = 1e-3;
const key = p => Math.round(p[0] / Q) + ',' + Math.round(p[1] / Q);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function loadFixtures() {
  if (!fs.existsSync(PAT_DIR)) return [];
  return fs.readdirSync(PAT_DIR).filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(PAT_DIR, f), 'utf8')));
}

// Arc interior vs endpoint vertices, so we can detect mid-arc starts.
// Closed-loop arcs (full circles, start==end) have NO endpoint, so starting them
// anywhere is legitimate — they're excluded from the interior set. `midArc` therefore
// counts only OPEN arcs entered partway along their curve (the real routing violation).
function arcVertexSets(segs) {
  const byAid = new Map();
  for (const s of segs) if (s.aid !== undefined && s.aid >= 0) {
    if (!byAid.has(s.aid)) byAid.set(s.aid, []);
    byAid.get(s.aid).push(s);
  }
  const endpoints = new Set(), interior = new Set();
  for (const list of byAid.values()) {
    const start = key(list[0].start), end = key(list[list.length - 1].end);
    endpoints.add(start); endpoints.add(end);
    if (start === end) continue; // closed loop — no endpoint, never a violation
    for (let i = 1; i < list.length; i++) interior.add(key(list[i].start));
  }
  for (const e of endpoints) interior.delete(e);
  return { endpoints, interior };
}

function metrics(pat, mode) {
  const segs = R.genTiledSegs({ ...pat, routingMode: mode });
  const path0 = R.buildExpPath(segs, pat.famOrder, mode);
  const { interior } = arcVertexSets(segs);

  let strokes = 0, jumps = 0, jumpLen = 0, stitchLen = 0, maxTurn = 0, midArc = 0;
  let prevEnd = null, strokeStartIdx = -1;

  for (let i = 0; i < path0.length; i++) {
    const s = path0[i];
    const newStroke = s.jump || i === 0;
    if (newStroke) {
      strokes++;
      if (i > 0) { jumps++; if (prevEnd) jumpLen += dist(prevEnd, s.start); }
      if (interior.has(key(s.start))) midArc++;
      strokeStartIdx = i;
    } else {
      // interior turn between previous stitch and this one (same stroke)
      const prev = path0[i - 1];
      const d1 = [prev.end[0] - prev.start[0], prev.end[1] - prev.start[1]];
      const d2 = [s.end[0] - s.start[0], s.end[1] - s.start[1]];
      const l1 = Math.hypot(d1[0], d1[1]) || 1, l2 = Math.hypot(d2[0], d2[1]) || 1;
      let dot = (d1[0] * d2[0] + d1[1] * d2[1]) / (l1 * l2);
      dot = Math.max(-1, Math.min(1, dot));
      const turn = Math.acos(dot) * 180 / Math.PI;
      if (turn > maxTurn) maxTurn = turn;
    }
    stitchLen += dist(s.start, s.end);
    prevEnd = s.end;
  }
  return {
    segs: segs.length, strokes, jumps,
    jumpLen: +jumpLen.toFixed(1), stitchLen: +stitchLen.toFixed(1),
    maxTurn: +maxTurn.toFixed(0), midArc,
  };
}

function fmtRow(name, mode, m) {
  return [
    name.slice(0, 34).padEnd(34),
    mode.padEnd(11),
    String(m.strokes).padStart(7),
    String(m.jumps).padStart(6),
    String(m.jumpLen).padStart(9),
    (m.maxTurn + '°').padStart(8),
    String(m.midArc).padStart(7),
  ].join(' ');
}
function header() {
  console.log([
    'pattern'.padEnd(34), 'mode'.padEnd(11), 'strokes'.padStart(7),
    'jumps'.padStart(6), 'jumpLen'.padStart(9), 'maxTurn'.padStart(8), 'midArc'.padStart(7),
  ].join(' '));
  console.log('-'.repeat(86));
}

function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter(a => a.startsWith('--')));
  const pos = args.filter(a => !a.startsWith('--'));
  const fixtures = loadFixtures();
  if (!fixtures.length) {
    console.error('No fixtures in test/patterns/. Run:  node tools/routing/fetch-patterns.js');
    process.exit(1);
  }

  // --snapshot / --check operate over every fixture × every mode for full coverage.
  if (flags.has('--snapshot') || flags.has('--check')) {
    const snap = {};
    for (const p of fixtures) for (const mode of MODES) {
      try { snap[`${p.id}:${mode}`] = metrics(p, mode); }
      catch (e) { snap[`${p.id}:${mode}`] = { error: e.message }; }
    }
    if (flags.has('--snapshot')) {
      fs.writeFileSync(SNAP, JSON.stringify(snap, null, 2));
      console.log(`Wrote ${Object.keys(snap).length} snapshot rows to ${path.relative(process.cwd(), SNAP)}`);
      return;
    }
    const old = fs.existsSync(SNAP) ? JSON.parse(fs.readFileSync(SNAP, 'utf8')) : {};
    let diffs = 0;
    for (const k of Object.keys(snap)) {
      const a = JSON.stringify(old[k]), b = JSON.stringify(snap[k]);
      if (a !== b) { diffs++; console.log(`CHANGED ${k}\n   old ${a}\n   new ${b}`); }
    }
    console.log(diffs ? `\n${diffs} routing metric(s) changed.` : 'No routing changes vs. snapshot.');
    process.exit(diffs ? 1 : 0);
  }

  header();
  const pick = pos[0] ? fixtures.filter(p => p.id === pos[0] || (p.name || '').toLowerCase().includes(pos[0].toLowerCase())) : fixtures;
  if (!pick.length) { console.error('No fixture matches:', pos[0]); process.exit(1); }
  for (const p of pick) {
    const modes = pos[1] ? [pos[1]] : (pos[0] || flags.has('--all-modes')) ? MODES : [p.routingMode || 'default'];
    for (const mode of modes) {
      try { console.log(fmtRow(p.name || p.id, mode, metrics(p, mode))); }
      catch (e) { console.log(fmtRow(p.name || p.id, mode, { strokes: '!', jumps: '!', jumpLen: '!', maxTurn: 'ERR', midArc: '!' }) + '  ' + e.message); }
    }
    if (pos[0]) console.log('');
  }
}

main();
