'use client';

import Image from 'next/image';
import UpscaleCompare from '@/components/upscale-compare';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, Clock3, Download, Image as ImageIcon, LoaderCircle, RefreshCw, Sparkles } from 'lucide-react';
import { eligibleForBulk, isActiveBatchStatus, wasPreviouslyGenerated } from '@/lib/production-rules';
import { runBoundedQueue } from '@/lib/standard-bulk-queue';
import type { StoredUpscaleBatch } from '@/lib/upscale-batch-transport';
import type { SimilarityReview } from '@/lib/similarity-review';
import { isOpenAICreditError, primeProductionAudio, useProductionSounds } from '@/lib/production-sounds';

type Character = { id: string; name: string; prompt: string; status: string; imageUrl?: string; upscaledImageUrl?: string; upscaleJob?: { id: string; submittedAt?: number; factor?: number }; error?: string; similarityReview?: SimilarityReview };
type Project = { id: string; name: string; characters: Character[]; listing?: { title?: string }; upscaleBatch?: StoredUpscaleBatch; fullAutomation?: { enabled: boolean; stage: string } };
type Job = { id: string; status: string; model: string; total: number; completed: number; failed: number; imported: number; createdAt: number; characterIds: string[]; assets: Array<{ id: string; status: string; imageUrl?: string; error?: string }>; warning?: string };
type UpscaleUpdate = { upscaleJob?: Character['upscaleJob']; upscaledImageUrl?: string; upscaledAt?: number };
type Props = { project: Project; model: string; batchPreferredModel: string; quality: string; onModel: (value: string) => void; onQuality: (value: string) => void; onDownloaded: (receipt: { lastDownloadedAt: number; downloadCount: number; lastDownloadImageCount: number; downloadedImageIds: string[] }) => void; onAsset: (id: string, data: { imageUrl?: string; status: 'done' | 'error'; error?: string; similarityReview?: SimilarityReview }) => void; onPromptChange: (id: string, prompt: string) => void; onUpscaleChange: (id: string, data: UpscaleUpdate) => void; onUpscaleBatch: (batch: StoredUpscaleBatch) => void };

async function request<T = unknown>(url: string, options?: RequestInit): Promise<T> {
  const r = await fetch(url, options);
  const result = await r.json() as T & { error?: string };
  if (!r.ok) throw new Error(result.error || `Request failed (${r.status})`);
  return result;
}

// Keep the last known job progress visible immediately when switching tabs.
const batchJobSnapshot = new Map<string, Job[]>();

