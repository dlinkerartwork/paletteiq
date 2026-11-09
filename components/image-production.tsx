'use client';

import Image from 'next/image';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, Clock3, Download, Image as ImageIcon, LoaderCircle, RefreshCw, Sparkles } from 'lucide-react';
import { eligibleForBulk, isActiveBatchStatus, wasPreviouslyGenerated } from '@/lib/production-rules';
import type { SimilarityReview } from '@/lib/similarity-review';
import { isOpenAICreditError, primeProductionAudio, useProductionSounds } from '@/lib/production-sounds';

type Character = { id: string; name: string; prompt: string; status: string; imageUrl?: string; upscaledImageUrl?: string; upscaleJob?: { id: string; submittedAt?: number }; error?: string; similarityReview?: SimilarityReview };
type Project = { id: string; name: string; characters: Character[]; listing?: { title?: string } };
type Job = { id: string; status: string; model: string; total: number; completed: number; failed: number; imported: number; createdAt: number; characterIds: string[]; assets: Array<{ id: string; status: string; imageUrl?: string; error?: string }>; warning?: string };
type Props = { project: Project; model: string; quality: string; onModel: (value: string) => void; onQuality: (value: string) => void; onDownloaded: (receipt: { lastDownloadedAt: number; downloadCount: number; lastDownloadImageCount: number; downloadedImageIds: string[] }) => void; onAsset: (id: string, data: { imageUrl?: string; status: 'done' | 'error'; error?: string; similarityReview?: SimilarityReview }) => void };

async function request<T = unknown>(url: string, options?: RequestInit): Promise<T> {
  const r = await fetch(url, options);
  const result = await r.json() as T & { error?: string };
  if (!r.ok) throw new Error(result.error || `Request failed (${r.status})`);
  return result;
}

// Keep the last known job progress visible immediately when switching tabs.
const batchJobSnapshot = new Map<string, Job[]>();

