// Pulls every saved pattern from the live Firestore (public read, no auth) into
// test/patterns/<id>.json. Unattended — no app, no clicking, no export button.
//
// Usage:  node tools/routing/fetch-patterns.js
// Needs network + Node 18+ (global fetch). On failure it leaves existing fixtures intact.

const fs = require('fs');
const path = require('path');

const PROJECT = 'sashiko-library';
const API_KEY = 'AIzaSyAUk0RJKsZYaI5K6ixr7tBGe3yxmwBbWgk'; // public web key, same as the app
const OUT = path.join(__dirname, '..', '..', 'test', 'patterns');

// Firestore REST → plain JS. Decodes the typed-value wrapper Firestore returns.
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

async function fetchAll() {
  const base = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/patterns`;
  let url = `${base}?key=${API_KEY}&pageSize=300`;
  const docs = [];
  for (;;) {
    const res = await fetch(url);
    const j = await res.json();
    if (j.error) throw new Error(`Firestore ${j.error.status}: ${j.error.message}`);
    for (const d of (j.documents || [])) docs.push(decodeFields(d.fields || {}));
    if (!j.nextPageToken) break;
    url = `${base}?key=${API_KEY}&pageSize=300&pageToken=${j.nextPageToken}`;
  }
  return docs;
}

async function main() {
  let docs;
  try {
    docs = await fetchAll();
  } catch (e) {
    console.error('Fetch failed:', e.message);
    console.error('Existing fixtures left untouched.');
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });
  let n = 0;
  for (const p of docs) {
    if (!p.id) continue;
    fs.writeFileSync(path.join(OUT, `${p.id}.json`), JSON.stringify(p, null, 2));
    n++;
  }
  console.log(`Wrote ${n} pattern fixtures to ${path.relative(process.cwd(), OUT)}`);
  const withMode = docs.filter(p => p.routingMode);
  console.log(`  (${withMode.length} have an explicit routingMode)`);
}

main();
