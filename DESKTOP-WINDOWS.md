# PaletteIQ Desktop — Windows proof of concept

PaletteIQ Desktop now starts a native SQLite service (`node:sqlite`) alongside the existing local Worker. New collection data is stored directly in `database/paletteiq.db`, and newly generated clipart files are written under `images/collections/`. Wrangler still hosts the web UI and API routes in this developer preview. This is **not yet** a distributable installer.

## Developer preview on Windows

Requires Node.js 22+ **on the developer machine only** for this stage.

```powershell
cd C:\dLinker\paletteIQ
npm run install:ci
npm run desktop:dev
```

The app launches its own local server bound to `127.0.0.1:18763`, then opens a dedicated Electron window. The app remains offline except for Etsy and OpenAI API requests. Users provide their own API keys in Settings.

Data lives under the Windows Electron `userData` directory, usually `%APPDATA%\PaletteIQ Desktop\paletteiq-data`:

```text
paletteiq-data/
  database/paletteiq.db
  database/paletteiq.db-wal
  database/paletteiq.db-shm
  images/collections/<owner>/<character-id>.png
  state/                         # legacy D1/R2 fallback, kept for migration
  desktop-secrets.json           # credential encryption key
  .dev.vars                      # credential encryption key and ephemeral bridge token
```

Back up the entire `paletteiq-data` folder together. The encryption key is needed to decrypt API credentials. **Never commit or share those files.**

## Status and constraints

- Native migrations are tracked in the `__paletteiq_migrations` table. On first launch the desktop attempts to import existing D1 records without deleting the old database; legacy R2 images are copied into the native image folder when accessed.
- No ChatGPT sign-in is needed when running under the loopback-only desktop server.
- Browser isolation is enabled: renderer Node integration off, sandbox on, and external HTTPS links open in the system browser.
- Desktop activation (Standard, no expiration, reset-device) is **planned, not implemented**; this development preview has no license enforcement.
- No end-user `.exe` is produced yet. A standalone installer needs a fully bundled worker runtime, Windows build verification, and OS-backed secret storage.
- Existing data in the separate web development `.wrangler/state` directory is **not automatically migrated**. The desktop imports only the D1 state already under its own `paletteiq-data/state` directory.
- Migration should be tested on a backup of the user profile first; do not remove the old `state` directory until the imported records and images are verified.
