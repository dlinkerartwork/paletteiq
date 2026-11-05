'use client';

import Image from 'next/image';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, Clock3, Download, Image as ImageIcon, LoaderCircle, RefreshCw, Sparkles } from 'lucide-react';
import { eligibleForBulk, isActiveBatchStatus, wasPreviouslyGenerated } from '@/lib/production-rules';
import type { SimilarityReview } from '@/lib/similarity-review';
import { isOpenAICreditError, primeProductionAudio, useProductionSounds } from '@/lib/production-sounds';

type Character = { id: string; name: string; prompt: string; status: string; imageUrl?: string; error?: string; similarityReview?: SimilarityReview };
type Project = { id: string; name: string; characters: Character[]; listing?: { title?: string } };
type Job = { id: string; status: string; model: string; total: number; completed: number; failed: number; imported: number; createdAt: number; characterIds: string[]; assets: Array<{ id: string; status: string; imageUrl?: string; error?: string }>; warning?: string };
type Props = { project: Project; model: string; quality: string; onModel: (value: string) => void; onQuality: (value: string) => void; onDownloaded: (timestamp: number) => void; onAsset: (id: string, data: { imageUrl?: string; status: 'done' | 'error'; error?: string; similarityReview?: SimilarityReview }) => void };

async function request<T = unknown>(url: string, options?: RequestInit): Promise<T> {
  const r = await fetch(url, options);
  const result = await r.json() as T & { error?: string };
  if (!r.ok) throw new Error(result.error || `Request failed (${r.status})`);
  return result;
}

