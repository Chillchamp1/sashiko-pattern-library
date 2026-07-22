# Firestore backup → git

`node tools/backup/backup-firestore.js` snapshots the live pattern library into `backup/`
(one JSON file per pattern doc + one per pattern's comment list) so the shared Firestore
data is versioned in this repo. Runs unattended over the **public-read REST API** — no
auth, no secrets, works locally and in CI.

- **Automated:** `.github/workflows/backup.yml` runs it on the **1st of every month**
  (03:17 UTC) and commits only when something actually changed. It can also be triggered
  manually: GitHub → Actions → *Backup Firestore patterns* → **Run workflow**.
- **Deterministic:** files carry no timestamps and keys are recursively sorted, so an
  unchanged library produces an empty diff (and therefore no commit). The git commit
  history *is* the backup timeline — old states are recoverable via `git log -- backup/`.
- **Tombstones included:** `{deleted:true}` docs are backed up too, so a restore cannot
  resurrect deleted patterns (see the tombstone rationale in CLAUDE.md).
- **Privacy:** the Firestore collection is public-read by design, so the backup exposes
  nothing new. It contains no e-mails or personal data — `creatorId` is a random
  anonymous device id, `communityName` is a display name the contributor typed in
  deliberately. Comment docs are backed up **without** their `uid` field (it only grants
  live delete-ownership and would be a pseudonymous device link in a public repo).
- **Restore:** there is no automated restore (deliberately — restores should be a
  considered, manual act). To restore a pattern, take its JSON from `backup/patterns/`
  (or from git history) and write it back to `patterns/{id}` via the Firestore console,
  or temporarily drop it into the app's localStorage `sashiko_exp` on an admin device and
  save — the local→remote sync pushes it.

NB: pattern docs embed their thumbnail as a base64 PNG, so the backup adds a few MB to
the repo; at monthly cadence and current library size that is fine.
