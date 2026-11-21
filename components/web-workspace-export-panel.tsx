'use client';

import { useEffect, useState } from 'react';
import { Archive, Download, LoaderCircle, ShieldCheck } from 'lucide-react';

export default function WebWorkspaceExportPanel() {
  const [web,setWeb]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');

  useEffect(()=>{
    let alive=true;
    void fetch('/api/desktop-workspace-import',{cache:'no-store'})
      .then(async response=>{
        if(!response.ok)throw Error('Cannot detect Workspace mode');
        return response.json() as Promise<{desktop?:boolean}>;
      })
      .then(data=>{if(alive)setWeb(data.desktop!==true);})
      .catch(()=>{ /* Do not show export until local identity is available. */ });
    return()=>{alive=false;};
  },[]);

  const download=async()=>{
    if(busy)return;
    setBusy(true);setMessage('Checking Collection references and saved PNG/JPG files…');
    try {
      const response=await fetch('/api/web-workspace-export?preview=1',{cache:'no-store'});
      const preview=await response.json() as {
        error?:string;missing?:string[];collections?:number;images?:number;
      };
      if(!response.ok)throw Error((preview.error||'Web export unavailable')+
        (preview.missing?.length?' Missing examples: '+preview.missing.slice(0,3).join(', '):''));
      setMessage('Preparing ZIP for '+preview.collections+' Collections and '+
        preview.images+' original image files. Check browser downloads.');
      // Navigate the real download directly; the browser streams the archive
      // instead of loading possibly gigabytes of transparent PNG into JS RAM.
      const anchor=document.createElement('a');
      anchor.href='/api/web-workspace-export';
      anchor.download='paletteiq-web-workspace.zip';
      document.body.appendChild(anchor);anchor.click();anchor.remove();
    }catch(error){
      setMessage(error instanceof Error?error.message:'Web Workspace ZIP export failed');
    }finally{setBusy(false);}
  };

  if(!web)return null;
  return <section className="desktop-workspace-import">
    <div className="restore-heading"><Archive size={21}/><div>
      <strong>Web Workspace ZIP → PaletteIQ Desktop</strong>
      <p className="sub">Save a portable ZIP containing this Web store's Collections, prompts,
        Etsy Listing Draft, original generated PNG/JPG images, upscaled images,
        thumbnails and other saved image assets. API credentials are never included.</p>
    </div></div>
    <p className="sub">Open this page on the <strong>original independent Web localhost</strong>,
      not the shared Desktop backend. To bypass a remembered shared connection temporarily,
      visit <code>http://localhost:5173/?webExport=1</code> before opening Settings.</p>
    <div className="backup-actions">
      <button className="outline-btn" disabled={busy} type="button" onClick={()=>void download()}>
        {busy?<LoaderCircle size={17} className="spin"/>:<Download size={17}/>}
        Export current Web store — ZIP with PNGs
      </button>
    </div>
    <p className="sub"><ShieldCheck size={14}/> The Web store remains unchanged.
      Import into your chosen Desktop store using <strong>Desktop Workspace ZIP → Selected Store</strong>.
      Active paid OpenAI jobs are not automatically transferred or duplicated.</p>
    {message&&<p role="status" className="sub">{message}</p>}
  </section>;
}
