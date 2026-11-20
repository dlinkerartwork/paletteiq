# Email/password accounts, multiple Etsy stores and GPU Batch notifications

## Account and store behavior

- Open PaletteIQ. Register with an email address and password (minimum 12 characters), or sign in.
- A new account receives an initial **My Etsy Store**. The store picker appears at the top of the workspace. Use **+** to create another store and choose the active store.
- Each store receives its own database owner ID derived from **account UUID + store UUID**. All existing project/image/batch routes obtain this ID from a verified HttpOnly session, never from client-provided store names or IDs.
- Collections, thumbnails, generated/upscaled image assets, OpenAI/Gemini/Etsy credentials, GPU Server URL/API key and SEO production preferences are separate per store. Switching stores reloads the workspace and resets in-memory collections.
- Passwords are salted PBKDF2-SHA256 (310,000 iterations). Sessions are SHA-256 token hashes held in the database; the browser receives an HttpOnly SameSite Strict cookie. Lockout begins after five failed logins for fifteen minutes.
- New email/password stores must save their own OpenAI, Gemini, Etsy and
  Remote GPU API keys in the selected store's Settings. Global environment
  fallback credentials are **disabled for these accounts by default**.
  Private installations can intentionally enable shared provider billing using
  `PALETTEIQ_ALLOW_SHARED_PROVIDER_KEYS=1` on the backend; do this only when
  all registered users are trusted to spend the shared provider account's
  quotas. Credentials remain encrypted under the individual store owner.
- Account enrollment is open to anyone who can reach this server. **Email verification, invitation policies, password reset and MFA are not implemented.** Do not expose the local desktop server to the public Internet without a TLS gateway and a considered account enrollment policy.
- ChatGPT-injected identity headers are considered only when `PALETTEIQ_TRUST_CHATGPT_HEADERS=1` is explicitly configured behind a trusted gateway. The previous `PALETTEIQ_LOCAL_NO_AUTH=1` value no longer bypasses login.

## Database migrations and old collections

The new migration `drizzle/0005_accounts_and_stores.sql` creates account/store/session tables. The bundled Windows Desktop migration runner automatically installs it on upgrade, and creates a pre-migration SQLite backup for an existing database.

For **local web development** using D1:

1. Build the app: `npm.cmd run build`
2. Run `scripts/setup-local.ps1` again, or apply the new D1 migration using Wrangler:

```powershell
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0005_accounts_and_stores.sql
```

For a hosted D1 database, apply that migration to the **correct hosted binding** using the project's deployment migration procedure before enabling login. Back up first. Do not apply it twice to different production databases inadvertently.

For an **existing native Windows Desktop** installation with former local-anonymous
`local_seedy` collections, first register your account and create the intended
empty store, then **exit PaletteIQ Desktop completely**. Back up
`%APPDATA%\PaletteIQ Desktop\paletteiq-data` before running:

```powershell
node scripts/migrate-legacy-desktop-to-store.cjs --email "your@email.com" --list-stores
node scripts/migrate-legacy-desktop-to-store.cjs --email "your@email.com" --store-name "My Etsy Store" --confirm
```

If the account has only one store, omit `--store-name`. The script makes a
SQLite `VACUUM INTO` backup, transfers old project rows, OpenAI Batch history
and image folder to the selected owner, and copies saved non-secret preferences
if the target store has no settings yet. **Encrypted API keys are not copied**;
re-enter them for the new store. The script aborts if the destination image
folder already exists; use an empty store to prevent overwriting current art.
The CLI applies only to the standard **native Desktop SQLite** workspace, not
Cloudflare-hosted data or restored-workspace selectors.

**Legacy collection safety:** existing rows and image files owned by the old anonymous `local_seedy` or ChatGPT-authenticated IDs are **not automatically reassigned** to the first account created, since that would let a different registrant claim somebody else's assets. They remain intact in storage. To bring them into an email/password store, use an explicit administrator-controlled migration of the project rows, related image folders and encrypted credentials, or perform a JSON backup/export in the old version and import it after sign-in. API credentials must be re-entered when moving between owner IDs because they are encrypted per owner. Back up the data folder before any conversion.

## Remote GPU selected-image Batches

- Open **Image Production**, check specific generated PNG images, choose GPU upscale factor, then click **GPU Upscale Batch**.
- PaletteIQ creates one Batch with an idempotent `client_batch_id` and `expected_files` equal to the selected image count.
- The client securely sends the signed-in account's email address and active store name to GPU Server (the email cannot be overridden in the browser UI).
- File uploads follow the remote `PUT /v1/batches/{id}/files/{fileId}` protocol with SHA-256 hashes; an interrupted upload can be resumed with **Resume GPU Batch**.
- After all files arrive, PaletteIQ commits once to the persistent GPU job queue. **Do not turn off the client before commit.** After commit, the client may be closed or powered off.
- GPU Server monitors all jobs, then sends one email per Batch upon overall terminal completion, if its SMTP is configured. The server's email thread remains independent of the client PC. The client displays notification configuration and delivery status.
- After reopening PaletteIQ, remote Batch metadata and individual job IDs are recovered from GPU Server, and the existing per-character upscale result import/QC workflow is reused.
- GPU Server must remain running and able to reach SMTP. If SMTP is not configured or delivery is blocked, upscale jobs still complete but no email notice is guaranteed.

