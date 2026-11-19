# PaletteIQ Full Automation and Etsy XLSX export

Branch: `feature/reference-assets-thumbnail-prompt`

## How to use

1. Configure Etsy/OpenAI API credentials in the active store's **Settings → API Credentials**.
2. In **Settings → Production Defaults**, select the OpenAI research model, OpenAI prompt-text model, OpenAI Batch image model, and image quality. In **Settings → SEO AI Prompts**, select the desired Etsy listing draft provider and model.
3. Start a **new collection** and load an Etsy listing's genuine reference images.
4. In **Research & analysis**, enter a target between 1–200 for Full Automation and check **Full Automation**. OpenAI Background research is required; a Gemini-only research session cannot run the background image generation pipeline.
5. Press **Analyze selected images** to start. The account/store/project-scoped state is persisted in the collection database. The workflow periodically advances after completed OpenAI work; do not submit another research job for this collection while automation is active.
6. Workflow stages:
   - Analyze selected Etsy images using OpenAI background.
   - Expand subject library with diverse original AI proposals until target or a bounded failure threshold.
   - Generate missing image prompts with OpenAI text Batch.
   - Generate missing image assets with OpenAI image Batches.
   - Review each generated asset against the Etsy reference image(s). Only `needs_review` assets enter the rewrite queue. `unverified` causes an explicit pause; **unverified must not be interpreted as originality verified**.
   - Rewrite ALL queued flagged prompt descriptions, preserving collection Style DNA and actual character identity while changing potentially imitative artistic composition/arrangement.
   - Send those rewritten prompts in **one regeneration OpenAI image Batch**. The one-batch limit is 120 flagged characters. If more than 120 are flagged, pause for manual review rather than silently creating multiple paid batches.
   - Recheck the resulting images; if any are still flagged or unverified, pause for manual review (no unlimited automatic retries).
   - Generate the Etsy SEO draft using the active store's chosen SEO provider and model. **No automatic Etsy publishing.** Verify factual claims, license, price, formats, and seller-entered information before listing.
7. Status banner shows the current automation phase and counts, with **Pause / Resume**. After a pause, check previous OpenAI Batch activity before resuming, to avoid duplicate paid work.
8. Image Production also has a manual **Regenerate prompt (too similar)** button on a `needs_review` card; it saves a revised prompt while keeping the old PNG. Then use manual image regeneration if you approve the new prompt.
9. In **Etsy Listing Draft**, **Export Excel** downloads a real `.xlsx` workbook; **Export TXT** remains available. The workbook includes only fields selected in SEO export settings. User-provided text is written as Excel inline strings, not executable formulas.

## Important runtime restrictions and safety

- OpenAI Background/Batch requests continue remotely after acceptance. **Desktop-only Full Automation** still needs the PC running because it uses a local SQLite database and local image files. It resumes when PaletteIQ is reopened. **Hosted cloud mode** can advance every stage with the Cloudflare Cron Worker described below, but only if the collection, credentials and asset storage actually live on that same hosted D1/R2 environment.
- The Desktop tray polls the authenticated `POST /api/full-automation` endpoint as well as image Batch completion. It does not send any notification request to the GPU Server for this feature.
- Workflow stages, attempts, flagged IDs, and regenerated Batch IDs are stored in the collection, not in unsaved renderer memory.
- New-workflow target is limited to 200 characters. Prompt Batch requests may contain up to 200 IDs, and first-image Batches up to 120 IDs. The queue is split only when necessary for initial generation; similarity regeneration is explicitly ONE batch up to 120.
- Full Automation will pause rather than silently retry uncertain network/paid submission failures or repeat a second image regeneration when a near-duplicate remains. This reduces—but cannot mathematically eliminate—the risk of duplicate API costs in the event of a crash between remote acceptance and local persistence.
- Similarity checking uses AI judgment and is **advisory**, not a copyright determination or guarantee of uniqueness.
- The original PNG remains saved if a regeneration fails. A successful replacement updates the character only if its stored prior image URL still matches the source image recorded at Batch submission. Stale Batches must not overwrite newer manual generations.
- Manual collection Save and manual image generation are restricted while Full Automation is active to protect background job state. Pause the workflow for manual edits.
- Budget/API limits apply. Large targets (such as 150–200) can require many OpenAI calls and many image-generation charges. Start with 3–5 characters in a new test collection and verify costs and all phases before using higher targets.

