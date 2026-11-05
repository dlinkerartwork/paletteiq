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
