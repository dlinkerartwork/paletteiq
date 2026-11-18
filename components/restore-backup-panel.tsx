'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileJson, FolderPlus, HardDriveDownload, LoaderCircle, ShieldCheck, Upload } from 'lucide-react';
import type { RestoreMode } from '@/lib/backup-restore';

type StoreSummary = { id: string; name: string };
type RestoreStats = { collections: number; characters: number; completed: number; upscaleReferences: number; thumbnails: number; listingImages: number; note: string };
type Counts = { create: number; replace: number; skip: number; keepBoth: number; blocked: number };
type Preview = { destination: StoreSummary; summary: RestoreStats; counts: Counts; warning: string; hasLegacyAlias: boolean };
type Result = { ok: boolean; destination: StoreSummary; counts: Counts; snapshotId: string; message: string };
type ServerError = { error?: string };
const modes: Array<{ value: RestoreMode; title: string; hint: string }> = [
  { value: 'skip', title: 'Skip duplicates', hint: 'Keep existing collections unchanged' },
  { value: 'replace', title: 'Replace duplicates', hint: 'Overwrite matching IDs only in this store' },
  { value: 'keep-both', title: 'Keep both', hint: 'Create new collection IDs for duplicates' },
];

async function request(body: Record<string, unknown>) {
  const result = await fetch('/api/backup-restore', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await result.json() as Record<string, unknown> & ServerError;
  if (!result.ok) throw Error(data.error || `Restore service returned HTTP ${result.status}`);
  return data;
}

export default function RestoreBackupPanel() {
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [desktopMode, setDesktopMode] = useState(false);
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [stores, setStores] = useState<StoreSummary[]>([]);
  const [activeStoreId, setActiveStoreId] = useState('');
  const [storeId, setStoreId] = useState('');
  const [mode, setMode] = useState<RestoreMode>('skip');
  const [importPreferences, setImportPreferences] = useState(false);
  const [newStoreName, setNewStoreName] = useState('');
  const [createStoreOpen, setCreateStoreOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadStores = useCallback(async () => {
    const response = await fetch('/api/backup-restore', { cache: 'no-store' });
    const data = await response.json() as { stores?: StoreSummary[]; activeStoreId?: string; error?: string };
    if (!response.ok) throw Error(data.error || 'Could not load your stores');
    setStores(data.stores || []);
    setActiveStoreId(data.activeStoreId || '');
    setStoreId(previous => previous || data.activeStoreId || data.stores?.[0]?.id || '');
  }, []);

  useEffect(() => { void loadStores().catch(e => setError(e instanceof Error ? e.message : String(e))); }, [loadStores]);
  useEffect(() => {
    let alive = true;
    void fetch('/api/desktop-workspace-import', { cache: 'no-store' })
      .then(r => r.json() as Promise<{ desktop?: boolean }>)
      .then(data => { if (alive) setDesktopMode(data.desktop === true); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  const invalidate = () => { setPreview(null); setResult(null); setError(''); setMessage(''); };

  const chooseFile = async (file?: File) => {
    invalidate(); setPayload(null); setFileName('');
    if (!file) return;
    if (file.name.toLowerCase().endsWith('.zip')) {
      setError('This Web restore currently accepts PaletteIQ JSON backups only. ZIP image archives are not imported yet; keep them intact for future asset restoration.');
      return;
    }
    if (file.size > 10_000_000) { setError('JSON backup exceeds the 10 MB limit.'); return; }
    try {
      const data: unknown = JSON.parse(await file.text());
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('Backup must contain a JSON object');
      const parsed = data as Record<string, unknown>;
      if (parsed.format !== 'paletteiq-backup' || parsed.version !== 1 || !Array.isArray(parsed.projects) ||
          !parsed.preferences || typeof parsed.preferences !== 'object' || Array.isArray(parsed.preferences))
        throw Error('Not a valid PaletteIQ JSON backup (version 1)');
      setPayload(parsed); setFileName(file.name);
      setMessage('Backup selected. Preview the destination store before restoring.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not open JSON backup'); }
  };
  const previewRestore = async () => {
    if (!payload || !storeId) return;
    setBusy('preview'); setError(''); setPreview(null); setResult(null); setMessage('');
    try {
      const data = await request({ action: 'preview', backup: payload, storeId, mode, importPreferences });
      setPreview(data as unknown as Preview);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Preview failed'); }
    finally { setBusy(''); }
  };
  const applyRestore = async () => {
    if (!payload || !storeId || !preview || busy) return;
    if (preview.counts.blocked) { setError('Replace cannot overwrite another store. Choose Keep Both or Skip.'); return; }
    const confirmation = `Restore ${preview.summary.collections} collections to "${preview.destination.name}"?\n\n` +
      `New: ${preview.counts.create}; replace: ${preview.counts.replace}; keep both: ${preview.counts.keepBoth}; skip: ${preview.counts.skip}.\n` +
      'A safety snapshot of existing store metadata will be saved first. Original image files are not included in JSON.';
    if (!window.confirm(confirmation)) return;
    setBusy('restore'); setError(''); setMessage('');
    try {
      const data = await request({ action: 'restore', backup: payload, storeId, mode, importPreferences });
      setResult(data as unknown as Result);
      setPreview(null);
      setMessage('Restore completed. Download the safety snapshot, then check your collections and image availability.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Restore failed'); }
    finally { setBusy(''); }
  };
  const createStore = async () => {
    if (newStoreName.trim().length < 2 || busy) return;
    setBusy('create-store'); setError(''); invalidate();
    try {
      const data = await request({ action: 'create-store', name: newStoreName.trim() });
      const created = data.store as StoreSummary;
      setStores(data.stores as StoreSummary[]);
      window.dispatchEvent(new Event('paletteiq:stores-updated'));
      setStoreId(created.id);
      setNewStoreName(''); setCreateStoreOpen(false);
      setMessage(`Created "${created.name}". It is now the restore destination; your active store was not switched.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create store'); }
    finally { setBusy(''); }
  };

  // The Web JSON-import endpoint is intentionally unavailable with the
  // Desktop native SQLite bridge. Display guidance rather than a broken form.
  if (desktopMode) return <div className="restore-image-note">
    <AlertTriangle size={17}/> JSON metadata restore into a selected store is currently a Web-only operation.
    To migrate Desktop collections together with actual PNG/JPG images, use
    <strong>Desktop Workspace ZIP → Selected Store</strong> above. The JSON export button remains available.
  </div>;
  return <div className="restore-backup-panel">
    <div className="restore-heading"><ShieldCheck size={19}/><div><strong>Restore legacy backup to a chosen store</strong><p className="sub">Preview first, choose duplicate rules, then confirm. Your original JSON file is never modified.</p></div></div>
    <div className="restore-fields">
      <div>
        <label className="input-label">1 · BACKUP FILE</label>
        <div className="restore-file-choice">
          <button type="button" className="outline-btn" disabled={!!busy} onClick={() => input.current?.click()}><Upload size={16}/> Choose JSON backup</button>
          <span className="restore-filename"><FileJson size={16}/> {fileName || 'No backup selected'}</span>
          <input ref={input} type="file" accept=".json,.txt,application/json,text/plain"
            style={{ display: 'none' }} onChange={e => void chooseFile(e.target.files?.[0])}/>
        </div>
      </div>
      <div>
        <label className="input-label" htmlFor="restore-destination">2 · DESTINATION STORE</label>
        <div className="restore-file-choice">
          <select id="restore-destination" value={storeId} disabled={!!busy}
            onChange={e => { invalidate(); setStoreId(e.target.value); }}>
            {stores.map(store => <option key={store.id} value={store.id}>{store.name}{store.id === activeStoreId ? ' (active)' : ''}</option>)}
          </select>
          <button type="button" className="outline-btn" disabled={!!busy} onClick={() => setCreateStoreOpen(!createStoreOpen)}><FolderPlus size={16}/> New store</button>
        </div>
        {createStoreOpen && <div className="restore-file-choice">
          <input aria-label="New store name for restore" maxLength={90} value={newStoreName}
            onChange={e => setNewStoreName(e.target.value)} placeholder="Store for recovered collections"/>
          <button type="button" className="outline-btn" disabled={!!busy || newStoreName.trim().length < 2}
            onClick={() => void createStore()}>Create without switching</button>
        </div>}
      </div>
    </div>

    <label className="input-label">3 · DUPLICATE COLLECTION IDS</label>
    <div className="restore-modes">
      {modes.map(option => <label key={option.value} className={'restore-mode'+(mode === option.value ? ' selected' : '')}>
        <input type="radio" name="restore-duplicates" value={option.value} checked={mode === option.value}
          disabled={!!busy} onChange={() => { invalidate(); setMode(option.value); }}/>
        <span><strong>{option.title}</strong><small>{option.hint}</small></span>
      </label>)}
    </div>
    <label className="restore-options"><input type="checkbox" checked={importPreferences} disabled={!!busy}
      onChange={e => { invalidate(); setImportPreferences(e.target.checked); }}/>
      <span>Also import non-secret production preferences into the destination store (default: leave existing settings intact)</span></label>

    <p className="restore-image-note"><AlertTriangle size={17}/> JSON backups do not contain image binaries. Existing image URLs work only if their original PNG/JPG files are accessible from this store. This operation never deletes or copies images, and does not transfer API keys. Workspace ZIP import is not supported in Web yet.</p>

    {error && <p className="restore-error" role="alert">{error}</p>}
    {message && <p className="restore-message" role="status">{message}</p>}
    {preview && <div className="restore-preview" aria-live="polite">
      <strong>Preview · {preview.destination.name}</strong>
      <div className="restore-stats">
        <span><b>{preview.summary.collections}</b> collections</span>
        <span><b>{preview.summary.characters}</b> characters</span>
        <span><b>{preview.summary.completed}</b> generated-image links</span>
        <span><b>{preview.summary.upscaleReferences}</b> upscale links</span>
        <span><b>{preview.summary.thumbnails}</b> thumbnails</span>
        <span><b>{preview.summary.listingImages}</b> listing images</span>
      </div>
      <p>Will create {preview.counts.create}, replace {preview.counts.replace}, keep both {preview.counts.keepBoth}, skip {preview.counts.skip}{preview.counts.blocked ? `; BLOCKED ${preview.counts.blocked} cross-store replacements` : ''}.</p>
      <p className="sub">A safety snapshot of the destination store's existing collection metadata and preferences is created before applying the restore. Existing PNG/JPG files remain untouched.</p>
    </div>}
    {result && <div className="restore-result">
      <CheckCircle2 size={20}/><div>
        <strong>Restore saved to {result.destination.name}</strong>
        <p>{result.counts.create} new, {result.counts.replace} replaced, {result.counts.keepBoth} copied, {result.counts.skip} skipped.</p>
        <a className="outline-btn" href={`/api/backup-restore?snapshot=${encodeURIComponent(result.snapshotId)}&storeId=${encodeURIComponent(result.destination.id)}`}>
          <HardDriveDownload size={16}/> Download pre-restore safety snapshot
        </a>
        {result.destination.id === activeStoreId
          ? <button type="button" className="outline-btn" onClick={() => window.location.reload()}>Refresh collections</button>
          : <p className="sub">Use the store switcher at the top of PaletteIQ to open this store.</p>}
      </div>
    </div>}
    <div className="settings-actions">
      <button className="outline-btn" type="button" disabled={!payload || !storeId || !!busy} onClick={() => void previewRestore()}>
        {busy === 'preview' && <LoaderCircle size={16} className="spin"/>} Preview restore
      </button>
      <button className="primary-btn" type="button" disabled={!preview || !!busy || preview.counts.blocked > 0}
        onClick={() => void applyRestore()}>
        {busy === 'restore' && <LoaderCircle size={16} className="spin"/>} Restore to selected store
      </button>
    </div>
  </div>;
}
