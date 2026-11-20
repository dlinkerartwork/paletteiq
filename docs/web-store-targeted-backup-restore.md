# Restore a pre-login PaletteIQ JSON backup into a chosen Web store

Implemented only for **PaletteIQ Web**. This release does not build or modify
the Windows installer, and Desktop's native bridge is explicitly not allowed
to use the Web-only restore endpoint.

## User flow

1. Sign in and open **Settings → JSON Backup & Restore**.
2. Choose a legacy `paletteiq-backup` **version 1** JSON file (up to 10 MB).
   Legacy `.txt` exports containing JSON are accepted too.
3. Choose any store under the authenticated account or **New store** to create
   a separate destination without switching your active store.
4. Choose duplicate-ID handling:
   - **Skip duplicates** — preserve the destination or foreign-store row
   - **Replace duplicates** — overwrite only rows **already owned by the destination store**
   - **Keep both** — generate a new collection ID for any duplicate; never overwrite another store
5. Optionally import **non-secret** production settings; by default,
   destination settings are untouched.
6. Click **Preview restore**. Verify collection/character/image-reference counts
   and the destination store. Confirm the second-stage **Restore to selected store** action.
7. Before SQL changes, a pre-restore JSON safety snapshot of the
   destination store's *entire collection metadata and non-secret preferences*
   is uploaded to **R2** and verified. D1 changes are then submitted using one
   transactional `D1.batch` call.
8. After success, download the safety snapshot and refresh the active store or
   switch to the destination store. Inspect collections and image availability.

## What this imports

- Collections, characters, prompts, SEO metadata, thumbnail design metadata,
  listing image metadata, reference URLs and review state.
- Optional non-secret preferences. **API credentials are never imported.**

## What this does NOT import

- **PNG/JPG bytes.** The old JSON format contains links
  (`/api/images/...`) but *not* the image files. Old pixels may continue to
  load when their original R2 object exists and the destination store is
  authorized to use the recovered legacy namespace. Otherwise links will
  remain in metadata, but images cannot be displayed. Restore does not
  regenerate, copy, or delete image binaries.
- Workspace `.zip` binary backups. They are **not supported yet in the Web
  UI**. Keep any old ZIP, `.wrangler/state`, or Desktop data directories intact.
- Login accounts, store passwords, credentials or original OpenAI Batch jobs.
  JSON contains collection state, not the original D1 job table.

## Safety and isolation

- Authenticated email/password session and origin checks are required.
- Destination store ownership is checked against the account in the database.
  A client-provided owner namespace is **never** accepted.
- A conflict against any other store or account cannot be replaced.
- On restore, a private R2 snapshot is written under
  `backups/{scoped-owner}/pre-restore/{uuid}.json`. It contains metadata,
  *not* the underlying R2 image binaries or encrypted credentials.
- Snapshot download requires the same authenticated account and store
  ownership. Restoring the snapshot is possible with the same JSON import
  flow, subject to the normal conflict policy.
- Existing image objects are not removed or changed by the restore endpoint.
- Changes to the database are refused if a verified snapshot cannot be
  written, or D1/R2 bindings are unavailable.
- Never delete the original legacy backups merely because restore completed.

## Local Web testing

```powershell
git fetch origin
git switch feature/reference-assets-thumbnail-prompt
git pull origin feature/reference-assets-thumbnail-prompt
npm.cmd run dev
```

Visit **Settings → JSON Backup & Restore**. Review duplicate strategy and
prefer restoring to a new empty store first. Do not manually copy SQLite files
over the new logged-in database.
