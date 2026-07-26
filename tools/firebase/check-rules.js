// Fails if firestore.rules (or anything else staged in the repo) contains a real email
// address. THIS REPOSITORY IS PUBLIC; the admin addresses belong in the GitHub secret
// ADMIN_EMAILS and nowhere else.
//
//   node tools/firebase/check-rules.js
//
// Run by the rules workflow before deploying, and useful as a pre-commit hook:
//   git config core.hooksPath .githooks

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const TARGETS = ['firestore.rules'];
const TOKEN = '__ADMIN_EMAILS__';
// Deliberately not matching the placeholder or obvious non-addresses in prose.
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

let bad = false;
for (const rel of TARGETS) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) continue;
  const txt = fs.readFileSync(file, 'utf8');

  const hits = [...new Set(txt.match(EMAIL) || [])]
    .filter(e => !/@users\.noreply\.github\.com$/.test(e));
  if (hits.length) {
    bad = true;
    console.error(`check-rules: ${rel} contains ${hits.length} email address(es):`);
    // Print masked — the point is to flag, not to echo them into CI logs.
    hits.forEach(e => console.error('   ' + e.replace(/^(.).*(@.*)$/, '$1***$2')));
  }

  if (!txt.includes(TOKEN)) {
    bad = true;
    console.error(`check-rules: ${rel} is missing ${TOKEN} — the committed copy must ` +
                  `stay a template, not a rendered file.`);
  }
}

if (bad) {
  console.error('\ncheck-rules: FAILED. Keep admin addresses in the ADMIN_EMAILS secret.');
  process.exit(1);
}
console.log('check-rules: ok — firestore.rules is a template, no addresses committed.');
