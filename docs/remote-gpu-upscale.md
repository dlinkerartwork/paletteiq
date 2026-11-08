# Remote GPU Upscale (PaletteIQ Web + Desktop)

This branch uses only the private **PaletteIQ Upscale Server** as its upscale provider. Replicate, Canva Companion, Fal.ai and local Real-ESRGAN provider UI are removed. Original generated images are not overwritten; upscaled PNGs are saved as separate assets.

## Secure connection

Set these **backend-only** environment variables:

```ini
PALETTEIQ_UPSCALE_SERVER_URL=https://your-protected-gpu-endpoint.example
PALETTEIQ_UPSCALE_SERVER_KEY=<random-server-api-key-at-least-32-characters>
```

- **Web hosting:** Use an authenticated HTTPS reverse proxy/tunnel reachable from the web backend. Do not use a private LAN/Tailscale IP unless that backend itself is a member of the VPN. Do not put the API key in client-side variables (`NEXT_PUBLIC_*`), source control, or browser storage. Restrict inbound access to trusted origins/identities at the tunnel or gateway in addition to the API key.
- If using Cloudflare Access in front of the tunnel, configure optional backend secrets `PALETTEIQ_GPU_ACCESS_CLIENT_ID` and `PALETTEIQ_GPU_ACCESS_CLIENT_SECRET` as an Access service token. Both must be configured together, and neither belongs in browser code.
- **Windows Desktop:** Supply the same environment variable names to the Electron process; the runtime copies them into its private local Wrangler secrets file. For desktop use, a private `http://127.0.0.1:8000`, RFC1918 LAN address, or Tailscale `100.64.0.0/10` endpoint is allowed. Prefer Tailscale for remote connections; never port-forward the raw HTTP API.
- Keep the machine running and use a recent, verified `paletteiq-server` v0.4 or later.

## Usage

1. In Settings → Remote GPU Upscale, choose model, 2×/4×, transparency policy and optional Edge Cleanup strength. Save and click **Test Connection**.
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
