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

- The OpenAI Background/Batch requests are processed remotely by OpenAI after acceptance. **Full Automation transitions require PaletteIQ to be running**, either in the open browser or the Windows Electron system tray. A powered-off PC cannot perform local workflow transitions; open PaletteIQ again to resume.
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
