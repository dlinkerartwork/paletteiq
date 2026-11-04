# PaletteIQ — Production Reliability & Advanced SEO

Scope: image production, storage, recovery, batch progress, image/ZIP export, and editorial Etsy SEO. This project does **not** perform image QC/upscaling or publish listings to Etsy.

## Reliability changes

- Bulk image generation accepts only never-generated prompts. Single-item regeneration is an explicit separate action.
- Active Batch jobs are excluded from submission and retries.
- Image files live in R2; per-character URL/status is stored with the collection. Legacy unlinked assets may not be automatically recoverable.
- Batch import now persists collection image references **before** advancing job bookkeeping. When that write fails, the job stays retriable.
- Batch synchronization skips terminal failed/cancelled/expired jobs rather than repeatedly polling them.
- ZIP export checks file existence before streaming and uses CRC32 ZIP entries. Image downloads require the authenticated owner.

## SEO intelligence

- A deterministic 100-point **editorial completeness** score checks titles, 13 tags (20 characters max), primary-keyword placement, description, category suggestion, attributes, and documentation.
- OpenAI can provide optional alternative titles, tags, keyword gaps, an opening paragraph, target buyers, and unverified-claim warnings.
- Suggested changes are **not applied automatically**; the user chooses when to use them.
- The final collection ZIP includes `seo-readiness-report.json` and the saved listing draft.
- No metric in the app claims to be Etsy search rank, search volume, traffic, or expected sales.

## Verification

```sh
node --test tests/reliability.test.mjs
npx tsc --noEmit
npm run build
```

### Manual local checks (with valid API credentials)

1. Create a collection, save prompts, submit a 2-character OpenAI Batch, and reload. Verify job ID and progress persist.
2. Attempt bulk submission again while that job is active. It should be blocked.
3. On a different character, generate one image in Single Mode. Reload and confirm the image is still attached.
4. Explicitly regenerate that image. Verify its versioned URL changes and the new image appears.
5. Finish a Batch job; confirm the collection shows each imported result and refresh does not revert to older output.
6. Download one image, selected ZIP, all ZIP, then package ZIP including the SEO draft and readiness report.
7. Generate an Etsy listing draft. Run SEO review, apply one suggestion, confirm the review is marked stale until rerun. Save and reload.

API calls may incur charges. The automated tests do not call OpenAI or Etsy and do not require credentials.
