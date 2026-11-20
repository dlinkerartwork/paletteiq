'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, LoaderCircle, Pencil, Plus, Store, Trash2, X } from 'lucide-react';

type StoreSummary = { id: string; name: string; collections: number; batches: number; activeJobs: number; legacyProtected: boolean };
type Result = { deletedStore: string; deletedStoreId: string; snapshot: string; collections: number };
type List = { activeStoreId: string; stores: StoreSummary[]; error?: string };
const read = async (response: Response) => {
  const body = await response.json() as Record<string, unknown> & { error?: string };
  if (!response.ok) throw Error(body.error || 'Store request failed');
  return body;
};
async function send(action: string, data: Record<string, unknown>) {
  return read(await fetch('/api/account', { method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...data }) }));
}

export default function StoreManagement() {
  const [stores,setStores] = useState<StoreSummary[]>([]);
  const [activeStoreId,setActiveStoreId] = useState('');
  const [newStore,setNewStore] = useState('');
  const [creating,setCreating] = useState(false);
  const [editing,setEditing] = useState('');
  const [rename,setRename] = useState('');
  const [deleting,setDeleting] = useState<StoreSummary|null>(null);
  const [typedName,setTypedName] = useState('');
  const [typedPhrase,setTypedPhrase] = useState('');
  const [receipt,setReceipt] = useState<Result|null>(null);
  const [notice,setNotice] = useState('');
  const [error,setError] = useState('');
  const [busy,setBusy] = useState('');

  const load = useCallback(async () => {
    const data = await read(await fetch('/api/store-management', { cache: 'no-store' })) as unknown as List;
    setStores(data.stores); setActiveStoreId(data.activeStoreId);
  }, []);
  useEffect(() => { void load().catch(e=>setError(e instanceof Error?e.message:String(e))); }, [load]);
  const run = async (task: string, cb: () => Promise<void>) => {
    if (busy) return;
    setBusy(task); setError(''); setNotice('');
    try { await cb(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(''); }
  };
  const create = () => void run('create',async()=>{
    await send('create-store',{ name: newStore.trim() });
    window.dispatchEvent(new Event('paletteiq:store-changing'));
    try { localStorage.removeItem('paletteiq-last-workspace'); } catch {}
    window.location.assign('/#paletteiq/stores/new');
  });
  const saveRename = (store: StoreSummary) => void run('rename',async()=>{
    await send('rename-store',{ storeId:store.id, name:rename.trim() });
    setEditing(''); await load();
    window.dispatchEvent(new Event('paletteiq:stores-updated'));
    setNotice('Store name updated. Collections and images were not changed.');
  });
  const deleteStore = (store: StoreSummary) => void run('delete',async()=>{
    const result = await read(await fetch('/api/store-management',{method:'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:'delete-store',storeId:store.id,storeName:typedName,confirmation:typedPhrase}),
    })) as unknown as Result;
    setReceipt(result); setDeleting(null); setTypedName(''); setTypedPhrase('');
    await load(); window.dispatchEvent(new Event('paletteiq:stores-updated'));
    setNotice(`Store "${result.deletedStore}" removed. Download its safety archive below. Original R2 image files were retained.`);
  });

  return <div className="store-management">
    <div className="panel store-management-intro">
      <div className="settings-header"><div className="heading-icon amber"><Store size={21}/></div>
        <div><h2>Your Etsy stores</h2><p>Each store has separate collections, image references, prompts and settings. You can rename your stores without altering their files.</p></div>
      </div>
      <div className="store-create-row">
        <label className="input-label" htmlFor="create-store-input">CREATE A NEW STORE</label>
        <div className="store-create-form">
          <input id="create-store-input" value={newStore} maxLength={90} minLength={2} placeholder="e.g. DLinker Artwork"
            onChange={e=>setNewStore(e.target.value)} disabled={!!busy}/>
          <button className="primary-btn" disabled={!!busy||newStore.trim().length<2} onClick={create}>
            {busy==='create'?<LoaderCircle className="spin" size={16}/>:<Plus size={16}/>} Create store
          </button>
        </div>
      </div>
    </div>
    {error&&<div className="store-notice error" role="alert">{error}</div>}
    {notice&&<div className="store-notice" role="status"><CheckCircle2 size={16}/>{notice}</div>}
    {receipt&&<div className="panel store-archive-receipt"><CheckCircle2 size={19}/>
      <div><strong>Store deleted: {receipt.deletedStore}</strong><p>Its collections were archived as JSON before deletion. Image binaries are not in the archive.</p>
        <a className="outline-btn" href={`/api/store-management?deletedStore=${encodeURIComponent(receipt.deletedStoreId)}&snapshot=${encodeURIComponent(receipt.snapshot)}`}><Download size={16}/> Download safety archive</a>
      </div>
    </div>}
    <div className="store-list">
      {stores.map(store=><section className="panel store-list-card" key={store.id}>
        <div className="store-list-head"><div><div className="store-list-name"><Store size={18}/>
          {editing===store.id?<input aria-label="Edit store name" value={rename} maxLength={90} minLength={2}
            onChange={e=>setRename(e.target.value)} disabled={!!busy}/>:<h3>{store.name}</h3>}
          {store.id===activeStoreId&&<span className="store-active-tag">Active</span>}
        </div><p>{store.collections} collections · {store.batches} image batches{store.activeJobs>0?` · ${store.activeJobs} active`:''}</p></div>
          <div className="store-row-actions">
            {editing===store.id?<><button className="primary-btn" disabled={!!busy||rename.trim().length<2}
              onClick={()=>saveRename(store)}>Save name</button><button type="button" className="outline-btn"
              onClick={()=>setEditing('')} disabled={!!busy}><X size={15}/> Cancel</button></>
              :<><button type="button" className="outline-btn" disabled={!!busy} onClick={()=>{setEditing(store.id);setRename(store.name);}}>
                <Pencil size={15}/> Rename</button>
                <button type="button" className="outline-btn danger-btn" disabled={!!busy||stores.length===1||store.id===activeStoreId||store.activeJobs>0||store.legacyProtected}
                  title={stores.length===1?'Create another store before deleting your last one':store.id===activeStoreId?'Switch to another store before deleting this one':store.activeJobs>0?'Finish active jobs before deleting':store.legacyProtected?'Recovered legacy R2 images must be migrated before deletion':''}
                  onClick={()=>{setDeleting(store);setTypedName('');setTypedPhrase('');setReceipt(null);}}>
                  <Trash2 size={15}/> Delete
                </button></>}
          </div>
        </div>
        {store.id===activeStoreId&&<p className="store-action-hint">To delete this store, first switch to another store using the selector at the top.</p>}
        {stores.length===1&&<p className="store-action-hint">Your last remaining store cannot be deleted.</p>}
        {store.activeJobs>0&&<p className="store-action-hint">Finish or cancel active image batches before deleting this store.</p>}
        {store.legacyProtected&&<p className="store-action-hint">Protected: this store has recovered legacy R2 images. Migrate those image files before deleting the store.</p>}
      </section>)}
    </div>
    {deleting&&<section className="store-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-store-heading">
      <div className="store-delete-card">
        <div className="store-delete-title"><AlertTriangle size={23}/><h2 id="delete-store-heading">Permanently delete store?</h2></div>
        <p>You are about to delete <strong>{deleting.name}</strong>, including its <strong>{deleting.collections} collection records</strong> and image-batch metadata.
          This cannot be undone from the store list. A JSON metadata archive will be saved automatically before deletion.</p>
        <p><strong>Important:</strong> The JSON archive does not contain image binaries or API keys. Original PNG/JPG files in R2 are retained for recovery but will no longer be accessible through this deleted store. Download and safely keep the archive after deletion.</p>
        <label className="input-label" htmlFor="store-delete-name">TYPE THE EXACT STORE NAME</label>
        <input id="store-delete-name" value={typedName} onChange={e=>setTypedName(e.target.value)} autoComplete="off"
          placeholder={deleting.name} disabled={!!busy}/>
        <label className="input-label" htmlFor="store-delete-phrase">TYPE DELETE STORE</label>
        <input id="store-delete-phrase" value={typedPhrase} onChange={e=>setTypedPhrase(e.target.value)} autoComplete="off"
          placeholder="DELETE STORE" disabled={!!busy}/>
        <div className="store-delete-actions"><button type="button" className="outline-btn"
          onClick={()=>{setDeleting(null);setTypedName('');setTypedPhrase('');}} disabled={!!busy}>Cancel</button>
          <button type="button" className="primary-btn store-danger-confirm"
            disabled={!!busy||typedName!==deleting.name||typedPhrase!=='DELETE STORE'}
            onClick={()=>deleteStore(deleting)}>{busy==='delete'?<LoaderCircle size={16} className="spin"/>:<Trash2 size={16}/>} Delete store permanently</button></div>
        {error&&<p className="store-notice error" role="alert">{error}</p>}
      </div>
    </section>}
  </div>;
}
