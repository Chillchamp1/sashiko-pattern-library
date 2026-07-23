// Refreshes pattern-clicks.json (repo root): unique pattern-open counts over the
// last 30 days, from GoatCounter's public visitor-counter endpoint (no auth).
// The app tracks every pattern open as the GoatCounter event `pattern/<id>`
// (render.js loadPattern), so each pattern has its own counter.
//
//   node tools/stats/fetch-clicks.js
//
// The JSON is baked into the build (INJECT:pattern-clicks.json → PATTERN_CLICKS)
// and feeds the gallery engagement score (gallery.js _engagement): heavily-viewed
// patterns earn up to 3 bonus points on a log scale. Run weekly by
// .github/workflows/weekly.yml (fetch → build → commit). Deterministic output
// (sorted keys, zero-count ids omitted); a pattern with no data keeps score 0.
// On any fetch failure the existing file is left untouched (exit 1).

const fs = require('fs');
const path = require('path');

const GC = 'https://sashiko.goatcounter.com';
const PROJECT = 'sashiko-library';
const API_KEY = 'AIzaSyAUk0RJKsZYaI5K6ixr7tBGe3yxmwBbWgk'; // public web key, same as the app
const OUT = path.join(__dirname, '..', '..', 'pattern-clicks.json');
const DAYS = 30;

async function fetchPatternIds() {
  const base = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/patterns`;
  let url = `${base}?key=${API_KEY}&pageSize=300&mask.fieldPaths=id&mask.fieldPaths=deleted`;
  const ids = [];
  for (;;) {
    const res = await fetch(url);
    const j = await res.json();
    if (j.error) throw new Error(`Firestore ${j.error.status}: ${j.error.message}`);
    for (const d of (j.documents || [])) {
      const f = d.fields || {};
      const id = f.id && f.id.stringValue;
      const dead = f.deleted && f.deleted.booleanValue;
      if (id && !dead) ids.push(id);
    }
    if (!j.nextPageToken) break;
    url = `${base}?key=${API_KEY}&pageSize=300&pageToken=${j.nextPageToken}&mask.fieldPaths=id&mask.fieldPaths=deleted`;
  }
  return ids;
}

// Built-in (hard-coded) gallery patterns — not in Firestore, but their opens are
// tracked the same way client-side (`pattern/<id>` events) and they rank in the
// merged traditional tab, so fetch their counters too. (The generator is hidden.)
const BUILTIN_IDS = ['juji', 'naname', 'komesashi', 'tsuzuki-yamagata', 'asanoha'];

async function main() {
  const ids = [...BUILTIN_IDS, ...await fetchPatternIds()];
  const start = new Date(Date.now() - DAYS * 86400000).toISOString().slice(0, 10);
  const clicks = {};
  const POOL = 8;
  let next = 0, fails = 0;
  await Promise.all(Array.from({ length: POOL }, async () => {
    while (next < ids.length) {
      const id = ids[next++];
      try {
        const r = await fetch(`${GC}/counter/pattern/${id}.json?start=${start}`);
        const j = await r.json();
        const n = parseInt(String(j.count_unique || j.count || '').replace(/\D/g, ''), 10);
        if (n > 0) clicks[id] = n;
      } catch (e) { fails++; }
    }
  }));
  if (fails > ids.length / 2) throw new Error(`${fails}/${ids.length} counter fetches failed`);
  const sorted = {};
  for (const k of Object.keys(clicks).sort()) sorted[k] = clicks[k];
  fs.writeFileSync(OUT, JSON.stringify(sorted, null, 2) + '\n');
  console.log(`Wrote ${Object.keys(sorted).length} pattern click counts (last ${DAYS} days) to pattern-clicks.json`);
}

main().catch(e => { console.error('fetch-clicks failed:', e.message); process.exit(1); });
