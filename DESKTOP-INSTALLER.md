# Building the standalone Windows installer

Run on **Windows x64** with Node.js installed **on the build computer**:

```powershell
cd C:\dLinker\paletteIQ
npm run install:ci
npm run license:init  # ONLY ONCE on the issuer PC; keep license-issuer/private.pem securely backed up
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

## Offline device activation
The signed Windows EXE verifies a non-expiring Ed25519 license file bound to the Windows MachineGuid fingerprint. No online license server is needed. The installer contains ONLY the public signing key; the private key stays in `license-issuer/private.pem` on the issuer's computer and is ignored by Git.
**Never publish, share, or commit your issuer private key.** Back it up privately; losing it prevents issuing licenses compatible with existing installers.

1. Generate the issuer key pair once: `npm run license:init`. If keys already exist, do not run it again.
2. Build `npm run desktop:package:win` on your Windows build computer.
3. The end user installs and launches PaletteIQ. On first launch, an activation dialog displays a **32-character device code** (copy using Ctrl+C).
4. On the issuer computer, generate a license:
   ```powershell
   npm run license:issue -- --device ABCD1234ABCD1234ABCD1234ABCD1234 --name "Customer Name" --output "C:\\Licenses\\customer-license.json"
   ```
   Replace the example code with the end user's actual device code.
5. Send only the license JSON file to the end user. They choose **Select license file** in the activation dialog.
6. Their API keys are entered separately in Settings; no API keys are included in the license.

For a **device reset or replacement**, ask the user for the new device code and issue a new signed license with the same issuer private key. Licenses have no expiration. Without a licensing server the old offline license cannot be remotely revoked; this is standard offline protection, not anti-piracy DRM.

For development, `npm run desktop:dev` does not enforce activation; packaged EXE always does.

