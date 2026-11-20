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

## Collection-specific model, target, and Auto-follow UI

- **Research & Analysis → Vision Model** starts with the saved `Settings → Full Automation Research Model` when the collection has no override. Before starting a new job, users can select another GPT text/vision model available to their OpenAI API key. Selection is saved to the collection and frozen in the Full Automation record when started.
- The chosen **text model** is used for Research, character expansion, prompt generation (OpenAI Batch), similarity-flagged prompt rewriting and OpenAI Etsy Listing Draft generation. The image generation stage **must use a compatible GPT Image Batch model**, set separately in Settings. Model availability in `/v1/models` is not proof of vision, JSON or Batch compatibility, so an incompatible model may return an API error. A previously submitted paid job retains its original model even if Settings change later.
- **Target Characters to Generate** is stored in the collection as `characterTarget`. The active workflow's persisted `fullAutomation.target` takes priority, then the stored collection target, then a completed/background research job target, and only then the Settings default. The Character Library and Research tabs display the same number, including after restarting the desktop app. Workflow targets cannot be edited mid-run.
- **Auto-follow Full Automation** is enabled by default and can be disabled in the workflow progress panel; the switch is a local UI preference. When the cloud/desktop controller confirms a stage transition, the tab can move Research → Character Library → AI Prompts → Image Production → Etsy Listing Draft. It follows only when the user is viewing the preceding stage, the collection editor is clean, and the thumbnail designer has no unsaved changes. This is navigation only: no extra paid requests or automatic draft publishing.
- Since the stage controller is local to the running PaletteIQ app or Electron tray in desktop-only mode, automatic navigation requires the window to be open. The existing background workflow may continue in the tray without a visible tab change.

## Hybrid Parallel Research and direct AI Prompts Auto-follow

- When **Full Automation** is selected, Research & Analysis offers **Hybrid Parallel Research** (default) versus Single Research. Hybrid divides the exact user-selected Etsy references into up to **three deterministic image groups** and submits one persisted OpenAI Background request for each group concurrently. Each worker has its own saved response ID and progress. Polling never resubmits a worker.
- After all research groups complete, PaletteIQ submits **one additional paid Background synthesis** (Merge & Style DNA) to reconcile evidence, produce one collection-wide Style DNA and generate a de-duplicated original character catalog for the requested target. If the merged response still produces fewer distinct characters, the existing Full Automation expansion stage finishes the target.
- Auto-follow **stays on Research & Analysis through synthesis and character completion** and opens **AI Prompts** directly when the target is reached. The Character Library remains accessible manually; tab navigation never submits a paid request.
- Every submitted request may incur charges. For 8 references and 50 characters the default arrangement is **three concurrent visual requests plus one Style DNA synthesis request**, not one request. Extra repeated instructions and output tokens can increase total cost, and parallel work does not guarantee a lower elapsed time. Single Research uses the original one-request path. PaletteIQ asks for confirmation before submitting Hybrid.
- An interrupted worker or synthesis submission without a saved OpenAI response ID is marked uncertain and never retried automatically. Examine OpenAI Logs before starting new paid work. A failed worker is retained for investigation; no automatic paid retry is performed.
- AI Prompts already uses **one OpenAI Batch job with groups of ten characters per request**. OpenAI schedules the requests asynchronously; PaletteIQ does not create extra prompt Batches or promise a concurrency count. Model support and turnaround depend on the selected GPT model and OpenAI Batch capacity.

## Several collections running Full Automation concurrently

- Users can start Full Automation in **multiple saved collections** within the same Etsy store. Each collection maintains its own target, Research worker receipts, Prompt Batch, Image Batch, merge status, lease, error handling, selected models, and completion stage.
- The active desktop window advances its current collection and also polls the **multi-collection scheduler** every 15 seconds to advance other collections. When hidden to tray, the existing Electron monitor uses the same multi-collection endpoint.
- The scheduler advances **up to 3 independent available collections concurrently per cycle**, prioritizing least recently updated workflows and skipping collections with valid in-flight leases so one long job cannot block the others. Further collections stay queued and receive later cycles; this is not an unlimited workers mode. The per-collection optimistic database lease and request guards remain in effect.
- **Collections** shows running workflow counts and the stage, character, prompt and image progress for each collection. Auto-follow only navigates the **currently opened** collection; other workflows never force a UI tab change. Unsaved edits to other collections are not overwritten by status refresh.
- Each collection's OpenAI API usage remains separately billable; parallel execution can trigger multiple simultaneous Research worker requests, prompt and image Batches. This feature does not multiply a single collection's prompt/image batch work, and never auto-retries uncertain paid submissions. Actual throughput remains subject to provider limits.

