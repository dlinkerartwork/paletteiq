const base = 'http://127.0.0.1:18763/api/canva-companion';
const byId = id => document.getElementById(id);
const status = value => { byId('status').textContent = value; };
let token = '';
let imageName = '';
byId('load').addEventListener('click', async () => {
  token = byId('token').value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(token)) return status('Paste a valid pairing code from PaletteIQ.');
  try {
    const response = await fetch(base + '?token=' + token, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Cannot connect. Check that PaletteIQ is open.');
    if (data.status !== 'pending') throw new Error('This task has already been completed.');
    imageName = data.name || 'image';
    byId('task').textContent = 'Ready: ' + imageName;
    for (const id of ['source','canva','result']) byId(id).disabled = false;
    status('Connected. Download the original image, then open Canva.');
  } catch (error) { status(String(error)); }
});
byId('source').addEventListener('click', async () => {
  try {
    const response = await fetch(base + '?file=1&token=' + token);
    if (!response.ok) throw new Error('Could not retrieve source image.');
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    chrome.downloads.download({ url: blobUrl, filename: 'PaletteIQ-' + imageName.replace(/[^a-z0-9-]/gi, '_').slice(0,70) + (blob.type === 'image/jpeg' ? '.jpg' : '.png'), saveAs: true }, () => setTimeout(() => URL.revokeObjectURL(blobUrl), 60000));
    status('Source downloaded. Upload it to Canva.');
  } catch (error) { status(String(error)); }
});
byId('canva').addEventListener('click', () => chrome.tabs.create({ url: 'https://www.canva.com/' }));
byId('result').addEventListener('change', () => { byId('submit').disabled = !byId('result').files?.length; });
byId('submit').addEventListener('click', async () => {
  const file = byId('result').files?.[0];
  if (!file) return status('Select your upscaled image first.');
  if (!['image/png','image/jpeg'].includes(file.type) || file.size > 25*1024*1024) return status('Use PNG or JPG, max 25 MB.');
  byId('submit').disabled = true;
  try {
    const response = await fetch(base + '?token=' + token, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not return image.');
    status('Saved to PaletteIQ! Return to the collection and refresh to view the upscaled version.');
  } catch (error) { status(String(error)); byId('submit').disabled = false; }
});
