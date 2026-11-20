'use client';

import Image from 'next/image';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, BarChart3, BookOpenText, Check, Copy, CircleHelp, Download, ExternalLink, FileSearch, ArrowLeft, RefreshCw, Image as ImageIcon, Layers3, LoaderCircle, Plus, Search, Settings2, Sparkles, Store, Trash2, WandSparkles, X, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { StoreSwitcher, useActiveStoreId } from '@/components/account-workspace';
import StoreManagement from '@/components/store-management';
import type { StoredUpscaleBatch } from '@/lib/upscale-batch-transport';
import StudioSettings, { defaultPrefs, defaultSeoPrompts, defaultSeoDraftFields, type StudioPreferences } from '@/components/studio-settings';
import ImageProduction from '@/components/image-production';
import ThumbnailDesigner, { type ThumbnailDesign, type ThumbnailSaveControls } from '@/components/thumbnail-designer';
import EtsyListingImageStudio from '@/components/etsy-listing-image-studio';
import type { ListingStudioConfig } from '@/lib/listing-studio-config';
import type { ListingImageRecord } from '@/lib/etsy-listing-image-plan';
import { isOpenAICreditError, playProductionSound, productionSoundEnabled } from '@/lib/production-sounds';
import MultiCollectionProduction from '@/components/multi-collection-production';
import TablePagination from '@/components/table-pagination';
import EtsyListingDraft, { type SavedSeoReview } from '@/components/etsy-listing-draft';
import type { EtsyListingDraft as ListingData } from '@/lib/etsy-listing';
import type { SimilarityReview } from '@/lib/similarity-review';
import { readWorkspaceHistoryState, routeEquals, routeFromWorkspaceHash, workspaceHash, isStudioTabEnabled, workspaceShortcut, type WorkspaceRoute, WORKSPACE_TAB_IDS } from '@/lib/workspace-history';
import { collectionHasUnsavedEdits } from '@/lib/collection-unsaved';
import { auditCreativeConcepts, expressionDistribution, familyDistribution, normalizeCreativeAnalysis, normalizeCreativeControls, referenceMoodFromExpressions, reverseEngineeringKeys, styleDNAKeys, characterDNAKeys, selectDiverseConcepts, type CreativeAnalysis, type CreativeControls } from '@/lib/creative-intelligence';

