 'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, LoaderCircle, RefreshCw, Sparkles } from 'lucide-react';
import { eligibleForBulk, isActiveBatchStatus } from '@/lib/production-rules';
import { isOpenAICreditError, primeProductionAudio, useProductionSounds } from '@/lib/production-sounds';
import { MOCK_STORAGE_KEY, mockEligibleIds, readMockJobs, writeMockJobs, type MockJob, type MockScenario } from '@/lib/mock-production';

type Character = { id: string; name: string; prompt: string; status: string; imageUrl?: string };
type Collection = { id: string; name: string; characters: Character[] };
type Job = { id: string; status: string; total: number; completed: number; failed: number; imported: number; warning?: string; characterIds: string[]; createdAt: number; model?: string; assets?: Array<{ id: string; status: string; error?: string }> };
type CollectionJobs = Record<string, Job[]>;

async function jsonRequest<T = unknown>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, cache: 'no-store' });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Request failed');
  return body as T;
}

export default function MultiCollectionProduction() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [environment, setEnvironment] = useState<'mock' | 'live'>(process.env.NODE_ENV === 'production' ? 'live' : 'mock');
  const [mockScenario, setMockScenario] = useState<MockScenario>('success');
  const [mockJobs, setMockJobs] = useState<MockJob[]>([]);
  const previousMockStates = useRef<Map<string, string> | null>(null);
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
  const refreshInFlight = useRef(false);
  const reportCredit = useCallback((value: unknown) => {
    if (!isOpenAICreditError(value)) return;
    const detail = value instanceof Error ? value.message : String(value);
    setCreditAlert('OpenAI credits/quota appear exhausted. Check API billing before retrying. ' + detail.slice(0, 240));
    if (lastCreditWarning.current !== detail) { lastCreditWarning.current = detail; soundRef.current('credits'); }
  }, []);
  const [progress, setProgress] = useState({ submitted: 0, total: 0 });

  const reload = useCallback(async (sync = false) => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setRefreshing(true);
    try {
      const rows = await jsonRequest<Array<{ data: Collection }>>('/api/studio');
      const fresh: Collection[] = (rows as Array<{ data: Collection }>).map(row => row.data);
      setCollections(fresh);
      if (environment === 'mock') {
        const simulated = readMockJobs(window.localStorage);
        writeMockJobs(window.localStorage, simulated);
        const next = new Map(simulated.map(job => [job.id, job.status]));
        if (previousMockStates.current) {
          const changed = simulated.filter(job => isActiveBatchStatus(previousMockStates.current?.get(job.id) || 'completed') && !isActiveBatchStatus(job.status));
          if (changed.some(job => job.status === 'completed' || job.status === 'completed_with_errors')) soundRef.current('completed');
          if (changed.some(job => job.scenario === 'quota_error')) {
            setCreditAlert('TEST ONLY — simulated OpenAI insufficient_quota. No API call was made.');
            soundRef.current('credits');
          }
        }
        previousMockStates.current = next;
        setMockJobs(simulated);
        if (sync) setMessage('TEST MODE — simulated statuses refreshed; production data unchanged.');
        return;
      }
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
      refreshInFlight.current = false;
      setRefreshing(false);
    }
  }, [reportCredit, environment]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => void reload(), 0);
    const timer = window.setInterval(() => void reload(true), environment === 'mock' ? 2000 : 45000);
    return () => { window.clearTimeout(initialTimer); window.clearInterval(timer); };
  }, [reload, environment]);

  const rows = useMemo(() => collections.map(collection => {
    if (environment === 'mock') {
      const simulated = mockJobs.filter(job => job.projectId === collection.id);
      const ids = new Set(mockEligibleIds(collection.characters, mockJobs, collection.id));
      return { collection, eligible: collection.characters.filter(character => ids.has(character.id)), jobs: simulated as Job[] };
    }
    const pending = new Set((jobs[collection.id] || []).filter(job => isActiveBatchStatus(job.status)).flatMap(job => job.characterIds || []));
    const eligible = collection.characters.filter(character => eligibleForBulk(character, pending.has(character.id)));
    return { collection, eligible, jobs: jobs[collection.id] || [] };
  }), [collections, jobs, environment, mockJobs]);
  const visible = rows.filter(row => row.collection.name.toLowerCase().includes(search.trim().toLowerCase()));
  const chosen = rows.filter(row => selected.includes(row.collection.id));
  const requestCount = chosen.reduce((sum, row) => sum + row.eligible.length, 0);
  const activity = rows.flatMap(row => row.jobs.map(job => ({ collection: row.collection.name, job }))).sort((a, b) => b.job.createdAt - a.job.createdAt).slice(0, 30);

  const submit = async () => {
    if (working || !requestCount) return;
    if (soundEnabled) primeProductionAudio();
    if (environment === 'mock') {
      try {
        const previous = readMockJobs(window.localStorage);
        const createdAt = Date.now();
        const added: MockJob[] = chosen.flatMap(row => {
          const ids = mockEligibleIds(row.collection.characters, previous, row.collection.id);
          const newJobs: MockJob[] = [];
          for (let i = 0; i < ids.length; i += 120) {
            const characterIds = ids.slice(i, i + 120);
            newJobs.push({ id: crypto.randomUUID(), projectId: row.collection.id, model: 'TEST: ' + model, createdAt,
              status: 'pending', total: characterIds.length, completed: 0, failed: 0, imported: 0,
              characterIds, assets: [], scenario: mockScenario });
          }
          return newJobs;
        });
        writeMockJobs(window.localStorage, [...previous, ...added]);
        setMockJobs([...previous, ...added]);
        setProgress({ submitted: added.reduce((sum, job) => sum + job.total, 0), total: requestCount });
        setMessage('TEST MODE — queued ' + added.reduce((sum, job) => sum + job.total, 0) + ' simulated images. No API charges, images, or production writes.');
        if (!added.length) setMessage('TEST MODE — nothing eligible. Clear mock history to repeat the simulation.');
        void reload();
      } catch (error) {
        setMessage('TEST MODE storage unavailable: ' + (error instanceof Error ? error.message : String(error)));
      }
      return;
    }
    setWorking(true);
    setProgress({ submitted: 0, total: requestCount });
    setMessage('Submitting separate OpenAI batches per collection...');
    let submitted = 0;
    const failures: string[] = [];
    let stoppedForQuota = false;
    try {
      // Re-read saved collections and outstanding jobs. A stale browser view
      // must never be treated as the authority for paid submissions.
      const freshRows = await jsonRequest<Array<{ data: Collection }>>('/api/studio');
      for (const row of chosen) {
        const fresh = freshRows.find(item => item.data.id === row.collection.id)?.data;
        if (!fresh) { failures.push(row.collection.name + ': collection no longer exists'); continue; }
        let pendingIds = new Set<string>();
        try {
          const current = await jsonRequest<{ jobs: Job[] }>('/api/image-batches?projectId=' + encodeURIComponent(fresh.id));
          pendingIds = new Set(current.jobs.filter(j => isActiveBatchStatus(j.status)).flatMap(j => j.characterIds));
        } catch (error) {
          failures.push(fresh.name + ': unable to verify pending jobs (' + (error instanceof Error ? error.message : String(error)) + ')');
          continue;
        }
        const eligible = fresh.characters.filter(c => eligibleForBulk(c, pendingIds.has(c.id)));
        for (let i = 0; i < eligible.length; i += 120) {
          const ids = eligible.slice(i, i + 120).map(c => c.id);
          try {
            await jsonRequest('/api/image-batches', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ projectId: fresh.id, characterIds: ids, model, quality }),
            });
            submitted += ids.length;
            setProgress({ submitted, total: requestCount });
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            failures.push(fresh.name + ': ' + detail);
            reportCredit(error);
            if (isOpenAICreditError(error)) stoppedForQuota = true;
            // Do not submit later chunks from this collection after a failed chunk.
            break;
          }
        }
        if (stoppedForQuota) break;
      }
      setMessage(
        'Submitted ' + submitted + ' of ' + requestCount + ' initially eligible images. ' +
        (failures.length ? 'Some submissions were skipped or failed: ' + failures.slice(0, 4).join(' | ') + '. ' : '') +
        (stoppedForQuota ? 'Stopped because OpenAI reported insufficient credits/quota. ' : '') +
        'Refresh statuses before retrying; accepted jobs are saved independently.'
      );
    } catch (error) {
      setMessage('Submitted ' + submitted + ' images before stopping: ' + (error instanceof Error ? error.message : String(error)) + '. Refresh before retrying.');
      reportCredit(error);
    } finally {
      setWorking(false);
      await reload();
    }
  };

  return <div className="panel">
    {process.env.NODE_ENV !== 'production' && <div className="mock-mode-toolbar">
      <strong>Generation environment</strong>
      <select aria-label="Generation environment" value={environment} disabled={working} onChange={e => { setEnvironment(e.target.value as 'mock' | 'live'); setSelected([]); setMessage(''); setCreditAlert(''); }}>
        <option value="mock">TEST / Mock — no OpenAI charges</option>
        <option value="live">LIVE — real OpenAI API requests</option>
      </select>
      {environment === 'mock' && <>
        <select aria-label="Simulation scenario" value={mockScenario} onChange={e => setMockScenario(e.target.value as MockScenario)}>
          <option value="success">Simulate success</option>
          <option value="partial_failure">Simulate one failed image per batch</option>
          <option value="quota_error">Simulate insufficient OpenAI credits</option>
        </select>
        <button className="outline-btn" type="button" disabled={working} onClick={() => { window.localStorage.removeItem(MOCK_STORAGE_KEY); setMockJobs([]); previousMockStates.current = null; setCreditAlert(''); setMessage('TEST MODE history cleared. Live collections and images were not changed.'); }}>Clear TEST history</button>
      </>}
    </div>}
    {environment === 'mock' && <p className="mock-mode-disclaimer" role="status">TEST MODE — simulated jobs stay in this browser only. No OpenAI requests, real image files, or production database updates. This mode is temporary and unavailable in production builds.</p>}
    <div className="table-toolbar">
      <div><h2>Multi-Collection Production</h2><p>Each collection gets its own saved Batch jobs and image assets. Previously generated prompts are excluded.</p></div>
      <div className="image-download-actions"><button type="button" className="outline-btn" disabled={refreshing || working} onClick={() => void reload(true)}>{refreshing ? <LoaderCircle className="spin" size={16}/> : <RefreshCw size={16}/>} Refresh</button><button type="button" className="outline-btn" onClick={toggleSound}>{soundEnabled ? '🔊 Sound alerts on' : '🔇 Sound alerts off'}</button></div>
    </div>
    <div className="production-controls">
      <div><label className="input-label">BATCH IMAGE MODEL</label><select value={model} onChange={e => setModel(e.target.value)}><option value="gpt-image-2.5-flare">GPT Image 2.5 Flare</option><option value="gpt-image-2.5-sunburst">GPT Image 2.5 Sunburst</option></select></div>
      <div><label className="input-label">QUALITY</label><select value={quality} onChange={e => setQuality(e.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
      <button className="primary-btn" disabled={working || refreshing || !requestCount} onClick={() => void submit()}>{working ? <LoaderCircle className="spin" size={16}/> : <Sparkles size={16}/>} {environment === 'mock' ? 'Simulate' : 'Submit'} {requestCount} images</button>
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
    <section className="production-activity-log" aria-label="Production activity log">
      <h3>Production Activity Log</h3>
      <p className="sub">{environment === 'mock' ? 'TEST ONLY — simulated browser-local jobs; no production records or images.' : 'Latest 30 saved Batch jobs across collections. Refresh to retrieve updated OpenAI results. History survives closing the browser.'}</p>
      {activity.length ? <div className="table-scroll"><table><thead><tr><th>SUBMITTED</th><th>COLLECTION</th><th>MODEL</th><th>STATUS</th><th>PROCESSED</th><th>IMPORTED</th><th>ERRORS</th></tr></thead><tbody>
        {activity.map(({ collection, job }) => <tr key={job.id}>
          <td>{new Date(job.createdAt).toLocaleString()}</td><td>{collection}</td><td>{job.model || 'Batch'}</td>
          <td><span className={'status ' + (job.status === 'completed' ? 'done' : isActiveBatchStatus(job.status) ? 'ready' : 'error')}>{job.status.replaceAll('_', ' ')}</span></td>
          <td>{job.completed + job.failed}/{job.total}</td><td>{job.imported}/{job.total}</td>
          <td>{job.warning || job.assets?.filter(item => item.status === 'error').slice(0, 2).map(item => item.error || 'Image failed').join('; ') || (job.failed ? job.failed + ' failed' : '—')}</td>
        </tr>)}
      </tbody></table></div> : <p className="sub">No Batch activity recorded yet.</p>}
    </section>
  </div>;
}
