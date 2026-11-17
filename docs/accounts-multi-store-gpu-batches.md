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