export default function ImageProduction({ project, model, batchPreferredModel, quality, onModel, onQuality, onDownloaded, onAsset, onPromptChange, onUpscaleChange, onUpscaleBatch }: Props) {
  const [mode, setMode] = useState<'single' | 'standard-bulk' | 'batch'>('batch');
  const automationActive = !!project.fullAutomation?.enabled && !['paused','completed'].includes(project.fullAutomation.stage);
  const [batchModel, setBatchModel] = useState(batchPreferredModel);
  const [batchGroupSize, setBatchGroupSize] = useState<10|25|50>(10);
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
  // Match the saved Settings/Full Automation selection across tab remounts.
  useEffect(() => { if (!working) setBatchModel(batchPreferredModel); }, [batchPreferredModel, working]);
  const [refreshing, setRefreshing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [upscaleProvider, setUpscaleProvider] = useState<'remote'>('remote');
  const [upscaleFactor, setUpscaleFactor] = useState(4);
  const [upscaling, setUpscaling] = useState(false);
  const [upscaleBatchStatus, setUpscaleBatchStatus] = useState<{
    status: string; received: number; total: number; finished: number;
    notificationConfigured?: boolean; notificationEmail?: string;
    notificationStatus?: string;
  } | null>(null);
  const latestBatchChange = useRef(onUpscaleBatch);
  useEffect(() => { latestBatchChange.current = onUpscaleBatch; }, [onUpscaleBatch]);
  const [upscalePreview, setUpscalePreview] = useState<{ name: string; originalUrl: string; upscaledUrl: string } | null>(null);
  const [remoteProgress, setRemoteProgress] = useState<Record<string, { status: string; elapsed: number; remaining?: number | null }>>({});
  const latestUpscaleChange = useRef(onUpscaleChange);
  useEffect(() => { latestUpscaleChange.current = onUpscaleChange; }, [onUpscaleChange]);
  // The polling effect re-subscribes ONLY when the saved job IDs change, not on each tick.
  const pendingUpscaleKey = project.characters.filter(c => c.upscaleJob).map(c => c.id + ':' + c.upscaleJob!.id).join('|');
  useEffect(() => {
    let live = true;
    void fetch('/api/settings').then(async r => await r.json() as { preferences?: { upscaleFactor?: number } }).then(data => {
      if (live) { setUpscaleProvider('remote'); setUpscaleFactor(data.preferences?.upscaleFactor || 4); }
    }).catch(() => {});
    return () => { live = false; };
  }, []);
  const [singleProgress, setSingleProgress] = useState({ done: 0, total: 0 });
  const [bulkWorkers, setBulkWorkers] = useState(3);
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
          const result = await response.json() as { status: string; error?: string; url?: string; elapsedSeconds?: number; estimatedRemainingSeconds?: number | null };
          if (stopped) return;
          if (result.status === 'succeeded' || result.status === 'cancelled') {
            // The API has already saved the result/cancellation in the collection.
            // Update ONLY this character; do not reload the page or reset selection/scroll.
            latestUpscaleChange.current(characterId, result.status === 'succeeded'
              ? { upscaleJob: undefined, upscaledImageUrl: result.url, upscaledAt: Date.now() }
              : { upscaleJob: undefined });
            setRemoteProgress(old => ({ ...old, [characterId]: { status: result.status, elapsed: result.elapsedSeconds || 0 } }));
            continue;
          }
          setRemoteProgress(old => {
            const previous = old[characterId];
            const next = { status: result.status, elapsed: result.elapsedSeconds || 0, remaining: result.estimatedRemainingSeconds };
            return previous?.status === next.status && previous.elapsed === next.elapsed && previous.remaining === next.remaining
              ? old : { ...old, [characterId]: next };
          });
          if (result.status === 'failed') setMessage(`Remote upscale failed: ${result.error || 'Unknown error'}`);
        }
      } catch (error) {
        if (!stopped) setMessage(`Upscale status check failed: ${error instanceof Error ? error.message : String(error)}. The GPU job remains on the server; do not resubmit it.`);
      } finally { running = false; }
    };
    void poll();
    const interval = setInterval(() => void poll(), 5000);
    return () => { stopped = true; clearInterval(interval); };
  }, [project.id, pendingUpscaleKey]);
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
  useEffect(() => {
    if (!project.upscaleBatch) return;
    let closed = false, checking = false;
    const checkBatch = async () => {
      if (closed || checking || latestProject.current.upscaleBatch?.status === 'completed') return;
      checking = true;
      try {
        const data = await request<{
          batch?: StoredUpscaleBatch; status: string; totalFiles?: number;
          completedFiles?: number; receivedIds?: string[];
          notificationConfigured?: boolean; notificationEmail?: string;
          notificationStatus?: string;
          jobs?: Array<{ characterId: string; job: Character['upscaleJob'] }>;
        }>('/api/upscale-batches?projectId=' + encodeURIComponent(project.id));
        if (closed) return;
        setUpscaleBatchStatus({
          status: data.status, received: data.receivedIds?.length || 0,
          total: data.totalFiles || data.batch?.items.length || 0,
          finished: data.completedFiles || 0,
          notificationConfigured: data.notificationConfigured,
          notificationEmail: data.notificationEmail,
          notificationStatus: data.notificationStatus,
        });
        if (data.batch && (data.batch.status !== latestProject.current.upscaleBatch?.status ||
            data.batch.remoteId !== latestProject.current.upscaleBatch?.remoteId))
          latestBatchChange.current(data.batch);
        for (const item of data.jobs || []) {
          const current = latestProject.current.characters.find(c => c.id === item.characterId);
          if (item.job && current && current.upscaleJob?.id !== item.job.id &&
              !current.upscaledImageUrl) {
            latestUpscaleChange.current(item.characterId, { upscaleJob: item.job });
          }
        }
      } catch {
        // A disconnected GPU host does not cancel or duplicate the remote Batch.
      } finally { checking = false; }
    };
    void checkBatch();
    const timer = window.setInterval(() => void checkBatch(), 12000);
    return () => { closed = true; window.clearInterval(timer); };
  }, [project.id, project.upscaleBatch?.id]);
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
      if (manual) setRefreshing(true);
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
        setJobs(previous => JSON.stringify(previous) === JSON.stringify(freshJobs) ? previous : freshJobs);
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
      finally { syncBusy.current = false; if (!closed && manual) setRefreshing(false); }
    };
    refreshNow.current = () => refresh(true, true);
    // Read locally persisted batch status first. OpenAI polling/import must not
    // delay rendering progress after returning to this tab.
    void (async () => { await refresh(false, false); if (!closed) await refresh(false, true); })();
    const interval = setInterval(() => void refresh(false, true), 15000);
    return () => { closed = true; clearInterval(interval); refreshNow.current = async () => {}; };
  }, [project.id, reportCredit]);

  const rewriteSimilarityPrompt = async (character: Character) => {
    if (working || character.similarityReview?.status !== 'needs_review' || !character.imageUrl) return;
    setWorking(true);
    setMessage('Regenerating original prompt for ' + character.name + ' using its similarity review…');
    try {
      const response = await request<{ prompts: Array<{ id: string; prompt: string }> }>(
        '/api/regenerate-prompt', { method: 'POST',
          headers: { 'Content-Type':'application/json' },
          body: JSON.stringify({ projectId:project.id, characterIds:[character.id] }) });
      const revised = response.prompts?.find(p => p.id === character.id)?.prompt;
      if (!revised) throw new Error('AI did not return a valid revised prompt');
      onPromptChange(character.id, revised);
      setMessage('Revised prompt saved for ' + character.name + '. Click Regenerate image to generate a new image; the old image stays available until replacement succeeds.');
    } catch (error) {
      setMessage('Prompt revision failed; original prompt and image are unchanged. ' +
        (error instanceof Error ? error.message : String(error)));
    } finally { setWorking(false); }
  };
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

  const generateStandardBulk = async () => {
    if (!jobsLoaded || working || automationActive || !selectedBatchIds.length) return;
    const selected = project.characters.filter(c => selectedBatchIds.includes(c.id));
    if (soundEnabled) primeProductionAudio();
    setWorking(true);
    setSingleProgress({ done: 0, total: selected.length });
    setMessage('Standard Bulk started. Keep PaletteIQ running until all requests finish; paid requests cannot be cancelled safely by closing this tab.');
    try {
      await request('/api/studio', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', id: project.id, name: project.name, data: project }) });
      const result = await runBoundedQueue(selected, bulkWorkers, async item => {
        try {
          const data = await request<{ imageUrl: string; similarityReview?: SimilarityReview }>(
            '/api/studio', { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'generate', model, quality, projectId: project.id, characterId: item.id }) });
          onAsset(item.id, { imageUrl: data.imageUrl, status: 'done', error: '', similarityReview: data.similarityReview });
        } catch (error) {
          reportCredit(error);
          throw error; // Never retry uncertain or already-billed API requests.
        }
      }, (done, total) => setSingleProgress({ done, total }));
      await recoverImages(true);
      setMessage('Standard Bulk finished: ' + (result.completed - result.failed) + ' succeeded, ' + result.failed +
        ' need review. Check recovered images and API usage before retrying any failed request.');
      if (!result.failed) playSound('completed');
    } catch (error) {
      setMessage('Standard Bulk could not start: ' + (error instanceof Error ? error.message : String(error)));
    } finally { setWorking(false); }
  };

  const submitBatch = async (ids = selectedBatchIds, regenerate = false) => {
    if (!jobsLoaded || working || !ids.length || ids.some(id => pending.has(id))) return;
    if (soundEnabled) primeProductionAudio();
    setWorking(true);
    setMessage('Submitting independent Image Batches (up to 3 uploads at once). Each completed Batch is imported without waiting for the others...');
    let submitted = 0;
    const errors:string[]=[];
    try {
      // Save the edited collection exactly once before any paid request.
      await request('/api/studio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', id: project.id, name: project.name, data: project }) });
      const chunks:Array<string[]>=[];
      for(let offset=0;offset<ids.length;offset+=batchGroupSize)
        chunks.push(ids.slice(offset,offset+batchGroupSize));
      // Bounded upload concurrency: all independent Batches can reach OpenAI
      // without waiting for any OTHER Batch to finish processing. Individual
      // submissions are never automatically retried after ambiguous errors.
      let nextChunk=0;
      const workers=Array.from({length:Math.min(3,chunks.length)},async()=>{
        while(nextChunk<chunks.length){
          const index=nextChunk++;
          const chunk=chunks[index];
          try{
            const data=await request<{job:Job}>('/api/image-batches',{
              method:'POST',headers:{'Content-Type':'application/json'},
              body:JSON.stringify({projectId:project.id,characterIds:chunk,
                model:batchModel,quality,regenerate}),
            });
            submitted+=chunk.length;
            setJobs(previous=>[data.job,...previous.filter(j=>j.id!==data.job.id)]);
            setMessage('OpenAI accepted '+submitted+'/'+ids.length+
              ' images across '+(index+1)+' submitted groups. Waiting Batches remain independent.');
          }catch(error){
            errors.push('Group '+(index+1)+' ('+chunk.length+' images): '+
              (error instanceof Error?error.message:String(error)));
            reportCredit(error);
          }
        }
      });
      await Promise.all(workers);
      if(!errors.length){
        setSelectedIds([]);
        setMessage('All '+submitted+' image requests submitted in '+
          chunks.length+' independent OpenAI Batches. Each completed group is imported immediately when its output file becomes available; OpenAI controls validating/in_progress status.');
      }else{
        setMessage(submitted+'/'+ids.length+' image requests confirmed accepted. '+
          errors.length+' groups have uncertain/failed submissions: '+
          errors.join(' | ').slice(0,600)+
          '. Check OpenAI Batch activity before any manual resubmission to avoid duplicate charges.');
      }
      void refreshNow.current();
    }catch(error){
      setMessage('Could not prepare Image Batch submission: '+
        (error instanceof Error?error.message:String(error))+
        '. Check existing Batch jobs before trying again.');
      reportCredit(error);
    }finally{setWorking(false);}
  };

  const runCloudUpscale = async () => {
    if (upscaling) return;
    if (upscaleProvider !== 'remote') { setMessage('Remote GPU Server is not selected.'); return; }
    const staging = project.upscaleBatch?.status === 'staging' ? project.upscaleBatch : null;
    if (project.upscaleBatch?.status === 'committed') {
      setMessage('The previous upscale Batch is running. Wait until its jobs finish before submitting another Batch.');
      return;
    }
    const targets = staging
      ? staging.items.map(item => project.characters.find(c => c.id === item.characterId)).filter((c): c is Character => !!c)
      : selectedGenerated.filter(c => !c.upscaleJob);
    if (!targets.length) { setMessage('Select generated PNGs to upscale or resume an existing Batch.'); return; }
    setUpscaling(true);
    try {
      // One logical Batch per checkbox selection: create -> idempotent uploads
      // -> one commit. Only after commit can the client PC be switched off.
      const accepted = await request<{
        batch: StoredUpscaleBatch; notificationConfigured: boolean;
      }>('/api/upscale-batches', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id,
          characterIds: targets.map(c => c.id), factor: staging?.factor || upscaleFactor }),
      });
      latestBatchChange.current(accepted.batch);
      setMessage('GPU Batch created for ' + targets.length + ' selected images. Uploading files…');
      const recovery = await request<{ receivedIds: string[] }>(
        '/api/upscale-batches?projectId=' + encodeURIComponent(project.id));
      const received = new Set(recovery.receivedIds || []);
      let uploaded = received.size;
      for (const target of targets) {
        if (received.has(target.id)) continue;
        setMessage('Uploading file ' + (uploaded + 1) + '/' + targets.length + ' to the GPU Batch: ' + target.name);
        await request('/api/upscale-batches', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: project.id, characterId: target.id }),
        });
        uploaded++;
        setUpscaleBatchStatus({
          status: 'staging', received: uploaded, total: targets.length, finished: 0,
          notificationConfigured: accepted.notificationConfigured,
          notificationEmail: accepted.batch.notificationEmail,
        });
      }
      setMessage('All ' + targets.length + ' files uploaded. Committing one Batch to the GPU queue…');
      const committed = await request<{
        batch: StoredUpscaleBatch; jobs: Array<{ characterId: string; job: Character['upscaleJob'] }>;
        notificationConfigured?: boolean;
      }>('/api/upscale-batches', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id }),
      });
      latestBatchChange.current(committed.batch);
      for (const item of committed.jobs || []) {
        latestUpscaleChange.current(item.characterId, { upscaleJob: item.job });
        setRemoteProgress(old => ({ ...old, [item.characterId]: { status: 'queued', elapsed: 0 } }));
      }
      setUpscaleBatchStatus({
        status: 'committed', received: targets.length, total: targets.length,
        finished: 0, notificationConfigured: committed.notificationConfigured,
        notificationEmail: accepted.batch.notificationEmail,
      });
      setSelectedIds([]);
      setMessage('GPU Batch accepted: ' + targets.length + ' selected files. ' +
        (committed.notificationConfigured
          ? 'The GPU Server will email ' + accepted.batch.notificationEmail + ' after all files finish.'
          : 'SMTP email is not configured on the GPU server; work will still complete.') +
        ' You can now close PaletteIQ or switch off the client PC.');
    } catch (error) {
      setMessage('Upscale Batch upload or commit interrupted: ' + (error instanceof Error ? error.message : String(error)) +
        '. The Batch manifest is saved. Use Resume GPU Batch to continue; do not submit a duplicate.');
    } finally { setUpscaling(false); }
  };
  const cancelRemoteUpscale = async (character: Character) => {
    if (!character.upscaleJob || !window.confirm(`Cancel remote upscale for ${character.name}?`)) return;
    try {
      const result = await request<{ status: string; cleared?: boolean }>('/api/upscale', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel', projectId: project.id, characterId: character.id }) });
      setRemoteProgress(old => ({ ...old, [character.id]: { status: result.status, elapsed: old[character.id]?.elapsed || 0 } }));
      if (result.cleared) {
        latestUpscaleChange.current(character.id, { upscaleJob: undefined });
        setMessage(`Remote upscale cancelled for ${character.name}.`);
        return;
      }
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
      <div className="production-mode-head"><div><h2>Generation mode</h2><p className="sub">Images and their collection records are automatically saved. Generate one image, generate multiple images with Standard Bulk (3–5 workers), or submit a discounted Batch job.</p></div><div className="mode-switch"><button className={mode === 'single' ? 'active' : ''} onClick={() => setMode('single')}>Single</button><button className={mode === 'standard-bulk' ? 'active' : ''} onClick={() => setMode('standard-bulk')}>Standard Bulk</button><button className={mode === 'batch' ? 'active' : ''} onClick={() => setMode('batch')}>Batch <span>Save ~50%</span></button></div></div>
      <div className="image-download-actions"><button className="outline-btn" disabled={working} onClick={() => void recoverImages()}><RefreshCw size={14}/> Recover images</button><button type="button" className="outline-btn" onClick={toggleSound} aria-label="Toggle generation sound alerts">{soundEnabled ? '🔊 Sound alerts on' : '🔇 Sound alerts off'}</button></div>
      {automationActive && <p className="sub">Full Automation owns image submission and similarity-regeneration Batches. Pause it in the Research & analysis workflow before running manual generation or prompt revisions.</p>}
      {creditAlert && <div className="notice production-notice" role="alert"><CircleAlert size={16}/><strong>{creditAlert}</strong><button type="button" onClick={() => setCreditAlert('')}>Dismiss</button></div>}
      <div className="production-controls">
        <div><label className="input-label">{mode !== 'batch' ? 'IMAGE MODEL' : 'BATCH IMAGE MODEL (SETTINGS)'}</label>{mode !== 'batch' ? <select value={model} onChange={e => onModel(e.target.value)}>{!imageModels.some(m => m.id === model) && <option value={model}>{model} (saved model)</option>}{imageModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select> : <select value={batchModel} onChange={e => setBatchModel(e.target.value)}>{!imageModels.some(m => m.id === batchModel && m.batchSupported) && <option value={batchModel}>{batchModel} (saved batch model)</option>}{imageModels.filter(m => m.batchSupported).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>}{imageModelError && <p className="sub">{imageModelError}</p>}</div>
        <div><label className="input-label">QUALITY</label><select value={quality} onChange={e => onQuality(e.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
        {mode === 'batch' && <div><label className="input-label">IMAGES PER BATCH</label><select value={batchGroupSize} disabled={working} onChange={e=>setBatchGroupSize(Number(e.target.value) as 10|25|50)}><option value={10}>10 — earliest group imports</option><option value={25}>25 — balanced</option><option value={50}>50 — fewer Batch jobs</option></select><p className="sub">All groups submit without waiting for earlier groups to finish. OpenAI controls validation and output availability. Existing Batch jobs are unchanged.</p></div>}
        {mode === 'standard-bulk' && <div><label className="input-label">PARALLEL WORKERS</label><select value={bulkWorkers} onChange={e => setBulkWorkers(Number(e.target.value))}><option value={3}>3 workers</option><option value={4}>4 workers</option><option value={5}>5 workers</option></select></div>}
        {mode === 'single' && <div className="character-choice"><label className="input-label">CHOOSE NEVER-GENERATED CHARACTER</label><select value={chosenSingle?.id ?? ''} onChange={e => setSingleId(e.target.value)}><option value="" disabled>Select a character...</option>{eligible.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
        <button className="primary-btn" disabled={automationActive || working || downloading || !jobsLoaded || (mode === 'single' ? !chosenSingle : !selectedBatchIds.length)} onClick={() => mode === 'single' ? void generateSingle() : mode === 'standard-bulk' ? void generateStandardBulk() : void submitBatch()}>{working ? <LoaderCircle size={17} className="spin"/> : <Sparkles size={17}/>} {mode === 'single' ? 'Generate single image' : mode === 'standard-bulk' ? `Generate ${selectedBatchIds.length} images in Standard Bulk` : `Submit ${selectedBatchIds.length} new prompts to Batch`}</button>
      </div>
      {mode === 'batch' && <p className="sub">On PaletteIQ Desktop, OpenAI Batch completion emails are sent directly via the built-in SMTP settings (installer .env defaults or store override). Close to tray keeps monitoring while Windows is signed in. No GPU server, LAN, public HTTPS or OpenAI webhook is required; PNG import may still be pending.</p>}
      {mode === 'standard-bulk' && <p className="sub">Standard Bulk uses live requests and requires this app to stay open. Select image cards to limit the job; otherwise all eligible prompts are used. Failed or uncertain requests are not retried automatically.</p>}
      {mode === 'batch' && <div className="batch-selector"><div className="batch-selector-head"><div><b>New prompt submission</b><small>{eligible.length} never-generated prompts available. Selected cards limit submission to eligible prompts; otherwise all eligible prompts are submitted (groups of {batchGroupSize} images, up to 3 simultaneous uploads).</small></div><button onClick={() => setSelectedIds([])}>Clear selection</button></div><p className="batch-hint"><Clock3 size={15}/> Previously generated items are never included in bulk submission. Use per-card Regenerate for an explicit rerun. Batch jobs continue after closing the browser.</p></div>}
      {message && <div className="notice production-notice"><CircleAlert size={16}/>{message}</div>}
      <div className="production-progress"><div><span>Collection images produced</span><b>{completedTotal} / {project.characters.length}</b></div><div className="progress"><i style={{ width: `${project.characters.length ? completedTotal / project.characters.length * 100 : 0}%` }}/></div></div>
      {mode !== 'batch' && working && <div className="single-loading"><LoaderCircle className="spin" size={16}/> {mode === 'single' ? 'Single image' : 'Standard Bulk'} in progress · {singleProgress.done}/{singleProgress.total} completed</div>}
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
              <div className="batch-job-top"><div><b title={c.name}>{c.name}</b><small>Real-ESRGAN {c.upscaleJob?.factor ?? upscaleFactor}× · {Math.floor(seconds / 60)}m {Math.floor(seconds % 60)}s · {progress?.remaining != null ? `Est. remaining: ${Math.ceil(progress.remaining / 60)} min` : status === 'queued' ? 'Time remaining: waiting for GPU' : 'Time remaining: estimating…'}</small></div><span className={`status ${status === 'failed' || status === 'sync_error' ? 'error' : 'ready'}`}>{status === 'sync_error' ? 'Import failed' : status}</span></div>
              <div className={`remote-activity-track ${status === 'processing' ? 'is-processing' : ''}`} role="progressbar" aria-label={`Upscale ${c.name}: ${status}`} aria-valuetext={status === 'processing' ? 'Processing on GPU' : status}><i/></div>
              <button type="button" className="outline-btn remote-job-cancel" onClick={() => void cancelRemoteUpscale(c)}>Cancel</button>
            </div>;
          })}
        </div>
      </div>
    </aside>
    </div>
    <section className="panel image-download-toolbar"><div><h2>Collection images</h2><p className="sub">{selectedIds.length} cards selected · {generated.length} images available · {eligible.length} prompts not yet generated</p></div><div className="image-download-actions"><button className="outline-btn" onClick={() => setSelectedIds(project.characters.map(c => c.id))}>Select all</button><button className="outline-btn" onClick={() => setSelectedIds([])}>Clear</button><select style={{ width: 88, flex: '0 0 88px' }} aria-label="Image upscale factor" value={upscaleFactor} disabled={upscaling} onChange={e => setUpscaleFactor(Number(e.target.value))}>{[2,4,6,8].map(factor => <option key={factor} value={factor}>{factor}×</option>)}</select><button className="outline-btn" disabled={upscaling || (project.upscaleBatch?.status !== 'staging' && !selectedGenerated.some(c => !c.upscaleJob)) || project.upscaleBatch?.status === 'committed'} onClick={() => void runCloudUpscale()}>{upscaling ? <LoaderCircle size={15} className="spin"/> : <ImageIcon size={15}/>} {project.upscaleBatch?.status === 'staging' ? 'Resume GPU Batch (' + project.upscaleBatch.items.length + ')' : 'GPU Upscale Batch ' + upscaleFactor + '× (' + selectedGenerated.filter(c => !c.upscaleJob).length + ')'}</button><button className="outline-btn" disabled={downloading || !selectedGenerated.length} onClick={() => void downloadZip('selected')}><Download size={15}/> Download selected ZIP</button><button className="outline-btn" disabled={downloading || !generated.length} onClick={() => void downloadZip('all')}><Download size={15}/> Download all ZIP</button><button className="primary-btn" title={!project.listing?.title ? 'Create and save an Etsy listing draft first.' : ''} disabled={downloading || !generated.length || !project.listing?.title} onClick={() => void downloadZip('package')}><Download size={15}/> Images + listing draft ZIP</button></div></section>
    {(upscaleBatchStatus || project.upscaleBatch) && <div className="panel" aria-live="polite">
      <strong>Remote GPU Batch</strong>
      <p className="sub">Status: {upscaleBatchStatus?.status || project.upscaleBatch?.status} ·
        Upload: {upscaleBatchStatus?.received || 0}/{upscaleBatchStatus?.total || project.upscaleBatch?.items.length || 0} ·
        Terminal jobs: {upscaleBatchStatus?.finished || 0}/{upscaleBatchStatus?.total || project.upscaleBatch?.items.length || 0}</p>
      <p className="sub">Completion notice: {upscaleBatchStatus?.notificationConfigured
        ? 'GPU Server email to ' + (upscaleBatchStatus.notificationEmail || project.upscaleBatch?.notificationEmail)
        : 'SMTP not configured on GPU Server; no email will be sent.'}
        {upscaleBatchStatus?.notificationStatus ? ' · ' + upscaleBatchStatus.notificationStatus : ''}</p>
      <p className="sub">Keep the client open until the whole Batch has been committed. After that, GPU work and email notification continue without the client PC.</p>
    </div>}
    <div className="assets-grid">{project.characters.map(c => <div className={`asset-card image-select-card ${selectedIds.includes(c.id) ? 'selected' : ''}`} key={c.id}><label className="asset-select"><input type="checkbox" aria-label={`Select ${c.name}`} checked={selectedIds.includes(c.id)} onChange={e => setSelectedIds(ids => e.target.checked ? [...ids, c.id] : ids.filter(id => id !== c.id))}/><span>Select</span></label><div className="asset-image">{c.imageUrl ? <Image unoptimized width={1024} height={1024} src={c.imageUrl} alt={c.name}/> : <ImageIcon size={36}/>}</div><div className="asset-meta"><b>{c.name}</b><span className={`status ${c.status}`}>{c.status}</span></div>{pending.has(c.id) && <p className="asset-pending">Batch pending</p>}{c.upscaleJob && <div className="asset-upscaled"><span>Remote GPU: {remoteProgress[c.id]?.status === 'sync_error' ? 'Import failed' : remoteProgress[c.id]?.status || 'queued'} · {Math.floor((remoteProgress[c.id]?.elapsed || 0) / 60)}m {Math.floor((remoteProgress[c.id]?.elapsed || 0) % 60)}s</span><button className="outline-btn" type="button" onClick={() => void cancelRemoteUpscale(c)}>Cancel upscale</button></div>}{c.upscaledImageUrl && <div className="asset-upscaled"><button type="button" className="outline-btn" onClick={() => c.imageUrl && setUpscalePreview({ name: c.name, originalUrl: c.imageUrl, upscaledUrl: c.upscaledImageUrl! })}>View upscale</button><a className="outline-btn" href={c.upscaledImageUrl + '&download=1'} download>Download upscale</a></div>}{c.imageUrl && <div className={`similarity-note similarity-${c.similarityReview?.status || 'unverified'}`} title={c.similarityReview?.reason || 'Not checked yet'}>{c.similarityReview?.status === 'needs_review' ? `⚠ Similar to reference (${c.similarityReview.score}%) — review / regenerate` : c.similarityReview?.status === 'clear' ? `✓ AI visual review: low similarity (${c.similarityReview.score}%)` : 'Similarity not verified'}{c.similarityReview?.reason && <small>{c.similarityReview.reason}</small>}</div>}{c.error && <p className="asset-error">{c.error}</p>}<div className="asset-card-actions">{c.similarityReview?.status === 'needs_review' && <button type="button" className="outline-btn" disabled={automationActive || working || pending.has(c.id)} onClick={() => void rewriteSimilarityPrompt(c)}><Sparkles size={14}/> Regenerate prompt (too similar)</button>}<button className="outline-btn" disabled={automationActive || working || pending.has(c.id) || !c.prompt} onClick={() => mode !== 'batch' ? void generateSingle(c) : void submitBatch([c.id], everGenerated(c))}>{working ? <LoaderCircle size={14} className="spin"/> : <Sparkles size={14}/>} {everGenerated(c) ? 'Regenerate' : 'Generate'} {mode === 'batch' ? '(Batch)' : '(Single)'}</button>{c.imageUrl && <a className="outline-btn" href={`${c.imageUrl}&download=1`} download><Download size={14}/> Download</a>}</div></div>)}</div>
    {upscalePreview && <UpscaleCompare name={upscalePreview.name} originalUrl={upscalePreview.originalUrl} upscaledUrl={upscalePreview.upscaledUrl} onClose={() => setUpscalePreview(null)}/>}
    {!project.characters.length && <div className="panel empty-state"><ImageIcon size={32}/><strong>No image subjects yet</strong><p>Create characters and prompts first.</p></div>}
  </>;
}

