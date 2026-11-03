# paletteIQ — Windows local development

This is the source of the independent **Clipart Intelligence Studio (paletteIQ)**. The web app uses Vinext/React, Cloudflare D1 for saved collections and preferences, and R2 for generated assets. Local development runs with a local D1/R2 simulation.

## Requirements

- Windows 10/11, PowerShell
- Node.js **22.13 or newer** (`node --version`)
- Git (for cloning from GitHub)

## First-time setup

1. Download and extract the source ZIP into a folder, or clone the repository once it is connected.
2. Open PowerShell in the project directory (the folder containing `package.json`).
3. Run:

```powershell
PowerShell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-local.ps1
npm run dev
```

4. Open **http://localhost:5173/**. No sign-in is required for local development.
5. In **Settings**, save your Etsy API key (`keystring:shared_secret`) and OpenAI API key. API keys are encrypted in the local database and never committed or included in JSON backups.

The setup script installs exact dependencies with pnpm on Windows (no Bash/WSL required), creates a random local encryption key and enables login-free development in `.dev.vars`, builds the app, and runs local database migrations. It does **not** delete an existing `.dev.vars` or local database. Internet access is required for the initial dependency download. The hosted Site continues to require ChatGPT sign-in.

## Later sessions

```powershell
npm run dev
```

Open `http://localhost:5173` in your browser. When you pull an update that adds database tables, run `PowerShell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-local.ps1 -SkipInstall` again. The script tracks applied migrations locally and applies only new ones.

## Image production modes

- **Single:** one selected character, billed at Standard API rates.
- **Batch:** choose up to 120 characters and submit them to the OpenAI Batch API with a supported GPT Image 2.5 model. OpenAI offers a Batch discount and processes jobs asynchronously within a 24-hour completion window.
- The job metadata and imported images persist locally. The batch continues on OpenAI if the browser closes, but the browser must be reopened to retrieve finished images. The progress display shows OpenAI request counts and image-import counts separately.

## Important limitations

- Data stored locally is independent of the hosted Site. Export a JSON backup from the hosted app and import it locally to move collections and preferences. **API keys and generated image file bytes are deliberately not part of the backup.** Hosted image URLs may not resolve locally.
- The current production queue runs while the browser tab remains open; it is not a persistent background worker.
- External Etsy and OpenAI requests require valid credentials and an internet connection. Etsy developer API access is subject to Etsy's permissions.
- `.dev.vars`, `.env*`, generated output, `.wrangler/`, and private credentials must remain ignored by Git.
- The production hosting configuration is bound to the original Site; running the local app does not deploy or modify the hosted version.

## Troubleshooting

- `node` / `npm` not found: install Node.js LTS 22+, then reopen PowerShell.
- Port 5173 busy: stop the other dev process first or use `npm run dev -- --port 5174`.
- Database table missing: run `setup-local.ps1` and check the migration output. Ensure `.wrangler/state` is writable.
- Existing keys unreadable after manually changing `.dev.vars`: restore the original local encryption key. Without it, encrypted keys cannot be recovered; remove and re-enter them.
- Blank credentials on another machine: expected. API keys do not travel in the JSON backup.
