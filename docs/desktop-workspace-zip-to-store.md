# Import an old Desktop workspace ZIP into a selected Etsy store

This workflow runs **only inside PaletteIQ Desktop**. It does not require
a Windows installer rebuild to review the code, but the new feature will only
appear inside a Desktop build that includes these changes.

## Usage

1. In PaletteIQ Desktop, sign in to the account that owns the destination.
2. Choose **Settings → Backup & Restore** (rightmost settings tab).
3. In **Desktop Workspace ZIP → Selected Store**, click **Choose workspace ZIP**.
   A trusted Windows file dialog opens; ZIP bytes are never uploaded via the
   browser or Cloudflare Worker. The archive is extracted to a temporary
   Desktop-only folder.
4. Choose the **destination store** from your account.
   Create an empty store first using the **Stores** page if desired.
5. Choose duplicate-ID policy:
   - **Skip** — leave matching project IDs unchanged.
   - **Replace** — replace matching IDs **only when already owned by this store**.
     Refuse projects with active image batches.
   - **Keep Both** — create new collection IDs where duplicates exist, and
     update thumbnail image links to the new collection.
6. Click **Preview ZIP**. Inspect source collections, characters, valid
   PNG/JPG files, missing files, cross-store/active-batch conflicts.
7. A missing/corrupt file blocks restore by default. **Allow partial image
   recovery** is an explicit opt-in: remove missing image links, and mark a
   finished character as Ready only if neither the original nor the upscale
   image survived.
8. Optionally include **non-secret** production preferences. API keys are
   never imported or overwritten.
9. Confirm **Restore ZIP to selected store**. PaletteIQ first creates an
   entire SQLite safety snapshot in the Desktop's local
   `backups/before-store-import/` directory, then verifies PNG/JPG bytes
   with SHA-256 before transactionally importing project rows into the store.
10. Reload collections or switch to the destination store to verify originals,
    upscale images, thumbnails, and listing preview images.

## Data behavior

- ZIP must use `paletteiq-workspace-backup` manifest version 1 and contain
  `database/paletteiq.db` plus PNG/JPG under
  `images/collections/<legacy_owner>/`. Image-batch subdirectories are
  supported.
- All image files copied into the destination store receive **new asset
  UUIDs** and are verified against the original bytes. Both direct images
  and old batch URLs are converted to direct native asset URLs. Thumbnail
  URLs point at the destination collection ID.
- **No existing PNG/JPG in any store is overwritten or deleted.**
- Old OpenAI image batches and research jobs are not started or imported
  as active jobs. Prompt text, completed character metadata, SEO listing
  data, thumbnail designs, and saved listing image URLs are preserved.
- The source ZIP, old workspace and all other stores remain unchanged.
- SQLite snapshot includes the *existing* locally encrypted credentials.
  It stays on the user's computer. **Do not share the entire snapshot**.
  The original ZIP export now clears all four API credential fields.
- On database failure, SQL changes roll back. Newly created image files
  are removed on a handled rollback; an unexpected OS crash may leave
  harmless orphan files with new UUIDs, never existing data loss.
- The Desktop supports its older **Restore ZIP as separate workspace**
  menu action independently; that action does *not* import into a store.
- Old Web-only JSON exports or `.wrangler/state` directories are **not**
  the same format as a Desktop workspace ZIP. Use the separately available
  JSON restore/migration workflow for those sources.

## Verify

On Windows x64 with Node.js 22+:

```powershell
node --test tests/desktop-workspace-store-import.test.mjs tests/desktop-workspace-zip-windows.test.mjs
```

Windows CI also runs this suite:
`.github/workflows/desktop-workspace-restore.yml`

The existing Linux TypeScript + production test workflow verifies that the
new import route and Settings UI compile without requiring an EXE build.

**Before final release:** run the new Desktop app in a clean Windows user
profile, import a copy of a real old ZIP, verify image previews and store
switching, and confirm existing workspace data remains unchanged.
