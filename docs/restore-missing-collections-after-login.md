# URGENT: collections disappeared after enabling email/password login

**Do not uninstall, reset, delete .wrangler, or erase the Desktop data directory.**
A blank Collections tab does **not** establish that the data was erased.

## Why it happens

Old local development sessions stored collections under owner `local_seedy`,
while new email/password logins filter projects by the active account+store
owner `user_{accountId}_store_{storeId}`. SQLite/D1 project rows and their
associated Miniflare R2 image objects can therefore survive an update but
appear missing in the new account.

No recovery script can reconstruct data from a deleted/overwritten state.
The tools below **first inspect** without modifying data, and **refuse to
claim a legacy owner** unless you explicitly select the destination account
and store.

## Local Web app (npm.cmd run dev, localhost:5173)

Use the **ORIGINAL PaletteIQ repository directory** that previously contained
the collections. Do not create a new clone and expect data to be there.
Close the PaletteIQ browser tab and stop the local dev process (`Ctrl+C`).

In Windows PowerShell in that existing directory:

```powershell
git fetch origin
git switch feature/reference-assets-thumbnail-prompt
git pull origin feature/reference-assets-thumbnail-prompt
node scripts/inspect-lost-collections.cjs
```

The **read-only inspector** searches the old `.wrangler` and, if present,
Desktop SQLite storage. It reports each database path and collection owner
count. Look for a positive value next to `local_seedy` (perhaps 120
collections). This proves the rows were found, **not** that R2 images were
all checked.

If it reports zero, **DO NOT RUN THE MUTATING MIGRATION**. Try another
original repository folder, for example:

```powershell
node scripts/inspect-lost-collections.cjs --search "C:\the\old\paletteiq"
```

If `local_seedy` rows are found in the correct Web D1 state directory:

1. Make sure the new email/password account and at least one store have been
   registered **in that same local database**.
2. Stop the app. Install only outstanding database migrations, including
   `0006_legacy_asset_recovery.sql`, without deleting data:

```powershell
PowerShell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-local.ps1 -SkipInstall
```

3. Preview the exact account/store claim (this **DOES NOT CHANGE** data):

```powershell
node scripts/recover-local-web-collections.cjs --email "YOUR_REGISTERED_EMAIL"
```

   If the account has more than one store, add
   `--store-name "Exact Store Name"`, or use `--store-id UUID`.

4. After confirming the preview shows the expected positive
   `Legacy collections` count, and **only once the dev server is stopped**,
   execute the recovery. **This always backs up the entire local D1+R2
   storage directory and verifies the copied byte count before moving
   collection ownership**:

```powershell
node scripts/recover-local-web-collections.cjs --email "YOUR_REGISTERED_EMAIL" --apply --server-stopped
```

5. Keep the printed backup folder permanently. Restart `npm.cmd run dev`,
   sign in to your account and switch to the selected store. Old image URLs
   are resolved through an authorized alias from the new owner to the
   original `generated/local_seedy/` bucket path. Source R2 blobs remain in
   place, so we **do not copy or delete image bodies** during recovery.
6. Check a collection, original PNG thumbnails, ZIP exports, and upscale
   before creating new collections.

**If any step says the database is in a different state path, or multiple
databases contain the same email, stop and share ONLY the diagnostic output
(database paths and counts).** Do not manually update owner SQL, and never
overwrite one DB with another.

### Source files and backup

- Original storage: `<original-repo>\.wrangler\state`
- Automatic FULL backup: `<original-repo>\.wrangler\legacy-recovery-backups\state-before-claim-...`
- Backup includes both D1 tables and R2 binary objects.
- Encrypted API credentials are never silently transplanted to the new store.
  Re-enter them in Settings as needed.
- The script **does not touch image assets or delete old account settings**.
- Backup may need substantial extra free disk space. If there is not enough,
  the script refuses to modify your database.

## Windows Desktop (.exe)

Desktop's database and PNG files usually live under:
`%APPDATA%\PaletteIQ Desktop\paletteiq-data`.

Use `node scripts/inspect-lost-collections.cjs` to identify the old owner
before performing any migration. Back up the entire
`paletteiq-data` folder to a separate drive. Once the new account/store has
been created in Desktop and the app is fully closed, the existing
`scripts/migrate-legacy-desktop-to-store.cjs` supports moving old
`local_seedy` collections to a chosen store. See
`docs/accounts-multi-store-gpu-batches.md` for Desktop-specific commands.
**Do not run the Web recovery script against a Desktop SQLite database.**

## Safety and limitations

- Recovery is intentionally an **explicit local administrative operation**,
  not a self-service web endpoint that any newly registered user could abuse.
- This migration handles a legacy owner of `local_seedy`. Older installed
  apps or other accounts may have different owner identifiers; use the
  read-only inspector first.
- Collection metadata and Miniflare R2 images must originate from the
  same persistent storage folder. If an old clone had a separate
  `.wrangler/state`, keep it intact. Neither `git pull` nor database
  migrations inherently import data from a different clone.
- No code can guarantee recoverability until the actual files are inspected.
