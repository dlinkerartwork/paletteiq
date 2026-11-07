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

chrome.downloads.onCreated.addListener(async item => {
  try {
    const { companionCapture: capture } = await chrome.storage.local.get('companionCapture');
    if (!capture || capture.state !== 'armed' || Date.now() > capture.expiresAt) return;
    if (!isCanvaUrl(item.finalUrl || item.url)) return;
    if (item.referrer && capture.canvaDesignUrl && new URL(item.referrer).pathname !== new URL(capture.canvaDesignUrl).pathname) return;
    if (Date.parse(item.startTime || '') < capture.armedAt) return;
    if (!/\.(png|jpe?g)$/i.test(item.filename || '')) return;
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
    if (!candidate || !isCanvaUrl(candidate.finalUrl || candidate.url) ||
        Date.parse(candidate.startTime || '') < capture.armedAt ||
        !/\\.(png|jpe?g)$/i.test(candidate.filename || '')) return;
    if (candidate.referrer && capture.canvaDesignUrl &&
        new URL(candidate.referrer).pathname !== new URL(capture.canvaDesignUrl).pathname) return;
  }
  // Set processing before awaiting network calls to avoid duplicate imports.
  await chrome.storage.local.set({ companionCapture: { ...capture, state: 'processing', downloadId: delta.id } });
  try {
    if (Date.now() > capture.expiresAt) throw new Error('Pairing/capture window expired');
    const [item] = await chrome.downloads.search({ id: delta.id });
    if (!item || !isCanvaUrl(item.finalUrl || item.url)) throw new Error('Not a Canva download');
    if (item.referrer && capture.canvaDesignUrl && new URL(item.referrer).pathname !== new URL(capture.canvaDesignUrl).pathname) throw new Error('Download referrer is a different Canva design');
    const url = item.finalUrl || item.url;
    if (!/\.(png|jpe?g)$/i.test(item.filename || '')) throw new Error('Expected PNG or JPG filename');
    const response = await fetch(url, { cache: 'no-store', credentials: 'include', redirect: 'follow' });
    if (!response.ok) throw new Error('Canva download URL returned HTTP ' + response.status);
    const size = Number(response.headers.get('content-length') || 0);
    if (size > 25 * 1024 * 1024) throw new Error('Result exceeds 25 MB');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 25 * 1024 * 1024) throw new Error('Result must be under 25 MB');
    const mime = imageFormat(bytes);
    if (!mime) throw new Error('Downloaded data was not PNG/JPEG');
    const put = await fetch(capture.base + '?token=' + encodeURIComponent(capture.token), {
      method: 'PUT',
      headers: { 'Content-Type': mime },
      body: bytes
    });
    const result = await put.json().catch(() => ({}));
    if (!put.ok || !result.ok) throw new Error(result.error || 'PaletteIQ import HTTP ' + put.status);
    await chrome.storage.local.remove(['companionCapture','companionTask']);
    await stateMessage('Canva PNG/JPG automatically returned to PaletteIQ! Refresh the collection to see the upscale.');
  } catch (error) {
    await chrome.storage.local.remove('companionCapture');
    await stateMessage('Auto Return could not read Canva download URL: ' + String(error) +
      '. The downloaded file is safe on your computer. Choose it in Return upscaled image instead.');
  }
});
