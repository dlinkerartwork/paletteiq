'use client';

import Image from 'next/image';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, BarChart3, BookOpenText, Check, Copy, CircleHelp, Download, ExternalLink, FileSearch, ArrowLeft, RefreshCw, Image as ImageIcon, Layers3, LoaderCircle, Plus, Search, Settings2, Sparkles, Trash2, WandSparkles, X, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { StoreSwitcher } from '@/components/account-workspace';
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
import { auditCreativeConcepts, expressionDistribution, familyDistribution, normalizeCreativeAnalysis, normalizeCreativeControls, reverseEngineeringKeys, styleDNAKeys, characterDNAKeys, selectDiverseConcepts, type CreativeAnalysis, type CreativeControls } from '@/lib/creative-intelligence';

type Character = { id: string; name: string; family?: string; expression?: string; shape?: string; silhouette?: string; accessories?: string; colorPlan?: string; description: string; prompt: string; status: 'draft' | 'ready' | 'done' | 'error'; imageUrl?: string; upscaledImageUrl?: string; upscaledAt?: number; upscaleJob?: { id: string; submittedAt?: number; factor?: number }; error?: string; similarityReview?: SimilarityReview; origin: 'listing' | 'ai' | 'manual' };
type ResearchJobPreview = { id: string; status: 'submitting' | 'queued' | 'in_progress' | 'completed' | 'failed'; target: number; requested: number; completedCount: number; model: string; createdAt: number; updatedAt: number; error?: string };
const hasActiveResearch = (job?: ResearchJobPreview) => !!job && ['submitting','queued','in_progress'].includes(job.status);
type PromptJobPreview = { id: string; status: string; total: number; imported: number; failed: number; processedGroups: number; totalGroups: number; model: string; createdAt: number; updatedAt: number; error?: string };
const hasActivePromptJob = (job?: PromptJobPreview) => !!job && !['completed','completed_with_errors','failed','cancelled','expired'].includes(job.status);
type Project = { id: string; name: string; url: string; upscaleBatch?: StoredUpscaleBatch; researchJob?: ResearchJobPreview; promptJob?: PromptJobPreview; theme: string; subtheme: string; microtheme?: string; primaryKeyword?: string; longTailKeywords?: string[]; research?: CreativeAnalysis; creativeControls?: CreativeControls; sourceDescription?: string; sourceTags?: string[]; emotionDirection?: string; ageDirection?: string; cutenessDirection?: string; style: string; palette: string; texture: string; keywords: string[]; characters: Character[]; title: string; images: string[]; selectedImageUrls?: string[]; notes: string; listing?: ListingData; seoReview?: SavedSeoReview; thumbnails?: ThumbnailDesign[]; listingImages?: ListingImageRecord[]; listingStudioSettings?: ListingStudioConfig; lastDownloadedAt?: number; downloadCount?: number; lastDownloadImageCount?: number; downloadedImageIds?: string[] };
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

