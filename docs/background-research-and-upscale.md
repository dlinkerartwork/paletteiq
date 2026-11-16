# Background Research and Non-Disruptive Upscale

## Research & Analysis (OpenAI)
- On **Analyze selected images**, the client first saves the collection, then submits one OpenAI Responses request with `background: true` and `store: true`.
- The backend persists the remote response ID and job metadata in `projects.data.researchJob` **before returning accepted** to the UI. The OpenAI request continues on OpenAI servers independently of the browser and the local PaletteIQ PC.
- Default target of 120 is generated in one remote request. For targets over 160, the first background stage plans 160 subjects; users can complete the remaining catalog with **AI Fill** after the first stage has been imported.
- The browser checks `GET /api/research-jobs?projectId=...` every 8 seconds **only while a job is active**. This GET retrieves the remote response status; it never submits another paid response.
- On the first successful poll after OpenAI finishes (including after PC shutdown/restart), the backend validates and imports the results into the saved collection while preserving existing characters and generated assets. GitHub/desktop do **not** need to stay on for OpenAI's processing, but the import itself waits until PaletteIQ is running again.
- Interrupted submission *before* the response ID was stored is **not** automatically retried (to avoid duplicate charges). After 2 minutes it reports a clear failed/needs-review message. Check OpenAI usage before explicitly retrying.
- OpenAI background output needs remote retention (`store: true`) and a valid OpenAI API key. Work is not guaranteed to remain retrievable indefinitely; do not leave jobs unimported for an extended time.
- Google Gemini's existing vision path remains a foreground request. It cannot promise PC-off processing.
- This is **not** a Cloudflare Workflow/Queue; it is durable *remote AI execution* with recovery/import when the application is reopened. If additional automatic follow-up tasks are required while the PC is off, use a continuously available cloud worker/scheduler.

## Upscale
- Remote GPU jobs are submitted sequentially and their IDs stored in the collection.
- The UI polls the status every 5 seconds and updates only the affected job's progress data. Completion or cancellation updates the character in React state, without `window.location.reload()`.
- Batch progress refresh runs quietly. The Refresh button displays a spinner only when manually invoked.
- The remote GPU server must remain powered and processing; if the GPU server PC shuts down as well, its engine cannot run until it starts again. Reopening PaletteIQ will resume tracking any jobs that the server retains.

## Validation
Run:
```bash
npm run typecheck
npm run test:production
```
A paid end-to-end test using a real Etsy listing, OpenAI background Responses and the user's remote GPU server is still required before release.