export default function ImageProduction({ project, model, quality, onModel, onQuality, onDownloaded, onAsset }: Props) {
  const [mode, setMode] = useState<'single' | 'batch'>('batch');
  const [batchModel, setBatchModel] = useState('gpt-image-2.5-flare');
  const [singleId, setSingleId] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [working, setWorking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [singleProgress, setSingleProgress] = useState({ done: 0, total: 0 });
  const [message, setMessage] = useState('');
  const [creditAlert, setCreditAlert] = useState('');
  const { enabled: soundEnabled, toggle: toggleSound, play: playSound } = useProductionSounds();
  const soundRef = useRef(playSound);
  useEffect(() => { soundRef.current = playSound; }, [playSound]);
  const previousBatchStates = useRef<Map<string, string> | null>(null);
  const lastCreditWarning = useRef('');
  const reportCredit = useCallback((value: unknown) => {
    if (!isOpenAICreditError(value)) return;
    const detail = value instanceof Error ? value.message : String(value);
    setCreditAlert('OpenAI credits/quota appear exhausted. Check API billing before retrying. ' + detail.slice(0, 240));
    if (lastCreditWarning.current !== detail) { lastCreditWarning.current = detail; soundRef.current('credits'); }
  }, []);
  const latestAsset = useRef(onAsset);
  const latestProject = useRef(project);
  useEffect(() => { latestAsset.current = onAsset; latestProject.current = project; }, [onAsset, project]);
  const syncBusy = useRef(false);
  const refreshNow = useRef<() => Promise<void>>(async () => {});
  const pending = new Set(jobs.filter(j => isActiveBatchStatus(j.status)).flatMap(j => j.characterIds || []));
  const everGenerated = wasPreviouslyGenerated;
  const eligible = project.characters.filter(c => eligibleForBulk(c, pending.has(c.id)));
  const chosenSingle = eligible.find(c => c.id === singleId) || eligible[0];
  const selectedBatchIds = selectedIds.length ? eligible.filter(c => selectedIds.includes(c.id)).map(c => c.id) : eligible.map(c => c.id);
  const completedTotal = project.characters.filter(c => c.status === 'done').length;
  const generated = project.characters.filter(c => !!c.imageUrl);
  const selectedGenerated = generated.filter(c => selectedIds.includes(c.id));

  const recoverImages = useCallback(async (quiet = false) => {
    try {
      const data = await request<{ recovered?: Array<{ id: string; imageUrl: string }> }>('/api/studio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'recover-images', projectId: project.id }) });
      for (const asset of data.recovered || []) latestAsset.current(asset.id, { imageUrl: asset.imageUrl, status: 'done', error: '' });
      if (!quiet) setMessage(data.recovered?.length ? `Recovered ${data.recovered.length} image(s) and saved their records.` : 'No unlinked image files found.');
    } catch (e) { if (!quiet) setMessage(e instanceof Error ? e.message : String(e)); }
  }, [project.id]);
  useEffect(() => { const timer = window.setTimeout(() => void recoverImages(true), 0); return () => window.clearTimeout(timer); }, [recoverImages]);
  useEffect(() => {
    let closed = false;
    const refresh = async (manual = false) => {
      if (syncBusy.current) { if (manual) setMessage('A refresh is already in progress.'); return; }
      syncBusy.current = true;
      setRefreshing(true);
      try {
        const data = await request<{ jobs: Job[] }>(`/api/image-batches?projectId=${encodeURIComponent(project.id)}&sync=1`);
        if (closed) return;
        const freshJobs = data.jobs || [];
        if (previousBatchStates.current) {
          const finished = freshJobs.some(job => isActiveBatchStatus(previousBatchStates.current?.get(job.id) || 'completed') && !isActiveBatchStatus(job.status));
          if (finished) soundRef.current('completed');
        }
        previousBatchStates.current = new Map(freshJobs.map(job => [job.id, job.status]));
        const warning = freshJobs.find(job => isOpenAICreditError(job.warning))?.warning;
        if (warning) reportCredit(warning);
        setJobs(freshJobs);
        // The stored collection is authoritative; historical completed jobs must not
        // overwrite a newer single or batch regeneration on the client.
        const rows = await request<Array<{ id: string; data: Project }>>(`/api/studio?projectId=${encodeURIComponent(project.id)}`);
        const stored = (rows as Array<{ id: string; data: Project }>).find(r => r.id === project.id)?.data;
        for (const asset of stored?.characters || []) {
          const local = latestProject.current.characters.find(c => c.id === asset.id);
          if (asset.imageUrl && (asset.imageUrl !== local?.imageUrl || JSON.stringify(asset.similarityReview) !== JSON.stringify(local?.similarityReview))) latestAsset.current(asset.id, { imageUrl: asset.imageUrl, status: 'done', error: '', similarityReview: asset.similarityReview });
        }
        if (manual && !closed) setMessage('Image and Batch job statuses refreshed.');
      } catch (e) { if (!closed) { setMessage(e instanceof Error ? e.message : String(e)); reportCredit(e); } }
      finally { syncBusy.current = false; if (!closed) setRefreshing(false); }
    };
    refreshNow.current = () => refresh(true);
    void refresh();
    const interval = setInterval(() => void refresh(), 15000);
    return () => { closed = true; clearInterval(interval); refreshNow.current = async () => {}; };
  }, [project.id, reportCredit]);

  const generateSingle = async (character?: Character) => {
    const item = character || chosenSingle;
    if (!item || !item.prompt || pending.has(item.id)) return;
    if (soundEnabled) primeProductionAudio();
    setWorking(true); setMessage(`Saving collection and generating ${item.name}...`); setSingleProgress({ done: 0, total: 1 });
    try {
      await request('/api/studio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', id: project.id, name: project.name, data: project }) });
      const data = await request<{ imageUrl: string; similarityReview?: SimilarityReview }>('/api/studio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'generate', model, quality, projectId: project.id, characterId: item.id }) });
      onAsset(item.id, { imageUrl: data.imageUrl, status: 'done', error: '', similarityReview: data.similarityReview });
      setSingleProgress({ done: 1, total: 1 }); setMessage(`Image completed and saved: ${item.name}. Safe to refresh.`); playSound('completed');
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); reportCredit(e); if (!item.imageUrl) onAsset(item.id, { status: 'error', error: String(e) }); }
    finally { setWorking(false); }
  };

  const submitBatch = async (ids = selectedBatchIds, regenerate = false) => {
    if (!ids.length || ids.length > 120 || ids.some(id => pending.has(id))) return;
    if (soundEnabled) primeProductionAudio();
    setWorking(true); setMessage('Saving collection and submitting an OpenAI Batch job...');
    try {
      await request('/api/studio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', id: project.id, name: project.name, data: project }) });
      const data = await request<{ job: Job }>('/api/image-batches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: project.id, characterIds: ids, model: batchModel, quality, regenerate }) });
      setJobs(list => [data.job, ...list]); setSelectedIds([]);
      setMessage(`Batch submitted (${ids.length} characters). OpenAI processes it asynchronously; you can close this tab.`);
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); reportCredit(e); }
    finally { setWorking(false); }
  };

  const downloadZip = async (scope: 'selected' | 'all' | 'package') => {
    setDownloading(true); setMessage('Preparing ZIP download from saved collection images…');
    try {
      const response = await fetch('/api/exports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: project.id, ids: selectedGenerated.map(c => c.id), scope }) });
      if (!response.ok) { const error = await response.json() as { error?: string }; throw new Error(error.error || `Export failed (${response.status})`); }
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url;
      link.download = `${project.name.replace(/[^a-z0-9-]/gi, '_')}-${scope === 'package' ? 'etsy-package' : 'images'}.zip`; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
      try { const receipt = await request<{ lastDownloadedAt: number }>('/api/studio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'mark-download', projectId: project.id }) }); onDownloaded(receipt.lastDownloadedAt); } catch { setMessage('ZIP downloaded, but download history could not be saved.'); return; }
      setMessage(`ZIP ready: ${scope === 'selected' ? selectedGenerated.length : generated.length} images.`);
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); } finally { setDownloading(false); }
  };

  return <>
    <section className="panel production-setup">
      <div className="production-mode-head"><div><h2>Generation mode</h2><p className="sub">Images and their collection records are automatically saved. Generate one character or submit a discounted Batch job.</p></div><div className="mode-switch"><button className={mode === 'single' ? 'active' : ''} onClick={() => setMode('single')}>Single</button><button className={mode === 'batch' ? 'active' : ''} onClick={() => setMode('batch')}>Batch <span>Save ~50%</span></button></div></div>
      <div className="image-download-actions"><button className="outline-btn" disabled={working} onClick={() => void recoverImages()}><RefreshCw size={14}/> Recover images</button><button type="button" className="outline-btn" onClick={toggleSound} aria-label="Toggle generation sound alerts">{soundEnabled ? '🔊 Sound alerts on' : '🔇 Sound alerts off'}</button></div>
      {creditAlert && <div className="notice production-notice" role="alert"><CircleAlert size={16}/><strong>{creditAlert}</strong><button type="button" onClick={() => setCreditAlert('')}>Dismiss</button></div>}
      <div className="production-controls">
        <div><label className="input-label">{mode === 'single' ? 'IMAGE MODEL' : 'BATCH IMAGE MODEL'}</label>{mode === 'single' ? <select value={model} onChange={e => onModel(e.target.value)}><option value="gpt-image-1-mini">GPT Image 1 Mini</option><option value="gpt-image-1">GPT Image 1</option><option value="gpt-image-1.5">GPT Image 1.5</option><option value="gpt-image-2.5-flare">GPT Image 2.5 Flare</option><option value="gpt-image-2.5-sunburst">GPT Image 2.5 Sunburst</option></select> : <select value={batchModel} onChange={e => setBatchModel(e.target.value)}><option value="gpt-image-2.5-flare">GPT Image 2.5 Flare</option><option value="gpt-image-2.5-sunburst">GPT Image 2.5 Sunburst</option></select>}</div>
        <div><label className="input-label">QUALITY</label><select value={quality} onChange={e => onQuality(e.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
        {mode === 'single' && <div className="character-choice"><label className="input-label">CHOOSE NEVER-GENERATED CHARACTER</label><select value={chosenSingle?.id ?? ''} onChange={e => setSingleId(e.target.value)}><option value="" disabled>Select a character...</option>{eligible.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
        <button className="primary-btn" disabled={working || downloading || (mode === 'single' ? !chosenSingle : !selectedBatchIds.length || selectedBatchIds.length > 120)} onClick={() => mode === 'single' ? void generateSingle() : void submitBatch()}>{working ? <LoaderCircle size={17} className="spin"/> : <Sparkles size={17}/>} {mode === 'single' ? 'Generate single image' : `Submit ${selectedBatchIds.length} new prompts to Batch`}</button>
      </div>
      {mode === 'batch' && <div className="batch-selector"><div className="batch-selector-head"><div><b>New prompt submission</b><small>{eligible.length} never-generated prompts available. Selected cards limit submission to eligible prompts; otherwise all eligible prompts are submitted (max 120).</small></div><button onClick={() => setSelectedIds([])}>Clear selection</button></div><p className="batch-hint"><Clock3 size={15}/> Previously generated items are never included in bulk submission. Use per-card Regenerate for an explicit rerun. Batch jobs continue after closing the browser.</p></div>}
      {message && <div className="notice production-notice"><CircleAlert size={16}/>{message}</div>}
      <div className="production-progress"><div><span>Collection images produced</span><b>{completedTotal} / {project.characters.length}</b></div><div className="progress"><i style={{ width: `${project.characters.length ? completedTotal / project.characters.length * 100 : 0}%` }}/></div></div>
      {mode === 'single' && working && <div className="single-loading"><LoaderCircle className="spin" size={16}/> Single image in progress · {singleProgress.done}/{singleProgress.total} completed</div>}
    </section>
    {jobs.length > 0 && <section className="panel batch-jobs"><div className="table-toolbar"><div><h2>OpenAI Batch jobs</h2><p>Jobs update automatically every 15 seconds when this page is open.</p></div><button type="button" className="outline-btn" disabled={refreshing} onClick={() => void refreshNow.current()}>{refreshing ? <LoaderCircle className="spin" size={17}/> : <RefreshCw size={17}/>} Refresh</button></div>{jobs.map(job => <div key={job.id} className="batch-job"><div className="batch-job-top"><div><b>{job.model}</b><small>{new Date(job.createdAt).toLocaleString()} · {job.total} requests</small></div><span className={`status ${job.status === 'completed' ? 'done' : job.status.includes('failed') ? 'error' : 'ready'}`}>{job.status.replaceAll('_',' ')}</span></div><div className="batch-job-counts"><span><CheckCircle2 size={14}/> {job.completed} processed by OpenAI</span><span><CircleAlert size={14}/> {job.failed} failed</span><span><ImageIcon size={14}/> {job.imported} imported</span></div><div className="progress"><i style={{ width: `${job.total ? Math.round((job.completed + job.failed) / job.total * 100) : 0}%` }}/></div>{job.warning && <p className="asset-error">{job.warning}</p>}</div>)}</section>}
    <section className="panel image-download-toolbar"><div><h2>Collection images</h2><p className="sub">{selectedIds.length} cards selected · {generated.length} images available · {eligible.length} prompts not yet generated</p></div><div className="image-download-actions"><button className="outline-btn" onClick={() => setSelectedIds(project.characters.map(c => c.id))}>Select all</button><button className="outline-btn" onClick={() => setSelectedIds([])}>Clear</button><button className="outline-btn" disabled={downloading || !selectedGenerated.length} onClick={() => void downloadZip('selected')}><Download size={15}/> Download selected ZIP</button><button className="outline-btn" disabled={downloading || !generated.length} onClick={() => void downloadZip('all')}><Download size={15}/> Download all ZIP</button><button className="primary-btn" title={!project.listing?.title ? 'Create and save an Etsy listing draft first.' : ''} disabled={downloading || !generated.length || !project.listing?.title} onClick={() => void downloadZip('package')}><Download size={15}/> Images + listing draft ZIP</button></div></section>
    <div className="assets-grid">{project.characters.map(c => <div className={`asset-card image-select-card ${selectedIds.includes(c.id) ? 'selected' : ''}`} key={c.id}><label className="asset-select"><input type="checkbox" aria-label={`Select ${c.name}`} checked={selectedIds.includes(c.id)} onChange={e => setSelectedIds(ids => e.target.checked ? [...ids, c.id] : ids.filter(id => id !== c.id))}/><span>Select</span></label><div className="asset-image">{c.imageUrl ? <Image unoptimized width={1024} height={1024} src={c.imageUrl} alt={c.name}/> : <ImageIcon size={36}/>}</div><div className="asset-meta"><b>{c.name}</b><span className={`status ${c.status}`}>{c.status}</span></div>{pending.has(c.id) && <p className="asset-pending">Batch pending</p>}{c.imageUrl && <div className={`similarity-note similarity-${c.similarityReview?.status || 'unverified'}`} title={c.similarityReview?.reason || 'Not checked yet'}>{c.similarityReview?.status === 'needs_review' ? `⚠ Similar to reference (${c.similarityReview.score}%) — review / regenerate` : c.similarityReview?.status === 'clear' ? `✓ AI visual review: low similarity (${c.similarityReview.score}%)` : 'Similarity not verified'}{c.similarityReview?.reason && <small>{c.similarityReview.reason}</small>}</div>}{c.error && <p className="asset-error">{c.error}</p>}<div className="asset-card-actions"><button className="outline-btn" disabled={working || pending.has(c.id) || !c.prompt} onClick={() => mode === 'single' ? void generateSingle(c) : void submitBatch([c.id], everGenerated(c))}>{working ? <LoaderCircle size={14} className="spin"/> : <Sparkles size={14}/>} {everGenerated(c) ? 'Regenerate' : 'Generate'} {mode === 'batch' ? '(Batch)' : '(Single)'}</button>{c.imageUrl && <a className="outline-btn" href={`${c.imageUrl}&download=1`} download><Download size={14}/> Download</a>}</div></div>)}</div>
    {!project.characters.length && <div className="panel empty-state"><ImageIcon size={32}/><strong>No image subjects yet</strong><p>Create characters and prompts first.</p></div>}
  </>;
}