## Developer verification

```powershell
cd C:\dLinker\paletteIQ
git switch feature/reference-assets-thumbnail-prompt
git pull --ff-only origin feature/reference-assets-thumbnail-prompt
npm.cmd run install:ci
npm.cmd run typecheck
npm.cmd run test:production
npm.cmd run desktop:dev
```

GitHub CI validates TypeScript and static/in-memory production regression tests, not live paid OpenAI or Etsy integration. Before distributing a new installer, perform an end-to-end test with real credentials and a small original collection.

## Optional 24/7 cloud scheduler (PC can be powered off)

**Deployment requirement:** This is an opt-in cloud architecture, not an automatic upgrade of local Desktop projects. Do not expose your PC or its native storage bridge to the internet. A scheduler cannot access a powered-off PC's local SQLite database, encrypted credential store or generated files. Before enabling the cron, deploy the full PaletteIQ server to an always-on HTTPS Cloudflare Worker with persistent D1 `DB`, R2 `BUCKET`, and `STUDIO_CREDENTIAL_ENCRYPTION_KEY`. Create or migrate the required accounts, store projects, credentials and assets **using a separately reviewed, authenticated migration process**. A desktop-only collection will not magically appear in the cloud. Keep backups and verify ownership/scoping.

### How the cloud pathway works

1. A separate Cloudflare Cron Worker in `worker/cloud-automation-cron.ts` invokes the hosted `POST /api/full-automation` endpoint once per minute. It never receives session cookies or OpenAI API keys.
2. The call includes a timestamped HMAC-SHA256 signature. Only a correctly configured shared secret (at least 32 characters) grants access to the **fixed** `cloud-tick` action. No request can choose a user, store or project.
3. The app selects up to two active collections from hosted D1 by oldest update, resolves each owner through the actual account/store records, and runs a single existing Full Automation stage through the server-only identity context. Existing optimistic locking, bounded attempts and fail-closed paid Batch safeguards remain in effect.
4. Progress, Batch IDs, downloaded assets, credentials and SEO drafts remain in the hosted database and bucket. The UI reflects progress whenever reopened. The cloud tick cannot publish listings on Etsy.

### Deployment checklist

- Deploy hosted PaletteIQ with *real*, persistent Cloudflare D1/R2 and the matching schema/migrations. Verify the `DB` and `BUCKET` bindings and encryption secret on that deployment.
- Ensure your saved workflow and OpenAI credentials exist in **the hosted store**, not just on your Windows PC. Never copy plaintext API keys into GitHub, a Wrangler config file or browser code.
- Generate a random secret of at least 32 characters outside GitHub. Configure the **same** `PALETTEIQ_CLOUD_AUTOMATION_SECRET` as a secret in both the hosted PaletteIQ Worker and the standalone Cron Worker.
- Replace the example `AUTOMATION_TARGET_URL` in `wrangler.cloud-automation-cron.jsonc` with the hosted PaletteIQ HTTPS origin (not localhost). Deploy with `npx wrangler deploy --config wrangler.cloud-automation-cron.jsonc`. Cloudflare controls the actual cron registration. The placeholder URL will not work.
- Test a **new 3–5-character hosted collection** with the PC shut down. Inspect Cron logs, database state, Batch IDs, image persistence and API charges across every stage before moving larger collections. Check the scheduler's worker timeout and your account limits.
- Disable the Cron Trigger if reverting to desktop-only mode; cloud and local databases are independent. Never start the same paid job in both environments.

**Operational limitations:** If the cloud host, D1/R2, encryption secret, service credentials or Cron Worker are missing, the workflow does not continue offline. Every cron invocation advances only a bounded amount of work; a job can require many invocations and OpenAI Batch latency is not predictable. Unverified originality or uncertain paid operations still pause for manual review. This implementation has not been proven with live OpenAI charges or a full deployed Cloudflare environment.
