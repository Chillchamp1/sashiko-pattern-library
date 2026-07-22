// Backs up the live Firestore pattern library into backup/ for committing to git.
// Public-read REST only (same as tools/routing/fetch-patterns.js) — no auth, no secrets.
//
//   node tools/backup/backup-firestore.js
//
// What it writes (deterministic, so an unchanged library produces an EMPTY git diff):
//   backup/patterns/<id>.json   every pattern doc verbatim, INCLUDING tombstones
//                               ({deleted:true} docs — a restore must not resurrect
//                               deleted patterns), with recursively sorted keys
//   backup/comments/<id>.json   the pattern's comments (only when it has any),
//                               with the anonymous auth `uid` stripped — it only
//                               grants delete-ownership live and is useless in a
//                               backup (defense-in-depth for the public repo)
//   backup/photos/<id>.json     the pattern's APPROVED photos (compressed base64
//                               JPEGs; unapproved junk is deliberately excluded),
//                               `uid` stripped like the comments
// Files whose doc no longer exists remotely are pruned (git history keeps them).
// No timestamps inside the files — the git commit itself dates each backup.
//
// Needs network + Node 18+ (global fetch). On fetch failure it exits 1 and leaves
// the existing backup untouched.

const fs = require('fs');
const path = require('path');

const PROJECT = 'sashiko-library';
const API_KEY = 'AIzaSyAUk0RJKsZYaI5K6ixr7tBGe3yxmwBbWgk'; // public web key, same as the app
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const OUT = path.join(__dirname, '..', '..', 'backup');

function decode(v) {
  if (v == null) return null;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  return null;
}
function decodeFields(fields) {
  const o = {};
  for (const k of Object.keys(fields)) o[k] = decode(fields[k]);
  return o;
}

// Recursively sort object keys so the JSON on disk is byte-stable between runs.
function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = stable(v[k]);
    return o;
  }
  return v;
}

async function fetchCollection(url) {
  const docs = [];
  let pageToken = '';
  for (;;) {
    const res = await fetch(`${url}?key=${API_KEY}&pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`);
    const j = await res.json();
    if (j.error) throw new Error(`Firestore ${j.error.status}: ${j.error.message}`);
    for (const d of (j.documents || [])) docs.push(decodeFields(d.fields || {}));
    if (!j.nextPageToken) break;
    pageToken = j.nextPageToken;
  }
  return docs;
}

function writeDir(dir, byId) {
  fs.mkdirSync(dir, { recursive: true });
  let wrote = 0, pruned = 0;
  const keep = new Set([...byId.keys()].map(id => `${id}.json`));
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.json') && !keep.has(f)) { fs.unlinkSync(path.join(dir, f)); pruned++; }
  }
  for (const [id, data] of byId) {
    const file = path.join(dir, `${id}.json`);
    const json = JSON.stringify(stable(data), null, 2) + '\n';
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== json) { fs.writeFileSync(file, json); wrote++; }
  }
  return { wrote, pruned };
}

async function main() {
  const pats = await fetchCollection(`${BASE}/patterns`);
  const patById = new Map();
  for (const p of pats) if (p.id) patById.set(p.id, p);

  // Comments + approved photos per pattern (public read; sparse — most have none).
  const comById = new Map();
  const phoById = new Map();
  const ids = [...patById.keys()];
  const POOL = 8;
  let next = 0;
  await Promise.all(Array.from({ length: POOL }, async () => {
    while (next < ids.length) {
      const id = ids[next++];
      const comments = await fetchCollection(`${BASE}/patterns/${id}/comments`);
      if (comments.length) {
        comments.forEach(c => delete c.uid);   // strip the anonymous auth uid
        comments.sort((a, b) => (a.created || 0) - (b.created || 0));
        comById.set(id, comments);
      }
      // Tolerate PERMISSION_DENIED here: until the /photos rules block is deployed
      // the subcollection is unreadable — the rest of the backup must still run.
      let photos = [];
      try { photos = (await fetchCollection(`${BASE}/patterns/${id}/photos`)).filter(p => p.approved); } catch (e) {}
      if (photos.length) {
        photos.forEach(p => delete p.uid);
        photos.sort((a, b) => (a.created || 0) - (b.created || 0));
        phoById.set(id, photos);
      }
    }
  }));

  const p = writeDir(path.join(OUT, 'patterns'), patById);
  const c = writeDir(path.join(OUT, 'comments'), comById);
  const f = writeDir(path.join(OUT, 'photos'), phoById);
  const tomb = pats.filter(x => x.deleted).length;
  console.log(`Backed up ${patById.size} pattern docs (${tomb} tombstones), comments for ${comById.size} and approved photos for ${phoById.size} patterns.`);
  console.log(`  patterns: ${p.wrote} written/updated, ${p.pruned} pruned`);
  console.log(`  comments: ${c.wrote} written/updated, ${c.pruned} pruned`);
  console.log(`  photos:   ${f.wrote} written/updated, ${f.pruned} pruned`);
}

main().catch(e => { console.error('Backup failed:', e.message); process.exit(1); });
