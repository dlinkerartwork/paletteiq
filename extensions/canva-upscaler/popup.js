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
    for (const id of ['source','canva','place','fit','upscale','result']) byId(id).disabled = false;
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
const uploadStem = () => 'PaletteIQ-' + imageName.replace(/[^a-z0-9-]/gi, '_').slice(0,70);

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
    if (result?.ok) {
      status('Image handed to Canva Uploads. Trying to place the matching upload on canvas in a moment…');
      setTimeout(() => { if (!byId('place').disabled) byId('place').click(); }, 2500);
    }
  } catch (error) {
    status('Automatic upload unavailable: ' + String(error) + '. You can still use Download source and upload manually.');
  } finally { byId('canva').disabled = false; }
});
// Place only the upload that can be identified by this task's filename.
// Never select the first thumbnail blindly: the Canva Uploads list can contain
// unrelated artwork from other collections.
byId('place').addEventListener('click', async () => {
  byId('place').disabled = true;
  try {
    const allTabs = await chrome.tabs.query({});
    const editors = allTabs.filter(t => {
      try {
        const u = new URL(t.url || '');
        return (u.hostname === 'canva.com' || u.hostname.endsWith('.canva.com')) && u.pathname.startsWith('/design/');
      } catch { return false; }
    });
    const tab = editors.find(t => t.id === canvaTabId) || editors.find(t => t.active) || editors[0];
    if (!tab) throw new Error('Open your Canva design editor first.');
    canvaTabId = tab.id;
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: canvaTabId },
      func: expected => {
        const normalize = s => String(s || '').toLowerCase().replace(/\.[a-z0-9]{2,5}$/, '').trim();
        const visible = el => {
          const r = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && style.visibility !== 'hidden';
        };
        const target = normalize(expected);
        const candidates = [...document.querySelectorAll('img[alt], [title], [aria-label]')]
          .filter(visible)
          .filter(el => {
            const names = [el.getAttribute('alt'), el.getAttribute('title'), el.getAttribute('aria-label')];
            return names.some(v => normalize(v) === target);
          });
        const cards = new Map();
        for (const element of candidates) {
          const control = element.closest('button, [role="button"]') || element;
          cards.set(control, true);
        }
        if (cards.size !== 1) {
          // Read-only diagnostics: names and element roles only, never image
          // URLs or account information. Inspect thumbnails in left sidebar.
          const previews = [...document.querySelectorAll('img')].filter(visible)
            .filter(el => {
              const rect = el.getBoundingClientRect();
              return rect.left < Math.min(window.innerWidth * 0.38, 600) && rect.top > 190 && rect.width >= 40 && rect.height >= 40;
            }).slice(0, 8).map(el => {
              const parent = el.closest('button, [role="button"], [data-testid]') || el.parentElement;
              return {
                alt: (el.getAttribute('alt') || '').slice(0, 70),
                title: (parent?.getAttribute('title') || '').slice(0, 70),
                aria: (parent?.getAttribute('aria-label') || '').slice(0, 70),
                role: parent?.getAttribute('role') || parent?.tagName?.toLowerCase() || 'unknown'
              };
            });
          return {
            ok: false,
            message: cards.size === 0
              ? 'Upload name not exposed by Canva. Visible sidebar thumbnails (read-only): ' + JSON.stringify(previews) + '. Send this text so we can build a reliable selector. You can click the correct upload manually meanwhile.'
              : 'Multiple Canva controls match. Select the correct PaletteIQ upload manually to avoid editing the wrong image.'
          };
        }
        const [control] = cards.keys();
        control.click();
        return {
          ok: true,
          message: 'Clicked the matching uploaded image. Verify it appears and is selected on the canvas, then run Canva Upscale.'
        };
      },
      args: [uploadStem()]
    });
    status(result?.result?.message || 'Canva did not confirm image placement.');
  } catch (error) { status('Place image unavailable: ' + String(error)); }
  finally { byId('place').disabled = false; }
});

