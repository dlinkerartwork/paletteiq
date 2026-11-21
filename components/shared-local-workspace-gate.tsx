'use client';

import { useEffect, useState } from 'react';

const SHARED_ORIGIN = 'http://127.0.0.1:18763';
const PREFERENCE = 'paletteiq-use-shared-local-workspace';
type Discovery = { service?:string;mode?:string;shared?:boolean;protocol?:number };
type Mode = 'checking'|'shared'|'available'|'standalone'|'missing';

function isIndependentLocalWeb() {
  if (typeof window === 'undefined') return false;
  const u = window.location;
  return u.protocol === 'http:' && ['127.0.0.1','localhost'].includes(u.hostname) &&
    u.port !== '18763';
}

function sharedUrl() {
  // Open the same application on the SAME backend as Electron. Do not move
  // the SQLite file or try to synchronize two independently written DBs.
  return SHARED_ORIGIN + '/' + window.location.search + window.location.hash;
}
function preference() {
  try { return localStorage.getItem(PREFERENCE) === '1'; } catch { return false; }
}
function remember(value:boolean) {
  try { localStorage.setItem(PREFERENCE,value?'1':'0'); } catch { /* Optional */ }
}

/**
 * One backend is the only safe way for both localhost UIs to share job IDs,
 * project state, and image storage. Independent web data is never overwritten
 * or auto-migrated by this UI.
 */
export default function SharedLocalWorkspaceGate({children}:{children:React.ReactNode}) {
  const [mode,setMode]=useState<Mode>('checking');
  const [preferred,setPreferred]=useState(false);
  const [attempt,setAttempt]=useState(0);

  useEffect(()=>{
    if(!isIndependentLocalWeb()) { setMode('shared'); return; }
    let alive=true;
    const wanted=preference();
    setPreferred(wanted);
    const controller=new AbortController();
    const timeout=window.setTimeout(()=>controller.abort(),2500);
    void fetch(SHARED_ORIGIN+'/api/local-workspace',{
      method:'GET',mode:'cors',cache:'no-store',signal:controller.signal,
    }).then(async response=>{
      if(!response.ok)throw Error('No shared PaletteIQ backend');
      const data=await response.json() as Discovery;
      if(data.service!=='paletteiq-local-workspace' || data.mode!=='desktop-shared' ||
        data.shared!==true || data.protocol!==1)throw Error('Unexpected local service');
      if(!alive)return;
      if(wanted) { window.location.replace(sharedUrl());return; }
      setMode('available');
    }).catch(()=>{
      if(alive)setMode(wanted?'missing':'standalone');
    }).finally(()=>window.clearTimeout(timeout));
    return()=>{alive=false;controller.abort();window.clearTimeout(timeout);};
  },[attempt]);

  // A browser opened before Windows finishes logging in will reconnect
  // automatically as soon as its one shared backend becomes available.
  useEffect(()=>{
    if(mode!=='missing' || !preferred)return;
    const retry=()=>{setMode('checking');setAttempt(n=>n+1);};
    const timer=window.setInterval(retry,15_000);
    window.addEventListener('online',retry);
    window.addEventListener('focus',retry);
    return()=>{
      window.clearInterval(timer);
      window.removeEventListener('online',retry);
      window.removeEventListener('focus',retry);
    };
  },[mode,preferred]);

  const switchToShared=()=>{
    remember(true);
    setPreferred(true);
    window.location.assign(sharedUrl());
  };
  const useStandalone=()=>{
    remember(false);
    setPreferred(false);
    setMode('standalone');
  };

  if(mode==='checking')return <main className="account-gate" role="status">
    <p>Checking whether the shared PaletteIQ Desktop workspace is available…</p>
  </main>;

  if(mode==='missing'&&preferred)return <main className="account-gate">
    <section className="account-card">
      <h1>Shared workspace is offline</h1>
      <p>PaletteIQ Web is configured to share the Desktop workspace at <code>{SHARED_ORIGIN}</code>.
        Start PaletteIQ Desktop (or enable its Windows startup option), then retry.</p>
      <p>Your original Web workspace is separate. No collections or OpenAI jobs have been moved or resubmitted.</p>
      <button className="account-submit" type="button" onClick={()=>{setMode('checking');setAttempt(n=>n+1);}}>
        Retry shared workspace connection
      </button>
      <button className="account-switch-mode" type="button" onClick={useStandalone}>
        Open independent Web workspace instead (not synchronized)
      </button>
    </section>
  </main>;

  return <>
    {mode==='available'&&<div role="status" style={{
      padding:'10px 16px',background:'#e9f2ff',color:'#183c63',
      display:'flex',alignItems:'center',gap:12,justifyContent:'center',flexWrap:'wrap',
      fontSize:13,
    }}>
      <span><strong>Separate Web workspace.</strong> Desktop is available locally.
        Use its shared backend to see the same collections, images and Full Automation jobs.
        Existing independent Web data is not moved.</span>
      <button type="button" onClick={switchToShared} style={{
        border:'1px solid #416a94',borderRadius:6,padding:'6px 12px',
        background:'white',color:'#183c63',fontWeight:700,cursor:'pointer',
      }}>Use shared Desktop workspace</button>
    </div>}
    {mode==='standalone'&&isIndependentLocalWeb()&&<div role="status" style={{
      padding:'8px 16px',background:'#f4f4f5',color:'#444',
      display:'flex',justifyContent:'center',alignItems:'center',gap:10,flexWrap:'wrap',fontSize:12,
    }}>
      <span>Independent Web workspace — not synchronized with Desktop.</span>
      <button type="button" onClick={()=>{setMode('checking');setAttempt(n=>n+1);}}
        style={{textDecoration:'underline',border:0,background:'transparent',cursor:'pointer',color:'inherit'}}>
        Check Desktop connection
      </button>
    </div>}
    {children}
  </>;
}