## Progressive research, characters, and prompt delivery

- **Research & Analysis** now displays a read-only **Live Research previews (provisional)** panel as soon as each Hybrid worker's background response is complete. Each preview shows worker status, theme/style and capped candidate concepts. A preview does **not** become an editable or production-eligible saved character until the final Merge & Style DNA result is imported. This prevents duplicate concept imports and maintains collection-wide consistency.
- **Character Library** can show read-only provisional concepts while Research is underway. During the later Full Automation expansion stage, durable character records are saved after every successfully accepted AI Fill group, then the active editor's sync renders them without waiting for all requested characters. Auto-follow still advances directly to **AI Prompts** once the target is achieved.
- **AI Prompts** offers the default **Single OpenAI Batch** (one job containing groups of ten) and an optional **Progressive Parallel** mode. The latter submits **separate OpenAI Batches for groups of ten**, keeps up to three groups active, and imports valid prompt outputs per completed group as soon as its Batch result file appears; remaining groups continue running independently.
- Progressive mode is selected **before** starting an AI Prompt job, either in Research & Analysis for Full Automation or directly in AI Prompts for manual collections. It is opt-in because it submits several separate paid Batch jobs rather than one. Group request content and model are frozen at submission, and group receipts/statuses persist in the collection.
- The API enforces optimistic version-controlled imports and fingerprint checks so a manually edited prompt is never overwritten. A lost/uncertain Batch receipt is **not** resubmitted; the other accepted groups continue to be observed and imported, then Full Automation pauses for manual investigation. A completed-with-errors job also pauses rather than automatically charging for missing prompts.
- The standard one-Batch mode remains available and exposes processed group counters while it runs, but the provider normally makes actual response files available only after the entire Batch completes. Progressive results do not guarantee faster overall completion or lower API costs; usage depends on the chosen model's available Batch endpoint and token volume.

## Default Full Automation provider and pricing profile (November 2026)

For NEW saved preferences, PaletteIQ now uses:
- **Research & Analysis:** `gpt-6.1-terra`, OpenAI Batch API; Hybrid mode submits up to three independently tracked image-analysis Batches and one Style DNA merge Batch. A single-research run also uses the Batch API. Existing legacy OpenAI Background Responses jobs remain recoverable by their original response IDs.
- **Character Library AI Fill:** `gpt-6.1-terra` via a durable and polled OpenAI Batch for each missing-character expansion group (up to 15 concepts). Paid receipts are persisted before subsequent polling; interrupted ambiguous submissions never auto-resubmit.
- **AI Prompts:** separate `gpt-6-luna` default. Both Single Prompt Batch and optional Progressive Parallel use the OpenAI Batch API. The chosen model is frozen in `fullAutomation.promptModel` separately from the Research model. Older running workflows without this field retain their previous text model to avoid changing accepted work.
- **Image Production:** `gpt-image-2.5-flare`, quality **low** by default, using Image Batch. Explicitly saved user model/quality preferences override the defaults.
- **Etsy Listing Draft:** Title, Description and Tags are taken from the Etsy API when AI enhancement is off (Full Automation's default). Supporting SEO, ALT text and other listing attributes use `gemini-3.5-flash` by default. If a saved SEO preference explicitly selects OpenAI, Batch-only Full Automation stops before paid SEO generation and requests switching to Gemini rather than silently making a synchronous OpenAI call.

The **Batch-only guarantee currently covers Full Automation** (including Research, AI Fill, prompts, similarity prompt revisions and image Batches), not all standalone manual buttons elsewhere in the studio. Some legacy manual image generation, AI Fill, SEO provider selection, and independent similarity rewrite tools still have synchronous request paths. Do not describe the entire application as Batch-only until those paths are migrated. OpenAI Batch has an asynchronous completion window of up to 24 hours; *parallel* Batches do not guarantee instant results. Preview data appears only when each Batch has published an output file.

The older Settings record can contain explicit Research, Prompt or SEO values from before these defaults changed. Always honor saved values; defaults apply only when a preference is absent. Do not migrate or restart currently running paid jobs automatically.
