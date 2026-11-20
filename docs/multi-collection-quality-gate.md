# Multi-Collection Production — Web Quality Gate

Status: Pending Windows / web runtime verification. Do not package desktop from this branch until the gate passes.

## Static checks
Run in C:\dLinker\paletteIQ after pulling feature/multi-collection-production-refresh:

```powershell
npx tsc --noEmit
npm run test:production
npx eslint app components lib db --ignore-pattern "dist/**" --ignore-pattern "release/**" --ignore-pattern ".next/**"
npm run build
```

## Controlled live test (OpenAI API charges apply)
Use three test collections, two fresh image prompts per collection (6 images total). Prefer low quality. Do not use large production collections for this test.

1. Open Multi-Collection Production. Select all three test collections. Confirm submitted count is exactly 6.
2. Submit once. Check that each collection gets its own job, has unique character IDs, and shows the expected total.
3. Before completion, refresh. Check that eligible prompt counts exclude all submitted subjects.
4. Attempt re-submission while jobs are pending. The server must reject duplicate character submissions; no duplicate OpenAI jobs should appear.
5. Close the web tab. Wait, reopen PaletteIQ, return to Multi-Collection Production and select Refresh. Confirm job state and completed images persisted.
6. Confirm each result belongs to its original collection, and counts match job results.
7. Check that Activity Log shows submitted time, collection, status, imported count and errors. Reopen the tab: the log should still be populated.
8. Turn sound alerts on and submit a small independent test. Verify the completion tone at job transition (browser sound may require user interaction).
9. For a credit/quota-error test, use a safe test environment with an API key known to return insufficient_quota. Verify both visual warning and alert sound. Do not intentionally spend credits to reach zero.
10. Regenerate one existing image using its per-character button and verify that the new URL/visual appears and is retained after page refresh.
11. Download a ZIP and confirm the Downloaded badge on the corresponding collection card remains after reloading.

## Explicit limitations / follow-up
- Server-side per-process locks plus persistent pending-job checks prevent common duplicate submits; cross-instance atomic locking has not yet been proven.
- A submitted OpenAI Batch is durable after the browser closes; importing its output requires the web app/backend to sync when next accessed.
- Audio plays only while the app/browser is active and browser autoplay permission allows it.
- Activity Log uses the latest 20 stored jobs per collection; it is not an immutable event-by-event audit trail.
- If the OpenAI Batch succeeds but the local database insert fails and remote cancellation cannot be confirmed, operators must inspect OpenAI Batch activity before retrying.
- Do not merge or build a desktop installer until TypeScript, ESLint, build and controlled tests above pass.

## Temporary Mock Mode (development only)

1. Run `npm run dev` and open **Multi-Collection Production**.
2. Set Generation environment to **TEST / Mock** (default in development).
3. Select 2–3 collections containing saved prompts and choose **Simulate success**.
4. Submit. Pending changes to In progress after about 2 seconds and Completed after about 10 seconds; no images are generated.
5. Refresh or close/reopen the browser and confirm the Activity Log and test statuses persist in this browser.
6. Repeat using **Simulate one failed image per batch** and **Simulate insufficient OpenAI credits**; verify the alert and sound if enabled.
7. Confirm that no real OpenAI batches, stored image assets, or production collection data changed.
8. Use **Clear TEST history** to repeat from scratch. This clears only browser-local mock jobs.
9. Do not use mock results to verify actual API billing, real OpenAI Batch output, image storage or production backend recovery; those still require a small controlled live test.

Mock Mode is hidden in production builds and must be removed before shipping the desktop installer. Its status is not a claim of real image production.

## Step 5B: Mock Data Integrity & Recovery

- Browser-local history is validated before it is used; malformed entries produce a warning and are not overwritten automatically.
- Activity Log displays each TEST scenario. A previously failed `quota_error` job should remain failed after reopening; it is not a recovery failure.
- To test recovery of a successful job, click **Clear TEST history**, choose **Simulate success**, submit new TEST jobs, close the browser while pending, wait 15 seconds, then reopen.
- Do not clear or repair real collection data as part of this test.
- `npm run test:production` includes malformed history, partial recovery, scenario persistence, and duplicate eligibility checks.