export default function ImageProduction({ project, model, quality, onModel, onQuality, onDownloaded, onAsset }: Props) {
  const [mode, setMode] = useState<'single' | 'batch'>('batch');
  const [batchModel, setBatchModel] = useState('gpt-image-2.5-flare');
  const [imageModels, setImageModels] = useState<Array<{ id: string; name: string; batchSupported: boolean }>>([]);
  const [imageModelError, setImageModelError] = useState('');
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/settings?models=openai').then(async response => {
      const body = await response.json() as { models?: Array<{ id: string; name: string; batchSupported: boolean }>; error?: string };
      if (!response.ok) throw new Error(body.error || 'Could not load image models');
      if (!cancelled) setImageModels(body.models || []);
    }).catch(error => { if (!cancelled) setImageModelError(error instanceof Error ? error.message : String(error)); });
    return () => { cancelled = true; };
  }, []);
  const [singleId, setSingleId] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [jobs, setJobs] = useState<Job[]>(() => batchJobSnapshot.get(project.id) || []);
  const [jobsLoaded, setJobsLoaded] = useState(() => batchJobSnapshot.has(project.id));
  useEffect(() => { batchJobSnapshot.set(project.id, jobs); }, [project.id, jobs]);
  const [working, setWorking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [upscaleProvider, setUpscaleProvider] = useState<'remote'>('remote');
  const [upscaleFactor, setUpscaleFactor] = useState(4);
  const [upscaling, setUpscaling] = useState(false);
  const [remoteProgress, setRemoteProgress] = useState<Record<string, { status: string; elapsed: number }>>({});
  useEffect(() => {
    let live = true;
    void fetch('/api/settings').then(r => r.json()).then((data: { preferences?: { upscaleFactor?: number } }) => {
      if (live) { setUpscaleProvider('remote'); setUpscaleFactor(data.preferences?.upscaleFactor || 4); }
    }).catch(() => {});
    return () => { live = false; };
  }, []);
  const [singleProgress, setSingleProgress] = useState({ done: 0, total: 0 });
  const [message, setMessage] = useState('');
  useEffect(() => { try { const notice = sessionStorage.getItem('paletteiq-upscale-submission-notice'); if (notice) { setMessage(notice); sessionStorage.removeItem('paletteiq-upscale-submission-notice'); } } catch { /* Optional notice. */ } }, []);
  useEffect(() => {
    const pendingIds = project.characters.filter(c => c.upscaleJob).map(c => c.id);
    if (!pendingIds.length) return;
    let stopped = false;
    let running = false;
    let cursor = 0;
    const poll = async () => {
      if (running || stopped) return;
      running = true;
      try {
        // Poll a bounded number of jobs per cycle for large collections.
        const sample = Array.from({ length: Math.min(10, pendingIds.length) }, (_, i) => pendingIds[(cursor + i) % pendingIds.length]);
        cursor = (cursor + sample.length) % pendingIds.length;
        for (const characterId of sample) {
          const response = await fetch(`/api/upscale?projectId=${encodeURIComponent(project.id)}&characterId=${encodeURIComponent(characterId)}`);
          if (!response.ok) {
            const detail = await response.json().catch(() => ({})) as { error?: string };
            if (!stopped) {
              setRemoteProgress(old => ({ ...old, [characterId]: { status: 'sync_error', elapsed: old[characterId]?.elapsed || 0 } }));
              setMessage(`Upscale result sync failed for ${project.characters.find(c => c.id === characterId)?.name || characterId}: HTTP ${response.status} — ${detail.error || 'Unknown error'}. The GPU job remains on the server; do not submit it again.`);
            }
            continue;
          }
          const result = await response.json() as { status: string; error?: string; elapsedSeconds?: number };
          if (stopped) return;
          if (result.status === 'succeeded') { window.location.reload(); return; }
          if (result.status === 'cancelled') { window.location.reload(); return; }
          setRemoteProgress(old => ({ ...old, [characterId]: { status: result.status, elapsed: result.elapsedSeconds || 0 } }));
          if (result.status === 'failed') setMessage(`Remote upscale failed: ${result.error || 'Unknown error'}`);
          else setMessage(`Remote GPU upscale: ${result.status} · ${Math.floor((result.elapsedSeconds || 0) / 60)}m ${Math.floor((result.elapsedSeconds || 0) % 60)}s. This job continues on the GPU server.`);
        }
      } catch (error) {
        if (!stopped) setMessage(`Upscale status check failed: ${error instanceof Error ? error.message : String(error)}. The GPU job remains on the server; do not resubmit it.`);
      } finally { running = false; }
    };
    void poll();
    const interval = setInterval(() => void poll(), 5000);
    return () => { stopped = true; clearInterval(interval); };
  }, [project.id]);
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
    const refresh = async (manual = false, sync = true) => {
      if (syncBusy.current) { if (manual) setMessage('A refresh is already in progress.'); return; }
      syncBusy.current = true;
      setRefreshing(true);
      try {
        const data = await request<{ jobs: Job[] }>(`/api/image-batches?projectId=${encodeURIComponent(project.id)}&sync=${sync ? '1' : '0'}`);
        if (closed) return;
        const freshJobs = data.jobs || [];
        if (previousBatchStates.current) {
          const finished = freshJobs.some(job => isActiveBatchStatus(previousBatchStates.current?.get(job.id) || 'completed') && !isActiveBatchStatus(job.status));
          if (finished) soundRef.current(freshJobs.some(job => isActiveBatchStatus(previousBatchStates.current?.get(job.id) || 'completed') && ['completed_with_errors', 'failed', 'cancelled', 'expired'].includes(job.status)) ? 'error' : 'completed');
        }
        previousBatchStates.current = new Map(freshJobs.map(job => [job.id, job.status]));
        const warning = freshJobs.find(job => isOpenAICreditError(job.warning))?.warning;
        if (warning) reportCredit(warning);
        setJobs(freshJobs);
        setJobsLoaded(true);
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
    refreshNow.current = () => refresh(true, true);
    // Read locally persisted batch status first. OpenAI polling/import must not
    // delay rendering progress after returning to this tab.
    void (async () => { await refresh(false, false); if (!closed) await refresh(false, true); })();
    const interval = setInterval(() => void refresh(false, true), 15000);
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
    } catch (e) {
      reportCredit(e);
      // A network error after OpenAI accepts a request does not prove it was unpaid.
      // Check the durable image store before allowing another potentially chargeable retry.
      await recoverImages(true);
      setMessage(`${e instanceof Error ? e.message : String(e)}. Check Recover images and refresh the collection before retrying to avoid duplicate OpenAI charges.`);
    }
    finally { setWorking(false); }
  };

  const submitBatch = async (ids = selectedBatchIds, regenerate = false) => {
    if (!jobsLoaded || !ids.length || ids.some(id => pending.has(id))) return;
    if (soundEnabled) primeProductionAudio();
    setWorking(true); setMessage('Submitting batches of up to 50 images to OpenAI. Keep the application open until every batch is accepted...');
    let submitted = 0;
    try {
      await request('/api/studio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', id: project.id, name: project.name, data: project }) });
      for (let offset = 0; offset < ids.length; offset += 50) {
        const chunk = ids.slice(offset, offset + 50);
        const data = await request<{ job: Job }>('/api/image-batches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: project.id, characterIds: chunk, model: batchModel, quality, regenerate }) });
        setJobs(list => [data.job, ...list]);
        submitted += chunk.length;
        setMessage(`Submitted ${submitted}/${ids.length} images to OpenAI. Do not shut down until all batches are accepted.`);
      }
      setSelectedIds([]);
      setMessage(`All ${submitted} images submitted across ${Math.ceil(ids.length / 50)} OpenAI batches. Safe to shut down; reopen paletteIQ later to import results.`);
    } catch (e) {
      setMessage(`Submitted ${submitted}/${ids.length} images before an error: ${e instanceof Error ? e.message : String(e)}. Check Batch activity before retrying to prevent duplicate charges.`);
      reportCredit(e);
    } finally { setWorking(false); }
  };

  const runCloudUpscale = async () => {
    if (!selectedGenerated.length || upscaling) return;
    if (upscaleProvider !== 'remote') { setMessage('Remote GPU Server is not selected.'); return; }
    // Never upload images that are already queued or have an upscaled asset.
    const targets = selectedGenerated.filter(c => !c.upscaleJob && !c.upscaledImageUrl);
    if (!targets.length) { setMessage('Selected images are already queued or upscaled.'); return; }
    setUpscaling(true);
    let accepted = 0;
    const errors: string[] = [];
    try {
      // The collection is persisted in one JSON record. Submit sequentially to
      // prevent concurrent POSTs overwriting each other's saved job references.
      // Do not wait for GPU completion; the remote server owns the durable queue.
      for (const c of targets) {
        setMessage(`Uploading ${accepted + errors.length + 1}/${targets.length}: ${c.name}. Keep this client running until all jobs are accepted.`);
        try {
          await request<{ id: string }>('/api/upscale', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId: project.id, characterId: c.id }),
          });
          accepted++;
          setRemoteProgress(old => ({ ...old, [c.id]: { status: 'queued', elapsed: 0 } }));
        } catch (error) {
          errors.push(`${c.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      const notice = `GPU server accepted ${accepted}/${targets.length} upscale jobs. ${errors.length ? `${errors.length} failed to submit:\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? `\n…and ${errors.length - 5} more failures.` : ''} Retry only failed images after fixing the errors.` : 'You may turn off the client PC now; processing continues on the GPU server.'} ${accepted ? 'Reopen PaletteIQ to import results.' : ''}`;
      setMessage(notice);
      // Rehydrate persisted references and start normal background polling.
      if (accepted) {
        try { sessionStorage.setItem('paletteiq-upscale-submission-notice', notice); } catch { /* Optional notice. */ }
        window.location.reload();
      }
    } finally { setUpscaling(false); }
  };
  const cancelRemoteUpscale = async (character: Character) => {
    if (!character.upscaleJob || !window.confirm(`Cancel remote upscale for ${character.name}?`)) return;
    try {
      const result = await request<{ status: string; cleared?: boolean }>('/api/upscale', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel', projectId: project.id, characterId: character.id }) });
      setRemoteProgress(old => ({ ...old, [character.id]: { status: result.status, elapsed: old[character.id]?.elapsed || 0 } }));
      if (result.cleared) { window.location.reload(); return; }
      setMessage(result.status === 'completed'
        ? `GPU job for ${character.name} is already completed and cannot be cancelled. The result is still on the server; PaletteIQ will retry importing it. Do not submit another upscale job.`
        : `Remote upscale for ${character.name}: ${result.status}. Waiting for server confirmation.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  const downloadZip = async (scope: 'selected' | 'all' | 'package') => {
    setDownloading(true); setMessage('Preparing ZIP download from saved collection images…');
    try {
      const response = await fetch('/api/exports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: project.id, ids: selectedGenerated.map(c => c.id), scope }) });
      if (!response.ok) { const error = await response.json() as { error?: string }; throw new Error(error.error || `Export failed (${response.status})`); }
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url;
      link.download = `${project.name.replace(/[^a-z0-9-]/gi, '_')}-${scope === 'package' ? 'etsy-package' : 'images'}.zip`; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
      try { const receipt = await request<{ lastDownloadedAt: number; downloadCount: number; lastDownloadImageCount: number; downloadedImageIds: string[] }>('/api/studio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'mark-download', projectId: project.id, scope, ids: selectedGenerated.map(c => c.id) }) }); onDownloaded(receipt); } catch { setMessage('ZIP downloaded, but download history could not be saved.'); return; }
      setMessage(`ZIP ready: ${scope === 'selected' ? selectedGenerated.length : generated.length} images.`);
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); } finally { setDownloading(false); }
  };

  return <>
    <div className="production-dashboard">
    <div className="production-dashboard-main">
    <section className="panel production-setup">
      <div className="production-mode-head"><div><h2>Generation mode</h2><p className="sub">Images and their collection records are automatically saved. Generate one character or submit a discounted Batch job.</p></div><div className="mode-switch"><button className={mode === 'single' ? 'active' : ''} onClick={() => setMode('single')}>Single</button><button className={mode === 'batch' ? 'active' : ''} onClick={() => setMode('batch')}>Batch <span>Save ~50%</span></button></div></div>
      <div className="image-download-actions"><button className="outline-btn" disabled={working} onClick={() => void recoverImages()}><RefreshCw size={14}/> Recover images</button><button type="button" className="outline-btn" onClick={toggleSound} aria-label="Toggle generation sound alerts">{soundEnabled ? '🔊 Sound alerts on' : '🔇 Sound alerts off'}</button></div>
      {creditAlert && <div className="notice production-notice" role="alert"><CircleAlert size={16}/><strong>{creditAlert}</strong><button type="button" onClick={() => setCreditAlert('')}>Dismiss</button></div>}
      <div className="production-controls">
        <div><label className="input-label">{mode === 'single' ? 'IMAGE MODEL' : 'BATCH IMAGE MODEL'}</label>{mode === 'single' ? <select value={model} onChange={e => onModel(e.target.value)}>{!imageModels.some(m => m.id === model) && <option value={model}>{model} (saved model)</option>}{imageModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select> : <select value={batchModel} onChange={e => setBatchModel(e.target.value)}>{!imageModels.some(m => m.id === batchModel && m.batchSupported) && <option value={batchModel}>{batchModel} (saved batch model)</option>}{imageModels.filter(m => m.batchSupported).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>}{imageModelError && <p className="sub">{imageModelError}</p>}</div>
        <div><label className="input-label">QUALITY</label><select value={quality} onChange={e => onQuality(e.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
        {mode === 'single' && <div className="character-choice"><label className="input-label">CHOOSE NEVER-GENERATED CHARACTER</label><select value={chosenSingle?.id ?? ''} onChange={e => setSingleId(e.target.value)}><option value="" disabled>Select a character...</option>{eligible.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
        <button className="primary-btn" disabled={working || downloading || !jobsLoaded || (mode === 'single' ? !chosenSingle : !selectedBatchIds.length)} onClick={() => mode === 'single' ? void generateSingle() : void submitBatch()}>{working ? <LoaderCircle size={17} className="spin"/> : <Sparkles size={17}/>} {mode === 'single' ? 'Generate single image' : `Submit ${selectedBatchIds.length} new prompts to Batch`}</button>
      </div>
      {mode === 'batch' && <div className="batch-selector"><div className="batch-selector-head"><div><b>New prompt submission</b><small>{eligible.length} never-generated prompts available. Selected cards limit submission to eligible prompts; otherwise all eligible prompts are submitted (automatically split into groups of 50).</small></div><button onClick={() => setSelectedIds([])}>Clear selection</button></div><p className="batch-hint"><Clock3 size={15}/> Previously generated items are never included in bulk submission. Use per-card Regenerate for an explicit rerun. Batch jobs continue after closing the browser.</p></div>}
      {message && <div className="notice production-notice"><CircleAlert size={16}/>{message}</div>}
      <div className="production-progress"><div><span>Collection images produced</span><b>{completedTotal} / {project.characters.length}</b></div><div className="progress"><i style={{ width: `${project.characters.length ? completedTotal / project.characters.length * 100 : 0}%` }}/></div></div>
      {mode === 'single' && working && <div className="single-loading"><LoaderCircle className="spin" size={16}/> Single image in progress · {singleProgress.done}/{singleProgress.total} completed</div>}
    </section>
    </div>
    <aside className="panel production-activity" aria-label="Production activity">
      <div className="table-toolbar production-activity-head">
        <div><h2>Production Activity</h2><p>OpenAI Batch jobs &amp; Remote GPU upscale queue</p></div>
        <button type="button" className="outline-btn" disabled={refreshing} onClick={() => void refreshNow.current()} aria-label="Refresh OpenAI Batch jobs">{refreshing ? <LoaderCircle size={17} className="spin"/> : <RefreshCw size={17}/>}</button>
      </div>
      <div className="production-activity-scroll">
        <div className="production-activity-section">
          <h3>OpenAI Batch jobs <span>{jobs.length}</span></h3>
          {!jobsLoaded && <p className="sub">Loading saved Batch progress…</p>}
          {jobsLoaded && jobs.length === 0 && <p className="sub">No OpenAI Batch jobs yet.</p>}
          {jobs.map(job => <div key={job.id} className="batch-job"><div className="batch-job-top"><div><b>{job.model}</b><small>{new Date(job.createdAt).toLocaleString()} · {job.total} requests</small></div><span className={`status ${job.status === 'completed' ? 'done' : job.status.includes('failed') ? 'error' : 'ready'}`}>{job.status.replaceAll('_',' ')}</span></div><div className="batch-job-counts"><span><CheckCircle2 size={14}/> {job.completed} processed by OpenAI</span><span><CircleAlert size={14}/> {job.failed} failed</span><span><ImageIcon size={14}/> {job.imported} imported</span></div><div className="progress"><i style={{ width: `${job.total ? Math.round((job.completed + job.failed) / job.total * 100) : 0}%` }}/></div>{job.warning && <p className="asset-error">{job.warning}</p>}</div>)}
        </div>
        <div className="production-activity-section">
          <h3>Remote GPU upscale <span>{project.characters.filter(c => c.upscaleJob).length} pending</span></h3>
          {project.characters.some(c => c.upscaleJob) && <div className="production-activity-summary"><b>{project.characters.filter(c => c.upscaleJob).length}</b> queued / processing · Continues on GPU server if client closes</div>}
          {!project.characters.some(c => c.upscaleJob) && !upscaling && <p className="sub">No remote upscale jobs pending.</p>}
          {upscaling && <p className="sub"><LoaderCircle size={14} className="spin"/> Submitting images to GPU server…</p>}
          {project.characters.filter(c => c.upscaleJob).map(c => {
            const progress = remoteProgress[c.id];
            const status = progress?.status || 'queued';
            const seconds = progress?.elapsed || Math.max(0, Math.floor((Date.now() - (c.upscaleJob?.submittedAt || Date.now())) / 1000));
            return <div key={c.id} className="batch-job remote-upscale-job">
              <div className="batch-job-top"><div><b title={c.name}>{c.name}</b><small>Real-ESRGAN {upscaleFactor}× · {Math.floor(seconds / 60)}m {Math.floor(seconds % 60)}s</small></div><span className={`status ${status === 'failed' || status === 'sync_error' ? 'error' : 'ready'}`}>{status === 'sync_error' ? 'Import failed' : status}</span></div>
              <div className={`remote-activity-track ${status === 'processing' ? 'is-processing' : ''}`} role="progressbar" aria-label={`Upscale ${c.name}: ${status}`} aria-valuetext={status === 'processing' ? 'Processing on GPU' : status}><i/></div>
              <button type="button" className="outline-btn remote-job-cancel" onClick={() => void cancelRemoteUpscale(c)}>Cancel</button>
            </div>;
          })}
        </div>
      </div>
    </aside>
    </div>
    <section className="panel image-download-toolbar"><div><h2>Collection images</h2><p className="sub">{selectedIds.length} cards selected · {generated.length} images available · {eligible.length} prompts not yet generated</p></div><div className="image-download-actions"><button className="outline-btn" onClick={() => setSelectedIds(project.characters.map(c => c.id))}>Select all</button><button className="outline-btn" onClick={() => setSelectedIds([])}>Clear</button><button className="outline-btn" disabled={upscaling || !selectedGenerated.length} onClick={() => void runCloudUpscale()}>{upscaling ? <LoaderCircle size={15} className="spin"/> : <ImageIcon size={15}/>} Remote GPU upscale {upscaleFactor}× ({selectedGenerated.length})</button><button className="outline-btn" disabled={downloading || !selectedGenerated.length} onClick={() => void downloadZip('selected')}><Download size={15}/> Download selected ZIP</button><button className="outline-btn" disabled={downloading || !generated.length} onClick={() => void downloadZip('all')}><Download size={15}/> Download all ZIP</button><button className="primary-btn" title={!project.listing?.title ? 'Create and save an Etsy listing draft first.' : ''} disabled={downloading || !generated.length || !project.listing?.title} onClick={() => void downloadZip('package')}><Download size={15}/> Images + listing draft ZIP</button></div></section>
    <div className="assets-grid">{project.characters.map(c => <div className={`asset-card image-select-card ${selectedIds.includes(c.id) ? 'selected' : ''}`} key={c.id}><label className="asset-select"><input type="checkbox" aria-label={`Select ${c.name}`} checked={selectedIds.includes(c.id)} onChange={e => setSelectedIds(ids => e.target.checked ? [...ids, c.id] : ids.filter(id => id !== c.id))}/><span>Select</span></label><div className="asset-image">{c.imageUrl ? <Image unoptimized width={1024} height={1024} src={c.imageUrl} alt={c.name}/> : <ImageIcon size={36}/>}</div><div className="asset-meta"><b>{c.name}</b><span className={`status ${c.status}`}>{c.status}</span></div>{pending.has(c.id) && <p className="asset-pending">Batch pending</p>}{c.upscaleJob && <div className="asset-upscaled"><span>Remote GPU: {remoteProgress[c.id]?.status === 'sync_error' ? 'Import failed' : remoteProgress[c.id]?.status || 'queued'} · {Math.floor((remoteProgress[c.id]?.elapsed || 0) / 60)}m {Math.floor((remoteProgress[c.id]?.elapsed || 0) % 60)}s</span><button className="outline-btn" type="button" onClick={() => void cancelRemoteUpscale(c)}>Cancel upscale</button></div>}{c.upscaledImageUrl && <div className="asset-upscaled"><a className="outline-btn" href={c.upscaledImageUrl} target="_blank" rel="noreferrer">View upscale</a><a className="outline-btn" href={c.upscaledImageUrl + '&download=1'} download>Download upscale</a></div>}{c.imageUrl && <div className={`similarity-note similarity-${c.similarityReview?.status || 'unverified'}`} title={c.similarityReview?.reason || 'Not checked yet'}>{c.similarityReview?.status === 'needs_review' ? `⚠ Similar to reference (${c.similarityReview.score}%) — review / regenerate` : c.similarityReview?.status === 'clear' ? `✓ AI visual review: low similarity (${c.similarityReview.score}%)` : 'Similarity not verified'}{c.similarityReview?.reason && <small>{c.similarityReview.reason}</small>}</div>}{c.error && <p className="asset-error">{c.error}</p>}<div className="asset-card-actions"><button className="outline-btn" disabled={working || pending.has(c.id) || !c.prompt} onClick={() => mode === 'single' ? void generateSingle(c) : void submitBatch([c.id], everGenerated(c))}>{working ? <LoaderCircle size={14} className="spin"/> : <Sparkles size={14}/>} {everGenerated(c) ? 'Regenerate' : 'Generate'} {mode === 'batch' ? '(Batch)' : '(Single)'}</button>{c.imageUrl && <a className="outline-btn" href={`${c.imageUrl}&download=1`} download><Download size={14}/> Download</a>}</div></div>)}</div>
    {!project.characters.length && <div className="panel empty-state"><ImageIcon size={32}/><strong>No image subjects yet</strong><p>Create characters and prompts first.</p></div>}
  </>;
}