// Fit the selected Canva image using the Position → Advanced numerical controls.
// This targets one dimension with Canva's ratio lock enabled, preserving aspect
// ratio. Canva's editor DOM is not an official API, so verify after each change.
byId('fit').addEventListener('click', async () => {
  byId('fit').disabled = true;
  try {
    const tabs = await chrome.tabs.query({});
    const editors = tabs.filter(t => {
      try {
        const u = new URL(t.url || '');
        return (u.hostname === 'canva.com' || u.hostname.endsWith('.canva.com')) && u.pathname.startsWith('/design/');
      } catch { return false; }
    });
    const tab = editors.find(t => t.id === canvaTabId) || editors.find(t => t.active) || editors[0];
    if (!tab) throw new Error('Open a Canva design with the image selected.');
    canvaTabId = tab.id;
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: canvaTabId },
      func: async () => {
        const visible = el => {
          const r = el.getBoundingClientRect(), style = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        };
        const clickNamed = name => {
          const buttons = [...document.querySelectorAll('button,[role="button"]')].filter(visible);
          const button = buttons.find(b => [b.getAttribute('aria-label'), b.getAttribute('title'), b.textContent]
            .some(s => String(s || '').trim() === name));
          if (button && !button.disabled && button.getAttribute('aria-disabled') !== 'true') {
            button.click();
            return true;
          }
          return false;
        };
        const text = document.body.innerText;
        const titleMatch = text.match(/(\d{2,5})\s*px\s*[×x]\s*(\d{2,5})\s*px/i);
        if (!titleMatch) return { message:'Could not read Canva canvas dimensions. Open Position → Advanced and retry.' };
        const cw = Number(titleMatch[1]), ch = Number(titleMatch[2]);
        const findField = name => {
          const labels = [...document.querySelectorAll('label,span,div,p')].filter(el =>
            visible(el) && el.children.length < 2 && el.textContent.trim() === name &&
            el.getBoundingClientRect().left < 650
          );
          const inputs = [...document.querySelectorAll('input')].filter(el => visible(el) &&
            el.getBoundingClientRect().left < 650 && /[\d.]+/.test(el.value || '')
          );
          const options = [];
          for (const label of labels) {
            const r = label.getBoundingClientRect();
            for (const input of inputs) {
              const i = input.getBoundingClientRect();
              const dx = Math.abs(i.left - r.left), dy = i.top - r.bottom;
              if (dy >= -5 && dy < 72 && dx < 95)
                options.push({ input, score: dy + dx / 8 });
            }
          }
          options.sort((a,b) => a.score - b.score);
          return options[0]?.input || null;
        };
        let width = findField('Width'), height = findField('Height');
        if (!width || !height || width === height) {
          const opened = clickNamed('Position');
          return { message: opened
            ? 'Position panel opened. Click Auto Fit again when Advanced Width/Height fields appear.'
            : 'Cannot identify Width and Height safely. Open Position → Arrange → Advanced and retry.' };
        }
        const numeric = input => Number(String(input.value || '').replace(/[^0-9.]/g, ''));
        const w = numeric(width), h = numeric(height);
        if (!(w > 0 && h > 0 && cw > 0 && ch > 0))
          return { message:'Invalid image/canvas dimensions; no resize performed.' };
        const factor = Math.min(cw / w, ch / h);
        const useWidth = cw / w <= ch / h;
        const field = useWidth ? width : height;
        const target = Math.round((useWidth ? w : h) * factor * 10) / 10;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (!setter) return { message:'Cannot update Canva numeric controls.' };
        field.focus();
        setter.call(field, String(target));
        field.dispatchEvent(new Event('input', { bubbles:true }));
        field.dispatchEvent(new Event('change', { bubbles:true }));
        field.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', code:'Enter', bubbles:true }));
        field.dispatchEvent(new KeyboardEvent('keyup', { key:'Enter', code:'Enter', bubbles:true }));
        field.blur();
        await new Promise(resolve => setTimeout(resolve, 350));
        width = findField('Width'); height = findField('Height');
        const expectedW = w * factor, expectedH = h * factor;
        const measurements = () => {
          width = findField('Width'); height = findField('Height');
          return { nw: width ? numeric(width) : NaN, nh: height ? numeric(height) : NaN };
        };
        const matches = ({nw,nh}) => Number.isFinite(nw) && Number.isFinite(nh)
          && Math.abs(nw - expectedW) < 2 && Math.abs(nh - expectedH) < 2;
        let measured = measurements();
        let inputMethod = 'native input events';
        if (!matches(measured)) {
          // Canva's controlled inputs may reject synthetic input/change events.
          // Ask Chromium to insert text into the focused editable control as a
          // fallback, then verify the actual Width/Height values again.
          field = (useWidth ? findField('Width') : findField('Height')) || field;
          field.focus();
          field.select?.();
          const inserted = document.execCommand('insertText', false, String(target));
          field.dispatchEvent(new Event('change', { bubbles: true }));
          field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
          field.blur();
          await new Promise(resolve => setTimeout(resolve, 450));
          measured = measurements();
          inputMethod = inserted ? 'editable text insertion' : 'text insertion unsupported';
        }
        const {nw:newW, nh:newH} = measured;
        if (!matches(measured)) return { message:
          'Canva rejected both resize input methods. Expected ' + expectedW.toFixed(1) + ' × ' +
          expectedH.toFixed(1) + ', observed ' + newW + ' × ' + newH +
          ' (' + inputMethod + '). Input type: ' + field.type +
          ', readOnly: ' + field.readOnly +
          '. Resize manually for now; automation will not proceed to Upscale.' };
        clickNamed('Middle');
        clickNamed('Center');
        return { message:'Auto Fit applied: ' + newW + ' × ' + newH +
          ' on ' + cw + ' × ' + ch + ' canvas. Middle/Center requested. Verify alignment before Upscale.' };
      }
    });
    status(result?.result?.message || 'Auto Fit result unavailable.');
  } catch (error) { status('Auto Fit unavailable: ' + String(error)); }
  finally { byId('fit').disabled = false; }
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
