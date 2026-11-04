# Building the standalone Windows installer

Run on **Windows x64** with Node.js installed **on the build computer**:

```powershell
cd C:\dLinker\paletteIQ
npm run install:ci
npm run desktop:package:win
```

The build command creates `release/PaletteIQ-Setup-<version>-x64.exe` using Electron Builder/NSIS.

The installer is designed to bundle Electron, a standalone Windows `node.exe`, the generated Worker, migration SQL, and runtime dependencies. **End users should not need to install Node.js, npm, pnpm, Wrangler, or SQLite.** The installer still needs to be built and smoke-tested on a clean Windows system without Node.js before this can be considered verified.

For a Windows unpacked test build:

```powershell
npm run desktop:unpacked:win
```

Run `release/win-unpacked/PaletteIQ.exe`, ideally on a clean Windows VM without Node.js. Confirm the app opens, collection creation persists across restart, OpenAI credentials work, an image saves to native local storage, and batches recover on reopen.

The initial runtime bundle includes the complete `node_modules` tree to preserve Wrangler/Miniflare's platform-specific binaries. Expect a large installer. A trimmed runtime should only be attempted after successful clean-machine testing.

**Do not install over an existing desktop preview without first backing up** `%APPDATA%\PaletteIQ Desktop\paletteiq-data`. This folder holds the database, generated images, and Windows-protected API key. An installer on a different Windows account or computer cannot necessarily decrypt the DPAPI-protected key; the user may need to enter their OpenAI/Etsy API key again.

This build has no device activation or license enforcement yet. Standard protection, non-expiring licenses, and reset-device support remain a separate stage.