export default function Home() {
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
  const [visualModel, setVisualModel] = useState('gpt-4.1-mini');
  const [promptProvider, setPromptProvider] = useState<'openai' | 'gemini'>('openai');
  const [promptModel, setPromptModel] = useState('gpt-4.1-mini');
  const [analysisModels, setAnalysisModels] = useState<Record<'openai' | 'gemini', Array<{ id: string; name: string }>>>({ openai: [], gemini: [] });
  const [analysisModelsError, setAnalysisModelsError] = useState('');
  useEffect(() => {
    const options = analysisModels[analysisProvider];
    if (options.length && !options.some(m => m.id === visualModel)) setVisualModel(options[0].id);
  }, [analysisModels, analysisProvider, visualModel]);
  useEffect(() => {
    const options = analysisModels[promptProvider];
    if (options.length && !options.some(m => m.id === promptModel)) setPromptModel(options[0].id);
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
  const [target, setTarget] = useState(120);
  const [model, setModel] = useState('gpt-image-1-mini');
  const [quality, setQuality] = useState('low');
  const [selected, setSelected] = useState<string[]>([]);
  const [loadDone, setLoadDone] = useState(false);
  const observedBatchStates = useRef<Map<string, string> | null>(null);
  const lastCreditNotice = useRef('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [duplicateListing, setDuplicateListing] = useState<{ url: string; collections: string[] } | null>(null);
  const [preferences, setPreferences] = useState<StudioPreferences>(defaultPrefs);

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
          savedProjectSnapshots.current.get(current.project.id) !== JSON.stringify(current.project);
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
      if (savedProjectSnapshots.current.get(current.project.id) !== JSON.stringify(current.project) ||
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
    const dirty = savedProjectSnapshots.current.get(current.project.id) !== JSON.stringify(current.project) ||
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
        setProjects(prev => prev.map(item => byId.get(item.id) ?? item));
        setProject(prev => {
          const current = byId.get(prev.id);
          if (!current) return prev;
          const recoveredAssets = new Map(current.characters.map(char => [char.id, char]));
          return { ...prev, characters: prev.characters.map(char => {
            const stored = recoveredAssets.get(char.id);
            return stored?.imageUrl && (char.imageUrl !== stored.imageUrl || JSON.stringify(char.similarityReview) !== JSON.stringify(stored.similarityReview)) ? { ...char, imageUrl: stored.imageUrl, status: stored.status, error: stored.error, similarityReview: stored.similarityReview } : char;
          }) };
        });
      } catch { /* Offline is expected; try again on the next interval. */ }
      finally { polling = false; }
    };
    void resumeBatches();
    const timer = window.setInterval(() => void resumeBatches(), 45000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [loadDone, tab]);
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); const main = document.querySelector('.main'); if (main && main.scrollTop) main.scrollTop = 0; document.title = `${['overview','collections','multi-production','settings'].includes(tab) ? tab[0].toUpperCase() + tab.slice(1) : `${project.name} · ${steps.find(s => s.id === tab)?.label || tab}`} | PaletteIQ`; }, [tab, project.id, project.name]);
  const updatePreferences = useCallback((prefs: StudioPreferences) => { setPreferences(prefs); setTarget(prefs.target); setModel(prefs.model); setQuality(prefs.quality); }, []);
  useEffect(() => { fetch('/api/settings').then(r => r.ok ? r.json() as Promise<{ preferences?: StudioPreferences }> : null).then((data: { preferences?: StudioPreferences } | null) => { if (data?.preferences) updatePreferences({ ...defaultPrefs, ...data.preferences, seoPrompts: { ...defaultSeoPrompts, ...data.preferences.seoPrompts }, seoDraftFields: data.preferences.seoDraftFields ?? [...defaultSeoDraftFields] }); }).catch(() => {}); }, [updatePreferences]);

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
    if (!sourceUrl.trim()) { setMessage('Enter an Etsy listing URL first.'); return; }
    if (project.url !== sourceUrl.trim() || !project.images.length) { setMessage('Load listing images first.'); return; }
    const chosenImages = project.selectedImageUrls ?? project.images;
    if (!chosenImages.length) { setMessage('Select at least one image to analyze.'); return; }
    if (analysisProvider === 'openai') {
      // One persisted, asynchronous OpenAI response can analyze the selected
      // visual references and prepare the full 120-subject library remotely.
      // The browser is only a status viewer, never the job runner.
      setBusy('research-start'); setMessage('Saving the collection and submitting OpenAI background research…');
      try {
        await api({ action: 'save', id: project.id, name: project.name, data: project });
        const started = await fetch('/api/research-jobs', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: project.id, url: sourceUrl.trim(),
            selectedImages: chosenImages, target, model: visualModel }),
        });
        const result = await started.json() as { error?: string; job?: ResearchJobPreview };
        if (!started.ok || !result.job) throw new Error(result.error || 'Could not create background research job');
        const snapshot = { ...project, researchJob: result.job };
        setProject(snapshot);
        setProjects(previous => [snapshot, ...previous.filter(p => p.id !== snapshot.id)]);
        setAnalysisProgress({ done: result.job.completedCount, total: result.job.target });
        setMessage('OpenAI background research accepted. You may close PaletteIQ or shut down this PC; OpenAI continues processing. Reopen PaletteIQ to import the completed characters automatically. For a target above 160, use AI Fill afterward.');
      } catch (error) {
        setMessage('Background research not started: ' + (error instanceof Error ? error.message : String(error)) + '. Check the saved job before retrying to avoid duplicate API charges.');
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
          setProjects(previous => [result.project!, ...previous.filter(p => p.id !== projectId)]);
          setProject(previous => previous.id === projectId ? result.project! : previous);
          setAnalysisProgress({ done: result.job.completedCount, total: result.job.target });
          setMessage('Background research completed: ' + result.job.completedCount + '/' + result.job.target + ' subjects saved. Open Character Library to review family and expression variety.');
        } else {
          setProject(previous => previous.id === projectId && previous.researchJob?.id === jobId
            ? { ...previous, researchJob: result.job } : previous);
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
      if (closed || polling) return;
      polling = true;
      try {
        const response = await fetch('/api/prompt-jobs?projectId=' + encodeURIComponent(projectId));
        const result = await response.json() as { error?: string; job?: PromptJobPreview; project?: Project };
        if (!response.ok) throw Error(result.error || 'Could not retrieve OpenAI prompt batch status');
        if (closed || !result.job || result.job.id !== jobId) return;
        if (result.project && !hasActivePromptJob(result.job)) {
          setProjects(previous => [result.project!, ...previous.filter(p => p.id !== projectId)]);
          setProject(previous => previous.id === projectId ? result.project! : previous);
          setMessage(result.job.status === 'completed'
            ? 'OpenAI Batch finished. ' + result.job.imported + ' prompts were saved automatically. Review them before image generation.'
            : 'OpenAI Batch finished with ' + result.job.imported + ' imported prompts and ' + result.job.failed + ' missing or skipped. Review the remaining characters before retrying.');
        } else {
          setProject(previous => previous.id === projectId && previous.promptJob?.id === jobId
            ? { ...previous, promptJob: result.job } : previous);
          if (result.job.status === 'failed' || result.job.status === 'expired' || result.job.status === 'cancelled')
            setMessage('OpenAI prompt Batch ended: ' + (result.job.error || result.job.status) + '. Review before retrying to avoid duplicate charges.');
        }
      } catch (error) {
        if (!closed) setMessage('Prompt batch status temporarily unavailable: ' + (error instanceof Error ? error.message : String(error)) + '. The saved job will be checked again.');
      } finally { polling = false; }
    };
    void pollPrompts();
    const interval = window.setInterval(() => void pollPrompts(), 10000);
    return () => { closed = true; window.clearInterval(interval); };
  }, [loadDone, project.id, project.promptJob?.id, project.promptJob?.status]);
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
    if (busy || hasActivePromptJob(project.promptJob)) return;
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
            regenerate: chosen.some(c => !!c.prompt.trim()), model: promptModel }),
        });
        const result = await request.json() as { error?: string; job?: PromptJobPreview };
        if (!request.ok || !result.job) throw Error(result.error || 'OpenAI Batch submission failed');
        const snapshot = { ...project, promptJob: result.job };
        setProject(snapshot);
        setProjects(previous => [snapshot, ...previous.filter(p => p.id !== snapshot.id)]);
        setMessage('OpenAI accepted the prompt Batch. You may close PaletteIQ or turn off this PC. When the app is reopened, completed prompts will be imported automatically. Do not resubmit the same job.');
      } catch (error) {
        setMessage('Could not start prompt Batch: ' + (error instanceof Error ? error.message : String(error)) + '. Check the saved job before retrying to avoid duplicate charges.');
      } finally { setBusy(''); }
      return;
    }
    // Gemini retains its existing foreground prompt-generation implementation.
    setBusy('prompts'); setPromptProgress({ done: 0, total: chosen.length }); setMessage('');
    let completed = 0;
    try {
      for (let i = 0; i < chosen.length; i += 10) {
        const group = chosen.slice(i, i + 10);
        const result = await api({ action: 'generate-prompts', promptProvider, promptModel, title: project.title || project.name, analysis: creativeContext(project), characters: group });
        const generated = new Map<string, string>((result.prompts as { id: string; prompt: string }[]).map(p => [p.id, p.prompt]));
        if (generated.size !== group.length) throw new Error('AI returned an incomplete group.');
        setProject(prev => ({ ...prev, characters: prev.characters.map(c => generated.has(c.id) ? { ...c, prompt: generated.get(c.id)!, status: c.status === 'done' ? 'done' : 'ready' } : c) }));
        completed += group.length; setPromptProgress({ done: completed, total: chosen.length });
      }
      setMessage(`${completed} prompts generated with ${promptProvider === 'gemini' ? 'Gemini' : 'OpenAI'}. Review and save your collection.`);
    } catch (error) { setMessage(`${completed}/${chosen.length} prompts generated. ${error instanceof Error ? error.message : 'AI request failed'} You may retry the remaining characters.`); }
    finally { setBusy(''); }
  };
  const conceptAudit = auditCreativeConcepts(project.characters, normalizeCreativeAnalysis(project.research).styleDNA);
  const filtered = useMemo(() => project.characters.filter(c => `${c.name} ${c.description} ${c.expression || ''} ${c.family || ''} ${c.shape || ''} ${c.silhouette || ''} ${c.accessories || ''}`.toLowerCase().includes(query.toLowerCase())), [project.characters, query]);
  const libraryPages = Math.max(1, Math.ceil(filtered.length / libraryPageSize));
  const currentLibraryPage = Math.min(libraryPage, libraryPages);
  const pagedCharacters = filtered.slice((currentLibraryPage - 1) * libraryPageSize, currentLibraryPage * libraryPageSize);
  const countDone = project.characters.filter(c => c.status === 'done').length;
  const countReady = project.characters.filter(c => c.prompt).length;

  const creativeControls = normalizeCreativeControls(project.creativeControls);
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
  const nav = [{ id: 'overview', label: 'Overview', icon: BarChart3 }, { id: 'collections', label: 'Collections', icon: Layers3 }, { id: 'multi-production', label: 'Multi-Collection Production', icon: ImageIcon }, { id: 'settings', label: 'Settings', icon: Settings2 }];
  const canSwitchCollection = () => {
    const current = latestWorkspace.current;
    const thumbnailDirty = current.tab === 'thumbnails' && !!thumbnailSaveControlsRef.current?.hasUnsaved();
    const collectionDirty = savedProjectSnapshots.current.get(current.project.id) !== JSON.stringify(current.project);
    return !(thumbnailDirty || collectionDirty) || window.confirm('The current collection has unsaved changes. Switch collections? Your edits remain in this tab session; save before a browser reload.');
  };
  const openCollection = (p: Project) => { if (p.id !== project.id && !canSwitchCollection()) return; setLibraryPage(1); setProject(p); setSourceUrl(p.url); setSelected([]); setMessage(''); setTab(nextIncomplete(p)); };
  const openCollectionPrompts = (id: string) => { const target = projects.find(p => p.id === id); if (!target) { setMessage('Collection not found. Refresh collections and retry.'); return; } if (target.id !== project.id && !canSwitchCollection()) return; setLibraryPage(1); setProject(target); setSourceUrl(target.url); setSelected([]); setMessage('Generate the missing image prompts below, then save the collection.'); setTab(target.characters.length ? 'prompts' : 'characters'); };
  const createCollection = () => { if (!canSwitchCollection()) return; const p = blank(); setLibraryPage(1); setProject(p); setSourceUrl(''); setSelected([]); setTab('analysis'); };
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
      <div className="content"><div className="page-head"><div><div className="eyebrow"><Sparkles size={13}/> AI-POWERED CREATIVE PRODUCTION {stepIndex >= 0 && <span> / {title}</span>}</div><h1>{stepIndex >= 0 ? project.name : tab === 'overview' ? 'Your creative command center' : title}</h1><p>{tab === 'overview' ? 'From market insight to an original, production-ready clipart collection.' : tab === 'collections' ? 'Find a saved collection and resume its production pipeline.' : tab === 'analysis' ? 'Turn an Etsy listing into structured, actionable creative intelligence.' : tab === 'characters' ? 'Build, refine and organize 120+ subjects.' : tab === 'prompts' ? 'Generate unique prompts with OpenAI for each character.' : tab === 'thumbnails' ? 'Arrange original clipart freely (including beyond canvas edges), reuse Etsy SEO defaults, and optionally generate expressive AI lettering.' : tab === 'listing-images' ? 'Generate 15 Etsy listing images from original collection PNGs; review and approve each one.' : 'Continue preparing your clipart product.'}</p></div>{stepIndex >= 0 && <div className="head-buttons"><button className="outline-btn" onClick={() => { const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${project.name.replace(/[^\w-]/g,'_')}.json`; a.click(); URL.revokeObjectURL(a.href); }}><Download size={16}/> Export JSON</button></div>}</div>
      {duplicateListing && <div role="alertdialog" aria-label="Previously used Etsy reference" style={{ position: 'fixed', right: 24, top: 88, zIndex: 1000, width: 'min(420px, calc(100vw - 48px))', padding: 18, borderRadius: 14, border: '1px solid #ffc69e', background: '#fff9f3', color: '#53260e', boxShadow: '0 12px 40px #0002' }}><strong>Reference Etsy ini sudah pernah digunakan</strong><p style={{ marginTop: 8, marginBottom: 8 }}>Digunakan dalam collection: {duplicateListing.collections.join(', ')}. Anda tetap bisa memakai URL yang sama untuk collection baru.</p><div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><button type="button" className="outline-btn" onClick={() => setDuplicateListing(null)}>Batal</button><button type="button" className="primary-btn" onClick={() => { setSourceUrl(duplicateListing.url); void loadListingImages(true); }}>Tetap gunakan</button></div></div>}
      {!!message && <div className="notice"><CircleHelp size={17}/><span>{message}</span><button onClick={() => setMessage('')}><X size={16}/></button></div>}
      {hasActiveResearch(project.researchJob) && <section className="panel analysis-progress" aria-live="polite">
        <div className="production-progress"><span><LoaderCircle size={16} className="spin"/> OpenAI research: {project.researchJob?.status === 'submitting' ? 'submitting' : project.researchJob?.status === 'queued' ? 'queued' : 'processing'} (remote)</span>
          <b>{project.researchJob?.completedCount || 0} saved / {project.researchJob?.target} target</b></div>
        <p className="sub">The OpenAI background response continues when this browser or PC is closed. PaletteIQ imports its finished output when the app is next opened. Live percentage is not available from OpenAI.</p>
        {project.researchJob && project.researchJob.target > project.researchJob.requested && <p className="sub">The first remote stage is capped at {project.researchJob.requested} subjects. Use AI Fill for the rest after it completes.</p>}
      </section>}
      {busy === 'analyze' && <div className="panel analysis-progress"><div className="production-progress"><span>Analyzing Etsy images and building {target} original subjects with OpenAI…</span><b>{analysisProgress.done}/{analysisProgress.total}</b></div><div className="progress"><i style={{ width: `${analysisProgress.total ? Math.min(100, 100 * analysisProgress.done / analysisProgress.total) : 0}%` }}/></div><p className="sub">Visual research runs first, then AI generates unique additions in small groups. Please keep this page open until the collection is saved.</p></div>}
      {stepIndex >= 0 && <div className="pipeline-nav"><button className="pipeline-back" onClick={() => navigateTab('collections')}>← All collections</button><div className="pipeline-track">{steps.map((s, i) => <button key={s.id} className={`pipeline-step ${i === stepIndex ? 'current' : ''}`} onClick={() => navigateTab(s.id)}><span>{i + 1}</span>{s.label}</button>)}</div></div>}
      {tab === 'collections' && <><div className="panel collections-toolbar"><div className="collection-search"><Search size={17}/><input aria-label="Search collections" placeholder="Search name, theme, subtheme, or Etsy URL..." value={collectionQuery} onChange={e => setCollectionQuery(e.target.value)}/>{collectionQuery && <button onClick={() => setCollectionQuery('')} aria-label="Clear search"><X size={16}/></button>}</div><select className="collection-sort" aria-label="Sort collections" value={collectionSort} onChange={e => setCollectionSort(e.target.value as typeof collectionSort)}><option value="recent">Recently saved</option><option value="name">Name A–Z</option><option value="subjects">Most characters</option></select><button className="primary-btn" onClick={createCollection}><Plus size={16}/> New collection</button></div><p className="collections-count">Showing {foundCollections.length} of {projects.length} collections</p><div className="collections-main-grid">{foundCollections.map(p => { const done = p.characters.filter(c => c.status === 'done').length; const next = steps.find(s => s.id === nextIncomplete(p)); return <button className="panel collection-main-card" key={p.id} onClick={() => openCollection(p)}><span className="collection-main-theme">{p.theme || 'Theme not set'}</span><span className={p.lastDownloadedAt ? "collection-downloaded-badge" : "collection-download-untracked"} title={p.lastDownloadedAt ? `Last downloaded: ${new Date(p.lastDownloadedAt).toLocaleString()}` : "Download tracking was not available for earlier ZIP exports."}>{p.lastDownloadedAt ? <><Check size={13}/> Downloaded · {p.downloadCount ?? 1}×</> : <><Download size={13}/> No recorded downloads</>}</span><h2>{p.name}</h2><p>{p.subtheme || 'Original clipart collection'}</p><div className="collection-main-stats"><span>{p.characters.length} characters</span><span>{p.characters.filter(c => c.prompt).length} prompts</span><span>{done} images</span></div><div className="collection-download-history"><span><Download size={13}/> Last ZIP: {typeof p.lastDownloadImageCount === "number" ? p.lastDownloadImageCount + " images" : "not recorded"}</span><span>Unique downloaded: {Array.isArray(p.downloadedImageIds) ? p.downloadedImageIds.length + " images" : "not recorded"}</span><span>{p.lastDownloadedAt ? "Last: " + new Date(p.lastDownloadedAt).toLocaleString() : "Earlier ZIP downloads were not tracked"}</span><span className="collection-redownload-hint">ZIP downloads remain available</span></div><div className="collection-main-progress"><i style={{ width: `${p.characters.length ? done / p.characters.length * 100 : 0}%` }}/></div><div className="collection-main-next">Continue: {next?.label} <ArrowRight size={16}/></div></button>; })}</div>{!foundCollections.length && <div className="panel empty-state"><Layers3 size={30}/><strong>{projects.length ? 'No matching collections' : 'No collections saved yet'}</strong><p>{projects.length ? 'Try another search.' : 'Create your first collection to start the pipeline.'}</p><button className="primary-btn" onClick={createCollection}><Plus size={16}/> New collection</button></div>}</>}
      {tab === 'multi-production' && <MultiCollectionProduction onGeneratePrompts={openCollectionPrompts}/>}
      {tab === 'settings' && <StudioSettings preferences={preferences} onPreferences={updatePreferences} projects={[...projects.filter(p => p.id !== project.id), project]}/>}
      {tab === 'overview' && <><div className="stat-grid"><div className="stat"><span>Total subjects</span><strong>{project.characters.length}<small> / {target}</small></strong><div className="stat-foot"><Layers3 size={14}/> Collection coverage</div></div><div className="stat"><span>Unique prompts</span><strong>{countReady}</strong><div className="stat-foot"><BookOpenText size={14}/> Ready for generation</div></div><div className="stat"><span>Images produced</span><strong>{countDone}</strong><div className="stat-foot"><ImageIcon size={14}/> Finished assets</div></div><div className="stat"><span>Target completion</span><strong>{Math.min(100, Math.round(project.characters.length / target * 100))}%</strong><div className="progress"><i style={{ width: `${Math.min(100, project.characters.length / target * 100)}%` }}/></div></div></div>
      <section className="two-col"><div className="panel hero-panel"><div className="panel-heading"><div className="heading-icon violet"><FileSearch size={20}/></div><div><h2>Analyze a product listing</h2><p>Discover themes, style signals, SEO ideas and clipart subjects.</p></div></div><label className="input-label">ETSY LISTING URL</label><div className="url-row"><input placeholder="https://www.etsy.com/listing/123456789/..." value={sourceUrl} onChange={e => setSourceUrl(e.target.value)}/><button className="primary-btn" disabled={!!busy || !sourceUrl} onClick={() => void loadListingImages()}>{busy === 'images' ? <LoaderCircle className="spin" size={16}/> : <Sparkles size={16}/>} Load images <ArrowRight size={16}/></button></div><div className="helper"><CircleHelp size={14}/> Uses Etsy Open API and OpenAI when connected. No unauthorized scraping.</div><div className="workflow"><span><b>01</b> Import listing</span><ArrowRight size={14}/><span><b>02</b> AI insights</span><ArrowRight size={14}/><span><b>03</b> Build collection</span></div></div><div className="panel collection-panel"><div className="panel-heading"><div className="heading-icon amber"><Layers3 size={20}/></div><div><h2>Active collection</h2><p>Customize your production brief.</p></div></div><label className="input-label">COLLECTION NAME</label><input value={project.name} onChange={e => update({ name: e.target.value })}/><label className="input-label">PRIMARY THEME</label><input placeholder="e.g. Woodland Animals" value={project.theme} onChange={e => update({ theme: e.target.value })}/><div className="field-pair"><div><label className="input-label">TARGET SUBJECTS</label><input type="number" min={1} max={1000} value={target} onChange={e => setTarget(Math.max(1, Number(e.target.value) || 120))}/></div><div><label className="input-label">PROGRESS</label><div className="target-status">{project.characters.length >= target ? 'Target reached' : `${target - project.characters.length} to go`}</div></div></div></div></section>
      <section className="panel step-panel"><div className="section-title"><div><h2>Your production pipeline</h2><p>Follow these steps to create a consistent, original clipart bundle.</p></div></div><div className="step-grid">{[{ n:'01', icon: FileSearch, name:'Research & analyze', desc:'Import Etsy market signals', to:'analysis' },{ n:'02', icon: Layers3, name:'Build 120+ subjects', desc:'Expand and customize ideas', to:'characters' },{ n:'03', icon: WandSparkles, name:'Craft unique prompts', desc:'Ensure style consistency', to:'prompts' },{ n:'04', icon: ImageIcon, name:'Generate & review', desc:'Produce individual assets', to:'production' }].map(x => <button className="step" key={x.n} onClick={() => navigateTab(x.to)}><span className="step-no">{x.n}</span><x.icon size={24}/><b>{x.name}</b><small>{x.desc}</small><ArrowRight size={16} className="step-arrow"/></button>)}</div></section></>}
      {tab === 'analysis' && <div className="analysis-grid"><div className="panel"><div className="panel-heading"><div className="heading-icon violet"><Search size={20}/></div><div><h2>Source listing</h2><p>Analyze a listing with connected data sources.</p></div></div><label className="input-label">ETSY PRODUCT LINK</label><div className="field-inline"><input value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="Paste Etsy listing URL"/><button className="primary-btn" disabled={!!busy || !sourceUrl} onClick={() => void loadListingImages()}>{busy === 'images' ? 'Loading…' : 'Load images'}</button></div><div className="settings-fields" style={{ marginTop: 14 }}>
        <div><label className="input-label" htmlFor="source-analysis-provider">IMAGE ANALYSIS PROVIDER</label><select id="source-analysis-provider" value={analysisProvider} disabled={!!busy} onChange={e => { const provider = e.target.value as 'openai' | 'gemini'; setAnalysisProvider(provider); setVisualModel(analysisModels[provider][0]?.id || (provider === 'gemini' ? 'gemini-2.5-pro' : 'gpt-4.1-mini')); }}><option value="openai">OpenAI</option><option value="gemini">Google Gemini</option></select></div>
        <div><label className="input-label" htmlFor="source-analysis-model">VISION MODEL</label><select id="source-analysis-model" value={visualModel} disabled={!!busy} onChange={e => setVisualModel(e.target.value)}>{!analysisModels[analysisProvider].some(m => m.id === visualModel) && <option value={visualModel}>{visualModel} (saved/default)</option>}{analysisModels[analysisProvider].map(m => <option key={m.id} value={m.id}>{m.name} ({m.id})</option>)}</select></div>
      </div><p className="sub">OpenAI analysis can continue remotely after the PC is shut down. Gemini analysis still requires keeping the request/client online.</p>{project.title && project.url === sourceUrl.trim() && <div className="source-card"><strong>{project.title}</strong>{(project.sourceTags || []).length > 0 && <p className="sub">Source tags: {project.sourceTags?.join(' · ')}</p>}{project.sourceDescription && <details><summary>Source description</summary><p className="sub">{project.sourceDescription}</p></details>}{project.url && <a href={project.url} target="_blank" rel="noopener noreferrer">View source <ExternalLink size={13}/></a>}{project.images.length > 0 && <><div className="reference-toolbar"><strong>{(project.selectedImageUrls ?? project.images).length} / {project.images.length} selected</strong><button className="outline-btn" type="button" onClick={() => update({ selectedImageUrls: [...project.images] })}>Select all</button><button className="outline-btn" type="button" onClick={() => update({ selectedImageUrls: [] })}>Clear</button></div><div className="source-images">{project.images.map((src,i) => <label className={`reference-tile ${(project.selectedImageUrls ?? project.images).includes(src) ? 'is-selected' : ''}`} key={src}><input type="checkbox" checked={(project.selectedImageUrls ?? project.images).includes(src)} onChange={e => update({ selectedImageUrls: e.target.checked ? [...(project.selectedImageUrls ?? project.images), src] : (project.selectedImageUrls ?? project.images).filter(x => x !== src) })}/><Image unoptimized width={640} height={640} src={src} alt={`Etsy listing reference ${i + 1}`}/><span>Image {i + 1}</span></label>)}</div><button className="primary-btn wide" disabled={!!busy || hasActiveResearch(project.researchJob) || !(project.selectedImageUrls ?? project.images).length} onClick={runAnalyze}>{hasActiveResearch(project.researchJob) ? 'Background analysis running…' : busy === 'analyze' || busy === 'research-start' ? 'Starting analysis…' : `Analyze ${(project.selectedImageUrls ?? project.images).length} selected images with ${analysisProvider === 'gemini' ? 'Gemini' : 'OpenAI'}`}</button></>}</div>}</div><div className="panel"><h2>Creative intelligence</h2><p className="sub">Review and edit AI findings before production.</p>{[['General theme','theme'],['Sub-theme','subtheme'],['Micro-theme / niche','microtheme'],['Primary keyword','primaryKeyword'],['Visual style','style'],['Color direction','palette'],['Texture','texture']].map(([label,key]) => <div key={key}><label className="input-label">{label.toUpperCase()}</label><input value={String(project[key as keyof Project] ?? '')} onChange={e => update({ [key]: e.target.value })}/></div>)}<label className="input-label">SEO KEYWORDS <span>comma-separated</span></label><textarea rows={3} value={project.keywords.join(', ')} onChange={e => update({ keywords: e.target.value.split(',').map(x => x.trim()).filter(Boolean) })}/><div><label className="input-label">EXPRESSION / MOOD DIRECTION</label>
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
      {tab === 'characters' && <><div className="panel toolbar-panel"><div className="toolbar-left"><label>Target</label><input className="small-input" type="number" min={1} max={1000} value={target} onChange={e=>setTarget(Math.max(1,Number(e.target.value)||120))}/><span className="muted">{project.characters.length} / {target} subjects</span></div><div className="toolbar-right"><button className="outline-btn" onClick={() => addChars([makeChar('New original character','manual')])}><Plus size={15}/> Add character</button><button className="primary-btn" onClick={expand} disabled={!!busy || project.characters.length >= target}>{busy === 'expand' ? <LoaderCircle size={16} className="spin"/> : <Sparkles size={16}/>} AI fill to {target}</button></div></div><div className="panel library-panel"><div className="table-toolbar"><div><h2>Character collection</h2><p>{project.characters.length} concepts · {project.characters.filter(c => c.origin === 'ai').length} AI suggestions · {Object.keys(familyDistribution(project.characters)).length} distinct subject families</p><details><summary>Subject family distribution</summary><p className="sub">{Object.entries(familyDistribution(project.characters)).sort((a,b) => b[1]-a[1]).map(([family,count]) => family + ': ' + count).join(' · ') || 'No subjects yet'}</p></details><details><summary>Character expression distribution</summary><p className="sub">{Object.entries(expressionDistribution(project.characters)).sort((a,b) => b[1]-a[1]).map(([mood,count]) => mood + ': ' + count).join(' · ') || 'No facial expressions assigned yet'}</p></details><details><summary>Concept Diversity QA (before image generation)</summary>
  <p className="sub">Exact duplicate names: {conceptAudit.duplicateNames} · Repeated family silhouettes: {conceptAudit.duplicateSilhouettes} · Distinct families: {conceptAudit.distinctFamilies}</p>
  <p className="sub">Different expressions: {conceptAudit.distinctExpressions} · Color plans: {conceptAudit.distinctColorPlans} · Accessory plans: {conceptAudit.distinctAccessories}</p>
  <p className="sub">Missing shapes: {conceptAudit.missingShape} · Missing silhouettes: {conceptAudit.missingSilhouette} · Missing color plans: {conceptAudit.missingColorPlan}</p>
  <p className="sub">Style DNA: {conceptAudit.hasStyleDNA ? 'available' : 'not analyzed'} · Rendering-quality rules: {conceptAudit.hasRenderingRules ? 'specified' : 'not analyzed'}. This is concept/prompt QA, not an assessment of final image pixels.</p>
</details></div><div className="search-box"><Search size={16}/><input placeholder="Search characters..." value={query} onChange={e => { setQuery(e.target.value); setLibraryPage(1); }}/></div></div><div className="table-scroll"><table><thead><tr><th><input type="checkbox" checked={!!pagedCharacters.length && pagedCharacters.every(c => selected.includes(c.id))} onChange={e=>setSelected(previous => e.target.checked ? [...new Set([...previous, ...pagedCharacters.map(c => c.id)])] : previous.filter(id => !pagedCharacters.some(c => c.id === id)))}/></th><th>CHARACTER / SUBJECT</th><th>FAMILY / SPECIES</th><th>EXPRESSION / FACE</th><th>SHAPE / SILHOUETTE</th><th>ACCESSORIES / COLOR</th><th>ORIGIN</th><th>STATUS</th><th>DETAILS</th><th></th></tr></thead><tbody>{pagedCharacters.map((c,i) => <tr key={c.id}><td><input type="checkbox" checked={selected.includes(c.id)} onChange={e=>setSelected(s=>e.target.checked?[...s,c.id]:s.filter(x=>x!==c.id))}/></td><td><div className="character-name"><span className="char-number">{String((currentLibraryPage - 1) * libraryPageSize + i + 1).padStart(2,'0')}</span><input value={c.name} onChange={e=>updateChar(c.id,{name:e.target.value})}/></div></td><td><input aria-label={`Family for ${c.name}`} placeholder="e.g. cow / pig" value={c.family || ''} onChange={e => updateChar(c.id, { family: e.target.value })}/></td><td><input aria-label={`Expression for ${c.name}`} placeholder="e.g. joyful closed-eye smile" value={c.expression || ''} onChange={e => updateChar(c.id, { expression: e.target.value })}/></td><td><input aria-label={`Shape for ${c.name}`} placeholder="body anatomy" value={c.shape || ''} onChange={e => updateChar(c.id, { shape: e.target.value })}/><input aria-label={`Silhouette for ${c.name}`} placeholder="distinct silhouette" value={c.silhouette || ''} onChange={e => updateChar(c.id, { silhouette: e.target.value })}/></td>
        <td><input aria-label={`Accessories for ${c.name}`} placeholder="accessories" value={c.accessories || ''} onChange={e => updateChar(c.id, { accessories: e.target.value })}/><input aria-label={`Color plan for ${c.name}`} placeholder="color distribution" value={c.colorPlan || ''} onChange={e => updateChar(c.id, { colorPlan: e.target.value })}/></td><td><span className={`tag ${c.origin}`}>{c.origin}</span></td><td><span className={`status ${c.status}`}>{c.status}</span></td><td><input placeholder="Distinctive visual details..." value={c.description} onChange={e=>updateChar(c.id,{description:e.target.value})}/></td><td><button className="icon-btn" title="Delete" onClick={()=>update({characters:project.characters.filter(x=>x.id!==c.id)})}><Trash2 size={16}/></button></td></tr>)}</tbody></table>{!filtered.length && <div className="empty-state"><Layers3 size={32}/><strong>No characters yet</strong><p>Add a subject or use AI to expand your collection.</p></div>}</div><TablePagination total={filtered.length} page={currentLibraryPage} pageSize={libraryPageSize} onPage={setLibraryPage} onPageSize={size => { setLibraryPageSize(size); setLibraryPage(1); }} label="characters"/>{selected.length > 0 && <div className="bulk-bar"><span>{selected.length} selected</span><button className="outline-btn" onClick={()=>update({characters:project.characters.filter(c=>!selected.includes(c.id))})}>Remove selected</button><button className="outline-btn" onClick={()=>setSelected([])}>Clear</button></div>}</div></>}
      {tab === 'prompts' && <><div className="panel toolbar-panel"><div><h2>AI prompt generation</h2><p className="sub">Prompts inherit source title, keywords, general theme, sub-theme, micro-theme, palette, subject family, requested facial expressions and age/cuteness cues. OpenAI uses a durable background Batch; Gemini remains foreground. API usage may incur charges.</p><p className="sub"><b>Context:</b> {project.title || project.name} · {project.theme} / {project.subtheme} / {project.microtheme || 'micro-theme not set'} · {project.primaryKeyword || 'primary keyword not set'} · Mood: {project.emotionDirection || normalizeCreativeAnalysis(project.research).emotionProfile.dominantMood || 'not set'}</p></div><div className="head-buttons"><button className="outline-btn" disabled={!project.characters.some(character => character.prompt.trim())} onClick={() => void copyAllPrompts()}>{copiedAllPrompts ? <Check size={16}/> : <Copy size={16}/>} {copiedAllPrompts ? 'Copied!' : 'Copy All Prompts'}</button><button className="primary-btn" disabled={!!busy || hasActivePromptJob(project.promptJob) || !project.characters.length} onClick={() => generatePrompts()}>{busy === 'prompts' ? <LoaderCircle size={16} className="spin"/> : <WandSparkles size={16}/>} {hasActivePromptJob(project.promptJob) ? 'OpenAI Batch running…' : busy === 'prompt-start' ? 'Submitting background Batch…' : busy === 'prompts' ? `Generating ${promptProgress.done}/${promptProgress.total}` : selected.length ? `Generate ${selected.length} AI prompts` : promptProvider === 'openai' ? 'Generate prompts in background' : 'Generate all AI prompts'}</button></div></div><div className="panel settings-fields"><div><label className="input-label">PROMPT AI PROVIDER</label><select disabled={!!busy || hasActivePromptJob(project.promptJob)} value={promptProvider} onChange={e => { const provider = e.target.value as 'openai' | 'gemini'; setPromptProvider(provider); setPromptModel(analysisModels[provider][0]?.id || (provider === 'gemini' ? 'gemini-2.5-pro' : 'gpt-4.1-mini')); }}><option value="openai">OpenAI</option><option value="gemini">Google Gemini</option></select></div><div><label className="input-label">PROMPT MODEL</label><select disabled={!!busy || hasActivePromptJob(project.promptJob)} value={promptModel} onChange={e => setPromptModel(e.target.value)}>{!analysisModels[promptProvider].some(m => m.id === promptModel) && <option value={promptModel}>{promptModel} (saved/default)</option>}{analysisModels[promptProvider].map(m => <option key={m.id} value={m.id}>{m.name} ({m.id})</option>)}</select></div>{analysisModelsError && <p className="sub">{analysisModelsError}</p>}</div>{creativeControlsEditor}{project.promptJob && <div className="panel" aria-live="polite">
        <div className="production-progress"><span>OpenAI Prompt Batch · {project.promptJob.status}</span>
          <b>{project.promptJob.processedGroups}/{project.promptJob.totalGroups} groups · {project.promptJob.imported}/{project.promptJob.total} imported</b></div>
        <div className="progress"><i style={{ width: `${project.promptJob.totalGroups ? 100 * project.promptJob.processedGroups / project.promptJob.totalGroups : 0}%` }}/></div>
        <p className="sub">After OpenAI accepts this Batch, its processing continues even when this PC is off. Completed prompts are imported when PaletteIQ reconnects. Import never silently replaces a prompt edited during the job.</p>
        {project.promptJob.error && <p className="sub">{project.promptJob.error}</p>}
      </div>}
      {busy === 'prompts' && <div className="panel"><div className="production-progress"><span>AI prompt progress</span><b>{promptProgress.done}/{promptProgress.total}</b></div><div className="progress"><i style={{ width: `${promptProgress.total ? 100 * promptProgress.done / promptProgress.total : 0}%` }}/></div></div>}<div className="prompt-grid">{project.characters.map((c,i)=><div className="panel prompt-card" key={c.id}><div className="prompt-top"><span className="char-number">{String(i+1).padStart(3,'0')}</span><b>{c.name}</b><span className={`status ${c.prompt ? 'ready' : 'draft'}`}>{c.prompt ? 'Ready' : 'Draft'}</span></div><textarea rows={6} placeholder="Generate an OpenAI prompt or customize one manually..." value={c.prompt} disabled={hasActivePromptJob(project.promptJob)} onChange={e=>updateChar(c.id,{prompt:e.target.value,status:'ready'})}/><div className="prompt-bottom"><small>{c.prompt.length} characters</small><button disabled={!!busy || hasActivePromptJob(project.promptJob)} onClick={()=>generatePrompts([c.id])}><WandSparkles size={14}/> Regenerate with AI</button></div></div>)}</div>{!project.characters.length && <div className="panel empty-state"><BookOpenText size={32}/><strong>No prompts to show</strong><p>Build your character library first.</p></div>}</>}
      {tab === 'production' && <ImageProduction key={project.id} project={project} model={model} quality={quality} onModel={setModel} onQuality={setQuality} onDownloaded={(receipt) => { setProject(prev => ({ ...prev, ...receipt })); setProjects(prev => prev.map(item => item.id === project.id ? { ...item, ...receipt } : item)); }} onAsset={(id,fields) => updateChar(id,fields)} onUpscaleChange={updateUpscaleChar} onUpscaleBatch={updateUpscaleBatch}/>}
      {isStudioTabEnabled('thumbnails') && tab === 'thumbnails' && <ThumbnailDesigner key={project.id} collectionVisualSettings={{ style: project.style, palette: project.palette, texture: project.texture }} registerSaveControls={controls => { thumbnailSaveControlsRef.current = controls; }} title={project.subtheme || project.theme || project.name} seoListing={project.listing} aiDefaults={{ provider: preferences.seoProvider ?? 'openai', openaiModel: preferences.seoOpenaiModel ?? 'gpt-4.1-mini', geminiModel: preferences.seoGeminiModel ?? 'gemini-2.5-pro' }} projectId={project.id} characters={project.characters} references={project.images} designs={project.thumbnails || []} onChange={thumbnails => update({ thumbnails })} onSave={async thumbnails => { const updated = { ...project, thumbnails }; await api({ action: 'save', id: updated.id, name: updated.name, data: updated }); setProject(updated); setProjects(prev => [updated, ...prev.filter(p => p.id !== updated.id)]); }}/>}
      {isStudioTabEnabled('listing-images') && tab === 'listing-images' && <EtsyListingImageStudio key={project.id} projectId={project.id} name={project.name} theme={project.theme} subtheme={project.subtheme} style={project.style} palette={project.palette} texture={project.texture} seoTitle={project.listing?.title} primaryKeyword={project.listing?.primaryKeyword} defaultImageModel={preferences.model} defaultImageQuality={preferences.quality} characters={project.characters} onSaved={listingImages => update({ listingImages })}/>}
      {tab === 'listing' && <EtsyListingDraft project={project} seoProvider={preferences.seoProvider ?? 'openai'} seoGeminiModel={preferences.seoGeminiModel ?? 'gemini-2.5-pro'} seoOpenaiModel={preferences.seoOpenaiModel ?? 'gpt-6.1-terra'} seoDraftFields={preferences.seoDraftFields ?? defaultSeoDraftFields} seoTitleMaxLength={preferences.seoTitleMaxLength ?? 120} seoAltTextCount={preferences.seoAltTextCount ?? 10} onDownloaded={(receipt) => { setProject(prev => ({ ...prev, ...receipt })); setProjects(prev => prev.map(item => item.id === project.id ? { ...item, ...receipt } : item)); }} onChange={listing => update({ listing })} onSave={async () => { await api({ action: 'save', id: project.id, name: project.name, data: project }); setProjects(prev => [project, ...prev.filter(p => p.id !== project.id)]); }} onSeoReview={async seoReview => { const updated = { ...project, seoReview }; await api({ action: 'save', id: updated.id, name: updated.name, data: updated }); setProject(updated); setProjects(prev => [updated, ...prev.filter(p => p.id !== updated.id)]); }}/>}
      {stepIndex >= 0 && <div className="panel pipeline-footer"><button className="outline-btn" onClick={() => navigateTab(stepIndex ? steps[stepIndex - 1].id : 'collections')}>{stepIndex ? `← ${steps[stepIndex - 1].label}` : '← Collections'}</button><span>Step {stepIndex + 1} of {steps.length}</span><button className="primary-btn" disabled={!!busy} onClick={advance}>{busy === 'save' ? 'Saving…' : stepIndex < steps.length - 1 ? `Save & next: ${steps[stepIndex + 1].label}` : 'Save & back to collections'} <ArrowRight size={16}/></button></div>}
      <footer>paletteIQ · Independent clipart research and creation studio. Not affiliated with Etsy. Source listings are inspiration for original designs.</footer></div></main>
  </div>;
}
