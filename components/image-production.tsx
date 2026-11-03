'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, Clock3, Image as ImageIcon, LoaderCircle, RefreshCw, Sparkles } from 'lucide-react';

type Character = { id: string; name: string; prompt: string; status: string; imageUrl?: string; error?: string };
type Project = { id: string; name: string; characters: Character[] };
type Job = { id: string; status: string; model: string; total: number; completed: number; failed: number; imported: number; createdAt: number; assets: Array<{ id: string; status: string; imageUrl?: string; error?: string }>; warning?: string };
type Props = { project: Project; model: string; quality: string; onModel: (value: string) => void; onQuality: (value: string) => void; onAsset: (id: string, data: { imageUrl?: string; status: 'done' | 'error'; error?: string }) => void };

async function request(url: string, options?: RequestInit) {
  const r = await fetch(url, options);
  const result: any = await r.json();
  if (!r.ok) throw new Error(result.error || `Request failed (${r.status})`);
  return result;
}

export default function ImageProduction({ project, model, quality, onModel, onQuality, onAsset }: Props) {
  const [mode, setMode] = useState<'single' | 'batch'>('batch');
  const [batchModel, setBatchModel] = useState('gpt-image-2.5-flare');
  const [singleId, setSingleId] = useState('');
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [working, setWorking] = useState(false);
  const [singleProgress, setSingleProgress] = useState({ done: 0, total: 0 });
  const [message, setMessage] = useState('');
  const latestAsset = useRef(onAsset); latestAsset.current = onAsset;
  const syncBusy = useRef(false);
  const active = project.characters.filter(c => c.prompt && c.status !== 'done');
  const chosenSingle = active.find(c => c.id === singleId) || active[0];
  const chosenBatch = active.filter(c => batchIds.includes(c.id));
  const selectedBatchIds = batchIds.length ? chosenBatch.map(c => c.id) : active.map(c => c.id);
  const completedTotal = project.characters.filter(c => c.status === 'done').length;

  useEffect(() => { setBatchIds([]); setSingleId(''); setJobs([]); }, [project.id]);
  useEffect(() => {
    let closed = false;
    const refresh = async () => {
      if (syncBusy.current) return;
      syncBusy.current = true;
      try {
        const data = await request(`/api/image-batches?projectId=${encodeURIComponent(project.id)}&sync=1`);
        if (closed) return;
        setJobs(data.jobs || []);
        for (const job of (data.jobs || []) as Job[]) for (const asset of job.assets) {
          if (asset.status === 'done' || asset.status === 'error') latestAsset.current(asset.id, { imageUrl: asset.imageUrl, error: asset.error, status: asset.status });
        }
      } catch (e) { if (!closed) setMessage(e instanceof Error ? e.message : String(e)); }
      finally { syncBusy.current = false; }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 15000);
    return () => { closed = true; clearInterval(interval); };
  }, [project.id]);

  const generateSingle = async () => {
    if (!chosenSingle) return;
    setWorking(true); setMessage(`Generating ${chosenSingle.name}...`); setSingleProgress({ done: 0, total: 1 });
    try {
      const data = await request('/api/studio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'generate', model, quality, prompt: chosenSingle.prompt }) });
      onAsset(chosenSingle.id, { imageUrl: data.imageUrl, status: 'done', error: '' });
      setSingleProgress({ done: 1, total: 1 }); setMessage(`Image completed: ${chosenSingle.name}. Save the collection to persist its result.`);
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); onAsset(chosenSingle.id, { status: 'error', error: String(e) }); }
    finally { setWorking(false); }
  };

  const submitBatch = async () => {
    if (!selectedBatchIds.length || selectedBatchIds.length > 120) return;
    setWorking(true); setMessage('Saving collection and submitting an OpenAI Batch job...');
    try {
      await request('/api/studio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', id: project.id, name: project.name, data: project }) });
      const data = await request('/api/image-batches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: project.id, characterIds: selectedBatchIds, model: batchModel, quality }) });
      setJobs(list => [data.job, ...list]); setBatchIds([]);
      setMessage(`Batch submitted (${selectedBatchIds.length} characters). OpenAI processes it asynchronously; you can close this tab.`);
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
    finally { setWorking(false); }
  };

  return <>
    <section className="panel production-setup">
      <div className="production-mode-head"><div><h2>Generation mode</h2><p className="sub">Generate one character immediately or submit a discounted OpenAI Batch job.</p></div><div className="mode-switch"><button className={mode === 'single' ? 'active' : ''} onClick={() => setMode('single')}>Single</button><button className={mode === 'batch' ? 'active' : ''} onClick={() => setMode('batch')}>Batch <span>Save ~50%</span></button></div></div>
      <div className="production-controls">
        <div><label className="input-label">{mode === 'single' ? 'IMAGE MODEL' : 'BATCH IMAGE MODEL'}</label>{mode === 'single' ? <select value={model} onChange={e => onModel(e.target.value)}><option value="gpt-image-1-mini">GPT Image 1 Mini</option><option value="gpt-image-1">GPT Image 1</option><option value="gpt-image-1.5">GPT Image 1.5</option><option value="gpt-image-2.5-flare">GPT Image 2.5 Flare</option><option value="gpt-image-2.5-sunburst">GPT Image 2.5 Sunburst</option></select> : <select value={batchModel} onChange={e => setBatchModel(e.target.value)}><option value="gpt-image-2.5-flare">GPT Image 2.5 Flare</option><option value="gpt-image-2.5-sunburst">GPT Image 2.5 Sunburst</option></select>}</div>
        <div><label className="input-label">QUALITY</label><select value={quality} onChange={e => onQuality(e.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
        {mode === 'single' && <div className="character-choice"><label className="input-label">CHOOSE CHARACTER</label><select value={chosenSingle?.id ?? ''} onChange={e => setSingleId(e.target.value)}><option value="" disabled>Select a character...</option>{active.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
        <button className="primary-btn" disabled={working || !active.length || (mode === 'batch' && selectedBatchIds.length > 120)} onClick={mode === 'single' ? generateSingle : submitBatch}>{working ? <LoaderCircle size={17} className="spin"/> : <Sparkles size={17}/>} {mode === 'single' ? 'Generate single image' : `Submit ${selectedBatchIds.length} to Batch`}</button>
      </div>
      {mode === 'batch' && <div className="batch-selector"><div className="batch-selector-head"><div><b>Batch character selection</b><small>Only characters with prompts that are not completed. Maximum 120 per submission.</small></div><button onClick={() => setBatchIds(batchIds.length ? [] : active.map(c => c.id))}>{batchIds.length ? 'Select all eligible' : 'Select specific'}</button></div>{batchIds.length > 0 && <div className="batch-selection-list">{active.map(c => <label key={c.id}><input type="checkbox" checked={batchIds.includes(c.id)} onChange={e => setBatchIds(ids => e.target.checked ? [...ids, c.id] : ids.filter(id => id !== c.id))}/>{c.name}</label>)}</div>}<p className="batch-hint"><Clock3 size={15}/> Batch jobs have a 24-hour completion window. Progress is reported by OpenAI, not estimated. Submitted jobs continue after you close the browser.</p></div>}
      {message && <div className="notice production-notice"><CircleAlert size={16}/>{message}</div>}
      <div className="production-progress"><div><span>Collection images produced</span><b>{completedTotal} / {project.characters.length}</b></div><div className="progress"><i style={{ width: `${project.characters.length ? completedTotal / project.characters.length * 100 : 0}%` }}/></div></div>
      {mode === 'single' && working && <div className="single-loading"><LoaderCircle className="spin" size={16}/> Single image in progress · {singleProgress.done}/{singleProgress.total} completed</div>}
    </section>
    {jobs.length > 0 && <section className="panel batch-jobs"><div className="table-toolbar"><div><h2>OpenAI Batch jobs</h2><p>Jobs update automatically every 15 seconds when this page is open.</p></div><RefreshCw size={17}/></div>{jobs.map(job => <div key={job.id} className="batch-job"><div className="batch-job-top"><div><b>{job.model}</b><small>{new Date(job.createdAt).toLocaleString()} · {job.total} requests</small></div><span className={`status ${job.status === 'completed' ? 'done' : job.status.includes('failed') ? 'error' : 'ready'}`}>{job.status.replaceAll('_',' ')}</span></div><div className="batch-job-counts"><span><CheckCircle2 size={14}/> {job.completed} processed by OpenAI</span><span><CircleAlert size={14}/> {job.failed} failed</span><span><ImageIcon size={14}/> {job.imported} imported</span></div><div className="progress"><i style={{ width: `${job.total ? Math.round((job.completed + job.failed) / job.total * 100) : 0}%` }}/></div>{job.warning && <p className="asset-error">{job.warning}</p>}</div>)}</section>}
    <div className="assets-grid">{project.characters.map(c => <div className="asset-card" key={c.id}><div className="asset-image">{c.imageUrl ? <img src={c.imageUrl} alt={c.name}/> : <ImageIcon size={36}/>}</div><div className="asset-meta"><b>{c.name}</b><span className={`status ${c.status}`}>{c.status}</span></div>{c.error && <p className="asset-error">{c.error}</p>}{c.imageUrl && <a className="asset-download" href={c.imageUrl} target="_blank" rel="noopener noreferrer">Open image</a>}</div>)}</div>
    {!project.characters.length && <div className="panel empty-state"><ImageIcon size={32}/><strong>No image subjects yet</strong><p>Create characters and prompts first.</p></div>}
  </>;
}
