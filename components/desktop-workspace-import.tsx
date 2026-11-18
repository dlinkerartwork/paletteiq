'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Archive, CheckCircle2, FolderOpen, LoaderCircle, ShieldCheck, Store, XCircle } from 'lucide-react';

type StoreSummary = { id: string; name: string };
type Mode = 'skip' | 'replace' | 'keep-both';
type Counts = { create:number; skip:number; replace:number; 'keep-both':number; blocked:number };
type Preview = {
  destination:StoreSummary; counts:Counts; filesTotal:number; filesAvailable:number;
  filesMissing:number; characters:number; sourceCollections:number; sourceOwners:string[];
  warning:string;
};
type Result = { ok:boolean; storeName:string; counts:Counts; imagesCopied:number;
  imagesMissing:number; safetyDatabase:string; backupId:string };
const options: Array<{ value:Mode; label:string; hint:string }> = [
  { value:'skip', label:'Skip', hint:'Leave matching collections untouched' },
  { value:'replace', label:'Replace', hint:'Replace only matching collections in this store' },
  { value:'keep-both', label:'Keep Both', hint:'Create a new collection ID for duplicates' },
];

async function callNative(body: Record<string, unknown>) {
  const response = await fetch('/api/desktop-workspace-import',{
    method:'POST',credentials:'same-origin',
    headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
  });
  const payload = await response.json() as Record<string, unknown> & {error?:string};
  if (!response.ok) throw Error(payload.error || `Workspace import failed (HTTP ${response.status})`);
  return payload;
}

