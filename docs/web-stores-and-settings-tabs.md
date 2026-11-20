# PaletteIQ Web: Store management, named first store, and Settings tabs

Available on `feature/reference-assets-thumbnail-prompt` (Web). No Windows EXE build is required.

## First sign in and logout

- New accounts must specify the **First Etsy store name** (2–90 characters)
  on the registration form. The hardcoded `My Etsy Store` default is gone
  for new registrations. Existing account/store names are unchanged.
- In the top-right store selector a visible **Logout** button signs out
  after warning about unsaved work.

## Stores page

The **Stores** link in the sidebar opens a dedicated store-management page.
Use it to create additional stores, rename an existing store, or delete an
inactive store with strict confirmation.

**Deletion is deliberately hard to trigger:**
- Account authentication and same-origin POST request required
- Destination store ownership verified on the server
- User must first switch away from the store being deleted
- Last remaining store cannot be deleted
- Stores with ongoing image batches cannot be deleted
- Stores holding recovered `local_seedy` R2 assets cannot be deleted until
  their assets have been migrated to another store
- Type the **exact store name** and **DELETE STORE**
- The backend saves and verifies a private R2 JSON safety archive
  of the store's collections, production preferences and batch metadata
  **before** making any D1 changes
- Changes to project rows, image-batch rows, settings and store records
  happen within one D1 transaction, updating other active sessions to
  the remaining store
- Original PNG/JPG R2 blobs are **not deleted** so they remain physically
  available for manual recovery. The deleted store no longer serves
  these assets, however, and restoring the JSON archive alone will not
  recreate or re-link image binaries.
- The deletion receipt includes an authenticated download link to the
  pre-delete JSON archive. Save this archive immediately.

**Note:** Web store deletion is disabled when the Desktop native bridge is
active. The native Desktop requires a separate safe backup implementation.

## Settings page

The former mixed settings panels are now five independent tabs, left to right:
1. API Credentials
2. Production Defaults
3. Remote GPU Upscale
4. SEO AI Prompts
5. **Backup & Restore** (rightmost)

The last selected Settings tab is retained for the current browser session.
Previously entered settings are not rewritten merely by navigating tabs.
The existing store-targeted JSON restore workflow remains in Backup & Restore.

## Run without building a Windows EXE

```powershell
cd C:\dLinker\paletteIQ
git fetch origin
git switch feature/reference-assets-thumbnail-prompt
git pull origin feature/reference-assets-thumbnail-prompt
npm.cmd run dev
```

Test with a **temporary empty store first** before attempting a deletion.
Do not delete the existing `.wrangler/state` tree; it contains local
D1 collections and R2 image binaries.
