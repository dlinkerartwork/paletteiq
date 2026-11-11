# Build standalone Windows installers

Build on Windows x64. The end user runs only the generated EXE. The build PC
needs Node.js x64 (22.13 or newer), pnpm 11.25, full Python 3.11 x64 and Inno
Setup 6, plus the server's Real-ESRGAN engine, HAT source/weights and prepared
Windows CUDA wheelhouse. Builder tools are not prerequisites on user PCs.

## PaletteIQ client

Use branch `feature/multi-collection-production-refresh`:
```powershell
git fetch origin
git switch feature/multi-collection-production-refresh
git pull --ff-only
pnpm install --frozen-lockfile
.\scripts\prepare-windows-prerequisites.ps1
pnpm run typecheck
pnpm run desktop:package:win:no-license
```

Output: `release/PaletteIQ-NoLicense-Setup-0.1.0-x64.exe` (version follows package.json).
For a licensed edition use `pnpm run desktop:package:win` with the existing
`license-issuer/public.pem`; do not regenerate issuer keys for an update.

Both editions bundle Electron, private Node.js, Wrangler, workerd, esbuild,
migrations and the Microsoft Visual C++ runtime installer. Packaging checks
required native executables and runs the packaged Node/Wrangler version smoke
test without developer Node on PATH. NSIS installs per-machine with Administrator
rights and runs the bundled Visual C++ setup automatically. WebView2 is not used
by the Electron client.

## GPU server

Use `paletteiq-server/main`. Run
`installer/prepare-windows-prerequisites.ps1` before
`installer/build-windows.ps1`. The server installer bundles private Python,
server dependencies, Real-ESRGAN, HAT source/checkpoint/wheels, offline WebView2 and
Visual C++ prerequisites. Installer 0.9.2 installs prerequisites automatically.
The build script requires the full Python 3.11 installation, not a HAT virtualenv.
See that repository's README for the engine/model paths and complete build call.

## Clean Windows acceptance

Target Windows 10 22H2 or Windows 11 x64. Test the produced EXEs in a clean VM
without Node.js, Python, pnpm, or manually installed WebView2/Visual C++ runtimes.
Disconnect the network for the installer test; the bundled prerequisites should
install offline. Open the client, create/save a collection, close/reopen and
verify persistence. Open the server native dashboard and verify its service
after reboot. Test real inference separately on a machine with the appropriate
GPU driver. A CUDA Toolkit install is not needed, but graphics drivers are
hardware prerequisites. AI provider calls require internet and API credentials.

The packaging scripts have been inspected and syntax checked on Linux.
Windows EXE compilation, prerequisite execution, clean installation and actual
GPU inference still need verification on Windows; those checks cannot be
claimed from Linux.
