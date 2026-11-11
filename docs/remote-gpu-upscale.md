# Remote GPU Upscale (PaletteIQ Web + Desktop)

This branch uses only the private **PaletteIQ Upscale Server** as its upscale provider. Replicate, Canva Companion, Fal.ai and local Real-ESRGAN provider UI are removed. Original generated images are not overwritten; upscaled PNGs are saved as separate assets.

## Secure connection

Set these **backend-only** environment variables:

```ini
PALETTEIQ_UPSCALE_SERVER_URL=https://your-protected-gpu-endpoint.example
PALETTEIQ_UPSCALE_SERVER_KEY=<random-server-api-key-at-least-32-characters>
```

The GPU API key can also be added or replaced in **Settings → Remote GPU Upscale → GPU Server API key**. This is encrypted per signed-in user in `studio_settings.upscale_credential`, and takes precedence over the backend `PALETTEIQ_UPSCALE_SERVER_KEY` fallback. It is never returned by Settings GET, and is excluded from JSON backups. Run the `drizzle/0004_upscale_credential.sql` database migration before using the updated Settings screen. For local development, `scripts/setup-local.ps1 -SkipInstall` applies outstanding migrations after building.

- **Web hosting:** Use an authenticated HTTPS reverse proxy/tunnel reachable from the web backend. Do not use a private LAN/Tailscale IP unless that backend itself is a member of the VPN. Do not put the API key in client-side variables (`NEXT_PUBLIC_*`), source control, or browser storage. Restrict inbound access to trusted origins/identities at the tunnel or gateway in addition to the API key.
- If using Cloudflare Access in front of the tunnel, configure optional backend secrets `PALETTEIQ_GPU_ACCESS_CLIENT_ID` and `PALETTEIQ_GPU_ACCESS_CLIENT_SECRET` as an Access service token. Both must be configured together, and neither belongs in browser code.
- **Windows Desktop:** Supply the same environment variable names to the Electron process; the runtime copies them into its private local Wrangler secrets file. For desktop use, a private `http://127.0.0.1:8000`, RFC1918 LAN address, or Tailscale `100.64.0.0/10` endpoint is allowed. Prefer Tailscale for remote connections; never port-forward the raw HTTP API.
- **Local Web on your own laptop/LAN:** Set `PALETTEIQ_ALLOW_PRIVATE_HTTP_UPSCALE=1` in PaletteIQ backend `.dev.vars` and set `PALETTEIQ_UPSCALE_SERVER_URL=http://127.0.0.1:8000` (same computer) or an RFC1918 LAN IP. Restart the web backend. This opt-in permits HTTP only for loopback/private LAN/Tailscale IP addresses and keeps GPU API credentials on the backend. Do not enable it on publicly hosted deployments: LAN traffic is unencrypted, so use a trusted network and HTTPS/VPN outside local testing.
- The local `setup-local.ps1` workflow also sets `PALETTEIQ_LOCAL_NO_AUTH=1`, which automatically permits private HTTP GPU endpoints during this local development mode. Do not set `PALETTEIQ_LOCAL_NO_AUTH=1` on any publicly reachable instance; it disables sign-in and is for development only.
- Keep the machine running and use a recent, verified `paletteiq-server` v0.4 or later.

## Usage

1. In Settings → Remote GPU Upscale, choose model, 2×/4×/6×/8×, transparency policy and optional Edge Cleanup strength. Save and click **Test Connection**.
2. In Image Generation, select generated PNGs, then **Remote GPU upscale**.
3. Each accepted server job ID is written to the relevant character in the stored collection. Reopening Image Generation resumes status polling.
4. On completion the backend downloads and checks PNG output dimensions/alpha, saves a separate image in the asset bucket, and links it as `upscaledImageUrl`.
5. A failed job remains visible and can be explicitly retried using the same upscale button; a queued/processing/completed job is not resubmitted.

## Limitations / deployment checklist

- A hosted web backend cannot reach a laptop's `127.0.0.1` or private LAN address. Configure and test a secure HTTPS tunnel first; do **not** expose the raw FastAPI HTTP port to the public internet.
- Browser requests only reach PaletteIQ's own `/api/upscale`. Remote GPU key is sent only in server-to-server requests.
- Only PNG generated assets are accepted initially; JPG input support is a follow-up.
- GPU jobs are durable on the remote server. PaletteIQ persists their IDs in collection JSON; simultaneous edits to the same collection from multiple devices still need concurrency controls in a later release.
- The proxy returns errors when the GPU server or tunnel is unavailable; existing originals are retained.
- Do not delete legacy Canva extension installations on user devices automatically; they are no longer used by this branch.

## Scale selection, repeated upscale and thumbnail JPEGs

Image Production and the thumbnail gallery have a scale selector next to the
Remote GPU button. Each submission sends its selected 2×, 4×, 6× or 8× factor;
Settings supplies the default for API clients that omit it. Completed images
can be selected again. Image Production reads `upscaledImageUrl` before
`imageUrl`; thumbnails rasterize the latest upscaled image at its natural pixel
dimensions. For example, 1024 → 4× → 4096 → 2× → 8192 pixels.

Update **paletteiq-server together with this change**, before using the new UI.
The server runs the native 4× neural model and uses Lanczos to match the selected
output dimensions (including 6×/8×); those sizes do not imply additional learned
detail. HAT uses the same final sizing policy. Existing upload, pixel and output
file limits still apply, especially when repeatedly enlarging large images.

Clipart results remain PNG to preserve transparency. Thumbnail imports request
`GET /v1/jobs/{id}/result?format=jpg`, validate JPEG dimensions, and store the
returned bytes as `.jpg` with `image/jpeg` metadata. Transparent thumbnail
backgrounds are flattened onto white by the server at JPEG quality 95 and 300
DPI. The server retains its original PNG result for QC/older clients; PaletteIQ
stores the thumbnail result as JPG. An old server returning PNG is rejected with
an update message rather than saving PNG bytes under a JPG extension. Older
stored PNG thumbnails remain readable and will produce JPG on their next upscale.
