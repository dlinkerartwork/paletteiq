# PaletteIQ Canva Upscaler Companion (semi-automatic MVP)

This Chrome Manifest V3 extension connects **locally** to PaletteIQ Desktop on `http://127.0.0.1:18763`. It does not automate Canva's website or API and does not store Canva credentials.

## Install
1. Launch PaletteIQ Desktop.
2. In Chrome open `chrome://extensions` and enable **Developer mode**.
3. Select **Load unpacked**, and choose the `extensions/canva-upscaler` directory.
4. In PaletteIQ → Image production, tick one or more generated image cards and select **Send to Canva**.
5. Copy the pairing code for the first image. The extension supports one image per pairing code; repeat for other images.
6. Paste the code into the extension popup and select **Load selected image**.
7. Download the original image, open Canva, and use Canva's **Edit → Upscale** manually. Download PNG/JPG from Canva.
8. In the extension, choose that resulting image and select **Return upscaled image**.
9. Back in PaletteIQ, select **Refresh**. The original remains intact; the upscale is stored separately.

## Safety and limits
- Pairing codes are cryptographically random and expire after 30 minutes.
- Extension can only contact the local PaletteIQ port and Canva is opened explicitly by the user.
- Original image is never overwritten.
- Re-import requires the original image and collection to still match.
- PNG/JPEG only, up to 25 MB each; at most 20 tasks per send action.
- Tasks live in server memory and are lost if PaletteIQ restarts. Imported files remain saved.
- This is a **manual Canva step**, not a Canva Pro automation. Canva's own subscription/features/usage rules apply.
