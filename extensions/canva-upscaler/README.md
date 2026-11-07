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

## v0.4.0 — persistent PaletteIQ floating sidebar
- Open PaletteIQ Web or Desktop: the companion loads automatically as a right-side floating sidebar.
- Use the narrow orange toggle halfway down the left edge of the sidebar to collapse or expand it. Its state persists across navigation and refresh.
- Active pairing code, character name, endpoint, and status text are kept in extension-local storage so they survive PaletteIQ route/tab changes. On restoration, the extension revalidates the pairing against the server. Expired/completed tasks cannot be resumed.
- Selected files from the browser's file picker **cannot** be preserved across page reloads; select the downloaded Canva result again when returning it.
- The toolbar action popup is still supported, sharing the same pairing state with the embedded sidebar.
- Chrome extension permissions now include storage plus a content script limited to PaletteIQ's local development and desktop URLs.
- Update: pull the branch, reload the unpacked extension at chrome://extensions, then refresh PaletteIQ. No desktop installer rebuild is needed for local web development.
- The embedded extension page requires Chrome to allow loading web-accessible extension resources; report a blank panel if browser policy blocks the frame.
