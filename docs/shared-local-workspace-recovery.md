# Shared Local Workspace — Web + Desktop on the same PC

## Why this mode exists

The developer Web runtime (usually `http://localhost:5173`) and PaletteIQ
Desktop (`http://127.0.0.1:18763`) normally have **different databases and
asset stores**. Running both on loopback does **not** synchronize those stores
or duplicate-safe API receipts.

The supported shared mode opens **the Desktop's existing backend from a Web
browser**. This gives Web and Electron the same authenticated server, SQLite
database, image storage, saved OpenAI response and Batch IDs, and collection
version/lease protections. It does not mount the SQLite file in two processes
or synchronize two separately authored collections.

## Setup

1. Start the installed PaletteIQ Desktop. Leave it running or hide it to tray.
2. In Chrome, open your Web development URL (usually `http://localhost:5173`).
3. When you see **Separate Web workspace — Desktop is available locally**,
   click **Use shared Desktop workspace**.
4. Your browser navigates to **http://127.0.0.1:18763**. Log in again using the
   same PaletteIQ account if required (browser and Electron keep separate
   cookies). Both interfaces now see the *Desktop* database and image assets.
5. The browser remembers this choice. On future visits to Web localhost, it
   automatically reconnects to the Desktop workspace. If Desktop is offline,
   the browser stops before opening the independent Web database, retries the
   connection, and offers an explicitly labelled standalone alternative.
6. In installed Windows Desktop, use the tray menu **Start PaletteIQ with
   Windows (restore jobs in tray)** to opt into startup at Windows sign-in.
   The tray also has **Open Shared Workspace in Web Browser**.

The auto-start toggle is unavailable in the unbundled `npm run desktop:dev`
Electron executable; it needs a properly installed Windows build. Development
Desktop still provides the shared backend and reconnection behavior when running.

## Recovery rules

- The shared backend is the **single source of truth**. All tabs/clients use
  existing optimistic version checks and a single persisted Full Automation
  lease, so multiple browser windows must not cause duplicate paid jobs.
- After a restart, the Desktop renderer synchronizes saved OpenAI Batch IDs,
  background Responses and Full Automation stages. The Desktop tray keeps
  polling if the window is hidden.
- Accepted OpenAI jobs can continue remotely while offline. Local image
  imports and *new* workflow stages require a running local backend.
- If a paid POST had uncertain delivery and no reliable OpenAI ID was saved,
  PaletteIQ intentionally keeps the receipt uncertain. Do **not** blindly
  retry. Manual reconciliation of OpenAI activity is required.
- The Web Auto Follow option is a UI preference in each browser profile; it
  navigates through saved workflow stages without discarding unsaved editing.
- When Windows and the PC are fully **powered off**, localhost cannot poll,
  import assets, or run new pipeline stages. The optional Windows sign-in
  startup resumes those operations after the PC is turned on and a user signs
  into Windows. For genuinely unattended 24/7 processing with the PC off,
  migrate to a reviewed cloud D1/R2 deployment plus Cloudflare Cron.

## Existing data and safety

**This does not automatically import collections from your independent Web
localhost development database** into the Desktop workspace. Those collections
remain separate and are not deleted, replaced, or silently merged. Back them
up and use the supported Workspace ZIP import into a selected store only after
reviewing any conflicts.

The discovery endpoint is read-only and active only in the configured Desktop
runtime at `127.0.0.1:18763`. It only permits CORS probes from HTTP loopback
origins. Cross-origin API writes, exposed credential secrets, native file access,
and unauthenticated data migration are not provided. Never expose the Desktop
port to a LAN or the public internet.

## Tests

```powershell
npm run typecheck
npm run test:production
```

For a manual smoke test: start Desktop, connect the browser, open the same
Collection in both, confirm that both show the same saved prompt and image
counts, then pause the network briefly. Restore connectivity and confirm that
the original OpenAI receipts are polled instead of creating duplicate Batches.
Then close the browser, hide Desktop to tray, restart the browser and confirm
that saved progress is visible on the Desktop backend.
