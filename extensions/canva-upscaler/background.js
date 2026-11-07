// Canva Companion v0.6: one-shot download capture for a single pairing task.
// No arbitrary local file access, no reading downloads from unrelated domains.
// The user explicitly arms capture for one pending Canva export.
const isCanvaUrl = value => {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && (u.hostname === 'canva.com' || u.hostname.endsWith('.canva.com'));
  } catch { return false; }
};
const imageFormat = bytes => {
  if (bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  return null;
};
const stateMessage = async message => {
  await chrome.storage.local.set({ companionStatus: message }).catch(() => {});
};

// Import through a PaletteIQ page so the request has PaletteIQ's own origin.
// Vinext/Cloudflare denies cross-site PUTs from chrome-extension:// origins.
async function importFromPaletteIQ(capture, bytes, mime) {
  const endpoint = new URL(capture.base);
  if (endpoint.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(endpoint.hostname) ||
      !['5173', '18763'].includes(endpoint.port) || endpoint.pathname !== '/api/canva-companion') {
    throw new Error('Unsafe PaletteIQ endpoint in saved pairing');
  }
  const tabs = await chrome.tabs.query({});
  const page = tabs.find(tab => {
    try { return tab.id && new URL(tab.url).origin === endpoint.origin; }
    catch { return false; }
  });
  if (!page) throw new Error('Open the paired PaletteIQ website in a Chrome tab and retry');
  // Chrome scripting arguments are JSON-serializable. Transfer as base64 in
  // bounded chunks; no download URLs or Canva credentials enter the page.
  const encoded = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    encoded.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))));
  }
  const response = await chrome.scripting.executeScript({
    target: { tabId: page.id },
    world: 'MAIN',
    func: async (pathAndToken, encodedChunks, mimeType) => {
      const binary = encodedChunks.map(chunk => atob(chunk));
      const total = binary.reduce((sum, chunk) => sum + chunk.length, 0);
      const body = new Uint8Array(total);
      let offset = 0;
      for (const chunk of binary) {
        for (let index = 0; index < chunk.length; index++) body[offset++] = chunk.charCodeAt(index);
      }
      const reply = await fetch(pathAndToken, {
        method: 'PUT', headers: { 'Content-Type': mimeType }, body,
        credentials: 'same-origin'
      });
      const raw = await reply.text();
      let data = {};
      try { data = JSON.parse(raw); } catch { /* non-JSON server rejection */ }
      return { status: reply.status, ok: reply.ok && data.ok === true,
        error: data.error || (reply.ok ? '' : raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 180)) };
    },
    args: [endpoint.pathname + '?token=' + encodeURIComponent(capture.token), encoded, mime]
  });
  const result = response?.[0]?.result;
  if (!result?.ok) throw new Error('PaletteIQ import HTTP ' + (result?.status ?? 'unknown') +
    (result?.error ? ': ' + result.error : ''));
}

chrome.downloads.onCreated.addListener(async item => {
  try {
    const { companionCapture: capture } = await chrome.storage.local.get('companionCapture');
    if (!capture || capture.state !== 'armed' || Date.now() > capture.expiresAt) return;
    if (!isCanvaUrl(item.finalUrl) && !isCanvaUrl(item.url)) return;
    if (Date.parse(item.startTime || '') < capture.armedAt) return;
    if (!/\.(png|jpe?g)$/i.test(item.filename || '')) {
      await stateMessage('Canva download found, but filename is not yet PNG/JPG. Checking when download completes…');
      return;
    }
    await chrome.storage.local.set({ companionCapture: { ...capture, state: 'downloading', downloadId: item.id } });
    await stateMessage('Canva export detected. Waiting for download to finish…');
  } catch (error) { await stateMessage('Download watch error: ' + String(error)); }
});

chrome.downloads.onChanged.addListener(async delta => {
  if (delta.state?.current !== 'complete') return;
  const { companionCapture: capture } = await chrome.storage.local.get('companionCapture');
  if (!capture || !['armed', 'downloading'].includes(capture.state)) return;
  if (capture.state === 'downloading' && capture.downloadId !== delta.id) return;
  if (capture.state === 'armed') {
    // Some Chrome downloads don't have a filename until after creation.
    const [candidate] = await chrome.downloads.search({ id: delta.id });
    if (!candidate || (!isCanvaUrl(candidate.finalUrl) && !isCanvaUrl(candidate.url)) ||
        Date.parse(candidate.startTime || '') < capture.armedAt ||
        !/\.(png|jpe?g)$/i.test(candidate.filename || '')) return;
  }
  // Set processing before awaiting network calls to avoid duplicate imports.
  await chrome.storage.local.set({ companionCapture: { ...capture, state: 'processing', downloadId: delta.id } });
  try {
    if (Date.now() > capture.expiresAt) throw new Error('Pairing/capture window expired');
    const [item] = await chrome.downloads.search({ id: delta.id });
    if (!item || (!isCanvaUrl(item.finalUrl) && !isCanvaUrl(item.url))) throw new Error('Not a Canva download');
    const url = isCanvaUrl(item.finalUrl) ? item.finalUrl : item.url;
    if (!/\.(png|jpe?g)$/i.test(item.filename || '')) throw new Error('Expected PNG or JPG filename');
    const response = await fetch(url, { cache: 'no-store', credentials: 'include', redirect: 'follow' });
    if (!response.ok) throw new Error('Canva download URL returned HTTP ' + response.status);
    const size = Number(response.headers.get('content-length') || 0);
    if (size > 25 * 1024 * 1024) throw new Error('Result exceeds 25 MB');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 25 * 1024 * 1024) throw new Error('Result must be under 25 MB');
    const mime = imageFormat(bytes);
    if (!mime) throw new Error('Downloaded data was not PNG/JPEG');
    await importFromPaletteIQ(capture, bytes, mime);
    await chrome.storage.local.remove(['companionCapture','companionTask']);
    await stateMessage('Canva PNG/JPG automatically returned to PaletteIQ! Refresh the collection to see the upscale.');
  } catch (error) {
    await chrome.storage.local.remove('companionCapture');
    await stateMessage('Auto Return failed: ' + String(error) +
      '. The downloaded file is safe on your computer. Choose it in Return upscaled image instead.');
  }
});
