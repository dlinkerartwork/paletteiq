if (new URLSearchParams(location.search).has('sidebar')) document.documentElement.classList.add('in-sidebar');
const endpoints = [
  'http://localhost:5173/api/canva-companion',
  'http://127.0.0.1:5173/api/canva-companion',
  'http://127.0.0.1:18763/api/canva-companion',
];
const byId = id => document.getElementById(id);
const status = value => {
  byId('status').textContent = value;
  chrome.storage.local.set({ companionStatus: value }).catch(() => {});
};
let base = '';
let token = '';
let imageName = '';
let canvaTabId = null;

const rememberTask = expiresAt => chrome.storage.local.set({
  companionTask: { base, token, imageName, expiresAt },
}).catch(() => {});

// Popup and embedded sidebar use the same extension storage. A pending task
// survives PaletteIQ client-side routing and full page reloads, but never
// bypasses the server's pairing expiry.
chrome.storage.local.get(['companionTask','companionStatus','companionTokenDraft']).then(saved => {
  if (saved.companionTokenDraft) byId('token').value = saved.companionTokenDraft;
  if (saved.companionStatus) byId('status').textContent = saved.companionStatus;
  const task = saved.companionTask;
  if (!task || !/^[a-f0-9]{64}$/.test(task.token || '')) return;
  if (!Number.isFinite(task.expiresAt) || task.expiresAt <= Date.now()) {
    chrome.storage.local.remove('companionTask').catch(() => {});
    return;
  }
  base = task.base; token = task.token; imageName = task.imageName;
  byId('token').value = token;
  byId('task').textContent = 'Restoring: ' + imageName + ' (' + new URL(base).host + ')';
  api(currentTaskUrl(), { cache: 'no-store' }).then(response => response.json()).then(data => {
    if (data.status !== 'pending') throw new Error('Task is no longer pending');
    byId('task').textContent = 'Ready: ' + imageName + ' (' + new URL(base).host + ')';
    for (const id of ['source','canva','upscale','result']) byId(id).disabled = false;
  }).catch(() => {
    byId('task').textContent = 'Saved pairing expired or unavailable. Load a new pairing code.';
    chrome.storage.local.remove('companionTask').catch(() => {});
  });
}).catch(() => {});
byId('token').addEventListener('input', () => {
  chrome.storage.local.set({ companionTokenDraft: byId('token').value }).catch(() => {});
});

const api = async (url, init) => {
  const response = await fetch(url, init);
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok) {
    const error = contentType.includes('json') ? await response.json().catch(() => ({})) : {};
    throw new Error(error.error || 'PaletteIQ returned HTTP ' + response.status);
  }
  return response;
};
const currentTaskUrl = query => base + '?token=' + encodeURIComponent(token) + (query || '');
const sourceBlob = async () => (await api(currentTaskUrl('&file=1'))).blob();

byId('load').addEventListener('click', async () => {
  token = byId('token').value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(token)) return status('Paste a valid pairing code from PaletteIQ.');
  byId('load').disabled = true;
  const failures = [];
  try {
    for (const endpoint of endpoints) {
      try {
        const response = await api(endpoint + '?token=' + token, { cache: 'no-store' });
        const data = await response.json();
        if (data.status !== 'pending') throw new Error('This task is already completed.');
        base = endpoint;
        imageName = data.name || 'image';
        rememberTask(data.expiresAt);
        byId('task').textContent = 'Ready: ' + imageName + ' (' + new URL(base).host + ')';
        for (const id of ['source','canva','upscale','result']) byId(id).disabled = false;
        status('Connected. Click Send to Canva to try direct upload.');
        return;
      } catch (error) {
        failures.push(new URL(endpoint).host + ': ' + String(error));
      }
    }
    throw new Error('No matching PaletteIQ server/task found. Check that PaletteIQ Web is running on port 5173 or Desktop on 18763. ' + failures.join(' | '));
  } catch (error) { status(String(error)); }
  finally { byId('load').disabled = false; }
});

byId('source').addEventListener('click', async () => {
  try {
    const blob = await sourceBlob();
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({
      url, filename: 'PaletteIQ-' + imageName.replace(/[^a-z0-9-]/gi, '_').slice(0,70) + (blob.type === 'image/jpeg' ? '.jpg' : '.png'), saveAs: true
    }, () => {
      if (chrome.runtime.lastError) status(chrome.runtime.lastError.message);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    });
    status('Source download started.');
  } catch (error) { status(String(error)); }
});

const dataUrlOf = blob => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error || new Error('Could not read source image'));
  reader.readAsDataURL(blob);
});

async function injectIntoCanva(encoded, filename) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: canvaTabId },
    func: (dataUrl, name) => {
      const binary = atob(dataUrl.split(',')[1]);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const type = dataUrl.slice(5, dataUrl.indexOf(';'));
      const file = new File([bytes], name, { type });
      const visibleInputs = [...document.querySelectorAll('input[type="file"]')].filter(input => {
        const accept = (input.accept || '').toLowerCase();
        return !accept || accept.includes('image') || accept.includes('.png') || accept.includes('.jpg') || accept.includes('.jpeg') || accept.includes('*');
      });
      const input = visibleInputs[0];
      if (!input) return { ok: false, message: 'Canva upload input was not found. Open Uploads → Upload files in Canva, then try Send to Canva again.' };
      try {
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, message: 'Image handed to Canva upload input. Verify that it appears in Canva Uploads.' };
      } catch (error) { return { ok: false, message: 'Canva rejected the simulated file selection: ' + String(error) }; }
    },
    args: [encoded, filename]
  });
  return result?.result;
}

