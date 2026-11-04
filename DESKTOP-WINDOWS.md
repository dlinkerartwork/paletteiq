# PaletteIQ Desktop — Windows proof of concept

The first desktop milestone runs the existing PaletteIQ app in an isolated Electron window. The existing local Cloudflare D1 implementation **is SQLite under the hood** (managed by Wrangler/Miniflare). This is **not yet** a native `better-sqlite3` migration or a distributable installer.

## Developer preview on Windows

Requires Node.js 22+ **on the developer machine only** for this stage.

```powershell
cd C:\dLinker\paletteIQ
npm run install:ci
npm run desktop:dev
```

The app launches its own local server bound to `127.0.0.1:18763`, then opens a dedicated Electron window. The app remains offline except for Etsy and OpenAI API requests. Users provide their own API keys in Settings.

Data lives under the Windows Electron `userData` directory, usually `%APPDATA%\PaletteIQ Desktop\paletteiq-data`. The `state` folder contains local SQLite (D1) and R2-emulated file data. Back it up together with `desktop-secrets.json` and `.dev.vars`; the encryption key is needed to decrypt saved API credentials. **Never commit or share those files.**

## Status and constraints

- First-run migrations are tracked by markers in the user data directory; the app does not reset existing collections on restart.
- No ChatGPT sign-in is needed when running under the loopback-only desktop server.
- Browser isolation is enabled: renderer Node integration off, sandbox on, and external HTTPS links open in the system browser.
- Desktop activation (Standard, no expiration, reset-device) is **planned, not implemented**; this development preview has no license enforcement.
- No end-user `.exe` is produced yet. A standalone installer needs a fully bundled worker runtime, Windows build verification, native SQLite migration or reliable packaged local D1 runtime, and OS-backed secret storage.
- If data already exists in `.wrangler/state` from the web development server, it is not automatically migrated to the separate desktop profile. Export/import or a migration step will be required.
