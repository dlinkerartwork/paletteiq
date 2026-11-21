'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Archive, Download, LoaderCircle, ShieldCheck } from 'lucide-react';

export default function WebWorkspaceExportPanel() {
  const [web,setWeb]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [preview,setPreview]=useState<{
    collections:number;images:number;referencedImages:number;
    missingCount:number;missing:string[];
  }|null>(null);
  const [acceptPartial,setAcceptPartial]=useState(false);

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

  const startDownload=(partial:boolean)=>{
    const anchor=document.createElement('a');
    anchor.href='/api/web-workspace-export'+(partial?'?allowMissing=1':'');
    anchor.download=partial?'paletteiq-web-workspace-partial.zip':'paletteiq-web-workspace.zip';
    document.body.appendChild(anchor);anchor.click();anchor.remove();
  };
  const download=async()=>{
    if(busy)return;
    setBusy(true);setPreview(null);setAcceptPartial(false);
    setMessage('Checking Collection references and saved PNG/JPG files…');
    try {
      const response=await fetch('/api/web-workspace-export?preview=1',{cache:'no-store'});
      const data=await response.json() as {
        error?:string;missing?:string[];collections?:number;images?:number;
        referencedImages?:number;missingCount?:number;
      };
      if(!response.ok)throw Error(data.error||'Web export unavailable');
      const report={
        collections:data.collections||0,images:data.images||0,
        referencedImages:data.referencedImages||0,
        missingCount:data.missingCount||0,missing:data.missing||[],
      };
      setPreview(report);
      if(report.missingCount){
        setMessage('Found '+report.images+' available PNG/JPG and '+report.missingCount+
          ' missing. Review the missing-file warning, then explicitly choose partial export.');
      }else{
        setMessage('All '+report.images+' PNG/JPG images verified. Starting ZIP download.');
        startDownload(false);
      }
    }catch(error){
      setMessage(error instanceof Error?error.message:'Web Workspace ZIP export failed');
    }finally{setBusy(false);}
  };
  const downloadPartial=()=>{
    if(busy||!acceptPartial||!preview||preview.missingCount===0)return;
    setMessage('Starting partial ZIP with '+preview.images+
      ' available images. The missing-file report will be included in the archive.');
    startDownload(true);
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
    {preview?.missingCount ? <div className="restore-preview" role="status">
      <p className="restore-error"><AlertTriangle size={16}/> {preview.missingCount} of {preview.referencedImages} referenced PNG/JPG assets are missing from Web storage.</p>
      <p className="sub">{preview.images} files remain available and can be safely transferred.
        Missing images are NOT included, regenerated or represented by blank files.</p>
      {preview.missing.length>0&&<p className="sub">Examples: {preview.missing.slice(0,3).join(' · ')}</p>}
      <label className="restore-options"><input type="checkbox" checked={acceptPartial}
        onChange={event=>setAcceptPartial(event.target.checked)}/>
        I understand this is an incomplete image backup. On Desktop I will select
        <strong> Allow partial image recovery</strong> and review missing images before resuming production.
      </label>
      <button className="outline-btn" type="button" disabled={!acceptPartial||busy}
        onClick={downloadPartial}><Download size={17}/> Export partial ZIP ({preview.images} available images)</button>
    </div> : null}
    <p className="sub"><ShieldCheck size={14}/> The Web store remains unchanged.
      Import into your chosen Desktop store using <strong>Web / Desktop Workspace ZIP → Selected Store</strong>.
      Active paid OpenAI jobs are not automatically transferred or duplicated.</p>
    {message&&<p role="status" className="sub">{message}</p>}
  </section>;
}