byId('canva').addEventListener('click', async () => {
  byId('canva').disabled = true;
  try {
    status('Preparing source image and Canva tab…');
    const blob = await sourceBlob();
    if (blob.size > 12 * 1024 * 1024) throw new Error('Automatic transfer is limited to 12 MB. Use Download source for larger images.');
    const encoded = await dataUrlOf(blob);
    // Canva can use several editor URL forms. Inspect actual tab URLs instead
    // of matching only /design/<id>/edit.
    const allTabs = await chrome.tabs.query({});
    const canvaTabs = allTabs.filter(t => {
      try { return new URL(t.url || '').hostname.endsWith('.canva.com') || new URL(t.url || '').hostname === 'canva.com'; }
      catch { return false; }
    });
    const editors = canvaTabs.filter(t => {
      try { return new URL(t.url).pathname.startsWith('/design/'); }
      catch { return false; }
    });
    const current = canvaTabId == null ? null : editors.find(t => t.id === canvaTabId);
    let tab = current || editors.find(t => t.active) || editors[0];
    if (!tab) {
      const observed = canvaTabs.map(t => {
        try { return new URL(t.url).pathname.slice(0, 100); } catch { return '(unknown URL)'; }
      }).slice(0, 5).join(', ');
      throw new Error('No Canva design tab detected. Open a design (not Canva Home). Found ' + canvaTabs.length + ' Canva tabs' + (observed ? ': ' + observed : '') + '.');
    }
    canvaTabId = tab.id;
    if (tab.status !== 'complete') {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); reject(new Error('Canva tab timed out')); }, 25000);
        const listener = (id, change) => {
          if (id === canvaTabId && change.status === 'complete') {
            clearTimeout(timeout);
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
      });
    }
    tab = await chrome.tabs.get(canvaTabId);
    if (!tab.url?.startsWith('https://www.canva.com/')) throw new Error('Expected a Canva tab');
    const filename = 'PaletteIQ-' + imageName.replace(/[^a-z0-9-]/gi, '_').slice(0,70) + (blob.type === 'image/jpeg' ? '.jpg' : '.png');
    const result = await injectIntoCanva(encoded, filename);
    status(result?.message || 'Canva did not confirm the upload. Use Download source as fallback.');
  } catch (error) {
    status('Automatic upload unavailable: ' + String(error) + '. You can still use Download source and upload manually.');
  } finally { byId('canva').disabled = false; }
});
// Upscale control varies across Canva releases. Only trigger a visible,
// explicitly labeled Upscale control in the selected Canva editor.
byId('upscale').addEventListener('click', async () => {
  byId('upscale').disabled = true;
  try {
    const allTabs = await chrome.tabs.query({});
    const editors = allTabs.filter(t => {
      try {
        const url = new URL(t.url || '');
        return (url.hostname === 'canva.com' || url.hostname.endsWith('.canva.com')) && url.pathname.startsWith('/design/');
      } catch { return false; }
    });
    const tab = editors.find(t => t.id === canvaTabId) || editors.find(t => t.active) || editors[0];
    if (!tab) throw new Error('Open a Canva design editor first.');
    canvaTabId = tab.id;
    const [outcome] = await chrome.scripting.executeScript({
      target: { tabId: canvaTabId },
      func: () => {
        const visible = element => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        };
        const label = element => (
          element.getAttribute('aria-label') ||
          element.getAttribute('title') ||
          element.textContent ||
          ''
        ).trim().replace(/\s+/g, ' ');
        const controls = [...document.querySelectorAll('button, [role="button"]')].filter(visible);
        const match = exact => controls.find(el => exact.test(label(el)));
        // Canva sometimes places the Upscale tool under the Edit image panel.
        const edit = match(/^(Edit|Edit image)$/i);
        let upscale = match(/^Upscale$/i);
        if (!upscale && edit) {
          edit.click();
          return { action: 'opened-edit', message: 'Edit image opened. Wait for its tools to appear, then click Run Upscale again.' };
        }
        if (!upscale) return { action: 'not-found', message: 'Upscale control not found. Select the image, open Edit image, and try again.' };
        upscale.click();
        return { action: 'clicked', message: 'Clicked Canva Upscale. Watch the canvas and verify processing completes; this does not prove success yet.' };
      }
    });
    status(outcome?.result?.message || 'Canva did not report an Upscale action.');
  } catch (error) {
    status('Upscale automation unavailable: ' + String(error));
  } finally { byId('upscale').disabled = false; }
});
byId('result').addEventListener('change', () => { byId('submit').disabled = !byId('result').files?.length; });
byId('submit').addEventListener('click', async () => {
  const file = byId('result').files?.[0];
  if (!file) return status('Select the upscaled Canva image first.');
  if (!['image/png','image/jpeg'].includes(file.type) || file.size > 25 * 1024 * 1024) return status('Use PNG/JPG up to 25 MB.');
  byId('submit').disabled = true;
  try {
    const response = await api(currentTaskUrl(), { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
    const data = await response.json();
    if (data.ok) chrome.storage.local.remove('companionTask').catch(() => {});
    status(data.ok ? 'Upscaled result saved to PaletteIQ. Refresh the collection.' : 'Unexpected response.');
  } catch (error) { status(String(error)); byId('submit').disabled = false; }
});
