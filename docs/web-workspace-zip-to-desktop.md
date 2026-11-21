# Import Web localhost data into PaletteIQ Desktop

This is a **one-way, explicit, offline migration** for the PC that runs both
PaletteIQ Web development and PaletteIQ Desktop. **Other users only need
Desktop; no Web server is required to use or restore a Desktop workspace.**

## 1. Export the original Web store with PNGs

1. Run your original Web development server (usually `npm run dev`, hosted
   on `http://localhost:5173`). Sign in to the store holding the Collections.
2. If you previously enabled Shared Local Workspace, the browser may redirect
   to the Desktop backend. To access the **original independent Web database**
   temporarily, open **`http://localhost:5173/?webExport=1`**. This bypasses
   the redirect only for this page; it does not reset the saved shared preference.
3. Open **Settings → Backup & Restore** and choose
   **Export current Web store — ZIP with PNGs**.
4. The Web exporter checks the currently authenticated store's persisted
   Collections and referenced PNG/JPG, including Batch results, upscale
   results, thumbnails and listing image previews.
5. Download `paletteiq-web-workspace-YYYY-MM-DD.zip`. The ZIP includes:
   - `manifest.json` (format `paletteiq-web-workspace-export`, version 1)
   - `database/web-collections.json` (Collection data and safe preferences)
   - `images/collections/<source-owner>/...` (actual PNG/JPG originals,
     including Batch subdirectories).

**Do not use Export current store (.json)** for complete image migration.
The older JSON backup deliberately excludes the image bytes and will not
rebuild the generated artwork on Desktop. If even one referenced PNG/JPG
is missing, ZIP export refuses to start instead of producing a deceptive
completed Collection. Retry after repairing the original Web image storage.

## 2. Import into Desktop (choose the destination store)

1. Start PaletteIQ Desktop. Use the installed application or run
   `npm run desktop:dev` from your local checkout.
2. Sign in to the account that owns the destination store.
3. Navigate to **Settings → Backup & Restore → Web / Desktop Workspace ZIP →
   Selected Store**.
4. Click **Choose workspace ZIP** and select the exported Web ZIP using the
   trusted Windows file picker.
5. Select the target Etsy store. A fresh empty store is safest for a first
   migration. Choose **Skip** (default), **Keep Both**, or **Replace** for
   duplicate Collection IDs. Replace is prohibited for another store's data
   and while active destination batches exist.
6. Click **Preview ZIP**. Confirm the number of Collections, characters,
   available PNG/JPG files, missing files, and name conflicts.
7. Optionally import nonsecret settings; existing encrypted API credentials
   are **not** transferred or overwritten. Click **Restore ZIP to selected
   store**, then verify Collection preview images and Draft results.

Desktop extracts this ZIP into a temporary staging directory, validates the
metadata, builds a minimal SQLite file there, and invokes its pre-existing
safe store importer. It creates a **full local Desktop database safety
snapshot** before changing the destination. Each imported PNG/JPG is copied
under a new asset UUID and verified with SHA-256; existing files are never
deleted or overwritten.

The **source Web workspace and its original data remain unchanged**.
Subsequent changes in Web will not sync automatically into Desktop. Repeat
the export/import when you intentionally want another snapshot.

## In-progress Full Automation / OpenAI billing safety

The portable ZIP includes saved Collection fields, prompts, images, SEO Draft
and relevant creative metadata; **it does not transfer live OpenAI Batch
queues, credentials, or job execution authority**.

On importing a Web Collection whose Full Automation has not completed, the
Desktop copy is explicitly marked `paused` and `enabled=false`. Historic
research/prompt jobs are not automatically restarted. The source Web
instance may still own valid paid jobs on OpenAI; inspect/stop that source
workflow before making new paid requests. Missing images do **not** mean the
source's OpenAI submission failed. Manual review and a separate recovery plan
are required to resume an in-flight job *across* databases. Never run two
independent schedulers for the same paid workflow.

## Shared Workspace vs import

- **Web → Desktop ZIP import** copies historical data into a selected Desktop
  store and leaves Web intact. This is the recommended migration for the
  developer PC.
- **Shared Local Workspace** (optional) opens the Desktop backend
  `http://127.0.0.1:18763` from a browser. It displays the same live
  Desktop database, **not** the old separate Web development database.
- Installer-only PCs do not require Web or any shared-workspace setup.
- A fully powered-off PC cannot start new local jobs. Reopened Desktop
  resumes **its own** persisted jobs when their OpenAI receipts are valid.

## Verification

```powershell
npm run typecheck
npm run test:production
node --experimental-strip-types --test tests/web-workspace-zip-to-desktop.test.mjs
```

The test suite uses fake PNG magic-header fixtures and does not send paid
OpenAI requests. After updating your PC, perform one real end-to-end smoke
test on a fresh Desktop destination store with saved PNGs and check that
the image previews open, not only that image counts look correct.
