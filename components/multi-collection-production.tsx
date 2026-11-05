 'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, LoaderCircle, RefreshCw, Sparkles } from 'lucide-react';
import { eligibleForBulk, isActiveBatchStatus } from '@/lib/production-rules';
import { isOpenAICreditError, primeProductionAudio, useProductionSounds } from '@/lib/production-sounds';

type Character = { id: string; name: string; prompt: string; status: string; imageUrl?: string };
type Collection = { id: string; name: string; characters: Character[] };
type Job = { id: string; status: string; total: number; completed: number; failed: number; imported: number; warning?: string; characterIds: string[] };
type CollectionJobs = Record<string, Job[]>;

async function jsonRequest<T = unknown>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, cache: 'no-store' });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Request failed');
  return body as T;
}

export default function MultiCollectionProduction() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [model, setModel] = useState('gpt-image-2.5-flare');
  const [quality, setQuality] = useState('low');
  const [jobs, setJobs] = useState<CollectionJobs>({});
  const [working, setWorking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState('');
  const [creditAlert, setCreditAlert] = useState('');
  const { enabled: soundEnabled, toggle: toggleSound, play: playSound } = useProductionSounds();
  const soundRef = useRef(playSound);
  useEffect(() => { soundRef.current = playSound; }, [playSound]);
  const lastCreditWarning = useRef('');
  const previousStates = useRef<Map<string, string> | null>(null);
  const jobsRef = useRef<CollectionJobs>({});
  const reportCredit = useCallback((value: unknown) => {
    if (!isOpenAICreditError(value)) return;
    const detail = value instanceof Error ? value.message : String(value);
    setCreditAlert('OpenAI credits/quota appear exhausted. Check API billing before retrying. ' + detail.slice(0, 240));
    if (lastCreditWarning.current !== detail) { lastCreditWarning.current = detail; soundRef.current('credits'); }
  }, []);
  const [progress, setProgress] = useState({ submitted: 0, total: 0 });

  const reload = useCallback(async (sync = false) => {
    setRefreshing(true);
    try {
      const rows = await jsonRequest<Array<{ data: Collection }>>('/api/studio');
      const fresh: Collection[] = (rows as Array<{ data: Collection }>).map(row => row.data);
      setCollections(fresh);
      const errors: string[] = [];
      const updated = await Promise.all(fresh.map(async collection => {
        try {
          const result = await jsonRequest<{ jobs: Job[] }>('/api/image-batches?projectId=' + encodeURIComponent(collection.id) + (sync ? '&sync=1' : ''));
          for (const job of result.jobs) if (job.warning) reportCredit(job.warning);
          return [collection.id, result.jobs as Job[]] as const;
        } catch (error) {
          reportCredit(error);
          errors.push(collection.name + ': ' + (error instanceof Error ? error.message : String(error)));
          return [collection.id, jobsRef.current[collection.id] || []] as const;
        }
      }));
      const incomingJobs = Object.fromEntries(updated) as CollectionJobs;
      const nextStates = new Map<string, string>();
      for (const list of Object.values(incomingJobs)) for (const job of list) nextStates.set(job.id, job.status);
      if (previousStates.current && [...nextStates].some(([id, status]) => isActiveBatchStatus(previousStates.current?.get(id) || 'completed') && !isActiveBatchStatus(status))) soundRef.current('completed');
      previousStates.current = nextStates;
      jobsRef.current = incomingJobs;
      setJobs(incomingJobs);
      if (errors.length) setMessage('Some collections could not refresh: ' + errors.slice(0, 3).join(' | '));
      else if (sync) setMessage('Batch status and collection images refreshed.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Refresh failed');
      reportCredit(error);
    } finally {
      setRefreshing(false);
    }
  }, [reportCredit]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => void reload(), 0);
    const timer = window.setInterval(() => void reload(true), 45000);
    return () => { window.clearTimeout(initialTimer); window.clearInterval(timer); };
  }, [reload]);

  const rows = useMemo(() => collections.map(collection => {
    const pending = new Set((jobs[collection.id] || []).filter(job => isActiveBatchStatus(job.status)).flatMap(job => job.characterIds || []));
    const eligible = collection.characters.filter(character => eligibleForBulk(character, pending.has(character.id)));
    return { collection, eligible, jobs: jobs[collection.id] || [] };
  }), [collections, jobs]);
  const visible = rows.filter(row => row.collection.name.toLowerCase().includes(search.trim().toLowerCase()));
  const chosen = rows.filter(row => selected.includes(row.collection.id));
  const requestCount = chosen.reduce((sum, row) => sum + row.eligible.length, 0);

  const submit = async () => {
    if (working || !requestCount) return;
    if (soundEnabled) primeProductionAudio();
    setWorking(true);
    setProgress({ submitted: 0, total: requestCount });
    setMessage('Submitting separate OpenAI batches per collection...');
    let submitted = 0;
    try {
      // Read saved data again so unsaved edits in another window cannot be submitted accidentally.
      const freshRows = await jsonRequest<Array<{ data: Collection }>>('/api/studio');
      for (const row of chosen) {
        const fresh = freshRows.find(item => item.data.id === row.collection.id)?.data;
        if (!fresh) throw new Error('Collection no longer exists: ' + row.collection.name);
        const eligible = fresh.characters.filter(c => eligibleForBulk(c));
        for (let i = 0; i < eligible.length; i += 120) {
          const ids = eligible.slice(i, i + 120).map(c => c.id);
          await jsonRequest('/api/image-batches', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId: fresh.id, characterIds: ids, model, quality }),
          });
          submitted += ids.length;
          setProgress({ submitted, total: requestCount });
        }
      }
      setMessage('Submitted ' + submitted + ' images across ' + chosen.length + ' collections. OpenAI will process them asynchronously.');
    } catch (error) {
      setMessage('Submitted ' + submitted + ' images before stopping: ' + (error instanceof Error ? error.message : String(error)) + '. Refresh before retrying.');
      reportCredit(error);
    } finally {
      setWorking(false);
      await reload();
    }
  };

  return <div className="panel">
    <div className="table-toolbar">
      <div><h2>Multi-Collection Production</h2><p>Each collection gets its own saved Batch jobs and image assets. Previously generated prompts are excluded.</p></div>
      <div className="image-download-actions"><button type="button" className="outline-btn" disabled={refreshing || working} onClick={() => void reload(true)}>{refreshing ? <LoaderCircle className="spin" size={16}/> : <RefreshCw size={16}/>} Refresh</button><button type="button" className="outline-btn" onClick={toggleSound}>{soundEnabled ? '🔊 Sound alerts on' : '🔇 Sound alerts off'}</button></div>
    </div>
    <div className="production-controls">
      <div><label className="input-label">BATCH IMAGE MODEL</label><select value={model} onChange={e => setModel(e.target.value)}><option value="gpt-image-2.5-flare">GPT Image 2.5 Flare</option><option value="gpt-image-2.5-sunburst">GPT Image 2.5 Sunburst</option></select></div>
      <div><label className="input-label">QUALITY</label><select value={quality} onChange={e => setQuality(e.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
      <button className="primary-btn" disabled={working || refreshing || !requestCount} onClick={() => void submit()}>{working ? <LoaderCircle className="spin" size={16}/> : <Sparkles size={16}/>} Submit {requestCount} images</button>
    </div>
    <div className="collections-toolbar">
      <input aria-label="Search collections" placeholder="Search collections..." value={search} onChange={e => setSearch(e.target.value)}/>
      <button className="outline-btn" onClick={() => setSelected(visible.filter(row => row.eligible.length).map(row => row.collection.id))}>Select eligible</button>
      <button className="outline-btn" onClick={() => setSelected([])}>Clear selection</button>
    </div>
    <p className="sub">{selected.length} collections selected · {requestCount} new prompts ready · max 120 per OpenAI Batch job.</p>
    {creditAlert && <div className="notice" role="alert"><CircleAlert size={16}/><strong>{creditAlert}</strong><button type="button" onClick={() => setCreditAlert('')}>Dismiss</button></div>}
    {message && <div className="notice"><CircleAlert size={16}/>{message}</div>}
    {working && <div className="production-progress"><span>Batch submission</span><b>{progress.submitted}/{progress.total}</b><div className="progress"><i style={{ width: (progress.total ? progress.submitted / progress.total * 100 : 0) + '%' }}/></div></div>}
    <div className="table-scroll"><table><thead><tr><th>SELECT</th><th>COLLECTION</th><th>NEW PROMPTS</th><th>GENERATED</th><th>BATCH JOBS</th></tr></thead><tbody>
      {visible.map(({ collection, eligible, jobs: batchJobs }) => <tr key={collection.id}>
        <td><input type="checkbox" aria-label={'Select ' + collection.name} disabled={!eligible.length || working} checked={selected.includes(collection.id)} onChange={e => setSelected(old => e.target.checked ? [...old, collection.id] : old.filter(id => id !== collection.id))}/></td>
        <td><b>{collection.name}</b></td><td>{eligible.length}</td>
        <td>{collection.characters.filter(c => c.status === 'done').length}/{collection.characters.length}</td>
        <td>{batchJobs.length ? batchJobs.slice(0, 2).map(job => <div key={job.id}><CheckCircle2 size={13}/> {job.status.replaceAll('_', ' ')} · {job.imported}/{job.total} imported {job.warning && <span className="asset-error">{job.warning}</span>}</div>) : 'No jobs yet'}</td>
      </tr>)}
    </tbody></table></div>
    {!visible.length && <p className="sub">No collections match your search.</p>}
  </div>;
}
