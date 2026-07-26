# Firestore rules deployment

`firestore.rules` in this repo is a **template**. The admin addresses are not in it and
must never be committed — **this repository is public**, so anything here is published.
They live in a GitHub secret and are substituted at deploy time.

```
firestore.rules  (public, __ADMIN_EMAILS__)  +  ADMIN_EMAILS secret  ->  deployed rules
```

## One-time setup (only you can do this part)

Two repository secrets — *Settings → Secrets and variables → Actions → New secret*:

| Secret | Value |
|---|---|
| `ADMIN_EMAILS` | the quoted, comma-separated list, e.g. `'you@gmail.com','other@gmail.com'` — exactly what goes inside `in [ ... ]` |
| `FIREBASE_SERVICE_ACCOUNT` | the full service-account JSON |

The service account: Firebase Console → Project settings → Service accounts → Generate
new private key. It needs the **Firebase Rules Admin** role
(`roles/firebaserules.admin`) — nothing broader. Paste the whole JSON file as the
secret value.

Neither secret is visible to anyone without repo admin, and GitHub masks them in logs.

## Deploying

Edit `firestore.rules`, commit, push. `.github/workflows/rules.yml` renders and deploys
it. Or run it by hand from the **Actions** tab (*Deploy Firestore rules → Run workflow*).

Locally, if you'd rather:

```bash
node tools/firebase/render-rules.js --emails "'you@gmail.com'" -o /tmp/r.rules
cp /tmp/r.rules firestore.rules && firebase deploy --only firestore:rules
git checkout -- firestore.rules      # never commit the rendered file
```

## Why the guards are aggressive

Every failure mode of this pipeline is the same failure: **an admin list that matches
nobody**. `isAdmin()` gates publishing, editing published patterns, gallery reordering,
comment moderation and photo approval — and a wrong list doesn't error, it just starts
rejecting your writes. So:

- `render-rules.js` refuses to emit anything unless every entry is a properly quoted
  address, and re-checks the output still contains one after substitution.
- The workflow fails if either secret is empty, before it renders or authenticates.
- `check-rules.js` fails if `firestore.rules` contains an address, or has stopped being
  a template — so a rendered file can't be committed by accident.

Run the guard as a pre-commit hook if you like: `git config core.hooksPath .githooks`.

## Verified

The committed template plus your three addresses reproduces the **currently deployed
rules exactly** — a full normalised diff of the logic is identical, so the first run of
this workflow is a no-op. That was checked before wiring anything up, because the point
at which you discover a rules pipeline is wrong should not be the point at which you
lose admin.