export default function DesktopWorkspaceImportPanel() {
  const [desktop,setDesktop] = useState(false);
  const [stores,setStores] = useState<StoreSummary[]>([]);
  const [storeId,setStoreId] = useState('');
  const [activeStoreId,setActiveStoreId] = useState('');
  const [selectionId,setSelectionId] = useState('');
  const [fileName,setFileName] = useState('');
  const [mode,setMode] = useState<Mode>('skip');
  const [allowMissing,setAllowMissing] = useState(false);
  const [importPreferences,setImportPreferences] = useState(false);
  const [preview,setPreview] = useState<Preview|null>(null);
  const [result,setResult] = useState<Result|null>(null);
  const [busy,setBusy] = useState('');
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  useEffect(()=>{
    let alive=true;
    void Promise.all([
      fetch('/api/desktop-workspace-import',{cache:'no-store'}).then(r=>r.json() as Promise<{desktop?:boolean}>),
      fetch('/api/account',{cache:'no-store'}).then(r=>r.json() as Promise<{stores?:StoreSummary[];activeStoreId?:string}>),
    ]).then(([platform,session])=>{
      if(!alive)return;
      setDesktop(platform.desktop===true);
      setStores(session.stores||[]);
      setActiveStoreId(session.activeStoreId||'');
      setStoreId(session.activeStoreId||session.stores?.[0]?.id||'');
    }).catch(e=>{if(alive)setError(e instanceof Error?e.message:'Cannot load Desktop restore');});
    return ()=>{alive=false;};
  },[]);
  const invalidate=()=>{setPreview(null);setResult(null);setError('');setNotice('');};
  const choose=async()=>{
    setBusy('choose');invalidate();
    try{
      const data=await callNative({action:'select'});
      if(data.cancelled)return;
      setSelectionId(String(data.selectionId||''));
      setFileName(String(data.fileName||''));
      setNotice('ZIP extracted into a temporary workspace. Preview before importing.');
    }catch(e){setError(e instanceof Error?e.message:'ZIP selection failed');}
    finally{setBusy('');}
  };
  const inspect=async()=>{
    if(!selectionId||!storeId)return;
    setBusy('preview');invalidate();
    try{
      const data=await callNative({action:'preview',selectionId,storeId,mode});
      setPreview(data as unknown as Preview);
    }catch(e){setError(e instanceof Error?e.message:'Preview failed');}
    finally{setBusy('');}
  };
  const apply=async()=>{
    if(!selectionId||!preview||!storeId||busy)return;
    if(preview.counts.blocked || (preview.filesMissing>0&&!allowMissing))return;
    const text=`Import ${preview.sourceCollections} source collections from "${fileName}" to "${preview.destination.name}"?\n`+
      `Create: ${preview.counts.create}; replace: ${preview.counts.replace}; copy: ${preview.counts['keep-both']}; skip: ${preview.counts.skip}.\n`+
      `Restore ${preview.filesAvailable} PNG/JPG image files (missing: ${preview.filesMissing}).\n\n`+
      'PaletteIQ will save a local SQLite safety backup first. Existing PNG/JPG files will NOT be overwritten. Continue?';
    if(!window.confirm(text))return;
    setBusy('apply');setError('');setNotice('');
    try{
      const data=await callNative({action:'apply',selectionId,storeId,mode,allowMissing,importPreferences});
      setResult(data as unknown as Result);setPreview(null);setSelectionId('');setFileName('');
      setNotice('Workspace import complete. Check image previews after switching to the destination store.');
    }catch(e){setError(e instanceof Error?e.message:'Import failed');}
    finally{setBusy('');}
  };
  if(!desktop)return null;
  return <section className="desktop-workspace-import">
    <div className="restore-heading"><Archive size={21}/><div>
      <strong>Desktop Workspace ZIP → Selected Store</strong>
      <p className="sub">Import an old PaletteIQ Desktop ZIP containing database/paletteiq.db and images/collections. The original ZIP and all existing store images stay untouched.</p>
    </div></div>
    <div className="restore-fields">
      <div>
        <label className="input-label">1 · OLD WORKSPACE BACKUP ZIP</label>
        <div className="restore-file-choice">
          <button type="button" className="outline-btn" disabled={!!busy} onClick={()=>void choose()}>
            {busy==='choose'?<LoaderCircle size={16} className="spin"/>:<FolderOpen size={16}/>} Choose workspace ZIP…
          </button>
          <span className="restore-filename">{fileName || 'No workspace ZIP selected'}</span>
        </div>
      </div>
      <div>
        <label className="input-label" htmlFor="desktop-restore-store">2 · RESTORE INTO STORE</label>
        <select id="desktop-restore-store" value={storeId} disabled={!!busy}
          onChange={event=>{invalidate();setStoreId(event.target.value);}}>
          {stores.map(store=><option key={store.id} value={store.id}>
            {store.name}{activeStoreId===store.id?' (active)':''}
          </option>)}
        </select>
        <p className="sub">To create another store, use the Stores page first.</p>
      </div>
    </div>
    <label className="input-label">3 · DUPLICATE COLLECTIONS</label>
    <div className="restore-modes">
      {options.map(opt=><label key={opt.value} className={'restore-mode'+(mode===opt.value?' selected':'')}>
        <input type="radio" name="desktop-workspace-mode" checked={mode===opt.value}
          disabled={!!busy} onChange={()=>{invalidate();setMode(opt.value);}}/>
        <span><strong>{opt.label}</strong><small>{opt.hint}</small></span>
      </label>)}
    </div>
    <label className="restore-options"><input type="checkbox" checked={importPreferences}
      disabled={!!busy} onChange={e=>{invalidate();setImportPreferences(e.target.checked);}}/>
      Include non-secret production settings from the ZIP. Existing API credentials are never replaced.</label>
    {preview?.filesMissing ? <label className="restore-options">
      <input type="checkbox" checked={allowMissing} disabled={!!busy} onChange={e=>setAllowMissing(e.target.checked)}/>
      <span><strong>Allow partial image recovery</strong> — {preview.filesMissing} PNG/JPG file(s) were missing or invalid. Their image links will be removed from imported data. Generated status will revert to Ready when no original image survives.</span>
    </label> : null}
    <p className="restore-image-note"><ShieldCheck size={17}/> A full local SQLite safety snapshot is saved before changes. Copied images receive new IDs under the selected store; existing images are never replaced. Historical batch jobs are not resumed.</p>
    {error&&<p role="alert" className="restore-error"><XCircle size={16}/> {error}</p>}
    {notice&&<p role="status" className="restore-message">{notice}</p>}
    {preview&&<div className="restore-preview">
      <strong>ZIP preview → {preview.destination.name}</strong>
      <div className="restore-stats">
        <span><b>{preview.sourceCollections}</b> source collections</span>
        <span><b>{preview.characters}</b> selected characters</span>
        <span><b>{preview.filesAvailable}</b> valid PNG/JPG files</span>
        <span><b>{preview.filesMissing}</b> missing image files</span>
        <span><b>{preview.counts.create}</b> new collections</span>
        <span><b>{preview.counts['keep-both']}</b> duplicate copies</span>
      </div>
      <p>{preview.counts.replace} replace · {preview.counts.skip} skip · {preview.counts.blocked} blocked.</p>
      {preview.counts.blocked>0&&<p className="restore-error"><AlertTriangle size={16}/> Another store owns a conflicting collection ID, or there is an active batch. Choose Keep Both or Skip.</p>}
      {preview.filesMissing>0&&!allowMissing&&<p className="restore-error"><AlertTriangle size={16}/> Image files are missing. Recovery is blocked by default; enable partial recovery above to proceed.</p>}
      <p className="sub">Source owner namespaces: {preview.sourceOwners.join(', ')||'none'}. PNG/JPG files will be restored into the destination store's native image directory.</p>
    </div>}
    {result&&<div className="restore-result">
      <CheckCircle2 size={20}/><div><strong>Workspace ZIP import completed</strong>
        <p>{result.imagesCopied} PNG/JPG verified and copied; {result.imagesMissing} missing. {result.counts.create} new, {result.counts.replace} replaced, {result.counts['keep-both']} copied.</p>
        <p className="sub">Local safety database: <code>{result.safetyDatabase}</code></p>
        {storeId===activeStoreId
          ? <button type="button" className="outline-btn" onClick={()=>window.location.reload()}>Reload collections</button>
          : <p className="sub"><Store size={14}/> Choose this store in the top bar to see imported collections.</p>}
      </div>
    </div>}
    <div className="settings-actions">
      <button type="button" className="outline-btn" disabled={!selectionId||!!busy}
        onClick={()=>void inspect()}>{busy==='preview'&&<LoaderCircle className="spin" size={16}/>} Preview ZIP</button>
      <button type="button" className="primary-btn" disabled={!preview||!!busy||preview.counts.blocked>0||(preview.filesMissing>0&&!allowMissing)}
        onClick={()=>void apply()}>{busy==='apply'&&<LoaderCircle className="spin" size={16}/>} Restore ZIP to selected store</button>
    </div>
  </section>;
}