## Limitations / testing

- SMTP messages cannot guarantee exactly-once delivery; SMTP acceptance followed by a sudden crash may generate a duplicate upon retry.
- Automated typecheck/tests validate code contracts; use a test account and test SMTP mailbox to confirm login, store switching, a multi-image GPU Batch and the final email from your actual Windows service.
- Existing uploaded assets and old user data are not automatically migrated across owner IDs.


## PaletteIQ Desktop SMTP for OpenAI Image Generation Batches

**Desktop email does not contact the GPU Upscale Server at all.**
PaletteIQ Desktop sends SMTP directly from its own Windows Node/Electron backend
using TLS/STARTTLS. The mail sender is not exposed to the Next/React renderer,
and the browser does not receive SMTP passwords.

The owner email, store and collection names are frozen in each new OpenAI
Batch record. Whenever the desktop's authenticated poller observes OpenAI
status `completed`, it sends one email to the stored account owner.
This is **before** importing PNG files; the message accurately says that
OpenAI processing is done and imports may continue.

**Closing Desktop:** pressing X hides the window in the Windows system tray,
leaving the local Wrangler backend and React session alive. An Electron
background monitor polls batch sync every 60 seconds while hidden. Double-click
the tray icon to reopen; **Quit completely** stops monitoring. Windows sign-out
or powering off the machine also stops it. Monitoring resumes at next launch.

### Default configuration — builder's .env

The builder can put the following lines in the **PaletteIQ client repository
root** `.env` (not the GPU Server's `.env`):

```dotenv
PALETTEIQ_SMTP_HOST=smtp.gmail.com
PALETTEIQ_SMTP_PORT=587
PALETTEIQ_SMTP_USERNAME=sender@gmail.com
PALETTEIQ_SMTP_FROM=sender@gmail.com
PALETTEIQ_SMTP_PASSWORD=GOOGLE_16_CHARACTER_APP_PASSWORD
```

A tracked example exists at `desktop/smtp.example.env`.
The Windows staging script `scripts/prepare-desktop-bundle.mjs` extracts
**only the allowlisted SMTP fields** from the builder's local `.env`
and creates `dist/desktop-runtime/desktop-smtp.env` for the installer.
No OpenAI/GPU/API encryption keys are copied. The installed Desktop
automatically loads these defaults; users need no manual setup when the
bundled configuration is complete.

In development, `npm run desktop:dev` reads the repository-root `.env`
directly into the **native SMTP process**, not into Wrangler environment
variables or a renderer. The build is not required for source testing.

**Security limitation:** The SMTP App Password in `desktop-smtp.env` is
recoverable from the installer, even if the file has restricted permissions.
There is no way to securely embed a shared password inside a distributable
offline installer that untrusted recipients can run. Only use bundling on
trusted PCs under your control, with a dedicated sender account/App Password.
For customer-distributed installers, do NOT embed a shared SMTP credential;
let each installed user configure their own account from Settings or use a
trusted server-side mail relay. Never commit real passwords to source control.

### Store-specific override and testing

On Desktop open **Settings → SMTP Email**. The page shows whether the
installer defaults are available; the password is never reflected back to
the browser. Leave the fields unchanged to use bundled defaults.
To override a particular store, supply host, port, username, from email,
and an App Password, then click Save SMTP. The override is encrypted with
the Desktop workspace encryption key and stored in local SQLite under the
store ID, not uploaded to the GPU Server. **Use installer defaults** resets
the override for that store. **Send test email** always sends to the
currently authenticated account email, not an arbitrary recipient.

Supported SMTP transports: port **587 with mandatory STARTTLS**, or
port **465 with TLS/SSL**; certificates are verified and cleartext SMTP
authentication is not permitted. Gmail requires the username and From
address to be the same; use a Google App Password rather than the Gmail
login password.

Email attempts are deduplicated in local SQLite using the store owner
and image Batch ID. A transient SMTP failure does not roll back image
generation or interfere with image recovery; the next background sync
retries the email. As with all SMTP delivery, a process crash immediately
after the SMTP server accepts a message but before the sent marker is
written could still result in a second email on retry.

**Web vs Desktop:** browser-based PaletteIQ does not have a local Node
SMTP service and therefore does not send these direct SMTP notifications.
The unrelated GPU upscale Batch email notifications continue using the GPU
Server SMTP separately.

### Installer build

```powershell
cd C:\dLinker\paletteIQ
# Add the SMTP keys above to .env (local only; ignored by Git)
npm run desktop:package:win:no-license
```

The SMTP configuration is staged with the installer; it is not necessary
to rebuild the GPU Server. Test using a new OpenAI Batch and verify real
SMTP acceptance with Settings → SMTP Email → Send test email.
