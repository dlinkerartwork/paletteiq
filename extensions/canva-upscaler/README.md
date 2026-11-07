# PaletteIQ Canva Upscaler Companion v2 (experimental)

Chrome Manifest V3 extension for PaletteIQ Web (localhost:5173) or Desktop (127.0.0.1:18763). The extension auto-detects the correct endpoint when loading a pairing code.

## Install and test
1. Start PaletteIQ Web or Desktop.
2. Open chrome://extensions, enable Developer mode, and Load unpacked from extensions/canva-upscaler. If already installed, Reload after pulling changes.
3. In PaletteIQ Image production, select an image and click Send to Canva. Copy its pairing code.
4. Paste code in the extension and click Load selected image.
5. Click Send to Canva (automatic attempt). The extension opens Canva in a background tab and attempts to fill an existing Canva image-upload input. Open a Canva design and its Uploads panel if necessary, then retry. Verify that the image appears in Canva.
6. Upscale in Canva using its UI; download PNG or JPG.
7. In the extension choose the downloaded result and click Return upscaled image. Refresh PaletteIQ.

## Limitations
- Direct upload is best-effort and depends on Canva's DOM. Dispatching a file input event does not prove Canva imported the image. Use Download source (fallback) if it fails.
- Canva does not publish a verified endpoint to invoke its Pro Upscaler; the user still runs Upscale in Canva.
- Chrome extensions cannot automatically read arbitrary downloaded files from local disk. The return step still requires a file selection; full unattended round-trip is not currently supported.
- Direct upload caps image size at 12 MB; return accepts PNG/JPG up to 25 MB.
- Pairing codes are random, one image per code, expire after 30 minutes and are stored in server memory. Restarting PaletteIQ loses pending tasks. Originals are preserved.
- Canva credentials are never requested or handled by the extension.
