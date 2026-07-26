// Renders firestore.rules for deployment by substituting the admin address list.
//
//   node tools/firebase/render-rules.js --emails "'a@x.com','b@y.com'" -o out.rules
//   ADMIN_EMAILS="'a@x.com'" node tools/firebase/render-rules.js -o out.rules
//
// The addresses live in the GitHub secret ADMIN_EMAILS, never in the repo — this
// repository is public. The rendered file is a build artefact: deploy it, don't commit
// it (check-rules.js enforces that).
//
// Every failure mode here is a LOCKOUT: rules that deploy with an empty or malformed
// admin list make isAdmin() match nobody, which silently removes the ability to publish,
// edit published patterns, reorder the gallery, moderate comments and approve photos.
// So this refuses to emit anything it cannot fully validate.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'firestore.rules');
const TOKEN = '__ADMIN_EMAILS__';

function die(msg) {
  console.error('render-rules: ' + msg);
  process.exit(1);
}

const argv = process.argv.slice(2);
const arg = k => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : undefined;
};

const emails = (arg('--emails') || process.env.ADMIN_EMAILS || '').trim();
const out = arg('-o') || arg('--out');

if (!emails) die('no admin addresses. Pass --emails or set ADMIN_EMAILS.');
if (!out) die('no output path. Pass -o <file>.');

// Expect a rules list literal: 'a@x.com', 'b@y.com'
const parts = emails.split(',').map(s => s.trim()).filter(Boolean);
if (!parts.length) die('admin address list is empty.');
for (const p of parts) {
  if (!/^'[^'@\s]+@[^'@\s]+\.[^'@\s]+'$/.test(p)) {
    die(`malformed entry ${JSON.stringify(p)} — expected single-quoted addresses, ` +
        `e.g. "'a@x.com','b@y.com'"`);
  }
}

let src = fs.readFileSync(SRC, 'utf8');
if (!src.includes(TOKEN)) die(`${TOKEN} not found in firestore.rules — already rendered?`);

const rendered = src.split(TOKEN).join(parts.join(', '));

// Post-conditions: never emit something that would lock the admin out.
if (rendered.includes(TOKEN)) die('token still present after substitution.');
const m = rendered.match(/request\.auth\.token\.email in \[([^\]]*)\]/);
if (!m) die('isAdmin() address list not found in the rendered output.');
if (!m[1].includes('@')) die('rendered admin list contains no address — refusing.');

fs.writeFileSync(out, rendered);
console.log(`render-rules: wrote ${out} with ${parts.length} admin address(es).`);
