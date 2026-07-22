// Lists pattern photos that the admin hasn't reviewed yet (approved:false) as a
// Markdown fragment on stdout — EMPTY output = nothing to review. Used by
// .github/workflows/weekly.yml to open a "photo review" GitHub issue (GitHub then
// e-mails the owner), so nobody has to routinely check the site for new photos.
// Public-read REST, no auth. Tolerates the /photos rules not being deployed
// (prints nothing).

const PROJECT = 'sashiko-library';
const API_KEY = 'AIzaSyAUk0RJKsZYaI5K6ixr7tBGe3yxmwBbWgk'; // public web key, same as the app
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

function val(f, k) { const v = f && f[k]; if (!v) return undefined;
  return v.stringValue !== undefined ? v.stringValue
       : v.booleanValue !== undefined ? v.booleanValue
       : v.integerValue !== undefined ? Number(v.integerValue)
       : v.doubleValue !== undefined ? v.doubleValue : undefined; }

async function list(url) {
  const docs = [];
  let pageToken = '';
  for (;;) {
    const res = await fetch(`${url}?key=${API_KEY}&pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`);
    const j = await res.json();
    if (j.error) throw new Error(j.error.status);
    docs.push(...(j.documents || []));
    if (!j.nextPageToken) break;
    pageToken = j.nextPageToken;
  }
  return docs;
}

async function main() {
  const pats = (await list(`${BASE}/patterns`))
    .map(d => d.fields || {})
    .filter(f => val(f, 'id') && !val(f, 'deleted'))
    .map(f => ({ id: val(f, 'id'), name: val(f, 'name') || val(f, 'id') }));
  const lines = [];
  const POOL = 8;
  let next = 0;
  await Promise.all(Array.from({ length: POOL }, async () => {
    while (next < pats.length) {
      const p = pats[next++];
      let photos = [];
      try { photos = await list(`${BASE}/patterns/${p.id}/photos`); } catch (e) { continue; }
      for (const d of photos) {
        const f = d.fields || {};
        if (val(f, 'approved')) continue;
        const when = val(f, 'created') ? new Date(val(f, 'created')).toISOString().slice(0, 10) : '?';
        lines.push(`- **${p.name}** — photo by "${val(f, 'handle') || 'anon'}" (${when}): https://sashikolib.org/#${p.id}`);
      }
    }
  }));
  if (!lines.length) return;
  console.log('These pattern photos are live on the site but not yet reviewed.');
  console.log('Open each pattern → Comments panel: **✓ keep** archives the photo into the monthly git backup, **✕** deletes it.');
  console.log('');
  lines.sort().forEach(l => console.log(l));
  console.log('');
  console.log('Close this issue once everything is handled — the weekly check reopens it only if new photos appear.');
}

main().catch(() => {});   // never fail the workflow — empty output = no issue