type Character = { id: string; name: string; family?: string; expression?: string; shape?: string; silhouette?: string; accessories?: string; colorPlan?: string; description: string; prompt: string; status: 'draft' | 'ready' | 'done' | 'error'; imageUrl?: string; upscaledImageUrl?: string; upscaledAt?: number; upscaleJob?: { id: string; submittedAt?: number; factor?: number }; error?: string; similarityReview?: SimilarityReview; origin: 'listing' | 'ai' | 'manual' };
type ResearchJobPreview = { transport?: 'batch'|'background'; workerPreviews?: Array<{index:number;status:string;imageCount:number;theme:string;style:string;concepts:Array<{name:string;family:string;description:string}>;error?:string}>; workersCompleted?: number; workersTotal?: number; mergeStatus?: string; id: string; status: 'submitting' | 'queued' | 'in_progress' | 'completed' | 'failed'; target: number; requested: number; completedCount: number; model: string; createdAt: number; updatedAt: number; error?: string };
const hasActiveResearch = (job?: ResearchJobPreview) => !!job && ['submitting','queued','in_progress'].includes(job.status);
type PromptJobPreview = { mode?: 'batch'|'progressive'; groupStates?: Array<{key:string;status:string;error?:string}>; id: string; status: string; total: number; imported: number; failed: number; processedGroups: number; totalGroups: number; model: string; createdAt: number; updatedAt: number; error?: string };
const hasActivePromptJob = (job?: PromptJobPreview) => !!job && !['completed','completed_with_errors','failed','cancelled','expired'].includes(job.status);
type FullAutomation = { enabled: boolean; textModel?: string; promptModel?: string; batchImageModel?: string; imageQuality?: string; stage: 'research' | 'expanding' | 'prompts' | 'images' | 'revising' | 'regenerating' | 'verifying' | 'listing' | 'completed' | 'paused'; target: number; updatedAt: number; lastError?: string; reviewQueue?: string[]; revisedIds?: string[] };
type Project = { fullAutomation?: FullAutomation; characterTarget?: number; researchModel?: string; hybridResearch?: boolean; progressivePrompts?: boolean; id: string; name: string; url: string; upscaleBatch?: StoredUpscaleBatch; researchJob?: ResearchJobPreview; promptJob?: PromptJobPreview; theme: string; subtheme: string; microtheme?: string; primaryKeyword?: string; longTailKeywords?: string[]; research?: CreativeAnalysis; creativeControls?: CreativeControls; sourceDescription?: string; sourceTags?: string[]; emotionDirection?: string; ageDirection?: string; cutenessDirection?: string; style: string; palette: string; texture: string; keywords: string[]; characters: Character[]; title: string; images: string[]; selectedImageUrls?: string[]; notes: string; listing?: ListingData; seoReview?: SavedSeoReview; thumbnails?: ThumbnailDesign[]; listingImages?: ListingImageRecord[]; listingStudioSettings?: ListingStudioConfig; lastDownloadedAt?: number; downloadCount?: number; lastDownloadImageCount?: number; downloadedImageIds?: string[] };
const etsyListingId = (value: string) => { try { const url = new URL(value.trim()); return ['etsy.com', 'www.etsy.com'].includes(url.hostname) ? url.pathname.match(/^\/listing\/(\d+)/)?.[1] || null : null; } catch { return null; } };
const uid = () => crypto.randomUUID();
const blank = (): Project => ({ id: uid(), name: 'Untitled collection', url: '', theme: '', subtheme: '', microtheme: '', primaryKeyword: '', longTailKeywords: [], style: '', palette: '', texture: '', keywords: [], characters: [], title: '', images: [], notes: '' });
const makeChar = (name: string, origin: Character['origin'], description = '', family = '', expression = '', dna: Partial<Character> = {}): Character => ({ id: uid(), name, family, expression, description, prompt: '', status: 'draft', origin, shape: dna.shape, silhouette: dna.silhouette, accessories: dna.accessories, colorPlan: dna.colorPlan });
const creativeContext = (p: Project): CreativeAnalysis => {
  const research = normalizeCreativeAnalysis(p.research);
  return { ...research, theme: p.theme, subtheme: p.subtheme,
    microtheme: p.microtheme || '', primaryKeyword: p.primaryKeyword || '',
    style: p.style, palette: p.palette, texture: p.texture,
    keywords: p.keywords, longTailKeywords: p.longTailKeywords || [],
    notes: p.notes, creativeControls: normalizeCreativeControls(p.creativeControls ?? research.creativeControls),
    emotionProfile: { ...research.emotionProfile,
      dominantMood: p.emotionDirection === undefined ? research.emotionProfile.dominantMood : p.emotionDirection,
      ageCues: p.ageDirection === undefined ? research.emotionProfile.ageCues : [p.ageDirection].filter(Boolean),
      styleCues: p.cutenessDirection === undefined ? research.emotionProfile.styleCues : [p.cutenessDirection].filter(Boolean) },
  };
};
type Concept = { name: string; description?: string; family?: string; expression?: string; shape?: string; silhouette?: string; accessories?: string; colorPlan?: string };
type StudioApiResponse = { error?: string; source: { title: string; description?: string; images: string[]; tags: string[] }; analysis: Partial<CreativeAnalysis> & { characters: Array<string | Concept> }; selectedImages: string[]; characters: Concept[]; prompts: Array<{ id: string; prompt: string }> };
const api = async (body: object): Promise<StudioApiResponse> => {
  const payload = JSON.stringify(body);
  const r = await fetch('/api/studio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload });
  const responseText = await r.text();
  let json: StudioApiResponse;
  try { json = JSON.parse(responseText) as StudioApiResponse; }
  catch { throw new Error(r.status === 413 ? 'Collection data exceeds the server request limit (' + (new Blob([payload]).size / 1_000_000).toFixed(1) + ' MB). Remove embedded image data URLs before saving.' : 'Studio request failed (HTTP ' + r.status + '): ' + responseText.slice(0, 160)); }
  if (!r.ok) throw new Error(json.error ?? 'Request failed (HTTP ' + r.status + ')');
  return json;
};
const steps = [{ id: 'analysis', label: 'Research & analysis' }, { id: 'characters', label: 'Character library' }, { id: 'prompts', label: 'AI Prompts' }, { id: 'production', label: 'Image production' }, { id: 'listing', label: 'Etsy listing draft' }];
const nextIncomplete = (p: Project) => !p.theme && !p.title ? 'analysis' : !p.characters.length ? 'characters' : p.characters.some(c => !c.prompt) ? 'prompts' : p.characters.some(c => c.status !== 'done') ? 'production' : !p.listing?.title ? 'listing' : 'listing';
// Full Automation advances server-side; the optional UI follower only observes
// confirmed stage changes. Never use tab navigation to submit paid API work.
const automationStageTab = (stage?: FullAutomation['stage']): string | null => {
  if (!stage || stage === 'paused') return null;
  if (stage === 'research') return 'analysis';
  // Research synthesis and character completion stay on Research; only jump
  // directly to AI Prompts once the entire target has been saved.
  if (stage === 'expanding') return 'analysis';
  if (stage === 'prompts') return 'prompts';
  if (['images','revising','regenerating','verifying'].includes(stage)) return 'production';
  if (stage === 'listing' || stage === 'completed') return 'listing';
  return null;
};

export default function Home() {
  const activeStoreId = useActiveStoreId();
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project>(blank);
  const [tab, setTab] = useState('overview');
  const historyReady = useRef(false);
  const historySession = useRef('');
  const historyIndex = useRef(0);
  const historyMax = useRef(0);
  const restoreFromHistory = useRef(false);
  const lastRoute = useRef<WorkspaceRoute | null>(null);
  const [historyPosition, setHistoryPosition] = useState({ index: 0, max: 0 });
  const projectSnapshots = useRef(new Map<string, Project>());
  const savedProjectSnapshots = useRef(new Map<string, string>());
  const allowExplicitReload = useRef(false);
  const latestWorkspace = useRef<{ tab: string; project: Project; projects: Project[] }>({ tab: 'overview', project: blank(), projects: [] });
  latestWorkspace.current = { tab, project, projects };
  const thumbnailSaveControlsRef = useRef<ThumbnailSaveControls | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [query, setQuery] = useState('');
  const [libraryPage, setLibraryPage] = useState(1);
  const [libraryPageSize, setLibraryPageSize] = useState(25);
  const [collectionQuery, setCollectionQuery] = useState('');
  const [collectionSort, setCollectionSort] = useState<'recent' | 'name' | 'subjects'>('recent');
  const [busy, setBusy] = useState('');
  const [promptProgress, setPromptProgress] = useState({ done: 0, total: 0 });
  const [copiedAllPrompts, setCopiedAllPrompts] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState({ done: 0, total: 0 });
  const [analysisProvider, setAnalysisProvider] = useState<'openai' | 'gemini'>('openai');
  const [visualModel, setVisualModel] = useState('gpt-6.1-terra');
  const [promptProvider, setPromptProvider] = useState<'openai' | 'gemini'>('openai');
  const [promptModel, setPromptModel] = useState('gpt-6-luna');
  const [analysisModels, setAnalysisModels] = useState<Record<'openai' | 'gemini', Array<{ id: string; name: string }>>>({ openai: [], gemini: [] });
  const [analysisModelsError, setAnalysisModelsError] = useState('');
  const [autoFollowAutomation, setAutoFollowAutomation] = useState(true);
  const autoFollowRef = useRef(true);
  autoFollowRef.current = autoFollowAutomation;
  // A model chosen by the user must not be replaced just because the API
  // model-list endpoint filters it out or loads after the dropdown renders.
  useEffect(() => {
    if (analysisProvider === 'openai' && !/^gpt-[a-z0-9.-]{1,80}$/.test(visualModel))
      setVisualModel('gpt-6.1-terra');
  }, [analysisModels, analysisProvider, visualModel]);
  // Do not replace the chosen Research model with the first model in the
  // fetched list. The models endpoint may be temporarily unavailable and an
  // in-flight Batch must keep its originally submitted model.
  useEffect(() => {
    if (promptProvider === 'openai' && !/^gpt-[a-z0-9.-]{1,80}$/.test(promptModel))
      setPromptModel('gpt-6-luna');
    if (promptProvider === 'gemini' && !/^gemini-[a-z0-9.-]{1,80}$/.test(promptModel))
      setPromptModel(analysisModels.gemini[0]?.id || 'gemini-2.5-pro');
  }, [analysisModels, promptProvider, promptModel]);
  useEffect(() => {
    let cancelled = false;
    const load = async (provider: 'openai' | 'gemini') => {
      try {
        const res = await fetch(`/api/settings?models=${provider === 'openai' ? 'openai-seo' : 'gemini'}`);
        const data = await res.json() as { models?: Array<{ id: string; name: string }>; error?: string };
        if (!res.ok) throw Error(data.error || 'Model list unavailable');
        if (!cancelled) setAnalysisModels(previous => ({ ...previous, [provider]: data.models || [] }));
      } catch (error) { if (!cancelled) setAnalysisModelsError(error instanceof Error ? error.message : String(error)); }
    };
    void Promise.all([load('openai'), load('gemini')]);
    return () => { cancelled = true; };
  }, []);
  const [message, setMessage] = useState('');
  // Multiple independent job monitors share one connection warning. Network
  // failures are not OpenAI Batch failures, and must never trigger paid POSTs.
  const [backendConnectionWarning, setBackendConnectionWarning] = useState('');
  const networkPollFailures = useRef(new Map<string, {attempts:number;nextAt:number}>());
  const canPollBackend = (scope:string) =>
    Date.now() >= (networkPollFailures.current.get(scope)?.nextAt||0);
  const noteBackendPollHealthy = (scope:string) => {
    networkPollFailures.current.delete(scope);
    if(networkPollFailures.current.size===0) setBackendConnectionWarning('');
  };
  const noteBackendPollError = (scope:string,error:unknown):boolean => {
    const message=error instanceof Error?error.message:String(error);
    if(!/failed to fetch|networkerror|network request failed|load failed/i.test(message))return false;
    const count=(networkPollFailures.current.get(scope)?.attempts||0)+1;
    const delay=Math.min(60000,5000*Math.pow(2,Math.min(count-1,4)));
    networkPollFailures.current.set(scope,{attempts:count,nextAt:Date.now()+delay});
    setBackendConnectionWarning('PaletteIQ local server connection interrupted. Saved automation and OpenAI Batch IDs are preserved. Monitoring will resume automatically when the connection returns; do not resubmit paid jobs.');
    return true;
  };
  const [target, setTarget] = useState(120);
  const [fullAutoRequested, setFullAutoRequested] = useState(false);
  const setCollectionTarget = (requested: number) => {
    const next = Math.max(1, Math.min(fullAutoRequested ? 200 : 1000, Math.floor(requested || 1)));
    setTarget(next);
    setProject(prev => ({ ...prev, characterTarget: next }));
  };
  const [canRestartMissingResearch, setCanRestartMissingResearch] = useState(false);
  const [canRetryRejectedResearch, setCanRetryRejectedResearch] = useState(false);
  const [researchRecovery, setResearchRecovery] = useState<{state:string;message:string}|null>(null);
  const [savedResearchStatus, setSavedResearchStatus] = useState('unknown');
  const [savedResearchError, setSavedResearchError] = useState<string|null>(null);
  useEffect(() => { setFullAutoRequested(Boolean(project.fullAutomation?.enabled)); }, [project.id, project.fullAutomation?.enabled]);
  const [model, setModel] = useState('gpt-image-1-mini');
  const [quality, setQuality] = useState('low');
  const [selected, setSelected] = useState<string[]>([]);
  const [loadDone, setLoadDone] = useState(false);
  const observedBatchStates = useRef<Map<string, string> | null>(null);
  const lastCreditNotice = useRef('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [duplicateListing, setDuplicateListing] = useState<{ url: string; collections: string[] } | null>(null);
  const [preferences, setPreferences] = useState<StudioPreferences>(defaultPrefs);
  // The collection's entered target takes precedence over Settings defaults
  // and is restored in every workflow tab and after relaunch.
  useEffect(() => {
    const saved = project.fullAutomation?.target ?? project.characterTarget ??
      project.researchJob?.target ?? preferences.target;
    if (Number.isInteger(saved) && saved >= 1 && saved <= 1000) setTarget(saved);
  }, [project.id, project.characterTarget, project.fullAutomation?.target,
      project.researchJob?.target, preferences.target]);
  useEffect(() => {
    // Gemini can still be selected for manual non-automation research.
    if (!fullAutoRequested && analysisProvider !== 'openai') return;
    const saved = (project.fullAutomation?.stage !== 'completed' ? project.fullAutomation?.textModel : undefined) ||
      project.researchModel || project.researchJob?.model || preferences.analysisModel;
    if (/^gpt-[a-z0-9.-]{1,80}$/.test(saved || '')) setVisualModel(saved);
  }, [project.id, project.fullAutomation?.textModel, project.researchModel,
      project.researchJob?.model, project.fullAutomation?.stage, preferences.analysisModel, fullAutoRequested, analysisProvider]);
  const lockedPromptModel = project.fullAutomation?.enabled &&
    project.fullAutomation.stage !== 'completed'
    ? project.fullAutomation.promptModel || project.fullAutomation.textModel ||
      project.researchJob?.model || project.researchModel || preferences.automationPromptModel : null;
  // AI Prompts begins with the same collection-level GPT model selected in
  // Research & Analysis. On an active Full Automation job the model is frozen,
  // and changing Settings or switching tabs cannot silently replace it.
  useEffect(() => {
    const selectedModel = lockedPromptModel || preferences.automationPromptModel;
    if (/^gpt-[a-z0-9.-]{1,80}$/.test(selectedModel || '')) {
      setPromptProvider('openai');
      setPromptModel(selectedModel);
    }
  }, [project.id, lockedPromptModel, project.researchModel,
    project.researchJob?.model, preferences.automationPromptModel]);

  useEffect(() => {
    try { setAutoFollowAutomation(localStorage.getItem('paletteiq-auto-follow-automation') !== '0'); }
    catch { /* Keep the default on when browser storage is unavailable. */ }
  }, []);
  const updateAutoFollowAutomation = (enabled: boolean) => {
    setAutoFollowAutomation(enabled);
    try { localStorage.setItem('paletteiq-auto-follow-automation', enabled ? '1' : '0'); }
    catch { /* Optional local UI preference. */ }
  };

  async function copyAllPrompts() {
    const prompts = project.characters.map(character => character.prompt.trim()).filter(Boolean);
    if (!prompts.length) { setMessage('There are no prompts to copy yet.'); return; }
    const contents = prompts.join('\n\n');
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(contents);
      } else {
        const field = document.createElement('textarea');
        field.value = contents; field.style.position = 'fixed'; field.style.opacity = '0';
        document.body.appendChild(field); field.focus(); field.select();
        const copied = document.execCommand('copy'); field.remove();
        if (!copied) throw new Error('Clipboard unavailable');
      }
      setCopiedAllPrompts(true);
      setMessage(`Copied ${prompts.length} prompts to clipboard, separated by blank lines.`);
    } catch {
      setMessage('Unable to copy prompts. Check browser clipboard permissions.');
    }
  }

  useEffect(() => {
    try { setSidebarCollapsed(localStorage.getItem('paletteiq-sidebar-collapsed') === '1'); } catch { /* Optional preference. */ }
  }, []);
  const toggleSidebar = () => setSidebarCollapsed(value => {
    try { localStorage.setItem('paletteiq-sidebar-collapsed', value ? '0' : '1'); } catch { /* Optional preference. */ }
    return !value;
  });
  useEffect(() => { fetch('/api/studio').then(r => r.ok ? r.json() : [] as { data: Project }[]).then((rows) => {
    const list = (rows as { data: Project }[]).map(r => r.data); setProjects(list);
    projectSnapshots.current = new Map(list.map(p => [p.id, p]));
    savedProjectSnapshots.current = new Map(list.map(p => [p.id, JSON.stringify(p)]));
    let restored: { id?: string; tab?: string } = {};
    try { restored = JSON.parse(localStorage.getItem('paletteiq-last-workspace') || '{}'); } catch { /* Ignore invalid prior state. */ }
    let session = '';
    try {
      session = sessionStorage.getItem('paletteiq-history-session') || crypto.randomUUID();
      sessionStorage.setItem('paletteiq-history-session', session);
    } catch { session = crypto.randomUUID(); }
    historySession.current = session;
    const entry = readWorkspaceHistoryState(window.history.state, session);
    const routeHint = entry || routeFromWorkspaceHash(window.location.hash);
    const selectedProject = list.find(p => p.id === routeHint?.projectId)
      || list.find(p => p.id === restored.id) || list[0] || latestWorkspace.current.project;
    const validTabs = WORKSPACE_TAB_IDS as readonly string[];
    const restoredTab = routeHint && validTabs.includes(routeHint.tab) ? routeHint.tab
      : restored.tab && validTabs.includes(restored.tab) ? restored.tab : 'overview';
    setProject(selectedProject); setSourceUrl(selectedProject.url); setTab(restoredTab);
    const route: WorkspaceRoute = { tab: restoredTab, projectId: selectedProject.id };
    const cursor = entry?.index || 0;
    let max = cursor;
    try { max = Math.max(max, Math.min(10000, Number(sessionStorage.getItem('paletteiq-history-max') || '0') || 0)); } catch { /* Optional. */ }
    historyIndex.current = cursor; historyMax.current = max;
    lastRoute.current = route; setHistoryPosition({ index: cursor, max });
    try { window.history.replaceState({ ...window.history.state, paletteiqWorkspace: { ...route, index: cursor, session } }, '', workspaceHash(route)); } catch { /* History API unavailable. */ }
    historyReady.current = true;
  }).catch(() => {}).finally(() => setLoadDone(true)); }, []);
  // Browser history entries hold the active collection AND page. Browser toolbar,
  // Alt+Left/Right and the new in-app arrows all use this one native stack.
  useEffect(() => {
    if (!loadDone || !historyReady.current) return;
    projectSnapshots.current.set(project.id, project);
  }, [loadDone, project]);
  useEffect(() => {
    if (!loadDone || !historyReady.current) return;
    const route: WorkspaceRoute = { tab, projectId: project.id };
    if (restoreFromHistory.current) {
      restoreFromHistory.current = false;
      lastRoute.current = route;
      return;
    }
    if (lastRoute.current && routeEquals(lastRoute.current, route)) return;
    const index = historyIndex.current + 1;
    historyIndex.current = index; historyMax.current = index;
    lastRoute.current = route;
    try {
      window.history.pushState({
        ...window.history.state, paletteiqWorkspace: { ...route, index, session: historySession.current },
      }, '', workspaceHash(route));
      sessionStorage.setItem('paletteiq-history-max', String(index));
    } catch { /* Browsers may restrict history changes in private mode. */ }
    setHistoryPosition({ index, max: index });
  }, [loadDone, tab, project.id]);
  useEffect(() => {
    if (!loadDone) return;
    const onPop = (event: PopStateEvent) => {
      let entry = readWorkspaceHistoryState(event.state, historySession.current);
      if (!entry) {
        // Older saved browser entries can still point to disabled screens.
        // Repair those entries in-place rather than mounting hidden tools.
        const old = event.state?.paletteiqWorkspace as
          { tab?: unknown; projectId?: unknown; index?: unknown; session?: unknown } | undefined;
        if (!old || typeof old.tab !== 'string' || isStudioTabEnabled(old.tab) ||
            typeof old.projectId !== 'string' || old.session !== historySession.current ||
            !Number.isSafeInteger(old.index)) return;
        const safeRoute: WorkspaceRoute = { tab: 'listing', projectId: old.projectId };
        const repaired = { ...safeRoute, index: old.index, session: historySession.current };
        try { window.history.replaceState({ ...event.state, paletteiqWorkspace: repaired }, '', workspaceHash(safeRoute)); }
        catch { /* Do not render an unavailable tool even if the URL cannot be repaired. */ }
        entry = readWorkspaceHistoryState({ paletteiqWorkspace: repaired }, historySession.current);
        if (!entry) return;
      }
      const current = latestWorkspace.current;
      const next: WorkspaceRoute = { tab: entry.tab, projectId: entry.projectId };
      const previous: WorkspaceRoute = { tab: current.tab, projectId: current.project.id };
      if (!routeEquals(next, previous)) {
        const thumbnailDirty = current.tab === 'thumbnails' && !!thumbnailSaveControlsRef.current?.hasUnsaved();
        const collectionDirty = next.projectId !== current.project.id &&
          collectionHasUnsavedEdits(current.project, savedProjectSnapshots.current.get(current.project.id));
        if ((thumbnailDirty || collectionDirty) &&
            !window.confirm('You have unsaved changes. Leave this page? Your draft stays available in the current session, but a page reload could discard it.')) {
          window.history.go(historyIndex.current - entry.index);
          return;
        }
      }
      const previousIndex = historyIndex.current;
      historyIndex.current = entry.index;
      setHistoryPosition({ index: entry.index, max: historyMax.current });
      if (routeEquals(next, previous)) return;
      const destination = projectSnapshots.current.get(entry.projectId)
        || current.projects.find(p => p.id === entry.projectId);
      if (!destination) {
        // A collection was deleted; don't invent an empty replacement in history.
        window.history.go(previousIndex > entry.index ? 1 : -1);
        return;
      }
      restoreFromHistory.current = true;
      lastRoute.current = next;
      setProject(destination);
      setSourceUrl(destination.url);
      setTab(next.tab);
      setLibraryPage(1);
      setSelected([]);
      setMessage('');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [loadDone]);
  useEffect(() => {
    // AccountWorkspaceGate asks before switching stores; avoid a second native
    // warning after the server has already changed the active-store session.
    const onAccountTransition = () => { allowExplicitReload.current = true; };
    window.addEventListener('paletteiq:store-changing', onAccountTransition);
    return () => window.removeEventListener('paletteiq:store-changing', onAccountTransition);
  }, []);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (allowExplicitReload.current) return;
      const current = latestWorkspace.current;
      if (collectionHasUnsavedEdits(current.project, savedProjectSnapshots.current.get(current.project.id)) ||
          (current.tab === 'thumbnails' && !!thumbnailSaveControlsRef.current?.hasUnsaved())) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, []);
  const historyBack = () => { if (historyIndex.current > 0) window.history.back(); };
  const historyForward = () => { if (historyIndex.current < historyMax.current) window.history.forward(); };
  const historyRefresh = () => {
    const current = latestWorkspace.current;
    const dirty = collectionHasUnsavedEdits(current.project, savedProjectSnapshots.current.get(current.project.id)) ||
      (current.tab === 'thumbnails' && !!thumbnailSaveControlsRef.current?.hasUnsaved());
    if (dirty && !window.confirm('Refresh PaletteIQ? Unsaved changes in the current collection or designer will be lost.')) return;
    allowExplicitReload.current = true;
    window.location.reload();
  };
  useEffect(() => {
    // Use standard desktop browser shortcuts, but handle them ourselves so
    // guarded reloads and collection-aware history work in both web and Electron.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      const command = workspaceShortcut(event);
      if (!command) return;
      const node = event.target;
      const typing = node instanceof HTMLElement &&
        (node.isContentEditable || ['INPUT','TEXTAREA','SELECT'].includes(node.tagName));
      // Option+Arrow on macOS moves the caret; never override it when editing.
      if (typing && (command === 'back' || command === 'forward') &&
          /Mac|iPhone|iPad/.test(navigator.platform)) return;
      event.preventDefault();
      if (command === 'back') historyBack();
      else if (command === 'forward') historyForward();
      else historyRefresh();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);
  useEffect(() => { if (!loadDone) return; try { localStorage.setItem('paletteiq-last-workspace', JSON.stringify({ id: project.id, tab })); } catch { /* Storage is optional. */ } }, [loadDone, project.id, tab]);
  useEffect(() => {
    if (!loadDone || tab === 'production' || tab === 'multi-production') return;
    let stopped = false;
    let polling = false;
    const resumeBatches = async () => {
      if (polling) return;
      polling = true;
      try {
        const response = await fetch('/api/image-batches?syncAll=1');
        if (!response.ok || stopped) return;
        const result = await response.json() as { updatedProjectIds?: string[]; warnings?: string[] };
        const creditWarning = result.warnings?.find(isOpenAICreditError);
        if (creditWarning && creditWarning !== lastCreditNotice.current) {
          lastCreditNotice.current = creditWarning;
          setMessage('OpenAI credits/quota may be exhausted. Check API billing. ' + creditWarning.slice(0, 240));
          if (productionSoundEnabled()) playProductionSound('credits');
        }
        const ids = result.updatedProjectIds || [];
        if (!ids.length) return;
        const currentStates = new Map(observedBatchStates.current || []);
        let finished = false;
        let hasBatchError = false;
        await Promise.all(ids.map(async id => {
          try {
            const response = await fetch(`/api/image-batches?projectId=${encodeURIComponent(id)}`);
            if (!response.ok) return;
            const data = await response.json() as { jobs?: Array<{ id: string; status: string; warning?: string }> };
            for (const job of data.jobs || []) {
              const previous = observedBatchStates.current?.get(job.id);
              if (previous && !['completed', 'completed_with_errors', 'failed', 'cancelled', 'expired'].includes(previous) && ['completed', 'completed_with_errors', 'failed', 'cancelled', 'expired'].includes(job.status)) { finished = true; if (job.status !== 'completed') hasBatchError = true; }
              currentStates.set(job.id, job.status);
              if (job.warning && isOpenAICreditError(job.warning) && job.warning !== lastCreditNotice.current) {
                lastCreditNotice.current = job.warning;
                setMessage('OpenAI credits/quota may be exhausted. Check API billing. ' + job.warning.slice(0, 240));
                if (productionSoundEnabled()) playProductionSound('credits');
              }
            }
          } catch { /* Keep the next poll available after transient errors. */ }
        }));
        observedBatchStates.current = currentStates;
        if (finished && productionSoundEnabled()) playProductionSound(hasBatchError ? 'error' : 'completed');
        const recovered = await Promise.all(ids.map(async id => {
          const response = await fetch(`/api/studio?projectId=${encodeURIComponent(id)}`);
          return response.ok ? ((await response.json()) as Array<{ data: Project }>)[0]?.data : null;
        }));
        if (stopped) return;
        const fresh = recovered.filter((value): value is Project => Boolean(value));
        if (!fresh.length) return;
        const byId = new Map(fresh.map(item => [item.id, item]));
        // The Batch importer owns only persisted artwork results, not user
        // edits to the creative brief, mood direction, descriptions or prompts.
        // Reconcile image fields without replacing any unsaved local work.
        const mergeImportedAssets = (local:Project,remote:Project):Project => {
          const remoteImages=new Map(remote.characters.map(char=>[char.id,char]));
          return {...local,characters:local.characters.map(char=>{
            const saved=remoteImages.get(char.id);
            return saved?.imageUrl && (char.imageUrl!==saved.imageUrl ||
              JSON.stringify(char.similarityReview)!==JSON.stringify(saved.similarityReview))
              ? {...char,imageUrl:saved.imageUrl,status:saved.status,error:saved.error,
                  similarityReview:saved.similarityReview}:char;
          })};
        };
        setProjects(prev=>prev.map(item=>{
          const stored=byId.get(item.id);
          if(!stored)return item;
          if(collectionHasUnsavedEdits(item,savedProjectSnapshots.current.get(item.id)))
            return mergeImportedAssets(item,stored);
          savedProjectSnapshots.current.set(item.id,JSON.stringify(stored));
          return stored;
        }));
        setProject(prev=>{
          const stored=byId.get(prev.id);
          return stored?mergeImportedAssets(prev,stored):prev;
        });
      } catch { /* Offline is expected; try again on the next interval. */ }
      finally { polling = false; }
    };
    void resumeBatches();
    const timer = window.setInterval(() => void resumeBatches(), 12000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [loadDone, tab]);
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); const main = document.querySelector('.main'); if (main && main.scrollTop) main.scrollTop = 0; document.title = `${['overview','collections','multi-production','stores','settings'].includes(tab) ? tab[0].toUpperCase() + tab.slice(1) : `${project.name} · ${steps.find(s => s.id === tab)?.label || tab}`} | PaletteIQ`; }, [tab, project.id, project.name]);
  const updatePreferences = useCallback((prefs: StudioPreferences) => { setPreferences(prefs); setModel(prefs.model); setQuality(prefs.quality); }, []);
  useEffect(() => {
    // Store switching changes the authenticated data scope, not just the name
    // shown in the header. Never retain one store's draft preferences in another.
    let current = true;
    updatePreferences({ ...defaultPrefs, seoPrompts: { ...defaultSeoPrompts }, seoDraftFields: [...defaultSeoDraftFields] });
    void fetch('/api/settings', { cache: 'no-store' })
      .then(r => r.ok ? r.json() as Promise<{ preferences?: StudioPreferences }> : null)
      .then((data: { preferences?: StudioPreferences } | null) => {
        if (current && data?.preferences) updatePreferences({
          ...defaultPrefs, ...data.preferences,
          seoPrompts: { ...defaultSeoPrompts, ...data.preferences.seoPrompts },
          seoDraftFields: data.preferences.seoDraftFields ?? [...defaultSeoDraftFields],
        });
      }).catch(() => {});
    return () => { current = false; };
  }, [activeStoreId, updatePreferences]);

  const update = (fields: Partial<Project>) => setProject(prev => ({ ...prev, ...fields }));
  const updateChar = (id: string, fields: Partial<Character>) => setProject(prev => ({ ...prev, characters: prev.characters.map(c => c.id === id ? { ...c, ...fields } : c) }));
  const updateUpscaleChar = (id: string, fields: Partial<Character>) => {
    // Keep both the active tab and the saved collection picker in sync, even
    // when the user navigates away while remote GPU work is still running.
    setProject(prev => ({ ...prev, characters: prev.characters.map(c => c.id === id ? { ...c, ...fields } : c) }));
    setProjects(prev => prev.map(p => p.id !== project.id ? p :
      { ...p, characters: p.characters.map(c => c.id === id ? { ...c, ...fields } : c) }));
  };
  const updateUpscaleBatch = (batch: StoredUpscaleBatch) => {
    setProject(prev => ({ ...prev, upscaleBatch: batch }));
    setProjects(prev => prev.map(item => item.id === project.id ? { ...item, upscaleBatch: batch } : item));
  };
  const addChars = (newChars: Character[]) => setProject(prev => { const existing = new Set(prev.characters.map(c => c.name.trim().toLowerCase())); const unique = newChars.filter(c => { const k = c.name.trim().toLowerCase(); if (!k || existing.has(k)) return false; existing.add(k); return true; }); return { ...prev, characters: [...prev.characters, ...unique] }; });
  const save = async (value = project) => {
    setBusy('save');
    try {
      if (tab === 'thumbnails' && thumbnailSaveControlsRef.current) {
        await thumbnailSaveControlsRef.current.save();
        setMessage('Thumbnail designs and collection saved.');
      } else {
        await api({ action: 'save', id: value.id, name: value.name, data: value });
        setProjects(prev => [value, ...prev.filter(p => p.id !== value.id)]);
        savedProjectSnapshots.current.set(value.id, JSON.stringify(value));
        setMessage('Collection saved securely.');
      }
    } catch (e) { setMessage('Save failed: ' + (e instanceof Error ? e.message : String(e))); }
    finally { setBusy(''); }
  };
  const navigateTab = (next: string) => {
    if (!isStudioTabEnabled(next)) {
      setMessage('This tab is temporarily disabled in PaletteIQ.');
      return;
    }
    if (next === tab) return;
    if (tab === 'thumbnails' && thumbnailSaveControlsRef.current?.hasUnsaved()) {
      if (!window.confirm('Thumbnail designs have unsaved changes. Leave without saving?')) return;
    }
    setTab(next);
  };
  const loadListingImages = async (allowDuplicate = false) => {
    if (busy) return;
    if (!sourceUrl.trim()) { setMessage('Enter an Etsy listing URL first.'); return; }
    const referenceId = etsyListingId(sourceUrl);
    if (!allowDuplicate && referenceId) {
      const existing = projects.filter(item => item.id !== project.id && etsyListingId(item.url) === referenceId);
      if (existing.length) { setDuplicateListing({ url: sourceUrl.trim(), collections: existing.map(item => item.name) }); return; }
    }
    setDuplicateListing(null);
    setBusy('images'); setMessage('');
    try {
      const result = await api({ action: 'listing-images', url: sourceUrl.trim() });
      const images: string[] = result.source.images;
      setProject(prev => ({ ...prev, url: sourceUrl.trim(), title: result.source.title || '', sourceDescription: result.source.description || '', sourceTags: result.source.tags || [], images, selectedImageUrls: images }));
      setTab('analysis');
      setMessage(`${images.length} listing images loaded. Choose your references, then click Analyze selected images.`);
    } catch (e) { setMessage(`Could not load listing images: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(''); }
  };
  const runAnalyze = async () => {
    if (busy || hasActiveResearch(project.researchJob)) return;
    if (fullAutoRequested && target > 200) { setMessage('Full Automation supports up to 200 characters per collection. Reduce the target or uncheck Full Automation.'); return; }
    if (!sourceUrl.trim()) { setMessage('Enter an Etsy listing URL first.'); return; }
    if (project.url !== sourceUrl.trim() || !project.images.length) { setMessage('Load listing images first.'); return; }
    const chosenImages = project.selectedImageUrls ?? project.images;
    if (!chosenImages.length) { setMessage('Select at least one image to analyze.'); return; }
    if (analysisProvider === 'openai' || fullAutoRequested) {
      if (fullAutoRequested && project.progressivePrompts &&
          !window.confirm('Progressive AI Prompts will create separate OpenAI Batch jobs for groups of 10 characters. Each job can incur charges, and no group is automatically resubmitted if status is uncertain. Continue?')) return;
      if (fullAutoRequested && project.hybridResearch !== false &&
          !window.confirm('Hybrid Parallel Research will submit up to 3 paid OpenAI Batch jobs, followed by 1 paid Style DNA Batch merge. Token usage and cost may be higher than Single Research. Continue?')) return;
      // Research requests are durably tracked and can continue remotely.
      // The browser is only a status viewer, never the job runner.
      setBusy('research-start'); setMessage('Saving the collection and submitting OpenAI Research Batches…');
      let startedNewAutomation = false;
      try {
        if (fullAutoRequested) {
          // A newly created collection only lives in browser state. Do NOT
          // demand a server-side Full Automation record before the first Save;
          // GET /api/full-automation correctly returns 404 for an unsaved ID.
          // For a persisted ID, still inspect the authoritative workflow and
          // reject existing paid jobs BEFORE any browser Save can overwrite it.
          const saved = await fetch('/api/studio?projectId=' +
            encodeURIComponent(project.id), { cache:'no-store' });
          if (!saved.ok) throw Error('Unable to verify collection storage before starting automation (HTTP ' + saved.status + ')');
          const savedRows = await saved.json() as Array<{ id:string }>;
          if (savedRows.some(item => item.id === project.id)) {
            const previous = await refreshAutomationStatus(project.id);
            if (previous?.enabled && previous.stage !== 'completed') {
              setMessage(previous.stage === 'paused'
                ? 'This collection has a paused Full Automation workflow. Use its recovery controls above; do not start another paid research job.'
                : 'Full Automation is already running (' + previous.stage + '). The saved status is restored above; do not start another paid research job.');
              return;
            }
          }
        }
        // Persist new collections first, then initialize their workflow.
        await api({ action: 'save', id: project.id, name: project.name, data: project });
        let fullAutomation: FullAutomation | undefined = project.fullAutomation;
        if (fullAutoRequested) {
          const res = await fetch('/api/full-automation', { method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'start', projectId: project.id, target, model: visualModel }) });
          const next = await res.json() as { error?: string; flow?: FullAutomation };
          if (!res.ok || !next.flow) throw Error(next.error || 'Unable to start Full Automation');
          fullAutomation = next.flow;
          startedNewAutomation = true;
        }
        const started = await fetch('/api/research-jobs', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: project.id, url: sourceUrl.trim(),
            selectedImages: chosenImages, target, model: visualModel,
            hybridResearch: fullAutoRequested && project.hybridResearch !== false }),
        });
        const result = await started.json() as { error?: string; job?: ResearchJobPreview };
        if (!started.ok || !result.job) throw new Error(result.error || 'Could not create background research job');
        const snapshot = { ...project, characterTarget:target, researchModel:visualModel, fullAutomation, researchJob: result.job };
        savedProjectSnapshots.current.set(project.id, JSON.stringify(snapshot));
        setProject(snapshot);
        setProjects(previous => [snapshot, ...previous.filter(p => p.id !== snapshot.id)]);
        setAnalysisProgress({ done: result.job.completedCount, total: result.job.target });
        setMessage(fullAutoRequested
          ? 'Full Automation started. PaletteIQ will expand missing characters, generate prompts and images, revise similarity-flagged prompts once, then create the Etsy listing draft. OpenAI jobs run remotely; next workflow stages resume when PaletteIQ runs (including Desktop tray).'
          : 'OpenAI Research Batch accepted. You may close PaletteIQ or shut down this PC; OpenAI continues processing. Reopen PaletteIQ to import the completed characters automatically. For a target above 160, use AI Fill afterward.');
      } catch (error) {
        // Never pause a pre-existing workflow merely because a stale tab
        // attempted to start again. Pause only a workflow created by THIS call.
        if (startedNewAutomation) {
          try {
            await fetch('/api/full-automation', { method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'pause', projectId: project.id }) });
          } catch { /* Preserve the original submission error. */ }
        }
        try { await refreshAutomationStatus(project.id); }
        catch { /* User can reopen the collection to recover saved status. */ }
        setMessage('Background research not started: ' + (error instanceof Error ? error.message : String(error)) +
          '. Check the restored Full Automation status above before retrying to avoid duplicate API charges.');
      } finally { setBusy(''); }
      return;
    }
    setBusy('analyze'); setMessage(''); setAnalysisProgress({ done: 0, total: target });
    let working = project;
    try {
      const data = await api({ action: 'analyze', url: sourceUrl.trim(), selectedImages: chosenImages, analysisProvider, analysisModel: visualModel, creativeControls: normalizeCreativeControls(project.creativeControls) });
      const a = data.analysis;
      if (!a || !Array.isArray(a.characters)) throw new Error('OpenAI did not return visual character analysis.');
      const observed = a.characters.map((x: string | Concept) => typeof x === 'string'
        ? makeChar(x, 'listing') : makeChar(String(x.name || ''), 'listing', String(x.description || ''), String(x.family || ''), String(x.expression || ''), x)).filter((c: Character) => c.name.trim());
      const previous = working.url === sourceUrl ? working.characters : [];
      const preserved = [...new Map(previous.filter(c => c.name.trim()).map(c => [c.name.trim().toLowerCase(), c])).values()].slice(0, target);
      const verified = [...preserved, ...selectDiverseConcepts(observed, preserved, target, target - preserved.length, normalizeCreativeControls(working.creativeControls).characterVariation)];
      const research = normalizeCreativeAnalysis(a);
      working = { ...working, url: sourceUrl.trim(), name: data.source.title || working.name,
        title: data.source.title || '', sourceDescription: data.source.description || '',
        sourceTags: data.source.tags || [], images: data.source.images || [], selectedImageUrls: data.selectedImages,
        theme: research.theme, subtheme: research.subtheme, microtheme: research.microtheme,
        primaryKeyword: research.primaryKeyword, longTailKeywords: research.longTailKeywords,
        emotionDirection: research.emotionProfile.dominantMood, ageDirection: research.emotionProfile.ageCues.join(', '),
        cutenessDirection: research.emotionProfile.styleCues.join(', '),
        research, style: research.style || working.style, palette: research.palette || working.palette,
        texture: research.texture || working.texture, keywords: research.keywords.length ? research.keywords : data.source.tags || [],
        notes: research.notes, characters: verified };
      setProject(working); setAnalysisProgress({ done: verified.length, total: target });
      const observedCount = verified.filter(c => c.origin === 'listing').length;
      let attempts = 0;
      let emptyRounds = 0;
      while (working.characters.length < target && attempts < Math.ceil(target / 10) + 10) {
        attempts++;
        const needed = Math.min(20, target - working.characters.length);
        const result = await api({ action: 'expand', count: needed, target, title: working.title || working.name, analysis: creativeContext(working), images: working.selectedImageUrls ?? working.images, existing: working.characters.map(c => ({ name: c.name, family: c.family, expression: c.expression })) });
        const proposals: Character[] = (result.characters ?? []).map((x: Concept) => makeChar(String(x.name || ''), 'ai', String(x.description || ''), String(x.family || ''), String(x.expression || ''), x));
        const added = selectDiverseConcepts(proposals, working.characters, target, target - working.characters.length, normalizeCreativeControls(working.creativeControls).characterVariation);
        if (!added.length && ++emptyRounds >= 2) break;
        if (added.length) emptyRounds = 0;
        if (added.length) { working = { ...working, characters: [...working.characters, ...added] }; setProject(working); setAnalysisProgress({ done: working.characters.length, total: target }); }
      }
      await api({ action: 'save', id: working.id, name: working.name, data: working });
      setProjects(prev => [working, ...prev.filter(p => p.id !== working.id)]);
      setMessage(`${working.characters.length}/${target} subjects ready: ${observedCount} identified from listing evidence, ${working.characters.length - observedCount} original AI proposals. ${working.characters.length < target ? 'Some suggestions were duplicates; use AI fill to complete the target.' : 'Collection saved.'}`);
      setTab('characters');
    } catch (e) {
      let savedPartial = false;
      if (working !== project && working.characters.length) {
        try { await api({ action: 'save', id: working.id, name: working.name, data: working }); setProjects(prev => [working, ...prev.filter(p => p.id !== working.id)]); savedPartial = true; } catch { /* Keep editable state even if persistence fails. */ }
      }
      setMessage(`Analysis/expansion stopped at ${working.characters.length}/${target}: ${e instanceof Error ? e.message : 'Request failed'}. ${savedPartial ? 'Partial results saved; use AI fill to continue.' : 'Check your API settings and save the collection before leaving.'}`);
    } finally { setBusy(''); }
  };
  // Keep the UI interactive; poll only the remote response status, then import
  // the server-owned collection once. Works after refresh/relaunch as well.
  useEffect(() => {
    if (!loadDone || !hasActiveResearch(project.researchJob)) return;
    const projectId = project.id, jobId = project.researchJob!.id;
    let closed = false, polling = false;
    const pollResearch = async () => {
      if (closed || polling) return;
      polling = true;
      try {
        const response = await fetch('/api/research-jobs?projectId=' + encodeURIComponent(projectId));
        const result = await response.json() as { error?: string; job?: ResearchJobPreview; project?: Project };
        if (!response.ok) throw new Error(result.error || 'Could not refresh research status');
        if (closed || !result.job || result.job.id !== jobId) return;
        if (result.project && result.job.status === 'completed') {
          const editor = latestWorkspace.current;
          const hasLocalEdits = editor.project.id === projectId &&
            collectionHasUnsavedEdits(editor.project, savedProjectSnapshots.current.get(projectId));
          if (!hasLocalEdits) {
            savedProjectSnapshots.current.set(projectId, JSON.stringify(result.project));
            projectSnapshots.current.set(projectId, result.project);
            setProjects(previous => [result.project!, ...previous.filter(p => p.id !== projectId)]);
            setProject(previous => previous.id === projectId ? result.project! : previous);
          }
          setAnalysisProgress({ done: result.job.completedCount, total: result.job.target });
          setMessage('Background research and Style DNA merge completed: ' + result.job.completedCount + '/' + result.job.target + ' subjects saved. Full Automation will open AI Prompts after any missing subjects are filled.');
        } else {
          setProject(previous => {
            if (previous.id !== projectId || previous.researchJob?.id !== jobId) return previous;
            const updated = { ...previous, researchJob: result.job };
            if (!collectionHasUnsavedEdits(previous, savedProjectSnapshots.current.get(projectId)))
              savedProjectSnapshots.current.set(projectId, JSON.stringify(updated));
            return updated;
          });
          if (result.job.status === 'failed') setMessage('Background research needs attention: ' + (result.job.error || 'Unknown AI error') + '. Inspect API usage before retrying.');
        }
      } catch (error) {
        if (!closed) setMessage('Research status temporarily unavailable: ' + (error instanceof Error ? error.message : String(error)) + '. Job remains saved; it will be checked again.');
      } finally { polling = false; }
    };
    void pollResearch();
    const interval = window.setInterval(() => void pollResearch(), 8000);
    return () => { closed = true; window.clearInterval(interval); };
  }, [loadDone, project.id, project.researchJob?.id, project.researchJob?.status]);
  useEffect(() => {
    if (!loadDone || !hasActivePromptJob(project.promptJob)) return;
    const projectId = project.id, jobId = project.promptJob!.id;
    let closed = false, polling = false;
    const pollPrompts = async () => {
      if (closed || polling || !canPollBackend('prompts')) return;
      polling = true;
      try {
        const response = await fetch('/api/prompt-jobs?projectId=' + encodeURIComponent(projectId));
        const result = await response.json() as { error?: string; job?: PromptJobPreview; project?: Project };
        if (!response.ok) throw Error(result.error || 'Could not retrieve OpenAI prompt batch status');
        noteBackendPollHealthy('prompts');
        if (closed || !result.job || result.job.id !== jobId) return;
        if (result.project) {
          // Progressive groups are imported independently. Show saved prompts
          // immediately even while the remaining Batch receipts are active.
          const editor = latestWorkspace.current;
          const hasLocalEdits = editor.project.id === projectId &&
            collectionHasUnsavedEdits(editor.project, savedProjectSnapshots.current.get(projectId));
          if (!hasLocalEdits) {
            savedProjectSnapshots.current.set(projectId, JSON.stringify(result.project));
            projectSnapshots.current.set(projectId, result.project);
            setProjects(previous => [result.project!, ...previous.filter(p => p.id !== projectId)]);
            setProject(previous => previous.id === projectId ? result.project! : previous);
          }
          if (!hasActivePromptJob(result.job)) setMessage(result.job.status === 'completed'
            ? 'OpenAI prompt jobs finished. ' + result.job.imported + ' prompts saved.'
            : 'OpenAI prompt jobs finished with ' + result.job.imported + ' imported prompts. Review failed groups before retrying.');
        } else {
          setProject(previous => previous.id === projectId && previous.promptJob?.id === jobId
            ? { ...previous, promptJob: result.job } : previous);
          if (result.job.status === 'failed' || result.job.status === 'expired' || result.job.status === 'cancelled')
            setMessage('OpenAI prompt Batch ended: ' + (result.job.error || result.job.status) + '. Review before retrying to avoid duplicate charges.');
        }
      } catch (error) {
        if (!closed && !noteBackendPollError('prompts',error)) setMessage('Prompt batch status temporarily unavailable: ' + (error instanceof Error ? error.message : String(error)) + '. The saved job will be checked again.');
      } finally { polling = false; }
    };
    void pollPrompts();
    const interval = window.setInterval(() => void pollPrompts(), 10000);
    return () => { closed = true; window.clearInterval(interval); };
  }, [loadDone, project.id, project.promptJob?.id, project.promptJob?.status]);
  // Persisted Full Automation controller: the worker advances one bounded
  // stage at a time. OpenAI background jobs run remotely, and this controller
  // resumes automatically on relaunch or while Electron is hidden in the tray.
  useEffect(() => {
    if (!loadDone || !project.fullAutomation?.enabled ||
        ['completed','paused'].includes(project.fullAutomation.stage)) return;
    const id = project.id;
    let stopped = false, running = false;
    const step = async () => {
      if (stopped || running || !canPollBackend('automation')) return;
      running = true;
      try {
        const response = await fetch('/api/full-automation', { method: 'POST',
          headers: { 'Content-Type':'application/json' },
          body: JSON.stringify({ action:'tick', projectId:id }) });
        const status = await response.json() as { error?: string; flow?: FullAutomation };
        if (!response.ok) throw Error(status.error || 'Automation status check failed');
        if (stopped) return;
        const row = await fetch('/api/studio?projectId=' + encodeURIComponent(id), { cache:'no-store' });
        if (!row.ok) throw Error('Unable to load the saved automated collection');
        const stored = await row.json() as Array<{ id:string; data:Project }>;
        const updated = stored.find(entry => entry.id === id)?.data;
        if (!updated || stopped) return;
        noteBackendPollHealthy('automation');
        // Follow stage transitions only for the active collection, while the
        // user is watching the previous stage and has no unsaved editor data.
        // A manual tab switch suspends following until their tab again matches
        // the current workflow stage. Do not navigate off thumbnail edits.
        const view = latestWorkspace.current;
        const oldStage = view.project.fullAutomation?.stage;
        const newStage = updated.fullAutomation?.stage;
        const fromTab = automationStageTab(oldStage);
        const toTab = automationStageTab(newStage);
        const clean = !collectionHasUnsavedEdits(view.project, savedProjectSnapshots.current.get(id));
        if (clean) savedProjectSnapshots.current.set(id, JSON.stringify(updated));
        if (autoFollowRef.current && view.project.id === id && clean &&
            oldStage !== newStage && fromTab && toTab && fromTab !== toTab &&
            view.tab === fromTab && isStudioTabEnabled(toTab) &&
            !thumbnailSaveControlsRef.current?.hasUnsaved()) {
          setTab(toTab);
        }
        if (clean) {
          setProjects(previous => [updated, ...previous.filter(p => p.id !== id)]);
          setProject(previous => previous.id === id ? updated : previous);
        } else {
          // Keep the locally edited collection. Server processing continues,
          // but never silently replaces unsaved names, characters or designs.
          setProjects(previous => previous.map(p => p.id === id ? view.project : p));
        }
        if (updated.fullAutomation?.stage === 'paused')
          setMessage('Full Automation paused: ' + (updated.fullAutomation.lastError || 'Manual review required') + '. Check Batch activity before resuming.');
        else if (updated.fullAutomation?.stage === 'completed')
          setMessage('Full Automation complete: images verified and Etsy Listing Draft saved. Review the listing before publishing.');
      } catch (error) {
        if (!stopped && !noteBackendPollError('automation',error)) setMessage('Full Automation status unavailable; saved progress remains intact: ' +
          (error instanceof Error ? error.message : String(error)));
      } finally { running = false; }
    };
    void step();
    const timer = window.setInterval(() => void step(), 12000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [loadDone, project.id, project.fullAutomation?.enabled, project.fullAutomation?.stage]);
  // Keep all OTHER active collections advancing while this window is open.
  // The current collection has its own tab-following controller above. The
  // desktop tray also runs this same syncAll endpoint when the window is
  // hidden. The server leases each collection to prevent duplicate paid work.
  useEffect(() => {
    if (!loadDone) return;
    let stopped=false, running=false;
    const tickOtherCollections=async()=>{
      if (stopped || running) return;
      const view=latestWorkspace.current;
      const otherActive=view.projects.filter(p=>p.id!==view.project.id &&
        p.fullAutomation?.enabled &&
        !['paused','completed'].includes(p.fullAutomation.stage));
      if (!otherActive.length) return;
      running=true;
      try {
        const response=await fetch('/api/full-automation',{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({action:'tick',syncAll:true}),
        });
        if (!response.ok || stopped) return;
        const rows=await fetch('/api/studio',{cache:'no-store'});
        if (!rows.ok || stopped) return;
        const list=await rows.json() as Array<{id:string;data:Project}>;
        const fresh=new Map(list.map(item=>[item.id,item.data]));
        if (stopped) return;
        setProjects(previous=>previous.map(old=>{
          if (old.id===latestWorkspace.current.project.id || !old.fullAutomation?.enabled)
            return old; // Never overwrite the active editor or unrelated drafts.
          const stored=fresh.get(old.id);
          if (!stored) return old;
          if (collectionHasUnsavedEdits(old,savedProjectSnapshots.current.get(old.id)))
            return old; // Another collection has unsaved local changes.
          savedProjectSnapshots.current.set(old.id,JSON.stringify(stored));
          projectSnapshots.current.set(old.id,stored);
          return stored;
        }));
      } catch { /* Transient offline state: resume the next poll. */ }
      finally { running=false; }
    };
    void tickOtherCollections();
    const interval=window.setInterval(()=>void tickOtherCollections(),15000);
    return ()=>{stopped=true;window.clearInterval(interval);};
  },[loadDone,activeStoreId]);
  // A browser snapshot can lag behind the server's durable Full Automation
  // state. Always reconcile it before allowing a new paid research submission.
  const refreshAutomationStatus = async (projectId: string): Promise<FullAutomation | null> => {
    const response = await fetch('/api/full-automation?projectId=' + encodeURIComponent(projectId),
      { cache: 'no-store' });
    const state = await response.json() as { error?: string; flow?: FullAutomation | null; canRestartMissingResearch?: boolean; canRetryRejectedResearch?: boolean; researchRecovery?: {state:string;message:string}|null; researchJobStatus?:string; researchJobError?:string|null };
    if (!response.ok) throw Error(state.error || 'Unable to check saved Full Automation status');
    const flow = state.flow ?? null;
    setCanRestartMissingResearch(Boolean(state.canRestartMissingResearch));
    setCanRetryRejectedResearch(Boolean(state.canRetryRejectedResearch));
    setResearchRecovery(state.researchRecovery ?? null);
    setSavedResearchStatus(state.researchJobStatus || 'unknown');
    setSavedResearchError(state.researchJobError || null);
    setProject(prev => prev.id === projectId ? { ...prev, fullAutomation: flow ?? undefined } : prev);
    setProjects(prev => prev.map(item => item.id === projectId
      ? { ...item, fullAutomation: flow ?? undefined } : item));
    return flow;
  };
  useEffect(() => {
    if (!loadDone || tab !== 'analysis') return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/full-automation?projectId=' + encodeURIComponent(project.id),
          { cache: 'no-store' });
        const state = await response.json() as { flow?: FullAutomation | null; canRestartMissingResearch?: boolean; canRetryRejectedResearch?: boolean; researchRecovery?: {state:string;message:string}|null; researchJobStatus?:string; researchJobError?:string|null };
        if (!response.ok || cancelled) return;
        const flow = state.flow ?? null;
        setCanRestartMissingResearch(Boolean(state.canRestartMissingResearch));
        setCanRetryRejectedResearch(Boolean(state.canRetryRejectedResearch));
        setResearchRecovery(state.researchRecovery ?? null);
        setSavedResearchStatus(state.researchJobStatus || 'unknown');
        setSavedResearchError(state.researchJobError || null);
        setProject(prev => prev.id === project.id ? { ...prev, fullAutomation: flow ?? undefined } : prev);
        setProjects(prev => prev.map(item => item.id === project.id
          ? { ...item, fullAutomation: flow ?? undefined } : item));
      } catch { /* Keep the editor usable; start still checks server state. */ }
    })();
    return () => { cancelled = true; };
  }, [loadDone, tab, project.id]);

  const recoverMissingResearch = async () => {
    if (busy || !canRestartMissingResearch || !project.fullAutomation) return;
    setBusy('research-start');
    setMessage('Checking that no research was submitted before starting the missing job…');
    try {
      // The server rejects this recovery if ANY research job record exists,
      // including uncertain submissions. Never overwrite that paid receipt.
      const rearm = await fetch('/api/full-automation', { method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({action:'restart-missing-research', projectId:project.id}) });
      const armed = await rearm.json() as {error?:string;flow?:FullAutomation};
      if (!rearm.ok || !armed.flow) throw Error(armed.error || 'Research recovery unavailable');
      setCanRestartMissingResearch(false);
      setProject(prev => prev.id === project.id ? {...prev,fullAutomation:armed.flow} : prev);
      setProjects(prev => prev.map(x => x.id === project.id ? {...x,fullAutomation:armed.flow} : x));
      const res = await fetch('/api/research-jobs', {method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({projectId:project.id, url:project.url,
          selectedImages:project.selectedImageUrls ?? project.images,
          target:armed.flow.target,model:armed.flow.textModel || project.researchModel || preferences.analysisModel})});
      const data = await res.json() as {error?:string;job?:ResearchJobPreview};
      if (!res.ok || !data.job) throw Error(data.error || 'Research submission not confirmed');
      setProject(prev => prev.id === project.id ? {...prev,researchJob:data.job} : prev);
      setProjects(prev => prev.map(x => x.id === project.id ? {...x,researchJob:data.job} : x));
      setMessage('Missing research job accepted. Full Automation will continue when PaletteIQ is running.');
    } catch (error) {
      setMessage('Research recovery could not confirm submission: ' +
        (error instanceof Error ? error.message : String(error)) +
        '. Check saved research status and OpenAI usage before retrying.');
      try { await refreshAutomationStatus(project.id); } catch { /* Keep the error visible. */ }
    } finally { setBusy(''); }
  };
  const retryRejectedResearch = async () => {
    if (busy || !canRetryRejectedResearch || !project.fullAutomation) return;
    const selectedImages = project.selectedImageUrls ?? project.images;
    if (!selectedImages?.length) {
      setMessage('Select the Etsy reference images you want to analyze before retrying.');
      return;
    }
    if (!window.confirm('Retry Background Research with exactly ' + selectedImages.length +
      ' selected Etsy images? This sends a NEW potentially billable OpenAI request. Check existing OpenAI activity before continuing.')) return;
    setBusy('research-start');
    setMessage('Preparing ' + selectedImages.length + ' selected Etsy reference images for a new OpenAI background request…');
    try {
      // The server only accepts retries for a definite 400 URL-download
      // rejection without any OpenAI response ID. This is a user action.
      const response = await fetch('/api/research-jobs', { method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body:JSON.stringify({ projectId:project.id, url:project.url,
          selectedImages,
          target:project.fullAutomation.target,
          model:project.fullAutomation?.textModel || project.researchJob?.model || project.researchModel || preferences.analysisModel,
          retryFailed:true }) });
      const data = await response.json() as {error?:string;job?:ResearchJobPreview};
      if (!response.ok || !data.job) throw Error(data.error || 'Research retry not confirmed');
      setProject(prev => prev.id === project.id ? {...prev,researchJob:data.job} : prev);
      setProjects(prev => prev.map(x => x.id === project.id ? {...x,researchJob:data.job} : x));
      // Research is now durably tracked; resume the existing workflow, not
      // a second one. If this fails, the saved job can still be recovered.
      const resume = await fetch('/api/full-automation', {method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'resume',projectId:project.id})});
      const resumed = await resume.json() as {error?:string;flow?:FullAutomation};
      if (!resume.ok || !resumed.flow) throw Error('Research job accepted, but automation could not resume: ' + (resumed.error || 'unknown error'));
      setProject(prev => prev.id === project.id ? {...prev,fullAutomation:resumed.flow} : prev);
      setProjects(prev => prev.map(x => x.id === project.id ? {...x,fullAutomation:resumed.flow} : x));
      setCanRetryRejectedResearch(false);
      setMessage('Research submitted with embedded Etsy image data. Full Automation resumed; do not submit the job again.');
    } catch (error) {
      setMessage('Research recovery: ' + (error instanceof Error ? error.message : String(error)) +
        '. Check saved research and OpenAI usage before retrying.');
      try { await refreshAutomationStatus(project.id); } catch { /* Keep failure visible. */ }
    } finally { setBusy(''); }
  };
  const changeAutomation = async (action: 'pause' | 'resume') => {
    setBusy('automation');
    try {
      const response = await fetch('/api/full-automation', { method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ action, projectId:project.id }) });
      const result = await response.json() as { error?: string; flow?: FullAutomation };
      if (!response.ok || !result.flow) throw Error(result.error || 'Full Automation could not change state');
      setProject(prev => ({ ...prev, fullAutomation: result.flow }));
      setProjects(prev => prev.map(p => p.id === project.id ? { ...p, fullAutomation: result.flow } : p));
      setMessage(action === 'resume' ? 'Full Automation resumed. Previously accepted OpenAI batches will be checked before new submissions.' : 'Full Automation paused; existing OpenAI jobs continue remotely.');
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(''); }
  };
  const expand = async () => {
    if (busy) return;
    if (project.characters.length >= target) { setMessage('Target already reached.'); return; }
    setBusy('expand');
    let current = project, emptyRounds = 0, retries = 0;
    try {
      while (current.characters.length < target && retries++ < Math.ceil(target / 10) + 10) {
        const res = await api({ action: 'expand', count: Math.min(20, target - current.characters.length),
          target, title: current.title || current.name, analysis: creativeContext(current),
          images: current.selectedImageUrls ?? current.images,
          existing: current.characters.map(c => ({ name: c.name, family: c.family, expression: c.expression })) });
        const proposals = (res.characters ?? []).map((v: Concept) =>
          makeChar(String(v.name || ''), 'ai', String(v.description || ''), String(v.family || ''), String(v.expression || ''), v));
        const batch = selectDiverseConcepts(proposals, current.characters, target, target - current.characters.length, normalizeCreativeControls(current.creativeControls).characterVariation);
        if (!batch.length && ++emptyRounds >= 2) break;
        if (batch.length) emptyRounds = 0;
        current = { ...current, characters: [...current.characters, ...batch] };
        setProject(current);
      }
      setMessage(`Expanded to ${current.characters.length}/${target} diverse subjects across ${Object.keys(familyDistribution(current.characters)).length} families. Save your collection.`);
    } catch (e) {
      setMessage(`Expansion interrupted at ${current.characters.length}/${target}: ${String(e)}`);
    } finally { setBusy(''); }
  };
  const generatePrompts = async (ids?: string[]) => {
    if (busy || hasActivePromptJob(project.promptJob) || lockedPromptModel) return;
    const scope = project.characters.filter(c => ids ? ids.includes(c.id) : (!selected.length || selected.includes(c.id)));
    if (!scope.length) { setMessage('Add characters before generating prompts.'); return; }
    const ungenerated = scope.filter(c => !c.prompt.trim());
    let chosen = ungenerated;
    if (!ungenerated.length && !ids?.length) {
      if (!window.confirm(`All ${scope.length} selected character prompts are already filled. Regenerate them with AI? Existing prompts will be replaced and API charges may apply.`)) return;
      chosen = scope;
    } else if (ids?.length && scope.length === 1 && scope[0].prompt.trim()) {
      // Per-card regeneration is confirmed by the explicit button label.
      chosen = scope;
    }
    const quantity = normalizeCreativeControls(project.creativeControls).promptQuantity;
    if (quantity > 0) chosen = chosen.slice(0, quantity);
    if (!chosen.length) { setMessage('All selected characters already have prompts.'); return; }
    if (promptProvider === 'openai') {
      if (chosen.length > 200) {
        setMessage('Select at most 200 characters for one OpenAI background prompt Batch, then submit another Batch for the remainder.');
        return;
      }
      setBusy('prompt-start'); setMessage('Saving collection and submitting the prompt Batch to OpenAI…');
      try {
        await api({ action: 'save', id: project.id, name: project.name, data: project });
        const request = await fetch('/api/prompt-jobs', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: project.id, characterIds: chosen.map(c => c.id),
            regenerate: chosen.some(c => !!c.prompt.trim()), model: promptModel,
            progressive:project.progressivePrompts===true }),
        });
        const result = await request.json() as { error?: string; job?: PromptJobPreview };
        if (!request.ok || !result.job) throw Error(result.error || 'OpenAI Batch submission failed');
        const snapshot = { ...project, promptJob: result.job };
        setProject(snapshot);
        setProjects(previous => [snapshot, ...previous.filter(p => p.id !== snapshot.id)]);
        savedProjectSnapshots.current.set(project.id, JSON.stringify(snapshot));
        setMessage(project.progressivePrompts ? 'Progressive Prompt Batches accepted: finished groups will appear as soon as their results are available. Do not submit this job again.' : 'OpenAI accepted the prompt Batch. Completed prompts will be imported after the remote Batch ends. Do not resubmit the same job.');
      } catch (error) {
        setMessage('Could not start prompt Batch: ' + (error instanceof Error ? error.message : String(error)) + '. Check the saved job before retrying to avoid duplicate charges.');
      } finally { setBusy(''); }
      return;
    }
    // Gemini remains foreground. Use small groups to reduce truncation. Preserve
    // valid prompts even when one response omits a subject, and checkpoint each
    // group before moving to the next; a lost tab does not discard paid work.
    setBusy('prompts'); setPromptProgress({ done: 0, total: chosen.length }); setMessage('');
    let completed = 0;
    let current = project;
    try {
      const foregroundGroupSize = 5;
      for (let i = 0; i < chosen.length; i += foregroundGroupSize) {
        const group = chosen.slice(i, i + foregroundGroupSize);
        const result = await api({ action: 'generate-prompts', promptProvider, promptModel,
          title: current.title || current.name, analysis: creativeContext(current), characters: group });
        const allowed = new Set(group.map(c => c.id));
        const generated = new Map<string, string>((result.prompts || [])
          .filter(p => allowed.has(p.id) && typeof p.prompt === 'string' && p.prompt.trim().length > 60)
          .map(p => [p.id, p.prompt]));
        if (generated.size) {
          current = { ...current, characters: current.characters.map(c => generated.has(c.id)
            ? { ...c, prompt: generated.get(c.id)!, status: c.status === 'done' ? 'done' as const : 'ready' as const }
            : c) };
          setProject(current);
          // Persist only accepted IDs; no redraw or re-generation is needed for
          // previously saved prompts after a failed or partial response.
          await api({ action: 'save', id: current.id, name: current.name, data: current });
          setProjects(previous => [current, ...previous.filter(p => p.id !== current.id)]);
          completed += generated.size;
        }
        setPromptProgress({ done: completed, total: chosen.length });
      }
      setMessage(completed === chosen.length
        ? `${completed} prompts generated and saved with Gemini. Review your collection.`
        : `${completed}/${chosen.length} prompts generated and saved. ${chosen.length - completed} missing or invalid; use Generate again to retry only characters without prompts.`);
    } catch (error) {
      setMessage(`${completed}/${chosen.length} prompts generated and saved. ${error instanceof Error ? error.message : 'AI request failed'} Review the current collection, save any unsaved edits, then retry only characters without prompts.`);
    } finally { setBusy(''); }
  };
  const conceptAudit = auditCreativeConcepts(project.characters, normalizeCreativeAnalysis(project.research).styleDNA);
  const filtered = useMemo(() => project.characters.filter(c => `${c.name} ${c.description} ${c.expression || ''} ${c.family || ''} ${c.shape || ''} ${c.silhouette || ''} ${c.accessories || ''}`.toLowerCase().includes(query.toLowerCase())), [project.characters, query]);
  const libraryPages = Math.max(1, Math.ceil(filtered.length / libraryPageSize));
  const currentLibraryPage = Math.min(libraryPage, libraryPages);
  const pagedCharacters = filtered.slice((currentLibraryPage - 1) * libraryPageSize, currentLibraryPage * libraryPageSize);
  const countDone = project.characters.filter(c => c.status === 'done').length;
  const countReady = project.characters.filter(c => c.prompt).length;

  const creativeControls = normalizeCreativeControls(project.creativeControls);
  const researchEmotion=normalizeCreativeAnalysis(project.research).emotionProfile;
  const detectedReferenceMood=referenceMoodFromExpressions([
    ...researchEmotion.observedExpressions,
    ...normalizeCreativeAnalysis(project.research).imageObservations.flatMap(o=>o.expressions),
  ]);
  const referenceMood=detectedReferenceMood.mood || researchEmotion.referenceMood;
  const moodEvidence=researchEmotion.moodEvidence || detectedReferenceMood.evidence;
  const moodConfidence=researchEmotion.moodConfidence || detectedReferenceMood.confidence;
  const moodPresets=['joyful, cheerful and playful','happy and sweet','curious and excited',
    'gentle, calm and content','sleepy and peaceful','sad and tender','grumpy and angry'];
  const selectedMood=project.emotionDirection ?? researchEmotion.dominantMood;
  const creativeControlsEditor = <div style={{marginTop:18}}>
    <h3>Creative production controls</h3>
    <p className="sub">1–5: lower = subtle, higher = stronger. All prompts still follow the actual image references. Prompt Quantity: 0 = all eligible/selected characters.</p>
    <div className="settings-fields">
      {([
        ['Style Consistency','styleConsistency','Lock reference Style DNA across every asset',1,5],
        ['Character Variation','characterVariation','Encourage distinct categories, silhouettes and expressions',1,5],
        ['Texture Control','textureControl','Specify the observed material and surface finish',1,5],
        ['Detail Quality','detailQuality','Increase precision of edges, lighting and fine details',1,5],
        ['Prompt Quantity','promptQuantity','0 = all; otherwise limit the next prompt run',0,1000],
      ] as const).map(([label,key,help,min,max]) => <div key={key}>
        <label className="input-label">{label.toUpperCase()}</label>
        <input type="number" min={min} max={max} aria-label={label}
          value={creativeControls[key]} onChange={e => update({ creativeControls: {
            ...creativeControls, [key]: Math.max(min, Math.min(max, Number(e.target.value) || min)),
          } })}/>
        <p className="sub">{help}</p>
      </div>)}
    </div>
  </div>;
  const foundCollections = useMemo(() => {
    const needle = collectionQuery.trim().toLocaleLowerCase();
    const matches = projects.filter(p => !needle || [p.name, p.theme, p.subtheme, p.url].some(v => (v || '').toLocaleLowerCase().includes(needle)));
    if (collectionSort === 'name') return [...matches].sort((a, b) => a.name.localeCompare(b.name));
    if (collectionSort === 'subjects') return [...matches].sort((a, b) => b.characters.length - a.characters.length);
    return matches;
  }, [projects, collectionQuery, collectionSort]);
  const nav = [{ id: 'overview', label: 'Overview', icon: BarChart3 }, { id: 'collections', label: 'Collections', icon: Layers3 }, { id: 'multi-production', label: 'Multi-Collection Production', icon: ImageIcon }, { id: 'stores', label: 'Stores', icon: Store }, { id: 'settings', label: 'Settings', icon: Settings2 }];
  const canSwitchCollection = () => {
    const current = latestWorkspace.current;
    const thumbnailDirty = current.tab === 'thumbnails' && !!thumbnailSaveControlsRef.current?.hasUnsaved();
    const collectionDirty = collectionHasUnsavedEdits(current.project, savedProjectSnapshots.current.get(current.project.id));
    return !(thumbnailDirty || collectionDirty) || window.confirm('The current collection has unsaved changes. Switch collections? Your edits remain in this tab session; save before a browser reload.');
  };
  const openCollection = (p: Project) => { if (p.id !== project.id && !canSwitchCollection()) return; setLibraryPage(1); setProject(p); setSourceUrl(p.url); setSelected([]); setMessage(''); setTab(p.fullAutomation?.enabled ? (automationStageTab(p.fullAutomation.stage) || nextIncomplete(p)) : nextIncomplete(p)); };
  const openCollectionPrompts = (id: string) => { const target = projects.find(p => p.id === id); if (!target) { setMessage('Collection not found. Refresh collections and retry.'); return; } if (target.id !== project.id && !canSwitchCollection()) return; setLibraryPage(1); setProject(target); setSourceUrl(target.url); setSelected([]); setMessage('Generate the missing image prompts below, then save the collection.'); setTab(target.characters.length ? 'prompts' : 'characters'); };
  const createCollection = () => { if (!canSwitchCollection()) return; const p = { ...blank(), characterTarget: preferences.target, researchModel: preferences.analysisModel }; setLibraryPage(1); setProject(p); setSourceUrl(''); setSelected([]); setTab('analysis'); };
  const advance = async () => {
    if (busy) return;
    setBusy('save');
    try {
      if (tab === 'thumbnails') {
        if (!thumbnailSaveControlsRef.current) throw new Error('Thumbnail editor is not ready. Retry after it finishes loading.');
        await thumbnailSaveControlsRef.current.save();
      } else {
        await api({ action: 'save', id: project.id, name: project.name, data: project });
        setProjects(prev => [project, ...prev.filter(p => p.id !== project.id)]);
      }
      savedProjectSnapshots.current.set(project.id, JSON.stringify(project));
      setTab(steps[stepIndex + 1]?.id || 'collections');
      setMessage('Progress saved. Continue with the next step.');
    }
    catch (error) { setMessage(`Could not save before continuing: ${error instanceof Error ? error.message : 'Unknown error'}`); }
    finally { setBusy(''); }
  };
  const stepIndex = steps.findIndex(s => s.id === tab);
  const title = nav.find(n => n.id === tab)?.label || steps.find(s => s.id === tab)?.label || tab;

  return <div className={`studio-shell ${sidebarCollapsed ? "sidebar-is-collapsed" : ""}`}>
    <aside className="sidebar"><button type="button" className="sidebar-toggle" onClick={toggleSidebar} aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>{sidebarCollapsed ? <PanelLeftOpen size={18}/> : <PanelLeftClose size={18}/>}</button><div className="brand"><div className="brand-icon" style={{ background: "transparent", boxShadow: "none" }}><Image src="/paletteiq-icon.svg" width={39} height={39} alt="PaletteIQ icon" unoptimized/></div><div><strong>palette<span>IQ</span></strong><small>CLIPART INTELLIGENCE</small></div></div><div className="side-caption">WORKSPACE</div><nav>{nav.map(n => <button key={n.id} className={tab === n.id ? 'active' : ''} onClick={() => navigateTab(n.id)}><n.icon size={18}/><span className="sidebar-nav-label">{n.label}</span>{tab === n.id && <span className="nav-active-dot"/>}</button>)}</nav><div className="side-foot"><div className="account-avatar">D</div><div><b>My creative workspace</b><small>Private studio</small></div><Settings2 size={16}/></div></aside>
    <main className="main"><header className="topbar">
      <div className="workspace-history-controls" role="group" aria-label="Workspace navigation">
        <span className="workspace-history-tip" data-tooltip="Go Back · Alt + ←" title="Go Back (Alt + Left Arrow)">
          <button type="button" className="outline-btn" aria-label="Go back" aria-keyshortcuts="Alt+ArrowLeft" disabled={historyPosition.index === 0} onClick={historyBack}><ArrowLeft size={16}/></button>
        </span>
        <span className="workspace-history-tip" data-tooltip="Go Forward · Alt + →" title="Go Forward (Alt + Right Arrow)">
          <button type="button" className="outline-btn" aria-label="Go forward" aria-keyshortcuts="Alt+ArrowRight" disabled={historyPosition.index >= historyPosition.max} onClick={historyForward}><ArrowRight size={16}/></button>
        </span>
        <span className="workspace-history-tip" data-tooltip="Refresh · Ctrl/⌘ + R or F5" title="Refresh (Ctrl+R / Cmd+R / F5)">
          <button type="button" className="outline-btn" aria-label="Refresh page" aria-keyshortcuts="Control+R Meta+R F5" onClick={historyRefresh}><RefreshCw size={16}/></button>
        </span>
      </div><div className="crumb"><button className="breadcrumb-button" onClick={() => navigateTab('collections')}>Collections</button> <span>/</span> <b>{stepIndex >= 0 ? `${project.name} / ${title}` : title}</b></div><div className="top-actions"><StoreSwitcher/>{stepIndex >= 0 && <button className="save-btn" onClick={() => save()} disabled={!!busy}><Check size={16}/> {busy === 'save' ? 'Saving...' : 'Save collection'}</button>}</div></header>
      <div className="content"><div className="page-head"><div><div className="eyebrow"><Sparkles size={13}/> AI-POWERED CREATIVE PRODUCTION {stepIndex >= 0 && <span> / {title}</span>}</div><h1>{stepIndex >= 0 ? project.name : tab === 'overview' ? 'Your creative command center' : title}</h1><p>{tab === 'overview' ? 'From market insight to an original, production-ready clipart collection.' : tab === 'collections' ? 'Find a saved collection and resume its production pipeline.' : tab === 'stores' ? 'Manage Etsy stores, rename them, or safely delete a store after making a recovery archive.' : tab === 'analysis' ? 'Turn an Etsy listing into structured, actionable creative intelligence.' : tab === 'characters' ? 'Build, refine and organize 120+ subjects.' : tab === 'prompts' ? 'Generate unique prompts with OpenAI for each character.' : tab === 'thumbnails' ? 'Arrange original clipart freely (including beyond canvas edges), reuse Etsy SEO defaults, and optionally generate expressive AI lettering.' : tab === 'listing-images' ? 'Generate 15 Etsy listing images from original collection PNGs; review and approve each one.' : 'Continue preparing your clipart product.'}</p></div>{stepIndex >= 0 && <div className="head-buttons"><button className="outline-btn" onClick={() => { const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${project.name.replace(/[^\w-]/g,'_')}.json`; a.click(); URL.revokeObjectURL(a.href); }}><Download size={16}/> Export JSON</button></div>}</div>
      {duplicateListing && <div role="alertdialog" aria-label="Previously used Etsy reference" style={{ position: 'fixed', right: 24, top: 88, zIndex: 1000, width: 'min(420px, calc(100vw - 48px))', padding: 18, borderRadius: 14, border: '1px solid #ffc69e', background: '#fff9f3', color: '#53260e', boxShadow: '0 12px 40px #0002' }}><strong>Reference Etsy ini sudah pernah digunakan</strong><p style={{ marginTop: 8, marginBottom: 8 }}>Digunakan dalam collection: {duplicateListing.collections.join(', ')}. Anda tetap bisa memakai URL yang sama untuk collection baru.</p><div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><button type="button" className="outline-btn" onClick={() => setDuplicateListing(null)}>Batal</button><button type="button" className="primary-btn" onClick={() => { setSourceUrl(duplicateListing.url); void loadListingImages(true); }}>Tetap gunakan</button></div></div>}
      {!!backendConnectionWarning && <div className="notice" role="status"><CircleHelp size={17}/><span>{backendConnectionWarning}</span><button type="button" onClick={async()=>{
        networkPollFailures.current.clear();
        try{
          const response=await fetch('/api/studio',{cache:'no-store'});
          if(!response.ok)throw Error('Local server HTTP '+response.status);
          setBackendConnectionWarning('');
        }catch{
          setBackendConnectionWarning('PaletteIQ local server still unreachable. OpenAI Batch jobs remain saved; status checks will retry automatically. Do not submit another paid job.');
        }
      }}>Check connection</button></div>}
      {!!message && <div className="notice"><CircleHelp size={17}/><span>{message}</span><button onClick={() => setMessage('')}><X size={16}/></button></div>}
      {project.fullAutomation?.enabled && <section className="panel analysis-progress" aria-live="polite">
        <div className="production-progress"><span><Sparkles size={16}/> Full Automation · {project.fullAutomation.stage.replaceAll('_',' ')}</span><b>{project.characters.filter(c=>c.imageUrl).length} images / {project.fullAutomation.target} target</b></div>
        <p className="sub">Characters {project.characters.length}/{project.fullAutomation.target} · Prompts {project.characters.filter(c=>c.prompt.trim()).length}/{project.fullAutomation.target} · Similarity-flagged {project.characters.filter(c=>c.similarityReview?.status==='needs_review').length}. Text model: {project.fullAutomation.textModel || project.researchJob?.model || project.researchModel || preferences.analysisModel} · Batch image model: {project.fullAutomation.batchImageModel || preferences.automationImageModel} · Quality: {project.fullAutomation.imageQuality || preferences.quality}. Workflow transitions need PaletteIQ running or hidden in system tray.</p>
        <label className="sub" style={{display:'flex',alignItems:'center',gap:8}}><input type="checkbox" checked={autoFollowAutomation} onChange={e=>updateAutoFollowAutomation(e.target.checked)}/> Auto-follow Full Automation (switch tabs when stages complete)</label>
        {project.fullAutomation.lastError && <p className="sub" role="alert">{project.fullAutomation.lastError}</p>}
        {project.fullAutomation.stage === 'paused' && <p className="sub" role="status">Saved research status: {savedResearchStatus}. {researchRecovery?.message || 'Refresh status to inspect the saved stage and job.'}</p>}
        {project.fullAutomation.stage === 'paused' && savedResearchError && <p className="sub" role="alert">Last research error: {savedResearchError}</p>}
        {project.fullAutomation.stage === 'paused' && <button type="button" className="outline-btn" disabled={!!busy} onClick={() => void refreshAutomationStatus(project.id).then(() => setMessage('Saved Full Automation and Research status refreshed.')).catch(error => setMessage(error instanceof Error ? error.message : String(error)))}>Refresh Full Automation status</button>}
        {project.fullAutomation.stage === 'paused' && project.researchJob?.error && <p className="sub" role="alert">Saved research job error: {project.researchJob.error}</p>}
        {project.fullAutomation.stage === 'paused' && canRestartMissingResearch && <div className="sub" role="status">No background research job is recorded for this workflow. Resuming alone would pause again. Start the missing research only after checking OpenAI activity for any untracked charge.</div>}
        {project.fullAutomation.stage === 'paused' && canRetryRejectedResearch && <button type="button" className="outline-btn" disabled={!!busy} onClick={() => void retryRejectedResearch()}>Retry rejected image research (check OpenAI usage first)</button>}
        {project.fullAutomation.stage === 'paused' && canRestartMissingResearch && <button type="button" className="outline-btn" disabled={!!busy} onClick={() => void recoverMissingResearch()}>Start missing research (check OpenAI usage first)</button>}
        {project.fullAutomation.stage === 'paused' && !canRestartMissingResearch && !canRetryRejectedResearch && <button type="button" className="outline-btn" disabled={!!busy} onClick={() => void changeAutomation('resume')}>Resume Full Automation (review costs/jobs first)</button>}
        {project.fullAutomation.stage !== 'paused' && project.fullAutomation.stage !== 'completed' && <button type="button" className="outline-btn" disabled={!!busy} onClick={() => void changeAutomation('pause')}>Pause automation</button>}
      </section>}
      {hasActiveResearch(project.researchJob) && <section className="panel analysis-progress" aria-live="polite">
        <div className="production-progress"><span><LoaderCircle size={16} className="spin"/> OpenAI research: {project.researchJob?.status === 'submitting' ? 'submitting' : project.researchJob?.status === 'queued' ? 'queued' : 'processing'} (remote)</span>
          <b>{project.researchJob?.completedCount || 0} saved / {project.researchJob?.target} target</b></div>
        {!!project.researchJob?.workerPreviews?.length && <div className="panel" style={{marginTop:12}}><h3>Live Research previews (provisional)</h3><p className="sub">Each completed worker appears immediately. These are candidate ideas, not saved final characters; Merge &amp; Style DNA will reconcile and deduplicate them.</p>{project.researchJob.workerPreviews.map(w=><details key={w.index} open={w.status==='completed'}><summary>Reference group {w.index+1} · {w.imageCount} images · {w.status} · {w.concepts.length} candidate concepts</summary>{w.theme && <p className="sub">Theme: {w.theme} · Style: {w.style}</p>}{w.error && <p className="sub" role="alert">{w.error}</p>}{w.concepts.length>0 && <div className="sub">{w.concepts.map((c,i)=><p key={i}><b>{c.name}</b> {c.family?'('+c.family+')':''} — {c.description}</p>)}</div>}</details>)}</div>}
        {project.researchJob?.workersTotal && <p className="sub">Hybrid Parallel Research: {project.researchJob.workersCompleted || 0}/{project.researchJob.workersTotal} reference groups analyzed · Merge &amp; Style DNA: {project.researchJob.mergeStatus || 'pending'}. After the target characters are saved, Auto-follow opens AI Prompts directly.</p>}
        <p className="sub">New Research jobs use OpenAI Batch API (asynchronous, completion window up to 24 hours). The Batch continues remotely while the PC is closed. PaletteIQ imports completed results when the app resumes. Character counts become available after Merge &amp; Style DNA.</p>
        {project.researchJob && project.researchJob.target > project.researchJob.requested && <p className="sub">The first remote stage is capped at {project.researchJob.requested} subjects. Use AI Fill for the rest after it completes.</p>}
      </section>}
      {busy === 'analyze' && <div className="panel analysis-progress"><div className="production-progress"><span>Analyzing Etsy images and building {target} original subjects with OpenAI…</span><b>{analysisProgress.done}/{analysisProgress.total}</b></div><div className="progress"><i style={{ width: `${analysisProgress.total ? Math.min(100, 100 * analysisProgress.done / analysisProgress.total) : 0}%` }}/></div><p className="sub">Visual research runs first, then AI generates unique additions in small groups. Please keep this page open until the collection is saved.</p></div>}
      {stepIndex >= 0 && <div className="pipeline-nav"><button className="pipeline-back" onClick={() => navigateTab('collections')}>← All collections</button><div className="pipeline-track">{steps.map((s, i) => <button key={s.id} className={`pipeline-step ${i === stepIndex ? 'current' : ''}`} onClick={() => navigateTab(s.id)}><span>{i + 1}</span>{s.label}</button>)}</div></div>}
      {tab === 'collections' && <><div className="panel collections-toolbar"><div className="collection-search"><Search size={17}/><input aria-label="Search collections" placeholder="Search name, theme, subtheme, or Etsy URL..." value={collectionQuery} onChange={e => setCollectionQuery(e.target.value)}/>{collectionQuery && <button onClick={() => setCollectionQuery('')} aria-label="Clear search"><X size={16}/></button>}</div><select className="collection-sort" aria-label="Sort collections" value={collectionSort} onChange={e => setCollectionSort(e.target.value as typeof collectionSort)}><option value="recent">Recently saved</option><option value="name">Name A–Z</option><option value="subjects">Most characters</option></select><button className="primary-btn" onClick={createCollection}><Plus size={16}/> New collection</button></div><p className="collections-count">Showing {foundCollections.length} of {projects.length} collections · {projects.filter(p=>p.fullAutomation?.enabled && !['paused','completed'].includes(p.fullAutomation.stage)).length} Full Automation workflows running concurrently (up to 3 advanced per scheduler cycle)</p><div className="collections-main-grid">{foundCollections.map(p => { const done = p.characters.filter(c => c.status === 'done').length; const next = steps.find(s => s.id === nextIncomplete(p)); return <button className="panel collection-main-card" key={p.id} onClick={() => openCollection(p)}><span className="collection-main-theme">{p.theme || 'Theme not set'}</span><span className={p.lastDownloadedAt ? "collection-downloaded-badge" : "collection-download-untracked"} title={p.lastDownloadedAt ? `Last downloaded: ${new Date(p.lastDownloadedAt).toLocaleString()}` : "Download tracking was not available for earlier ZIP exports."}>{p.lastDownloadedAt ? <><Check size={13}/> Downloaded · {p.downloadCount ?? 1}×</> : <><Download size={13}/> No recorded downloads</>}</span><h2>{p.name}</h2><p>{p.subtheme || 'Original clipart collection'}</p>{p.fullAutomation?.enabled && <p className="sub" role="status">Full Automation: {p.fullAutomation.stage.replaceAll('_',' ')} · {p.characters.length}/{p.fullAutomation.target} characters · {p.characters.filter(c=>c.prompt).length} prompts · {p.characters.filter(c=>c.imageUrl).length} images</p>}<div className="collection-main-stats"><span>{p.characters.length} characters</span><span>{p.characters.filter(c => c.prompt).length} prompts</span><span>{done} images</span></div><div className="collection-download-history"><span><Download size={13}/> Last ZIP: {typeof p.lastDownloadImageCount === "number" ? p.lastDownloadImageCount + " images" : "not recorded"}</span><span>Unique downloaded: {Array.isArray(p.downloadedImageIds) ? p.downloadedImageIds.length + " images" : "not recorded"}</span><span>{p.lastDownloadedAt ? "Last: " + new Date(p.lastDownloadedAt).toLocaleString() : "Earlier ZIP downloads were not tracked"}</span><span className="collection-redownload-hint">ZIP downloads remain available</span></div><div className="collection-main-progress"><i style={{ width: `${p.characters.length ? done / p.characters.length * 100 : 0}%` }}/></div><div className="collection-main-next">Continue: {p.fullAutomation?.enabled && automationStageTab(p.fullAutomation.stage) ? steps.find(s=>s.id===automationStageTab(p.fullAutomation!.stage))?.label || next?.label : next?.label} <ArrowRight size={16}/></div></button>; })}</div>{!foundCollections.length && <div className="panel empty-state"><Layers3 size={30}/><strong>{projects.length ? 'No matching collections' : 'No collections saved yet'}</strong><p>{projects.length ? 'Try another search.' : 'Create your first collection to start the pipeline.'}</p><button className="primary-btn" onClick={createCollection}><Plus size={16}/> New collection</button></div>}</>}
      {tab === 'multi-production' && <MultiCollectionProduction onGeneratePrompts={openCollectionPrompts}/>}
      {tab === 'stores' && <StoreManagement/>}
      {tab === 'settings' && <StudioSettings key={activeStoreId} storeId={activeStoreId} preferences={preferences} onPreferences={updatePreferences} projects={[...projects.filter(p => p.id !== project.id), project]}/>}
      {tab === 'overview' && <><div className="stat-grid"><div className="stat"><span>Total subjects</span><strong>{project.characters.length}<small> / {target}</small></strong><div className="stat-foot"><Layers3 size={14}/> Collection coverage</div></div><div className="stat"><span>Unique prompts</span><strong>{countReady}</strong><div className="stat-foot"><BookOpenText size={14}/> Ready for generation</div></div><div className="stat"><span>Images produced</span><strong>{countDone}</strong><div className="stat-foot"><ImageIcon size={14}/> Finished assets</div></div><div className="stat"><span>Target completion</span><strong>{Math.min(100, Math.round(project.characters.length / target * 100))}%</strong><div className="progress"><i style={{ width: `${Math.min(100, project.characters.length / target * 100)}%` }}/></div></div></div>
      <section className="two-col"><div className="panel hero-panel"><div className="panel-heading"><div className="heading-icon violet"><FileSearch size={20}/></div><div><h2>Analyze a product listing</h2><p>Discover themes, style signals, SEO ideas and clipart subjects.</p></div></div><label className="input-label">ETSY LISTING URL</label><div className="url-row"><input placeholder="https://www.etsy.com/listing/123456789/..." value={sourceUrl} onChange={e => setSourceUrl(e.target.value)}/><button className="primary-btn" disabled={!!busy || !sourceUrl} onClick={() => void loadListingImages()}>{busy === 'images' ? <LoaderCircle className="spin" size={16}/> : <Sparkles size={16}/>} Load images <ArrowRight size={16}/></button></div><div className="helper"><CircleHelp size={14}/> Uses Etsy Open API and OpenAI when connected. No unauthorized scraping.</div><div className="workflow"><span><b>01</b> Import listing</span><ArrowRight size={14}/><span><b>02</b> AI insights</span><ArrowRight size={14}/><span><b>03</b> Build collection</span></div></div><div className="panel collection-panel"><div className="panel-heading"><div className="heading-icon amber"><Layers3 size={20}/></div><div><h2>Active collection</h2><p>Customize your production brief.</p></div></div><label className="input-label">COLLECTION NAME</label><input value={project.name} onChange={e => update({ name: e.target.value })}/><label className="input-label">PRIMARY THEME</label><input placeholder="e.g. Woodland Animals" value={project.theme} onChange={e => update({ theme: e.target.value })}/><div className="field-pair"><div><label className="input-label">TARGET SUBJECTS</label><input type="number" min={1} max={1000} value={target} onChange={e => setCollectionTarget(Number(e.target.value))}/></div><div><label className="input-label">PROGRESS</label><div className="target-status">{project.characters.length >= target ? 'Target reached' : `${target - project.characters.length} to go`}</div></div></div></div></section>
      <section className="panel step-panel"><div className="section-title"><div><h2>Your production pipeline</h2><p>Follow these steps to create a consistent, original clipart bundle.</p></div></div><div className="step-grid">{[{ n:'01', icon: FileSearch, name:'Research & analyze', desc:'Import Etsy market signals', to:'analysis' },{ n:'02', icon: Layers3, name:'Build 120+ subjects', desc:'Expand and customize ideas', to:'characters' },{ n:'03', icon: WandSparkles, name:'Craft unique prompts', desc:'Ensure style consistency', to:'prompts' },{ n:'04', icon: ImageIcon, name:'Generate & review', desc:'Produce individual assets', to:'production' }].map(x => <button className="step" key={x.n} onClick={() => navigateTab(x.to)}><span className="step-no">{x.n}</span><x.icon size={24}/><b>{x.name}</b><small>{x.desc}</small><ArrowRight size={16} className="step-arrow"/></button>)}</div></section></>}
      {tab === 'analysis' && <div className="analysis-grid"><div className="panel"><div className="panel-heading"><div className="heading-icon violet"><Search size={20}/></div><div><h2>Source listing</h2><p>Analyze a listing with connected data sources.</p></div></div><label className="input-label">ETSY PRODUCT LINK</label><div className="field-inline"><input value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="Paste Etsy listing URL"/><button className="primary-btn" disabled={!!busy || !sourceUrl} onClick={() => void loadListingImages()}>{busy === 'images' ? 'Loading…' : 'Load images'}</button></div><div className="settings-fields" style={{ marginTop: 14 }}>
         <div><label className="input-label" htmlFor="analysis-character-target">TARGET CHARACTERS TO GENERATE</label><input id="analysis-character-target" aria-label="Target characters to generate" type="number" min={1} max={fullAutoRequested ? 200 : 1000} value={target} disabled={!!busy || (project.fullAutomation?.enabled && project.fullAutomation.stage !== 'completed')} onChange={e => setCollectionTarget(Number(e.target.value))}/><p className="sub">If AI returns fewer unique characters, Full Automation asks AI to expand the original character library to the target.</p></div>
         <div><label className="input-label">AUTOMATION</label><label style={{ display:'flex',alignItems:'center',gap:9,fontWeight:600 }}><input type="checkbox" checked={fullAutoRequested} disabled={!!busy || (project.fullAutomation?.enabled && project.fullAutomation.stage !== 'completed' && project.fullAutomation.stage !== 'paused')} onChange={e => { setFullAutoRequested(e.target.checked); if (e.target.checked && target>200) setTarget(200); }}/> Full Automation</label><p className="sub">Analyze → fill character target → generate prompts → OpenAI image Batches → review similarity → rewrite flagged prompts → one regeneration Batch → Etsy Listing Draft. OpenAI API charges apply. Jobs resume when PaletteIQ is running, including Desktop tray.</p></div>
        {fullAutoRequested && <div><label className="input-label">AI PROMPTS DELIVERY</label><label style={{display:'flex',alignItems:'center',gap:9}}><input type="checkbox" checked={project.progressivePrompts===true} disabled={!!busy || (project.fullAutomation?.enabled && project.fullAutomation.stage !== 'completed')} onChange={e=>update({progressivePrompts:e.target.checked})}/> Progressive Parallel Prompt Batches (import groups of 10 as each finishes)</label><p className="sub">Optional. One standard Batch is the lower-complexity default. Progressive uses several independent paid Batch jobs with separate IDs and no automatic re-submission of uncertain jobs.</p></div>}
        {fullAutoRequested && <div><label className="input-label">RESEARCH PROCESSING MODE</label><label style={{display:'flex',alignItems:'center',gap:9,fontWeight:600}}><input type="checkbox" checked={project.hybridResearch !== false} disabled={!!busy || (project.fullAutomation?.enabled && project.fullAutomation.stage !== 'completed')} onChange={e=>update({hybridResearch:e.target.checked})}/> Hybrid Parallel Research (3 workers + Style DNA merge)</label><p className="sub">Hybrid: up to 3 paid image-analysis requests plus 1 paid Style DNA synthesis; possibly faster but can cost more. Uncheck for a single Research request. The chosen mode cannot change for a running job.</p></div>}
        <div><label className="input-label" htmlFor="source-analysis-provider">IMAGE ANALYSIS PROVIDER</label><select id="source-analysis-provider" value={fullAutoRequested ? 'openai' : analysisProvider} disabled={!!busy || fullAutoRequested} onChange={e => { const provider = e.target.value as 'openai' | 'gemini'; setAnalysisProvider(provider); setVisualModel(provider === 'gemini' ? (analysisModels.gemini[0]?.id || 'gemini-3.5-flash') : preferences.analysisModel); }}><option value="openai">OpenAI</option><option value="gemini">Google Gemini</option></select></div>
        <div><label className="input-label" htmlFor="source-analysis-model">VISION MODEL</label><select id="source-analysis-model" value={visualModel} disabled={!!busy || hasActiveResearch(project.researchJob) || (project.fullAutomation?.enabled && project.fullAutomation.stage !== 'completed')} onChange={e => { setVisualModel(e.target.value); if (fullAutoRequested || analysisProvider === 'openai') update({ researchModel:e.target.value }); }}>{!analysisModels[fullAutoRequested ? 'openai' : analysisProvider].some(m => m.id === visualModel) && <option value={visualModel}>{visualModel} (Settings/default)</option>}{analysisModels[fullAutoRequested ? 'openai' : analysisProvider].map(m => <option key={m.id} value={m.id}>{m.name} ({m.id})</option>)}</select></div>
      </div><p className="sub">OpenAI analysis can continue remotely after the PC is shut down. Gemini analysis still requires keeping the request/client online.</p>{project.title && project.url === sourceUrl.trim() && <div className="source-card"><strong>{project.title}</strong>{(project.sourceTags || []).length > 0 && <p className="sub">Source tags: {project.sourceTags?.join(' · ')}</p>}{project.sourceDescription && <details><summary>Source description</summary><p className="sub">{project.sourceDescription}</p></details>}{project.url && <a href={project.url} target="_blank" rel="noopener noreferrer">View source <ExternalLink size={13}/></a>}{project.images.length > 0 && <><div className="reference-toolbar"><strong>{(project.selectedImageUrls ?? project.images).length} / {project.images.length} selected</strong><button className="outline-btn" type="button" onClick={() => update({ selectedImageUrls: [...project.images] })}>Select all</button><button className="outline-btn" type="button" onClick={() => update({ selectedImageUrls: [] })}>Clear</button></div><div className="source-images">{project.images.map((src,i) => <label className={`reference-tile ${(project.selectedImageUrls ?? project.images).includes(src) ? 'is-selected' : ''}`} key={src}><input type="checkbox" checked={(project.selectedImageUrls ?? project.images).includes(src)} onChange={e => update({ selectedImageUrls: e.target.checked ? [...(project.selectedImageUrls ?? project.images), src] : (project.selectedImageUrls ?? project.images).filter(x => x !== src) })}/><Image unoptimized width={640} height={640} src={src} alt={`Etsy listing reference ${i + 1}`}/><span>Image {i + 1}</span></label>)}</div><button className="primary-btn wide" disabled={!!busy || hasActiveResearch(project.researchJob) || !(project.selectedImageUrls ?? project.images).length} onClick={runAnalyze}>{hasActiveResearch(project.researchJob) ? 'Background analysis running…' : busy === 'analyze' || busy === 'research-start' ? 'Starting analysis…' : `Analyze ${(project.selectedImageUrls ?? project.images).length} selected images with ${fullAutoRequested ? visualModel : analysisProvider === 'gemini' ? 'Gemini' : visualModel}`}</button></>}</div>}</div><div className="panel"><h2>Creative intelligence</h2><p className="sub">Review and edit AI findings before production.</p>{[['General theme','theme'],['Sub-theme','subtheme'],['Micro-theme / niche','microtheme'],['Primary keyword','primaryKeyword'],['Visual style','style'],['Color direction','palette'],['Texture','texture']].map(([label,key]) => <div key={key}><label className="input-label">{label.toUpperCase()}</label><input value={String(project[key as keyof Project] ?? '')} onChange={e => update({ [key]: e.target.value })}/></div>)}<label className="input-label">SEO KEYWORDS <span>comma-separated</span></label><textarea rows={3} value={project.keywords.join(', ')} onChange={e => update({ keywords: e.target.value.split(',').map(x => x.trim()).filter(Boolean) })}/><div><label className="input-label">EXPRESSION / MOOD DIRECTION</label>
        <div className="panel" style={{padding:12,marginBottom:10}}>
          <b>Reference Mood Analysis</b>
          <p className="sub">Visible reference faces: <strong>{referenceMood || 'Not verified from faces'}</strong> · Confidence: {moodConfidence}</p>
          <p className="sub">Facial evidence: {moodEvidence || 'No clear facial cues. Select the intended mood manually.'}</p>
          <p className="sub">This analysis uses observed eyes, smiles, brows and gestures—not pastel colors or watercolor style. You can override the target mood without paying for another Research job.</p>
          <label className="input-label" htmlFor="target-mood-preset">TARGET MOOD FOR NEW CHARACTERS AND AI PROMPTS</label>
          <select id="target-mood-preset" aria-label="Select target mood" value={moodPresets.includes(selectedMood)?selectedMood:'custom'}
            onChange={e=>{if(e.target.value!=='custom')update({emotionDirection:e.target.value});}}>
            {moodPresets.map(m=><option key={m} value={m}>{m}</option>)}
            <option value="custom">Custom / AI detected — edit below</option>
          </select>
        </div>
        <input aria-label="Collection mood and expression direction" placeholder="e.g. happy playful, sad and tender, grumpy" value={project.emotionDirection ?? normalizeCreativeAnalysis(project.research).emotionProfile.dominantMood} onChange={e => update({ emotionDirection: e.target.value })}/></div>
      <div><label className="input-label">AGE / BABY PROPORTIONS DIRECTION</label>
        <input aria-label="Character age and baby proportions direction" placeholder="e.g. baby proportions, larger eyes and rounded bodies" value={project.ageDirection ?? normalizeCreativeAnalysis(project.research).emotionProfile.ageCues.join(', ')} onChange={e => update({ ageDirection: e.target.value })}/></div>
      <div><label className="input-label">CUTENESS / VISUAL STYLE DIRECTION</label>
        <input aria-label="Cute styling direction" placeholder="e.g. adorable soft watercolor, gentle rounded shapes" value={project.cutenessDirection ?? normalizeCreativeAnalysis(project.research).emotionProfile.styleCues.join(', ')} onChange={e => update({ cutenessDirection: e.target.value })}/></div>
      <label className="input-label">LONG-TAIL KEYWORDS <span>comma-separated</span></label>
      <textarea rows={3} value={(project.longTailKeywords || []).join(', ')} onChange={e => update({ longTailKeywords: e.target.value.split(',').map(x => x.trim()).filter(Boolean) })}/>
      <label className="input-label">ANALYSIS NOTES</label><textarea rows={4} value={project.notes} onChange={e => update({ notes: e.target.value })}/>
      {creativeControlsEditor}
      {project.research && <div className="creative-research-report" style={{ marginTop: 18 }}>
        <h3>Detailed source research</h3>
        <details open><summary>12-point Visual Reverse Engineering</summary>
          {([
            ['Character Shape','characterShape'],['Facial Expression','facialExpression'],
            ['Color Palette','colorPalette'],['Material & Texture','materialTexture'],
            ['Special Effects','specialEffects'],['Lighting & Rendering','lightingRendering'],
            ['Character Categories','characterCategories'],['Accessories','accessories'],
            ['Composition','composition'],['Illustration Quality','illustrationQuality'],
            ['Clipart Production','clipartProduction'],['Commercial Assets','commercialAssets'],
          ] as const).map(([label,key]) => <p key={key} className="sub"><b>{label}:</b> {normalizeCreativeAnalysis(project.research).visualReverseEngineering[key] || 'Not established from reference images'}</p>)}
        </details>
        <div className="field-pair" style={{marginTop:14}}>
          <details open><summary><b>Style DNA — consistent across the collection</b></summary>
            {styleDNAKeys.map(key => <p key={key} className="sub"><b>{key.replace(/([A-Z])/g,' $1')}:</b> {normalizeCreativeAnalysis(project.research).styleDNA[key] || 'Not established'}</p>)}
          </details>
          <details open><summary><b>Character DNA — unique per character</b></summary>
            {characterDNAKeys.map(key => <p key={key} className="sub"><b>{key.replace(/([A-Z])/g,' $1')}:</b> {normalizeCreativeAnalysis(project.research).characterDNA[key] || 'Not established'}</p>)}
          </details>
        </div>
        <div style={{marginTop:10}}>
          <b>Expression & age research</b>
          <p className="sub">Title cues: {normalizeCreativeAnalysis(project.research).emotionProfile.titleCues.join(', ') || 'none'} · Tag cues: {normalizeCreativeAnalysis(project.research).emotionProfile.tagCues.join(', ') || 'none'} · Cuteness style: {normalizeCreativeAnalysis(project.research).emotionProfile.styleCues.join(', ') || 'not identified'}</p>
          <p className="sub">Expressions observed in selected images: {normalizeCreativeAnalysis(project.research).emotionProfile.observedExpressions.join(', ') || 'not visible / not identified'}</p>
          <p className="sub">Recommended variation: {normalizeCreativeAnalysis(project.research).emotionProfile.recommendedExpressions.join(' · ') || 'not identified'}</p>
          <p className="sub">Face and body language: {normalizeCreativeAnalysis(project.research).emotionProfile.expressionStyle || 'not identified'}</p>
          <p className="sub">{normalizeCreativeAnalysis(project.research).emotionProfile.guidance}</p>
        </div>
        <p className="sub">Observed in selected images versus original expansion opportunities.</p>
        <div className="field-pair">
          <div><b>Dominant colors</b>{project.research.dominantColors.map((c,i) => <div key={i} style={{ display:'flex',gap:8,alignItems:'center',marginTop:6 }}><span style={{ width:18,height:18,borderRadius:5,backgroundColor:c.hex || 'transparent',border:'1px solid #aaa' }}/>{c.name} {c.hex || ''} {c.role ? '('+c.role+')' : ''}</div>)}</div>
          <div><b>Accent colors</b>{project.research.accentColors.map((c,i) => <div key={i} style={{ display:'flex',gap:8,alignItems:'center',marginTop:6 }}><span style={{ width:18,height:18,borderRadius:5,backgroundColor:c.hex || 'transparent',border:'1px solid #aaa' }}/>{c.name} {c.hex || ''}</div>)}</div>
        </div>
        {([['Medium','medium'],['Mood','mood'],['Lighting','lighting'],['Composition','composition'],['Background treatment','background'],['Buyer search intent','seoIntent']] as const).map(([label,key]) => project.research?.[key] ? <p key={key} className="sub"><b>{label}:</b> {project.research[key]}</p> : null)}
        {([['Observed subjects (visual evidence)','observedSubjects'],['Suggested subject families (new ideas)','subjectFamilies'],['Visual motifs','visualMotifs'],['Buyer audiences','audience'],['Suggested uses','useCases'],['Originality / differentiators','differentiators']] as const).map(([label,key]) =>
          <div key={key} style={{marginTop:10}}><b>{label}</b><p className="sub">{project.research?.[key].join(' · ') || 'Not identified'}</p></div>)}
        <details><summary>Per-image evidence ({project.research.imageObservations.length})</summary>
          {project.research.imageObservations.map((item,i) => <div key={i} style={{padding:'8px 0',borderBottom:'1px solid #ddd'}}>
            <b>Selected image {item.imageIndex} · {item.role}</b>
            <p className="sub">Visible: {item.subjects.join(', ') || 'not determined'} · Colors: {item.colors.join(', ') || 'not determined'} · Expressions: {(item.expressions || []).join(', ') || 'not visible / not determined'}</p>
            <p className="sub">Shapes: {(item.shapes || []).join(', ') || 'not determined'} · Material: {(item.materials || []).join(', ') || 'not determined'} · Effects: {(item.effects || []).join(', ') || 'none observed'}</p>
            <p className="sub">{item.notes}</p>
          </div>)}
        </details>
      </div>}<button className="primary-btn wide" onClick={() => navigateTab('characters')}>Continue to character library <ArrowRight size={16}/></button></div></div>}
      {tab === 'characters' && <>{hasActiveResearch(project.researchJob) && !!project.researchJob?.workerPreviews?.some(w=>w.concepts.length) && <div className="panel" aria-live="polite"><h3>Incoming Research concepts — preview only</h3><p className="sub">Candidate concepts from completed workers. They will become editable Character Library entries only after Merge &amp; Style DNA. No duplicate job is being submitted.</p>{project.researchJob.workerPreviews.flatMap(w=>w.concepts.slice(0,20).map((c,i)=><p key={w.index+'-'+i} className="sub"><b>{c.name}</b> · {c.family||'unclassified'} · {c.description}</p>))}</div>}<div className="panel toolbar-panel"><div className="toolbar-left"><label>Target</label><input className="small-input" type="number" min={1} max={1000} value={target} disabled={!!(project.fullAutomation?.enabled && project.fullAutomation.stage !== 'completed')} onChange={e=>setCollectionTarget(Number(e.target.value))}/><span className="muted">{project.characters.length} / {target} subjects</span></div><div className="toolbar-right"><button className="outline-btn" onClick={() => addChars([makeChar('New original character','manual')])}><Plus size={15}/> Add character</button><button className="primary-btn" onClick={expand} disabled={!!busy || project.characters.length >= target}>{busy === 'expand' ? <LoaderCircle size={16} className="spin"/> : <Sparkles size={16}/>} AI fill to {target}</button></div></div><div className="panel library-panel"><div className="table-toolbar"><div><h2>Character collection</h2><p>{project.characters.length} concepts · {project.characters.filter(c => c.origin === 'ai').length} AI suggestions · {Object.keys(familyDistribution(project.characters)).length} distinct subject families</p><details><summary>Subject family distribution</summary><p className="sub">{Object.entries(familyDistribution(project.characters)).sort((a,b) => b[1]-a[1]).map(([family,count]) => family + ': ' + count).join(' · ') || 'No subjects yet'}</p></details><details><summary>Character expression distribution</summary><p className="sub">{Object.entries(expressionDistribution(project.characters)).sort((a,b) => b[1]-a[1]).map(([mood,count]) => mood + ': ' + count).join(' · ') || 'No facial expressions assigned yet'}</p></details><details><summary>Concept Diversity QA (before image generation)</summary>
  <p className="sub">Exact duplicate names: {conceptAudit.duplicateNames} · Repeated family silhouettes: {conceptAudit.duplicateSilhouettes} · Distinct families: {conceptAudit.distinctFamilies}</p>
  <p className="sub">Different expressions: {conceptAudit.distinctExpressions} · Color plans: {conceptAudit.distinctColorPlans} · Accessory plans: {conceptAudit.distinctAccessories}</p>
  <p className="sub">Missing shapes: {conceptAudit.missingShape} · Missing silhouettes: {conceptAudit.missingSilhouette} · Missing color plans: {conceptAudit.missingColorPlan}</p>
  <p className="sub">Style DNA: {conceptAudit.hasStyleDNA ? 'available' : 'not analyzed'} · Rendering-quality rules: {conceptAudit.hasRenderingRules ? 'specified' : 'not analyzed'}. This is concept/prompt QA, not an assessment of final image pixels.</p>
</details></div><div className="search-box"><Search size={16}/><input placeholder="Search characters..." value={query} onChange={e => { setQuery(e.target.value); setLibraryPage(1); }}/></div></div><div className="table-scroll"><table><thead><tr><th><input type="checkbox" checked={!!pagedCharacters.length && pagedCharacters.every(c => selected.includes(c.id))} onChange={e=>setSelected(previous => e.target.checked ? [...new Set([...previous, ...pagedCharacters.map(c => c.id)])] : previous.filter(id => !pagedCharacters.some(c => c.id === id)))}/></th><th>CHARACTER / SUBJECT</th><th>FAMILY / SPECIES</th><th>EXPRESSION / FACE</th><th>SHAPE / SILHOUETTE</th><th>ACCESSORIES / COLOR</th><th>ORIGIN</th><th>STATUS</th><th>DETAILS</th><th></th></tr></thead><tbody>{pagedCharacters.map((c,i) => <tr key={c.id}><td><input type="checkbox" checked={selected.includes(c.id)} onChange={e=>setSelected(s=>e.target.checked?[...s,c.id]:s.filter(x=>x!==c.id))}/></td><td><div className="character-name"><span className="char-number">{String((currentLibraryPage - 1) * libraryPageSize + i + 1).padStart(2,'0')}</span><input value={c.name} onChange={e=>updateChar(c.id,{name:e.target.value})}/></div></td><td><input aria-label={`Family for ${c.name}`} placeholder="e.g. cow / pig" value={c.family || ''} onChange={e => updateChar(c.id, { family: e.target.value })}/></td><td><input aria-label={`Expression for ${c.name}`} placeholder="e.g. joyful closed-eye smile" value={c.expression || ''} onChange={e => updateChar(c.id, { expression: e.target.value })}/></td><td><input aria-label={`Shape for ${c.name}`} placeholder="body anatomy" value={c.shape || ''} onChange={e => updateChar(c.id, { shape: e.target.value })}/><input aria-label={`Silhouette for ${c.name}`} placeholder="distinct silhouette" value={c.silhouette || ''} onChange={e => updateChar(c.id, { silhouette: e.target.value })}/></td>
        <td><input aria-label={`Accessories for ${c.name}`} placeholder="accessories" value={c.accessories || ''} onChange={e => updateChar(c.id, { accessories: e.target.value })}/><input aria-label={`Color plan for ${c.name}`} placeholder="color distribution" value={c.colorPlan || ''} onChange={e => updateChar(c.id, { colorPlan: e.target.value })}/></td><td><span className={`tag ${c.origin}`}>{c.origin}</span></td><td><span className={`status ${c.status}`}>{c.status}</span></td><td><input placeholder="Distinctive visual details..." value={c.description} onChange={e=>updateChar(c.id,{description:e.target.value})}/></td><td><button className="icon-btn" title="Delete" onClick={()=>update({characters:project.characters.filter(x=>x.id!==c.id)})}><Trash2 size={16}/></button></td></tr>)}</tbody></table>{!filtered.length && <div className="empty-state"><Layers3 size={32}/><strong>No characters yet</strong><p>Add a subject or use AI to expand your collection.</p></div>}</div><TablePagination total={filtered.length} page={currentLibraryPage} pageSize={libraryPageSize} onPage={setLibraryPage} onPageSize={size => { setLibraryPageSize(size); setLibraryPage(1); }} label="characters"/>{selected.length > 0 && <div className="bulk-bar"><span>{selected.length} selected</span><button className="outline-btn" onClick={()=>update({characters:project.characters.filter(c=>!selected.includes(c.id))})}>Remove selected</button><button className="outline-btn" onClick={()=>setSelected([])}>Clear</button></div>}</div></>}
      {tab === 'prompts' && <><div className="panel toolbar-panel"><div><h2>AI prompt generation</h2><p className="sub">Prompts inherit source title, keywords, general theme, sub-theme, micro-theme, palette, subject family, requested facial expressions and age/cuteness cues. OpenAI uses a durable background Batch; Gemini remains foreground. API usage may incur charges.</p><p className="sub"><b>Context:</b> {project.title || project.name} · {project.theme} / {project.subtheme} / {project.microtheme || 'micro-theme not set'} · {project.primaryKeyword || 'primary keyword not set'} · Mood: {project.emotionDirection || normalizeCreativeAnalysis(project.research).emotionProfile.dominantMood || 'not set'}</p></div><div className="head-buttons"><button className="outline-btn" disabled={!project.characters.some(character => character.prompt.trim())} onClick={() => void copyAllPrompts()}>{copiedAllPrompts ? <Check size={16}/> : <Copy size={16}/>} {copiedAllPrompts ? 'Copied!' : 'Copy All Prompts'}</button><button className="primary-btn" disabled={!!busy || hasActivePromptJob(project.promptJob) || !!lockedPromptModel || !project.characters.length} onClick={() => generatePrompts()}>{busy === 'prompts' ? <LoaderCircle size={16} className="spin"/> : <WandSparkles size={16}/>} {hasActivePromptJob(project.promptJob) ? 'OpenAI Batch running…' : busy === 'prompt-start' ? 'Submitting background Batch…' : busy === 'prompts' ? `Generating ${promptProgress.done}/${promptProgress.total}` : selected.length ? `Generate ${selected.length} AI prompts` : promptProvider === 'openai' ? 'Generate prompts in background' : 'Generate all AI prompts'}</button></div></div><div className="panel settings-fields"><div><label className="input-label">PROMPT AI PROVIDER</label><select disabled={!!busy || hasActivePromptJob(project.promptJob) || !!lockedPromptModel} value={lockedPromptModel ? 'openai' : promptProvider} onChange={e => { const provider = e.target.value as 'openai' | 'gemini'; setPromptProvider(provider); setPromptModel(provider === 'gemini' ? (analysisModels.gemini[0]?.id || 'gemini-3.5-flash') : preferences.automationPromptModel); }}><option value="openai">OpenAI</option><option value="gemini">Google Gemini</option></select></div><div><label className="input-label">PROMPT MODEL</label><select disabled={!!busy || hasActivePromptJob(project.promptJob) || !!lockedPromptModel} value={lockedPromptModel || promptModel} onChange={e => setPromptModel(e.target.value)}>{!analysisModels[lockedPromptModel ? 'openai' : promptProvider].some(m => m.id === (lockedPromptModel || promptModel)) && <option value={lockedPromptModel || promptModel}>{lockedPromptModel || promptModel} (Research selection)</option>}{analysisModels[lockedPromptModel ? 'openai' : promptProvider].map(m => <option key={m.id} value={m.id}>{m.name} ({m.id})</option>)}</select></div>{(promptProvider==='openai'||!!lockedPromptModel) && <div><label className="input-label">PROMPT PROCESSING MODE</label><label style={{display:'flex',alignItems:'center',gap:9}}><input type="checkbox" checked={project.progressivePrompts===true} disabled={!!busy || hasActivePromptJob(project.promptJob) || !!lockedPromptModel} onChange={e=>update({progressivePrompts:e.target.checked})}/> Progressive Parallel (up to 3 small Batches, import each group as ready)</label><p className="sub">Off = one OpenAI Batch (simpler). On = separate groups of 10 characters, each with its own tracked Batch ID. Requests remain billed at the applicable Batch rate; availability and completion order vary. Change this before starting the job.</p></div>}{lockedPromptModel && <p className="sub">Full Automation uses the separately saved AI Prompts model ({lockedPromptModel}). Model changes apply only to future workflows.</p>}{project.promptJob && <p className="sub">Submitted Prompt Batch model: {project.promptJob.model}</p>}{analysisModelsError && <p className="sub">{analysisModelsError}</p>}</div>{creativeControlsEditor}{project.promptJob && <div className="panel" aria-live="polite">
        <div className="production-progress"><span>OpenAI {project.promptJob.mode==='progressive'?'Progressive Prompt Batches':'Prompt Batch'} · {project.promptJob.status}</span>
          <b>{project.promptJob.processedGroups}/{project.promptJob.totalGroups} groups · {project.promptJob.imported}/{project.promptJob.total} imported</b></div>
        <div className="progress"><i style={{ width: `${project.promptJob.totalGroups ? 100 * project.promptJob.processedGroups / project.promptJob.totalGroups : 0}%` }}/></div>
        {project.promptJob.mode==='progressive' && <div className="sub">{project.promptJob.groupStates?.map(g=><p key={g.key}>{g.key}: {g.status}{g.error?' — '+g.error:''}</p>)}</div>}
        <p className="sub">{project.promptJob.mode==='progressive'?'Completed groups are imported and rendered without waiting for the other groups.':'A single OpenAI Batch exposes completed request counts, but its actual prompt output is generally available only after Batch result files are published.'} OpenAI processing can continue while the PC is off. Import does not replace manually edited prompts.</p>
        {project.promptJob.error && <p className="sub">{project.promptJob.error}</p>}
      </div>}
      {busy === 'prompts' && <div className="panel"><div className="production-progress"><span>AI prompt progress</span><b>{promptProgress.done}/{promptProgress.total}</b></div><div className="progress"><i style={{ width: `${promptProgress.total ? 100 * promptProgress.done / promptProgress.total : 0}%` }}/></div></div>}<div className="prompt-grid">{project.characters.map((c,i)=><div className="panel prompt-card" key={c.id}><div className="prompt-top"><span className="char-number">{String(i+1).padStart(3,'0')}</span><b>{c.name}</b><span className={`status ${c.prompt ? 'ready' : 'draft'}`}>{c.prompt ? 'Ready' : 'Draft'}</span></div><textarea rows={6} placeholder="Generate an OpenAI prompt or customize one manually..." value={c.prompt} disabled={hasActivePromptJob(project.promptJob)} onChange={e=>updateChar(c.id,{prompt:e.target.value,status:'ready'})}/><div className="prompt-bottom"><small>{c.prompt.length} characters</small><button disabled={!!busy || hasActivePromptJob(project.promptJob) || !!lockedPromptModel} onClick={()=>generatePrompts([c.id])}><WandSparkles size={14}/> Regenerate with AI</button></div></div>)}</div>{!project.characters.length && <div className="panel empty-state"><BookOpenText size={32}/><strong>No prompts to show</strong><p>Build your character library first.</p></div>}</>}
      {tab === 'production' && <ImageProduction key={project.id} project={project} model={model} batchPreferredModel={project.fullAutomation?.batchImageModel || preferences.automationImageModel} quality={quality} onModel={setModel} onQuality={setQuality} onDownloaded={(receipt) => { setProject(prev => ({ ...prev, ...receipt })); setProjects(prev => prev.map(item => item.id === project.id ? { ...item, ...receipt } : item)); }} onAsset={(id,fields) => updateChar(id,fields)} onPromptChange={(id,prompt) => updateChar(id,{prompt})} onUpscaleChange={updateUpscaleChar} onUpscaleBatch={updateUpscaleBatch}/>}
      {isStudioTabEnabled('thumbnails') && tab === 'thumbnails' && <ThumbnailDesigner key={project.id} collectionVisualSettings={{ style: project.style, palette: project.palette, texture: project.texture }} registerSaveControls={controls => { thumbnailSaveControlsRef.current = controls; }} title={project.subtheme || project.theme || project.name} seoListing={project.listing} aiDefaults={{ provider: preferences.seoProvider ?? 'gemini', openaiModel: preferences.seoOpenaiModel ?? 'gpt-4.1-mini', geminiModel: preferences.seoGeminiModel ?? 'gemini-3.5-flash' }} projectId={project.id} characters={project.characters} references={project.images} designs={project.thumbnails || []} onChange={thumbnails => update({ thumbnails })} onSave={async thumbnails => { const updated = { ...project, thumbnails }; await api({ action: 'save', id: updated.id, name: updated.name, data: updated }); setProject(updated); setProjects(prev => [updated, ...prev.filter(p => p.id !== updated.id)]); }}/>}
      {isStudioTabEnabled('listing-images') && tab === 'listing-images' && <EtsyListingImageStudio key={project.id} projectId={project.id} name={project.name} theme={project.theme} subtheme={project.subtheme} style={project.style} palette={project.palette} texture={project.texture} seoTitle={project.listing?.title} primaryKeyword={project.listing?.primaryKeyword} defaultImageModel={preferences.model} defaultImageQuality={preferences.quality} characters={project.characters} onSaved={listingImages => update({ listingImages })}/>}
      {tab === 'listing' && <EtsyListingDraft project={project} seoProvider={preferences.seoProvider ?? 'gemini'} seoGeminiModel={preferences.seoGeminiModel ?? 'gemini-3.5-flash'} seoOpenaiModel={preferences.seoOpenaiModel ?? 'gpt-6.1-terra'} seoDraftFields={preferences.seoDraftFields ?? defaultSeoDraftFields} seoTitleMaxLength={preferences.seoTitleMaxLength ?? 120} seoAltTextCount={preferences.seoAltTextCount ?? 10} onDownloaded={(receipt) => { setProject(prev => ({ ...prev, ...receipt })); setProjects(prev => prev.map(item => item.id === project.id ? { ...item, ...receipt } : item)); }} onChange={listing => update({ listing })} onSave={async () => { await api({ action: 'save', id: project.id, name: project.name, data: project }); setProjects(prev => [project, ...prev.filter(p => p.id !== project.id)]); }} onSeoReview={async seoReview => { const updated = { ...project, seoReview }; await api({ action: 'save', id: updated.id, name: updated.name, data: updated }); setProject(updated); setProjects(prev => [updated, ...prev.filter(p => p.id !== updated.id)]); }}/>}
      {stepIndex >= 0 && <div className="panel pipeline-footer"><button className="outline-btn" onClick={() => navigateTab(stepIndex ? steps[stepIndex - 1].id : 'collections')}>{stepIndex ? `← ${steps[stepIndex - 1].label}` : '← Collections'}</button><span>Step {stepIndex + 1} of {steps.length}</span><button className="primary-btn" disabled={!!busy} onClick={advance}>{busy === 'save' ? 'Saving…' : stepIndex < steps.length - 1 ? `Save & next: ${steps[stepIndex + 1].label}` : 'Save & back to collections'} <ArrowRight size={16}/></button></div>}
      <footer>paletteIQ · Independent clipart research and creation studio. Not affiliated with Etsy. Source listings are inspiration for original designs.</footer></div></main>
  </div>;
}
