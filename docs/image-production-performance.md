# Image Production performance improvements

Branch: `feature/reference-assets-thumbnail-prompt`

## Standard Bulk (foreground)

Open **Image Production → Standard Bulk**, select 3, 4 or 5 workers, choose eligible image cards (or leave none selected to process all eligible prompts), and start generation. This is **Standard API mode**, not the discounted OpenAI Batch API. The browser/Desktop must remain running through the entire job.

- A bounded worker pool issues at most 3–5 concurrent per-image requests. The app receives and saves results as each completes.
- The API uses an optimistic project compare-and-swap update, so concurrently finished images do not overwrite each other's database state.
- Uncertain failures are **not automatically retried**, to avoid duplicate paid generations. Recover images, reload the project and verify OpenAI usage before retrying.
- The UI displays completed requests / total. Actual speed depends on account rate limits, model, quality, network and image size. Increasing workers can trigger 429 errors; start with 3.

## Faster Batch import and independent similarity queue

- Each image Batch synchronization imports at most **12** saved output files, up from 5.
- Import persists paid images first. A separate bounded similarity-review queue reopens up to **4** stored images in parallel per sync.
- The Batch remains active in `reviewing` until all imported images have either a `clear`, `needs_review`, or `unverified` verdict.
- Full Automation continues to block on `reviewing`; it never treats missing or `unverified` similarity results as clear. The original paid images remain available when review fails.
- Polling runs while PaletteIQ Desktop/browser is open (or its desktop background tray is active). This change does **not** require or deploy Cloudflare. It also does not make a powered-off desktop continue local stage transitions.

## Verification and benchmarks

`npm run typecheck` checks TypeScript. `npm run test:production` runs all production regression checks, including `tests/production-throughput.test.mjs`, which simulates 50 and 100 jobs at worker concurrency 3 and 5 and verifies that each is attempted only once. These are **synthetic queue tests, not OpenAI latency benchmarks**. Measure true end-to-end throughput using a small paid test collection before producing 50–100 real images; the test suite must never issue paid OpenAI calls automatically.
