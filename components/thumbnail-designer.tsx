'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import UpscaleCompare from '@/components/upscale-compare';
import { readApiJson } from '@/lib/listing-image-upload';
import type { ListingStudioConfig } from '@/lib/listing-studio-config';
import { fitClipartAroundTypography, type ThumbnailBox } from '@/lib/thumbnail-fit';
import { buildThumbnailDesignBrief, type ThumbnailBriefSettings } from '@/lib/thumbnail-design-brief';
import { buildPack, filterThemeCharacters, placeOriginals, type PackPreset, type PackSlide, type ClipartHierarchy } from '@/lib/etsy-listing-pack';
import { Download, Plus, Trash2, Copy, Undo2, Redo2, WandSparkles, RotateCcw } from 'lucide-react';

export type ThumbnailElement = {
  id: string; type: 'image' | 'text'; characterId?: string; source?: 'original' | 'upscaled';
  text?: string; x: number; y: number; width: number; height: number; rotation: number;
  fontSize?: number; curve?: number; fontFamily?: string; color?: string; fontWeight?: string; opacity?: number; locked?: boolean;
};
export type ThumbnailDesign = {
  id: string; name: string; width: number; height: number; background: string; backgroundImageUrl?: string; aiImageUrl?: string; aiImagePrompt?: string; renderedImageUrl?: string; upscaledImageUrl?: string; upscaleJob?: { id: string; sourceUrl: string; factor: 2 | 4 | 6 | 8; submittedAt: number }; elements: ThumbnailElement[];
  referenceUrl?: string; originalAssetsOnly?: boolean; generationError?: string; updatedAt: number;
  rejectedBackgroundUrl?: string; rejectedBackgroundReason?: string;
  packTypography?: 'editable' | 'ai-artwork'; packSlideKey?: string; packHeadline?: string; packSubtitle?: string; packBadge?: string; packTextZone?: { x: number; y: number; width: number; height: number };
  packImageProvider?: 'openai' | 'gemini'; packImageModel?: string;
  packHierarchy?: ClipartHierarchy; packBoldness?: 'soft' | 'balanced' | 'bold'; packCoverStyle?: 'editorial' | 'boutique' | 'storybook' | 'modern' | 'watercolor';
  referenceDesign?: { graphicMotif?: string; letteringStyle?: string; paletteMood?: string };
};
type Character = { id: string; name: string; imageUrl?: string; upscaledImageUrl?: string; category?: string; subtheme?: string; group?: string };
export type ThumbnailSaveControls = { save: () => Promise<void>; hasUnsaved: () => boolean };
type Props = { onStartListingStudio?: (settings: ListingStudioConfig) => void | Promise<void>; registerSaveControls?: (controls: ThumbnailSaveControls | null) => void; title: string; collectionVisualSettings?: {style?: string; palette?: string; texture?: string}; aiDefaults: { provider: 'openai' | 'gemini'; openaiModel: string; geminiModel: string }; projectId: string; characters: Character[]; references: string[]; designs: ThumbnailDesign[]; onChange: (designs: ThumbnailDesign[]) => void; onSave: (designs: ThumbnailDesign[]) => Promise<void> };
const id = () => crypto.randomUUID();
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const THUMBNAIL_SIZE = 1024;
const newDesign = (index: number): ThumbnailDesign => ({ id: id(), name: 'Thumbnail ' + index, width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE, background: '#f7f1e9', elements: [], packSubtitle: 'Digital Clipart Collection', packTextZone: { x: 22, y: 30, width: 56, height: 34 }, updatedAt: Date.now() });
const newImage = (character: Character, index: number, preferredSource: 'auto' | 'original' | 'upscaled' = 'auto'): ThumbnailElement => ({
  id: id(), type: 'image', characterId: character.id, source: preferredSource === 'auto' ? (character.upscaledImageUrl ? 'upscaled' : 'original') : preferredSource,
  x: 10 + (index % 4) * 21, y: 17 + (Math.floor(index / 4) % 3) * 25, width: 22, height: 28, rotation: 0
});
const newText = (title = 'YOUR CLIPART COLLECTION'): ThumbnailElement => ({ id: id(), type: 'text', text: title, x: 9, y: 7, width: 82, height: 14, rotation: 0, fontSize: 90, curve: 0, fontFamily: 'Arial', color: '#644a35', fontWeight: 'bold' });
const normalizeDesign = (d: ThumbnailDesign): ThumbnailDesign => ({ ...d, width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE, updatedAt: Date.now() });

function CurvedText({ element, designWidth }: { element: ThumbnailElement; designWidth: number }) {
  const curve = clamp(element.curve || 0, -100, 100);
  const lines = (element.text || '').split('\n');
  const fontSize = clamp((element.fontSize || 80) / (designWidth * element.width / 100) * 1000, 18, 300);
  return <svg width="100%" height="100%" viewBox="0 0 1000 400" preserveAspectRatio="none" style={{ overflow: 'hidden', pointerEvents: 'none' }} aria-label={element.text || ''}>
    <defs>{lines.map((_, i) => <path key={i} id={`thumbnail-arc-${element.id}-${i}`} d={`M 25 ${200 + (i-(lines.length-1)/2)*fontSize*1.2} Q 500 ${200 + (i-(lines.length-1)/2)*fontSize*1.2 - curve*2.0} 975 ${200 + (i-(lines.length-1)/2)*fontSize*1.2}`}/>)}</defs>
    {lines.map((line, i) => <text key={i} fill={element.color || '#333333'} fontFamily={element.fontFamily || 'Arial'} fontWeight={element.fontWeight || 'bold'} fontSize={fontSize} textAnchor="middle" dominantBaseline="middle">
      <textPath href={`#thumbnail-arc-${element.id}-${i}`} startOffset="50%">{line}</textPath>
    </text>)}
  </svg>;
}

async function loadForExport(url: string): Promise<HTMLImageElement> {
  const image = new window.Image();
  image.crossOrigin = 'anonymous';
  image.src = url;
  await image.decode();
  return image;
}
export default function ThumbnailDesigner({ onStartListingStudio, registerSaveControls, title, collectionVisualSettings, aiDefaults, projectId, characters, references, designs, onChange, onSave }: Props) {
  const [activeId, setActiveId] = useState(designs[0]?.id || '');
  const [selectedId, setSelectedId] = useState('');
  const [previewZoom, setPreviewZoom] = useState(1);
  const [sideTab, setSideTab] = useState<'reference' | 'generation'>('reference');
  const [viewportSize, setViewportSize] = useState({ width: 300, height: 300 });
  const [reference, setReference] = useState('');
  const [uploadedReference, setUploadedReference] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [generationScope, setGenerationScope] = useState<'single' | PackPreset>('single');
  const [singleSlideKey, setSingleSlideKey] = useState('hero');
  const [coverHeadline, setCoverHeadline] = useState('');
  const [packQuality, setPackQuality] = useState<'low' | 'medium' | 'high'>('medium');
  const [packTypography, setPackTypography] = useState<'editable' | 'ai-artwork'>('ai-artwork');
  const [packHierarchy, setPackHierarchy] = useState<ClipartHierarchy>('dramatic');
  const [packBoldness, setPackBoldness] = useState<'soft' | 'balanced' | 'bold'>('bold');
  const [packCoverStyle, setPackCoverStyle] = useState<'editorial' | 'boutique' | 'storybook' | 'modern' | 'watercolor'>('editorial');
  const [packStatus, setPackStatus] = useState('');
  const [backgroundRetryId, setBackgroundRetryId] = useState('');
  const cancelPackRef = useRef(false);
  const [referenceStyle, setReferenceStyle] = useState<'creative' | 'similar' | 'palette'>('similar');
  const [comparePreview, setComparePreview] = useState<{ name: string; originalUrl: string; upscaledUrl: string; temporary?: boolean } | null>(null);
  useEffect(() => () => { if (comparePreview?.temporary) URL.revokeObjectURL(comparePreview.originalUrl); }, [comparePreview]);
  const [upscaleBusy, setUpscaleBusy] = useState(false);
  const [upscaleFactor, setUpscaleFactor] = useState<2 | 4 | 6 | 8>(4);
  const [selectedThumbnailIds, setSelectedThumbnailIds] = useState<Set<string>>(() => new Set());
  const [upscaleSubmitting, setUpscaleSubmitting] = useState({ done: 0, total: 0 });
  const [upscaleStatus, setUpscaleStatus] = useState('');
  const [upscaleJobs, setUpscaleJobs] = useState<Record<string, { status: string; elapsed?: number; remaining?: number | null; error?: string }>>({});
  const [upscaleRemaining, setUpscaleRemaining] = useState<Record<string, number | null>>({});
  const [imageModel, setImageModel] = useState('gpt-image-1-mini');
  const [imageProvider, setImageProvider] = useState<'openai' | 'gemini'>('openai');
  const [geminiImageModel, setGeminiImageModel] = useState('gemini-2.5-flash-image');
  const [imageModels, setImageModels] = useState<Array<{ id: string; name: string }>>([]);
  const [layoutMode, setLayoutMode] = useState<'ai' | 'manual'>('ai');
  const startListingStudio = () => onStartListingStudio?.({
    layoutMode, analysisProvider: provider, analysisModel: model,
    imageModel, quality: packQuality, typography: 'ai-artwork',
    boldness: packBoldness, hierarchy: packHierarchy, coverStyle: packCoverStyle,
    backgroundStyle, intensity: backgroundIntensity, referenceStyle,
    referenceImage: reference || undefined, headline: coverHeadline.trim() || undefined
  });
  const [provider, setProvider] = useState<'openai' | 'gemini'>(aiDefaults.provider);
  const [model, setModel] = useState(aiDefaults.provider === 'gemini' ? aiDefaults.geminiModel : aiDefaults.openaiModel);
  const [models, setModels] = useState<Record<string, Array<{ id: string; name: string }>>>({ openai: [], gemini: [] });
  const [modelError, setModelError] = useState('');
  useEffect(() => {
    let live = true;
    void Promise.all((['openai','gemini'] as const).map(async kind => {
      try {
        const response = await fetch('/api/settings?models=' + (kind === 'openai' ? 'openai-seo' : 'gemini'));
        const result = await response.json() as { models?: Array<{ id: string; name: string }>; error?: string };
        if (!response.ok) throw Error(result.error || 'Model list unavailable');
        if (live) setModels(prev => ({ ...prev, [kind]: result.models || [] }));
      } catch (error) { if (live) setModelError(error instanceof Error ? error.message : String(error)); }
    }));
    return () => { live = false; };
  }, []);
  useEffect(() => {
    let live = true;
    void fetch('/api/settings?models=openai').then(async r => {
      const result = await r.json() as { models?: Array<{ id: string; name: string }> };
      if (live && r.ok) setImageModels(result.models || []);
    }).catch(() => {});
    return () => { live = false; };
  }, []);
  useEffect(() => {
    const linkId = 'paletteiq-thumbnail-fonts';
    if (document.getElementById(linkId)) return;
    const link = document.createElement('link');
    link.id = linkId; link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Architects+Daughter&family=Bangers&family=Chewy&family=Courgette&family=Dancing+Script:wght@400;700&family=Gloria+Hallelujah&family=Indie+Flower&family=Josefin+Sans:wght@400;700&family=Kaushan+Script&family=Petit+Formal+Script&family=Playball&family=Sacramento&family=Tangerine:wght@400;700&family=Yeseva+One&family=Abril+Fatface&family=Allura&family=Amatic+SC:wght@400;700&family=Bebas+Neue&family=Caveat:wght@400;700&family=Fredericka+the+Great&family=Kalam:wght@400;700&family=Lobster+Two:wght@400;700&family=Oswald:wght@400;700&family=Pacifico&family=Patrick+Hand&family=Permanent+Marker&family=Rye&family=Satisfy&family=Special+Elite&family=Bodoni+Moda:wght@400;700&family=Cinzel:wght@400;700&family=Cormorant+Garamond:wght@400;700&family=DM+Serif+Display&family=EB+Garamond:wght@400;700&family=Great+Vibes&family=Libre+Baskerville:wght@400;700&family=Lora:wght@400;700&family=Marcellus&family=Montserrat:wght@400;700&family=Playfair+Display:wght@400;700&family=Poppins:wght@400;700&family=Prata&family=Raleway:wght@400;700&display=swap';
    document.head.appendChild(link);
  }, []);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [backgroundUploading, setBackgroundUploading] = useState(false);
  const [backgroundGenerating, setBackgroundGenerating] = useState(false);
  const [backgroundStyle, setBackgroundStyle] = useState<'watercolor' | 'paper' | 'gradient' | 'botanical' | 'vintage'>('watercolor');
  const [backgroundIntensity, setBackgroundIntensity] = useState<'soft' | 'balanced' | 'vibrant'>('balanced');
  const [backgroundLoadError, setBackgroundLoadError] = useState('');
  const [history, setHistory] = useState<ThumbnailDesign[]>([]);
  const [future, setFuture] = useState<ThumbnailDesign[]>([]);
  const saveRendersRef = useRef<(snapshot: ThumbnailDesign[]) => Promise<void>>(onSave);
  const latestSaveRef = useRef(onSave);
  latestSaveRef.current = onSave;
  const lastSavedDesignsRef = useRef(JSON.stringify(designs));
  const latestDesignsRef = useRef(designs);
  latestDesignsRef.current = designs;
  const registeredControlsRef = useRef<ThumbnailSaveControls>({
    save: async () => {},
    hasUnsaved: () => false
  });
  const registrationRef = useRef(registerSaveControls);
  registrationRef.current = registerSaveControls;
  useEffect(() => {
    registrationRef.current?.(registeredControlsRef.current);
    return () => registrationRef.current?.(null);
  }, [projectId]);
  const lastScheduledDesignsRef = useRef(JSON.stringify(designs));
  useEffect(() => {
    const serialized = JSON.stringify(designs);
    if (serialized === lastScheduledDesignsRef.current) return;
    lastScheduledDesignsRef.current = serialized;
    const timeout = window.setTimeout(() => {
      void saveRendersRef.current(designs).catch(error => {
        setMessage('Automatic thumbnail save failed: ' + (error instanceof Error ? error.message : String(error)));
      });
    }, 1300);
    return () => window.clearTimeout(timeout);
  }, [designs, projectId]);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasViewportRef = useRef<HTMLDivElement>(null);
  const galleryStripRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null);
  const scrollGallery = (direction: -1 | 1) => galleryStripRef.current?.scrollBy({ left: direction * Math.max(180, (galleryStripRef.current?.clientWidth || 600) * .75), behavior: 'smooth' });
  const zoomWithWheel = (event: WheelEvent) => {
    event.preventDefault();
    const viewport = canvasViewportRef.current;
    if (!viewport) return;
    const bounds = viewport.getBoundingClientRect();
    const pointX = event.clientX - bounds.left;
    const pointY = event.clientY - bounds.top;
    const previousZoom = previewZoom;
    const nextZoom = clamp(previousZoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12), .5, 5);
    const ratio = nextZoom / previousZoom;
    const previousLeft = viewport.scrollLeft, previousTop = viewport.scrollTop;
    setPreviewZoom(nextZoom);
    requestAnimationFrame(() => {
      viewport.scrollLeft = (previousLeft + pointX) * ratio - pointX;
      viewport.scrollTop = (previousTop + pointY) * ratio - pointY;
    });
  };
  useEffect(() => {
    const viewport = canvasViewportRef.current;
    if (!viewport) return;
    viewport.addEventListener('wheel', zoomWithWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', zoomWithWheel);
  }, [previewZoom, activeId, designs.length]);
  const startPan = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (event.button !== 0 || target.closest('[data-thumbnail-element="true"]')) return;
    const viewport = canvasViewportRef.current;
    if (!viewport) return;
    panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const movePan = (event: React.PointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    const viewport = canvasViewportRef.current;
    if (!pan || !viewport || pan.pointerId !== event.pointerId) return;
    viewport.scrollLeft = pan.left - (event.clientX - pan.x);
    viewport.scrollTop = pan.top - (event.clientY - pan.y);
  };
  const stopPan = () => { panRef.current = null; };
  const dragRef = useRef<{ id: string; mode: 'move' | 'resize' | 'rotate'; x: number; y: number; original: ThumbnailElement; centerX?: number; centerY?: number; startAngle?: number } | null>(null);
  const design = designs.find(d => d.id === activeId) || designs[0];
  useEffect(() => {
    const viewport = canvasViewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setViewportSize({ width: Math.max(1, Math.floor(width)), height: Math.max(1, Math.floor(height)) });
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [Boolean(design)]);
  useEffect(() => {
    if (previewZoom <= 1 && canvasViewportRef.current) {
      canvasViewportRef.current.scrollLeft = 0;
      canvasViewportRef.current.scrollTop = 0;
    }
  }, [previewZoom, activeId]);
  const canvasAspect = design ? design.width / design.height : 1;
  const fittedWidth = Math.min(viewportSize.width, viewportSize.height * canvasAspect);
  const fittedHeight = fittedWidth / canvasAspect;
  const selection = design?.elements.find(e => e.id === selectedId);
  const assetMap = useMemo(() => new Map(characters.map(c => [c.id, c])), [characters]);
  useEffect(() => { if (designs.length && !designs.some(d => d.id === activeId)) setActiveId(designs[0].id); }, [activeId, designs]);
  useEffect(() => { setHistory([]); setFuture([]); setSelectedId(''); }, [activeId, projectId]);
  useEffect(() => {
    // Older builds positioned added assets using their library index, sometimes far below the canvas.
    if (!designs.some(d => d.elements.some(e => e.type === 'image' && (e.y > 100 || e.x > 100)))) return;
    onChange(designs.map(d => ({ ...d, elements: d.elements.map((e, index) =>
      e.type === 'image' && (e.y > 100 || e.x > 100)
        ? { ...e, x: newImage(characters.find(c => c.id === e.characterId) || { id: '', name: '' }, index).x, y: newImage(characters.find(c => c.id === e.characterId) || { id: '', name: '' }, index).y }
        : e) })));
  }, [designs, characters, onChange]);

  const commit = (next: ThumbnailDesign, record = true) => {
    if (record && design) { setHistory(old => [...old.slice(-29), design]); setFuture([]); }
    const safeNext = next.originalAssetsOnly ? { ...next, elements: next.elements.map(e => e.type === 'image' ? { ...e, source: 'original' as const } : e) } : next;
    onChange(designs.map(d => d.id === next.id ? normalizeDesign(safeNext) : d));
  };
  const mutate = (changes: Partial<ThumbnailDesign>) => { if (design) commit({ ...design, ...changes }); };
  const updateElement = (changes: Partial<ThumbnailElement>, record = true) => {
    if (!design || !selection) return;
    commit({ ...design, elements: design.elements.map(e => e.id === selection.id ? { ...e, ...changes } : e) }, record);
  };
  const add = (element: ThumbnailElement) => { if (design) { const safe = design.originalAssetsOnly && element.type === 'image' ? { ...element, source: 'original' as const } : element; commit({ ...design, elements: [...design.elements, safe] }); setSelectedId(element.id); } };
  const remove = () => { if (design && selection) { commit({ ...design, elements: design.elements.filter(e => e.id !== selection.id) }); setSelectedId(''); } };
  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (!selectedId || !design || target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      const element = design.elements.find(e => e.id === selectedId);
      if (!element || element.locked) return;
      event.preventDefault();
      onChange(designs.map(item => item.id === design.id ? { ...item, elements: item.elements.filter(e => e.id !== selectedId) } : item));
      setSelectedId('');
    };
    window.addEventListener('keydown', keyDown);
    return () => window.removeEventListener('keydown', keyDown);
  }, [selectedId, design, designs, onChange]);

  const create = () => { const next = newDesign(designs.length + 1); onChange([...designs, next]); setActiveId(next.id); };
  const duplicate = () => { if (!design) return; const copy = { ...design, id: id(), name: design.name + ' copy', elements: design.elements.map(e => ({ ...e, id: id() })), updatedAt: Date.now() }; onChange([...designs, copy]); setActiveId(copy.id); };
  const deleteThumbnail = (thumbnailId: string) => {
    const target = latestDesignsRef.current.find(d => d.id === thumbnailId);
    if (!target || !window.confirm('Delete thumbnail "' + target.name + '" from this collection? Original clipart assets will not be deleted.')) return;
    if (target.upscaleJob) { setMessage('This thumbnail has an active GPU upscale job. Let it complete before deleting the design.'); return; }
    const next = latestDesignsRef.current.filter(d => d.id !== thumbnailId);
    latestDesignsRef.current = next;
    onChange(next);
    setSelectedThumbnailIds(old => { const updated = new Set(old); updated.delete(thumbnailId); return updated; });
    if (activeId === thumbnailId) setActiveId(next[0]?.id || '');
    setMessage('Thumbnail removed from this collection. Save designs to persist the change.');
  };
  const removeDesign = () => { if (design) deleteThumbnail(design.id); };
  const undo = () => { if (!history.length || !design) return; const previous = history[history.length - 1]; setHistory(history.slice(0, -1)); setFuture(old => [...old, design]); commit(previous, false); };
  const redo = () => { if (!future.length || !design) return; const next = future[future.length - 1]; setFuture(future.slice(0, -1)); setHistory(old => [...old, design]); commit(next, false); };
  const imageUrl = (e: ThumbnailElement) => {
    const character = assetMap.get(e.characterId || '');
    // Never silently fall back to an upscaled file when the layer explicitly requests original.
    return e.source === 'upscaled' ? character?.upscaledImageUrl || character?.imageUrl : character?.imageUrl;
  };
  const startDrag = (event: React.PointerEvent<HTMLElement>, element: ThumbnailElement, mode: 'move' | 'resize' | 'rotate') => {
    if (element.locked || !stageRef.current) return;
    event.stopPropagation(); event.preventDefault(); setSelectedId(element.id);
    const bounds = stageRef.current.getBoundingClientRect();
    const centerX = bounds.left + (element.x + element.width / 2) / 100 * bounds.width;
    const centerY = bounds.top + (element.y + element.height / 2) / 100 * bounds.height;
    dragRef.current = { id: element.id, mode, x: event.clientX, y: event.clientY, original: { ...element }, centerX, centerY, startAngle: Math.atan2(event.clientY - centerY, event.clientX - centerX) };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (design) setHistory(old => [...old.slice(-29), design]);
    setFuture([]);
  };
  const moveDrag = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const bounds = stageRef.current?.getBoundingClientRect();
    if (!drag || !bounds || !design) return;
    const dx = (event.clientX - drag.x) / bounds.width * 100;
    const dy = (event.clientY - drag.y) / bounds.height * 100;
    const next = drag.mode === 'rotate'
      ? { rotation: Math.round(drag.original.rotation + (Math.atan2(event.clientY - (drag.centerY || 0), event.clientX - (drag.centerX || 0)) - (drag.startAngle || 0)) * 180 / Math.PI) }
      : drag.mode === 'move'
      ? { x: clamp(drag.original.x + dx, -100, 200), y: clamp(drag.original.y + dy, -100, 200) }
      : { width: clamp(drag.original.width + dx, 1, 200), height: clamp(drag.original.height + dy, 1, 200) };
    commit({ ...design, elements: design.elements.map(e => e.id === drag.id ? { ...e, ...next } : e) }, false);
  };
  const endDrag = () => { dragRef.current = null; };
  // Exact human-readable typography. Unlike AI-rendered lettering, this cannot
  // hallucinate random words, and can be edited after generation.
  const typographyForSlide = (slide: PackSlide): ThumbnailElement[] => {
    const z = slide.textZone;
    const hero = slide.layout === 'hero';
    const boutique = slide.layout === 'boutique';
    const headline = slide.headline.trim();
    const cut = headline.length > 20 ? headline.lastIndexOf(' ', 20) : -1;
    const exactTitle = cut > 7 ? headline.slice(0, cut) + '\n' + headline.slice(cut + 1) : headline;
    const x = z.x + 3, width = z.width - 6;
    const ink = '#244c40';
    const eyebrowY = z.y + z.height * (boutique ? .17 : .08);
    const titleY = z.y + z.height * (boutique ? .29 : hero ? .25 : .27);
    const titleHeight = z.height * (boutique ? .32 : hero ? .46 : .45);
    const captionY = z.y + z.height * (boutique ? .70 : hero ? .78 : .78);
    const eyebrow: ThumbnailElement = {
      ...newText(slide.layout === 'hero' ? 'THE ARTWORK COLLECTION' : 'A CURATED CLIPART COLLECTION'),
      x, y: eyebrowY, width, height: Math.max(3,z.height*.10),
      fontSize: 25, fontFamily: 'Montserrat', fontWeight: 'normal',
      color: '#926a4f', rotation: 0
    };
    const main: ThumbnailElement = {
      ...newText(exactTitle), x, y: titleY, width, height: titleHeight,
      fontSize: hero ? 108 : boutique ? 104 : 90,
      fontFamily: 'Playfair Display', fontWeight: 'bold', color: ink, rotation: 0
    };
    const caption: ThumbnailElement = {
      ...newText(slide.subtitle),
      x:x+1,y:captionY,width:width-2,height:Math.max(4,z.height*.10),
      fontSize: 31, fontFamily: 'Montserrat', fontWeight: 'normal',
      color: '#8a624a', rotation: 0
    };
    return [eyebrow,main,caption];
  };

  // Vision planning always happens AFTER the AI background exists.
  // Only the layout planner can see the finished artwork; the image generator
  // never receives original PNGs and never draws their substitutes.
  const placeOriginalsOverBackground = async (
    slide: PackSlide, imageUrl: string, fallback: ThumbnailElement[],
    available: Character[], hierarchy: ClipartHierarchy, coverStyle: typeof packCoverStyle
  ): Promise<{ elements: ThumbnailElement[]; usedFallback: boolean }> => {
    const imageElements = fallback.filter(e => e.type === 'image' && e.characterId);
    if (!imageElements.length) return { elements: fallback, usedFallback: true };
    const catalogue = slide.layout === 'grid' || slide.layout === 'showcase';
    const fit = (items: ThumbnailElement[], titleAreas: ThumbnailBox[], subtitleAreas: ThumbnailBox[]) =>
      fitClipartAroundTypography(items, titleAreas, subtitleAreas, {
        grid: catalogue, titlePadding: 5, subtitlePadding: 3, maxArtworkOverlap: .30,
        minScale: hierarchy === 'soft' ? .75 : hierarchy === 'medium' ? .65 : .55
      });
    // Safe fallback must never paint original clipart over the known typography area.
    const safeFallback = fit(imageElements, [slide.textZone], []);
    try {
      const response = await fetch('/api/thumbnail-art-direction', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId, backgroundImageUrl: imageUrl, slideKey: slide.key, slideName: slide.name,
          headline: slide.headline, subtitle: slide.subtitle, textZone: slide.textZone,
          characters: imageElements.map(e => {
            const character = available.find(c => c.id === e.characterId);
            return { id: e.characterId, name: character?.name || e.characterId };
          }),
          hierarchy, coverStyle,
          suggestedSlots: imageElements.map(e => ({
            characterId: e.characterId, x: e.x, y: e.y, width: e.width, height: e.height
          }))
        })
      });
      const result = await response.json() as {
        error?: string; detectedTitleZone?: ThumbnailBox; detectedSubtitleZone?: ThumbnailBox;
        slots?: Array<{characterId: string; x: number; y: number; width: number; height: number; rotation: number}>;
      };
      const expectedMin = Math.min(imageElements.length, slide.layout === 'grid' || slide.layout === 'showcase' ? 4 : 3);
      if (!response.ok || !result.slots || result.slots.length < expectedMin)
        throw Error(result.error || 'Vision returned too few original PNG positions');
      const selected = result.slots
        .map(slot => {
          const element = imageElements.find(e => e.characterId === slot.characterId);
          return element ? { ...element, ...slot, source: 'original' as const } : null;
        })
        .filter(element => element !== null) as ThumbnailElement[];
      if (selected.length < expectedMin) throw Error('Vision returned insufficient valid original PNGs');
      const fitted = fit(selected, [slide.textZone, ...(result.detectedTitleZone ? [result.detectedTitleZone] : [])],
        result.detectedSubtitleZone ? [result.detectedSubtitleZone] : []);
      if (fitted.length < Math.min(expectedMin, safeFallback.length)) throw Error('Vision layout collides with typography after fitting');
      return { elements: fitted, usedFallback: false };
    } catch {
      // Background generation is paid. Never discard it because vision layout failed.
      // Preserve existing original-only positions as a readable editable fallback.
      return { elements: safeFallback, usedFallback: true };
    }
  };

  const currentBriefSettings = (slide?: PackSlide): ThumbnailBriefSettings => ({
    layoutMode, scope: generationScope, slide: slide?.name || singleSlideKey,
    headline: slide?.headline || coverHeadline.trim() || title,
    subtitle: slide?.subtitle || 'CLIPART COLLECTION',
    typography: packTypography, boldness: packBoldness, hierarchy: packHierarchy,
    coverStyle: packCoverStyle, quality: packQuality,
    backgroundStyle, intensity: backgroundIntensity,
    referenceInterpretation: referenceStyle, hasReference: Boolean(reference),
    analysisProvider: provider, analysisModel: model, imageModel,
    collectionStyle: collectionVisualSettings?.style,
    collectionPalette: collectionVisualSettings?.palette,
    collectionTexture: collectionVisualSettings?.texture
  });
  const previewSlides = buildPack(generationScope === 'single' ? 'complete-10' : generationScope, title, characters);
  const chosenPreviewSlides = generationScope === 'single'
    ? previewSlides.filter(slide => slide.key === singleSlideKey).slice(0, 1)
    : previewSlides;
  const currentBriefPreview = chosenPreviewSlides.map(slide =>
    buildThumbnailDesignBrief(currentBriefSettings({
      ...slide, headline: generationScope === 'single' && coverHeadline.trim()
        ? coverHeadline.trim() : slide.headline
    }))
  ).join('\n\n--- NEXT THUMBNAIL ---\n\n');

  // User-directed workflow: layout is authored ON the current canvas. The AI
  // receives only empty rectangles + exact text, never the original PNG pixels.
  // Unlike the legacy pack generator, this must never overwrite manual positions.
  const generateCanvasArtwork = async () => {
    if (!design || aiBusy || backgroundRetryId) return;
    const source = design;
    const imageLayers = source.elements.filter(e => e.type === 'image' && e.characterId && assetMap.get(e.characterId)?.imageUrl);
    if (!imageLayers.length) { setMessage('Add original clipart from Reference & Assets to the canvas first.'); return; }
    if (imageLayers.length !== source.elements.filter(e => e.type === 'image').length) {
      setMessage('An image layer has no original collection PNG. Replace it before generating.'); return;
    }
    const zone = source.packTextZone || { x: 22, y: 30, width: 56, height: 34 };
    if ([zone.x, zone.y, zone.width, zone.height].some(n => !Number.isFinite(n)) ||
      zone.x < 0 || zone.y < 0 || zone.width < 10 || zone.height < 10 ||
      zone.x + zone.width > 100 || zone.y + zone.height > 100) {
      setMessage('Set a valid typography safe zone inside the canvas.'); return;
    }
    if (imageLayers.some(e => e.x < 0 || e.y < 0 || e.x + e.width > 100 || e.y + e.height > 100)) {
      setMessage('All original clipart layers must fit fully within the canvas before generating.'); return;
    }
    const overlapsType = imageLayers.some(e =>
      e.x < zone.x + zone.width && e.x + e.width > zone.x &&
      e.y < zone.y + zone.height && e.y + e.height > zone.y
    );
    if (overlapsType) { setMessage('One or more clipart layers overlap the typography zone. Move or resize them on the canvas, or adjust the typography zone first.'); return; }
    const heading = (source.packHeadline ?? title).trim();
    const subtitle = (source.packSubtitle ?? 'Digital Clipart Collection').trim();
    const badge = (source.packBadge ?? '').trim();
    if (!heading || heading.length > 100 || subtitle.length > 140 || badge.length > 60) {
      setMessage('Main title (1–100 characters), subtitle (max 140), or badge (max 60) is invalid.'); return;
    }
    if (source.elements.some(e => e.type === 'text') &&
      !window.confirm('AI lettering is rendered into the background. Existing editable text layers on this canvas will be removed to avoid duplicate words. Continue?')) return;
    if (!window.confirm('Generate a paid AI background and exact artistic typography for this manually arranged canvas? No collection clipart will be sent to or regenerated by the image provider.')) return;
    setAiBusy(true);
    setPackStatus('Analyzing the selected graphic reference and preserving manual artwork placement...');
    try {
      let referenceDesign = source.referenceDesign;
      if (reference) {
        try {
          const response = await fetch('/api/thumbnail-layout', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectId, imageUrl: reference, provider, model,
              referenceStyle, count: Math.min(imageLayers.length, 24)
            })
          });
          const result = await readApiJson<{ layout?: ThumbnailDesign['referenceDesign']; error?: string }>(
            response, 'Reference analysis');
          if (result.layout) referenceDesign = {
            graphicMotif: result.layout.graphicMotif,
            letteringStyle: result.layout.letteringStyle,
            paletteMood: result.layout.paletteMood
          };
        } catch (error) {
          setPackStatus('Reference analysis unavailable; using your selected art preferences without repositioning clipart. ' +
            (error instanceof Error ? error.message.slice(0, 100) : ''));
        }
      }
      setPackStatus('Creating background and lettering. Original collection PNGs remain on your canvas...');
      const imageModelChoice = imageProvider === 'gemini' ? geminiImageModel : imageModel;
      const requestBody = {
        projectId, provider: imageProvider, model: imageModelChoice, quality: packQuality,
        mode: 'background-with-typography' as const,
        width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE,
        headline: heading, subtitle, badge,
        slideName: 'Custom Canvas Artwork',
        backgroundStyle, backgroundIntensity, designBoldness: packBoldness,
        coverStyle: packCoverStyle, referenceDesign,
        textZone: zone,
        // Exact source files, their contents, character names, and reference
        // images are never part of the generation request.
        layout: imageLayers.map(e => ({ type: 'image' as const,
          x: e.x, y: e.y, width: e.width, height: e.height })),
        designBriefSettings: {
          ...currentBriefSettings(), scope: 'single' as const, slide: 'Custom Canvas Artwork',
          headline: heading, subtitle, typography: 'ai-artwork' as const,
          imageModel: imageModelChoice
        }
      };
      const response = await fetch('/api/thumbnail-ai-image', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });
      const result = await readApiJson<{
        imageUrl?: string; prompt?: string; qcRejected?: boolean; qcReason?: string; error?: string
      }>(response, 'AI background and typography');
      if (!result.imageUrl) throw Error('AI did not return a background image.');
      await loadForExport(result.imageUrl);
      const currentDesign = latestDesignsRef.current.find(d => d.id === source.id) || source;
      const exactLayers = currentDesign.elements.filter(e => e.type === 'image')
        .map(e => ({ ...e, source: 'original' as const }));
      const common: Partial<ThumbnailDesign> = {
        originalAssetsOnly: true, packSlideKey: 'custom-canvas',
        packTypography: 'ai-artwork', packHeadline: heading, packSubtitle: subtitle,
        packBadge: badge, packTextZone: zone,
        packImageProvider: imageProvider, packImageModel: imageModelChoice,
        packBoldness, packHierarchy, packCoverStyle, referenceDesign,
        referenceUrl: reference.startsWith('https://') ? reference : undefined,
        aiImagePrompt: result.prompt, aiImageUrl: undefined,
        renderedImageUrl: undefined, upscaledImageUrl: undefined,
        updatedAt: Date.now()
      };
      const next = latestDesignsRef.current.map(d => d.id === source.id
        ? result.qcRejected
          ? { ...d, ...common, rejectedBackgroundUrl: result.imageUrl,
              rejectedBackgroundReason: result.qcReason || 'Possible generated product-like object',
              generationError: 'Background requires review before use: ' + (result.qcReason || ''),
              // Keep the current background until explicitly approved.
              elements: exactLayers }
          : { ...d, ...common, elements: exactLayers,
              backgroundImageUrl: result.imageUrl, rejectedBackgroundUrl: undefined,
              rejectedBackgroundReason: undefined, generationError: undefined }
        : d);
      latestDesignsRef.current = next;
      onChange(next);
      setMessage(result.qcRejected
        ? 'New AI background was flagged for review. Inspect it and explicitly approve it before composition; original clipart positions are preserved.'
        : 'AI background, exact title, subtitle and optional badge applied. Manual clipart positions are unchanged. Save the design to persist the result.');
      setPackStatus('');
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setMessage('AI background and typography failed: ' + reason);
      setPackStatus('');
    } finally {
      setAiBusy(false);
    }
  };

  // Create the background and artistic lettering FIRST, inspect the real pixels
  // with Vision, then composite exact original PNGs according to its coordinates.
  const generateReferenceBatch = async () => {
    let available = filterThemeCharacters(title, characters);
    if (!available.length) { setMessage('No original collection images match this specific theme (' + title + '). Generate theme-matching clipart first; unrelated artwork will not be added.'); return; }
    const chooseSlides = (items: typeof available) => {
      const all = buildPack(generationScope === 'single' ? 'complete-10' : generationScope, title, items);
      return generationScope === 'single' ? all.filter(slide => slide.key === singleSlideKey).slice(0, 1) : all;
    };
    let slides = chooseSlides(available);
    if (generationScope === 'single' && coverHeadline.trim()) slides = slides.map(slide => ({ ...slide, headline: coverHeadline.trim().slice(0,75) }));
    if (!slides.length) { setMessage('No matching thumbnail concept is available. Select another thumbnail type.'); return; }
    // Single mode should not run category AI unless the chosen thumbnail actually needs category metadata.
    const needsCategories = !available.some(c => c.category || c.subtheme || c.group) &&
      (generationScope === 'complete-10' || generationScope === 'category-showcase' ||
        (generationScope === 'single' && singleSlideKey.startsWith('category-')));
    if (!window.confirm('Create ' + slides.length + ' Etsy listing thumbnails? This makes up to ' + slides.length + ' paid OpenAI image requests, ' + slides.length + ' post-background Vision layout requests, and ' + slides.length + ' image QC checks' + (reference ? ' plus one reference analysis' : '') + (needsCategories ? ' plus one category analysis' : '') + '. Existing thumbnails are preserved. Continue?')) return;
    cancelPackRef.current = false;
    setAiBusy(true); setPackStatus('Preparing ' + slides.length + ' Etsy listing designs...');
    const failures: string[] = [];
    let completed = 0;
    let rejected = 0;
    let referenceWarning = '';
    try {
      let slots: Array<{ x: number; y: number; width: number; height: number }> = [];
      let color = '#f7f1e9';
      let referenceDesign: ThumbnailDesign['referenceDesign'];
      if (needsCategories) {
        setPackStatus('Finding meaningful artwork categories...');
        try {
          const response = await fetch('/api/thumbnail-categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId }) });
          const result = await response.json() as { groups?: Array<{ name: string; ids: string[] }>; error?: string };
          if (!response.ok) throw Error(result.error || 'Category analysis failed');
          const groupById = new Map<string, string>();
          for (const group of result.groups || []) for (const key of group.ids) groupById.set(key, group.name);
          if (new Set(groupById.values()).size > 1) {
            available = available.map(c => ({ ...c, category: groupById.get(c.id) }));
            slides = chooseSlides(available);
            if (generationScope === 'single' && coverHeadline.trim()) slides = slides.map(slide => ({ ...slide, headline: coverHeadline.trim().slice(0,75) }));
          }
        } catch (error) {
          setPackStatus('Category analysis unavailable; using neutral collection selections.');
        }
      }
      if (reference) {
        setPackStatus('Analyzing optional reference...');
        try {
          const response = await fetch('/api/thumbnail-layout', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, imageUrl: reference, provider, model, count: Math.min(available.length, 12), referenceStyle })
          });
          const body = await response.json() as { error?: string; layout?: { slots?: typeof slots; background?: string; graphicMotif?: string; letteringStyle?: string; paletteMood?: string } };
          if (!response.ok) throw Error(body.error || 'Reference analysis failed');
          slots = body.layout?.slots || [];
          referenceDesign = { graphicMotif: body.layout?.graphicMotif, letteringStyle: body.layout?.letteringStyle, paletteMood: body.layout?.paletteMood };
          if (/^#[0-9a-f]{6}$/i.test(body.layout?.background || '')) color = body.layout!.background!;
        } catch (error) {
          // Reference analysis is optional. A timeout must NOT abort the entire
          // pack before we even request the paid background.
          const reason = error instanceof Error ? error.message : String(error);
          referenceWarning = 'Reference analysis failed (' + reason.slice(0, 100) + '); used curated fallback style.';
          setPackStatus(referenceWarning + ' Continuing to image generation.');
          // Prefer an airy medallion instead of a generic orange abstract design
          // when the user is generating the central-title Hero Cover.
          if (slides.some(slide => slide.key === 'hero')) {
            referenceDesign = { graphicMotif: 'blush-brush-ring', letteringStyle: 'script-serif', paletteMood: 'blush-sage' };
          }
        }
      }
      // Each slot already avoids the title-safe-zone before we call the image API.
      const created: ThumbnailDesign[] = slides.map((slide, index) => ({
        ...newDesign(latestDesignsRef.current.length + index + 1),
        name: String(index + 1).padStart(2, '0') + ' · ' + slide.name,
        originalAssetsOnly: true,
        packTypography, packSlideKey: slide.key, packHeadline: slide.headline, packSubtitle: slide.subtitle, packTextZone: slide.textZone,
        packHierarchy, packBoldness, packCoverStyle, referenceDesign,
        background: color,
        referenceUrl: reference.startsWith('https://') ? reference : undefined,
        elements: [
          ...placeOriginals(slide, available, slots, packHierarchy).map(position => ({
            ...newImage(available.find(c => c.id === position.characterId)!, index, 'original'),
            ...position, source: 'original' as const
          })),
          ...typographyForSlide(slide)
        ]
      }));
      const original = [...latestDesignsRef.current, ...created];
      latestDesignsRef.current = original;
      onChange(original);
      setActiveId(created[0].id);
      for (let i = 0; i < created.length; i++) {
        if (cancelPackRef.current) { setPackStatus('Generation stopped. Completed thumbnails were kept.'); break; }
        const slide = slides[i];
        const item = created[i];
        try {
          const initialElements = item.elements.filter(e => e.type === 'image');
          const displayElements = packTypography === 'editable'
            ? [...initialElements, ...typographyForSlide(slide)]
            : initialElements;
          const initialDesigns = latestDesignsRef.current.map(d => d.id === item.id ? { ...d, elements: displayElements } : d);
          latestDesignsRef.current = initialDesigns;
          onChange(initialDesigns);
          setPackStatus('Requesting OpenAI ' + (packTypography === 'ai-artwork' ? 'background, artistic title and badges' : 'decorative background') + ' ' + (i + 1) + '/' + created.length + ': ' + slide.name);
          const response = await fetch('/api/thumbnail-ai-image', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectId, provider: 'openai',
              model: imageModel.startsWith('gpt-image-') ? imageModel : 'gpt-image-1-mini',
              quality: packQuality, width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE,
              mode: packTypography === 'editable' ? 'background-only' : 'background-with-typography',
              backgroundStyle, backgroundIntensity,
              headline: slide.headline, subtitle: slide.subtitle,
              slideName: slide.name, textZone: slide.textZone,
              designBoldness: packBoldness, coverStyle: packCoverStyle,
              referenceDesign, designBriefSettings: currentBriefSettings(slide),
              layout: initialElements.map(e => ({ type: 'image', x: e.x, y: e.y, width: e.width, height: e.height }))
            })
          });
          const result = await response.json() as { imageUrl?: string; error?: string; prompt?: string; qcRejected?: boolean; qcReason?: string };
          if (!response.ok || !result.imageUrl) throw Error(result.error || 'Generation failed');
          await loadForExport(result.imageUrl);
          if (result.qcRejected) {
            const reason = result.qcReason || 'AI background requires manual inspection.';
            const next = latestDesignsRef.current.map(d => d.id === item.id ? {
              ...d, rejectedBackgroundUrl: result.imageUrl, rejectedBackgroundReason: reason, aiImagePrompt: result.prompt,
              generationError: 'AI QC review required: ' + reason
            } : d);
            latestDesignsRef.current = next;
            onChange(next);
            failures.push(slide.name + ': QC review required');
            rejected++;
            if (rejected >= 2) {
              setPackStatus('Stopped after two QC rejections to avoid repeated paid image requests. Inspect the review drafts before retrying.');
              break;
            }
            continue;
          }
          setPackStatus('AI Vision analyzing generated background and positioning original clipart ' + (i + 1) + '/' + created.length);
          const placement = await placeOriginalsOverBackground(slide, result.imageUrl, initialElements, available, packHierarchy, packCoverStyle);
          const finalElements = packTypography === 'editable'
            ? [...placement.elements, ...typographyForSlide(slide)]
            : placement.elements;
          const next = latestDesignsRef.current.map(d => d.id === item.id ? {
            ...d, elements: finalElements, backgroundImageUrl: result.imageUrl, aiImagePrompt: result.prompt,
            rejectedBackgroundUrl: undefined, rejectedBackgroundReason: undefined,
            generationError: placement.usedFallback ? 'Vision placement unavailable; original PNG fallback layout used.' : undefined
          } : d);
          latestDesignsRef.current = next;
          onChange(next);
          rejected = 0;
          completed += 1;
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          failures.push(slide.name + ': ' + reason);
          const next = latestDesignsRef.current.map(d => d.id === item.id ? { ...d, generationError: reason } : d);
          latestDesignsRef.current = next;
          onChange(next);
        }
      }
      setPackStatus(cancelPackRef.current ? 'Stopped. Generated images are retained.' : rejected >= 2 ? 'Paused after repeated QC rejections. Review saved candidate artwork before additional paid requests.' : 'Pack generation finished.');
      setMessage('Pack: ' + created.length + ' designs with exact original collection PNGs; ' + completed + ' editorial backgrounds generated. ' + (packTypography === 'editable' ? 'Text remains independently editable and was not AI-rasterized.' : 'Check AI-generated lettering for spelling and factual accuracy.') + (referenceWarning ? ' ' + referenceWarning : '') + (failures.length ? ' Failed: ' + failures.join(' | ').slice(0,450) : ''));
    } catch (error) {
      setMessage('Etsy listing pack failed: ' + (error instanceof Error ? error.message : String(error)));
    } finally { setAiBusy(false); }
  };

  const retryBackground = async (target: ThumbnailDesign) => {
    if (aiBusy || backgroundRetryId || !target.originalAssetsOnly) return;
    setBackgroundRetryId(target.id);
    setMessage('Requesting OpenAI background for ' + target.name + '...');
    try {
      const artistic = target.packTypography === 'ai-artwork' || (target.packTypography == null && !target.elements.some(e => e.type === 'text'));
      const imageLayers = target.elements.filter(e => e.type === 'image');
      const response = await fetch('/api/thumbnail-ai-image', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId, provider: 'openai',
          model: imageModel.startsWith('gpt-image-') ? imageModel : 'gpt-image-1-mini',
          quality: packQuality, width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE,
          mode: artistic ? 'background-with-typography' : 'background-only',
          backgroundStyle, backgroundIntensity,
          headline: target.packHeadline || title,
          subtitle: target.packSubtitle || 'Digital Clipart Collection',
          slideName: target.name,
          designBoldness: target.packBoldness || packBoldness, coverStyle: target.packCoverStyle || packCoverStyle,
          referenceDesign: target.referenceDesign,
          designBriefSettings: { ...currentBriefSettings(), headline: target.packHeadline || title, subtitle: target.packSubtitle || 'CLIPART COLLECTION', slide: target.name },
          textZone: target.packTextZone || { x: 22, y: 31, width: 56, height: 38 },
          layout: imageLayers.map(e => ({ type: 'image', x: e.x, y: e.y, width: e.width, height: e.height }))
        })
      });
      const result = await response.json() as { imageUrl?: string; error?: string; prompt?: string; qcRejected?: boolean; qcReason?: string };
      if (!response.ok || !result.imageUrl) throw Error(result.error || 'No background returned');
      await loadForExport(result.imageUrl);
      if (result.qcRejected) {
        const reason = result.qcReason || 'The AI artwork needs manual inspection.';
        const pending = latestDesignsRef.current.map(d => d.id === target.id
          ? { ...d, rejectedBackgroundUrl: result.imageUrl, rejectedBackgroundReason: reason, aiImagePrompt: result.prompt,
            generationError: 'AI QC review required: ' + reason, updatedAt: Date.now() } : d);
        latestDesignsRef.current = pending;
        onChange(pending);
        setMessage('Background saved for review, not applied. Inspect the image before accepting or regenerating.');
        return;
      }
      const allAvailable = filterThemeCharacters(title, characters);
      const savedSlides = buildPack('complete-10', title, allAvailable);
      const matchedSlide = savedSlides.find(candidate => candidate.key === target.packSlideKey ||
        target.name.toLowerCase().includes(candidate.name.toLowerCase())) || savedSlides[0];
      const slide = matchedSlide && { ...matchedSlide, headline: target.packHeadline || matchedSlide.headline,
        subtitle: target.packSubtitle || matchedSlide.subtitle, textZone: target.packTextZone || matchedSlide.textZone };
      let positioned = imageLayers;
      let visionFallback = true;
      if (slide) {
        setMessage('AI Vision inspecting the new background and repositioning original clipart...');
        const placement = await placeOriginalsOverBackground(
          slide, result.imageUrl, imageLayers, allAvailable, target.packHierarchy || packHierarchy,
          target.packCoverStyle || packCoverStyle
        );
        positioned = placement.elements;
        visionFallback = placement.usedFallback;
      }
      const next = latestDesignsRef.current.map(d => d.id === target.id
        ? { ...d, backgroundImageUrl: result.imageUrl, aiImagePrompt: result.prompt, elements: [
            ...positioned, ...d.elements.filter(e => e.type === 'text')
          ], rejectedBackgroundUrl: undefined, rejectedBackgroundReason: undefined,
          generationError: visionFallback ? 'Vision placement unavailable; previous original PNG layout kept.' : undefined,
          updatedAt: Date.now() } : d);
      latestDesignsRef.current = next;
      onChange(next);
      setMessage('AI background generated for ' + target.name + '. Save designs to persist it.');
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const next = latestDesignsRef.current.map(d => d.id === target.id ? { ...d, generationError: reason } : d);
      latestDesignsRef.current = next;
      onChange(next);
      setMessage('AI background failed: ' + reason);
    } finally {
      setBackgroundRetryId('');
    }
  };

  const reLayoutWithVision = async (target: ThumbnailDesign) => {
    if (!target.backgroundImageUrl || aiBusy || backgroundRetryId) return;
    setBackgroundRetryId(target.id);
    try {
      const available = filterThemeCharacters(title, characters);
      const slides = buildPack('complete-10', title, available);
      const matchedSlide = slides.find(item => item.key === target.packSlideKey ||
        target.name.toLowerCase().includes(item.name.toLowerCase())) || slides[0];
      const slide = matchedSlide && { ...matchedSlide, headline: target.packHeadline || matchedSlide.headline,
        subtitle: target.packSubtitle || matchedSlide.subtitle, textZone: target.packTextZone || matchedSlide.textZone };
      if (!slide) throw Error('No collection layout available');
      const originals = target.elements.filter(e => e.type === 'image');
      setMessage('AI Vision inspecting saved background and adjusting original PNG positions...');
      const result = await placeOriginalsOverBackground(
        slide, target.backgroundImageUrl, originals, available,
        target.packHierarchy || packHierarchy, target.packCoverStyle || packCoverStyle
      );
      const next = latestDesignsRef.current.map(d => d.id === target.id ? {
        ...d, elements: [...result.elements, ...d.elements.filter(e => e.type === 'text')],
        generationError: result.usedFallback ? 'AI Vision layout unavailable; original positions retained.' : undefined,
        updatedAt: Date.now()
      } : d);
      latestDesignsRef.current = next;
      onChange(next);
      setMessage(result.usedFallback
        ? 'Vision could not improve the layout; current original PNG positions remain unchanged.'
        : 'AI Vision repositioned original PNGs without another paid image generation. Save designs to persist.');
    } catch (error) {
      setMessage('Vision re-layout failed: ' + (error instanceof Error ? error.message : String(error)));
    } finally { setBackgroundRetryId(''); }
  };

  const approveReviewedBackground = async (target: ThumbnailDesign) => {
    if (!target.rejectedBackgroundUrl || aiBusy || backgroundRetryId) return;
    if (!window.confirm('Have you OPENED and inspected this AI artwork at full size? Confirm it contains NO AI-generated collection clipart, foods, animals, product illustrations or imitations of your collection assets. Decorative shapes and lettering are allowed. Only approve if all artwork is background/typography.')) return;
    setBackgroundRetryId(target.id);
    try {
      setMessage('AI Vision analyzing approved background before overlaying original collection PNGs...');
      const available = filterThemeCharacters(title, characters);
      const candidates = buildPack('complete-10', title, available);
      const matchedSlide = candidates.find(item => item.key === target.packSlideKey ||
        target.name.toLowerCase().includes(item.name.toLowerCase())) || candidates[0];
      const slide = matchedSlide && { ...matchedSlide, headline: target.packHeadline || matchedSlide.headline,
        subtitle: target.packSubtitle || matchedSlide.subtitle, textZone: target.packTextZone || matchedSlide.textZone };
      const imageLayers = target.elements.filter(e => e.type === 'image');
      const placement = slide
        ? await placeOriginalsOverBackground(slide, target.rejectedBackgroundUrl, imageLayers, available,
            target.packHierarchy || packHierarchy, target.packCoverStyle || packCoverStyle)
        : { elements: imageLayers, usedFallback: true };
      const next = latestDesignsRef.current.map(d => d.id === target.id ? {
        ...d, backgroundImageUrl: d.rejectedBackgroundUrl,
        elements: [...placement.elements, ...d.elements.filter(e => e.type === 'text')],
        rejectedBackgroundUrl: undefined, rejectedBackgroundReason: undefined,
        generationError: placement.usedFallback ? 'Vision layout unavailable; original PNG positions retained.' : undefined,
        updatedAt: Date.now()
      } : d);
      latestDesignsRef.current = next;
      onChange(next);
      setMessage('Reviewed background applied with original PNG layout. Save designs to retain it.');
    } finally {
      setBackgroundRetryId('');
    }
  };

  const onReferenceUpload = async (file?: File) => {
    if (!file) return;
    if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 4_000_000) { setMessage('Use PNG/JPG/WebP up to 4 MB for AI reference.'); return; }
    const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Could not read file')); reader.readAsDataURL(file); });
    setUploadedReference(data); setReference(data); setMessage('Reference loaded for this editing session. The uploaded reference is not embedded in the saved collection.');
  };

  const generateReferenceBackground = async () => {
    if (!design || backgroundGenerating) return;
    if (!window.confirm('Generate a decorative background using OpenAI? This may incur API charges. Original collection clipart and text will remain separate editable layers.')) return;
    setBackgroundGenerating(true); setMessage('');
    try {
      const response = await fetch('/api/thumbnail-ai-image', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, provider: 'openai', model: imageModel.startsWith('gpt-image-') ? imageModel : 'gpt-image-1-mini', quality: packQuality, width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE, mode: 'background-only', backgroundStyle, backgroundIntensity,
          designBriefSettings: { ...currentBriefSettings(), typography: 'editable', headline: design.packHeadline || title, subtitle: design.packSubtitle || 'CLIPART COLLECTION', slide: design.name },
          layout: design.elements.map(e => ({ type: e.type, x: e.x, y: e.y, width: e.width, height: e.height })) })
      });
      const result = await response.json() as { error?: string; imageUrl?: string };
      if (!response.ok || !result.imageUrl) throw Error(result.error || 'Background generation failed');
      // API success alone does not guarantee the stored background is reachable.
      // Check the authenticated image endpoint and decoding before modifying the design.
      const imageResponse = await fetch(result.imageUrl, { credentials: 'same-origin', cache: 'no-store' });
      if (!imageResponse.ok || !(imageResponse.headers.get('content-type') || '').startsWith('image/')) {
        throw Error('Generated background is not accessible (HTTP ' + imageResponse.status + '). Check image storage and authentication.');
      }
      const imageBytes = await imageResponse.blob();
      if (!imageBytes.size) throw Error('Generated background is empty.');
      const previewUrl = URL.createObjectURL(imageBytes);
      try { await loadForExport(previewUrl); }
      finally { URL.revokeObjectURL(previewUrl); }
      setBackgroundLoadError('');
      commit({ ...design, backgroundImageUrl: result.imageUrl });
      setMessage('Decorative background loaded and applied to the canvas. Original clipart and editable typography remain separate layers.');
    } catch (error) { setMessage('Background generation failed: ' + (error instanceof Error ? error.message : String(error))); }
    finally { setBackgroundGenerating(false); }
  };
  const uploadBackground = async (file?: File) => {
    if (!file || !design) return;
    setBackgroundUploading(true); setMessage('');
    try {
      const form = new FormData(); form.append('projectId', projectId); form.append('file', file);
      const response = await fetch('/api/thumbnail-background', { method: 'POST', body: form });
      const result = await response.json() as { url?: string; error?: string };
      if (!response.ok || !result.url) throw Error(result.error || 'Background upload failed');
      mutate({ backgroundImageUrl: result.url });
      setMessage('Background uploaded. Save designs to keep the new background.');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBackgroundUploading(false); }
  };
  const downloadAiThumbnail = async () => {
    const sourceUrl = design?.upscaledImageUrl || design?.aiImageUrl;
    if (!design || !sourceUrl) return;
    try {
      const response = await fetch(sourceUrl);
      if (!response.ok) throw Error('Could not download generated thumbnail');
      const blob = await response.blob();
      const link = document.createElement('a'); const url = URL.createObjectURL(blob);
      link.href = url; link.download = (design.name.replace(/[^\w-]/g, '_') || 'ai-thumbnail') + '-ai.' + (blob.type === 'image/jpeg' ? 'jpg' : 'png');
      link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  const renderDesignBlob = async (target: ThumbnailDesign, format: 'png' | 'jpeg' = 'png'): Promise<Blob> => {
      const canvas = document.createElement('canvas'); canvas.width = THUMBNAIL_SIZE; canvas.height = THUMBNAIL_SIZE;
      const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas unavailable');
      ctx.fillStyle = target.background; ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (target.aiImageUrl || target.backgroundImageUrl) {
        const background = await loadForExport(target.aiImageUrl || target.backgroundImageUrl!);
        const scale = Math.max(THUMBNAIL_SIZE / background.naturalWidth, THUMBNAIL_SIZE / background.naturalHeight);
        const w = background.naturalWidth * scale, h = background.naturalHeight * scale;
        ctx.drawImage(background, (THUMBNAIL_SIZE - w) / 2, (THUMBNAIL_SIZE - h) / 2, w, h);
      }
      for (const element of target.elements) {
        const x = element.x / 100 * THUMBNAIL_SIZE, y = element.y / 100 * THUMBNAIL_SIZE;
        const w = element.width / 100 * THUMBNAIL_SIZE, h = element.height / 100 * THUMBNAIL_SIZE;
        ctx.save(); ctx.globalAlpha = element.opacity ?? 1;
        ctx.translate(x + w/2, y + h/2); ctx.rotate(element.rotation * Math.PI/180);
        if (element.type === 'image') {
          const url = imageUrl(element); if (!url) { ctx.restore(); throw new Error('Original clipart is missing: ' + (assetMap.get(element.characterId || '')?.name || element.characterId)); }
          const img = await loadForExport(url);
          const scale = Math.min(w/img.naturalWidth, h/img.naturalHeight);
          const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
          ctx.drawImage(img, -dw/2, -dh/2, dw, dh);
        } else {
          ctx.fillStyle = element.color || '#333333';
          await document.fonts.load(`${element.fontWeight || 'bold'} ${(element.fontSize || 80)}px ${element.fontFamily || 'Arial'}`).catch(() => []);
          ctx.font = `${element.fontWeight || 'bold'} ${Math.round((element.fontSize || 80) * THUMBNAIL_SIZE / 2000)}px ${element.fontFamily || 'Arial'}`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          const raw = (element.text || '').split('\n');
          const lineHeight = (element.fontSize || 80) * THUMBNAIL_SIZE / 2000 * 1.2;
          raw.forEach((line,i) => {
            const available = Math.max(1, w - 8);
            const actual = ctx.measureText(line).width;
            ctx.save(); if (actual > available) ctx.scale(available / actual, 1);
            const baseline = (i - (raw.length - 1)/2) * lineHeight;
            if (element.curve) {
              const letters = Array.from(line);
              const widths = letters.map(letter => ctx.measureText(letter).width);
              const total = widths.reduce((sum, width) => sum + width, 0);
              const bend = clamp(element.curve, -100, 100) / 100 * h * .45;
              let cursor = -total / 2;
              letters.forEach((letter, index) => {
                const position = cursor + widths[index] / 2;
                const t = total ? clamp(position / (total / 2), -1, 1) : 0;
                const heightOffset = -bend * (1 - t * t);
                const slope = total ? (4 * bend * t / total) : 0;
                ctx.save(); ctx.translate(position, baseline + heightOffset);
                ctx.rotate(Math.atan(slope));
                ctx.fillText(letter, 0, 0);
                ctx.restore();
                cursor += widths[index];
              });
            } else ctx.fillText(line, 0, baseline);
            ctx.restore();
          });
        }
        ctx.restore();
      }
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, format === 'png' ? 'image/png' : 'image/jpeg', .92));
      if (!blob) throw new Error('Could not encode thumbnail');
      return blob;
  };
  const uploadRenderedThumbnail = async (blob: Blob, mime: 'image/jpeg' | 'image/png' = 'image/jpeg'): Promise<string> => {
    if (blob.size > 20_000_000) throw new Error('Rendered thumbnail exceeds 20 MB (' + (blob.size / 1_000_000).toFixed(1) + ' MB). Reduce the canvas size.');
    const parse = async (response: Response): Promise<{ url?: string; error?: string }> => {
      const body = await response.text();
      let data: { url?: string; error?: string } = {};
      try { data = JSON.parse(body) as typeof data; }
      catch { throw new Error('Thumbnail upload failed (HTTP ' + response.status + '): ' + body.slice(0, 150)); }
      if (!response.ok) throw new Error(data.error || 'Thumbnail upload failed (HTTP ' + response.status + ')');
      return data;
    };
    const send = async (form: FormData) => parse(await fetch('/api/thumbnail-background', { method: 'POST', body: form }));
    if (blob.size <= 1_000_000) {
      const form = new FormData();
      form.set('projectId', projectId);
      form.set('file', new File([blob], mime === 'image/png' ? 'thumbnail.png' : 'thumbnail.jpg', { type: mime }));
      const result = await send(form);
      if (!result.url) throw new Error('Thumbnail upload returned no URL');
      return result.url;
    }
    const uploadId = crypto.randomUUID();
    const count = Math.ceil(blob.size / 1_000_000);
    for (let index = 0; index < count; index++) {
      const form = new FormData();
      form.set('projectId', projectId);
      form.set('action', 'chunk'); form.set('uploadId', uploadId);
      form.set('count', String(count)); form.set('index', String(index));
      form.set('file', new File([blob.slice(index * 1_000_000, (index + 1) * 1_000_000)], 'part', { type: 'application/octet-stream' }));
      await send(form);
    }
    const finish = new FormData();
    finish.set('projectId', projectId); finish.set('action', 'complete');
    finish.set('uploadId', uploadId); finish.set('count', String(count));
    const result = await send(finish);
    if (!result.url) throw new Error('Thumbnail upload returned no URL');
    return result.url;
  };
  const compareThumbnail = async (item: ThumbnailDesign) => {
    if (!item.upscaledImageUrl) return;
    try {
      const originalUrl = item.aiImageUrl || item.renderedImageUrl;
      const source = originalUrl || URL.createObjectURL(await renderDesignBlob(item, 'jpeg'));
      setComparePreview({ name: item.name, originalUrl: source, upscaledUrl: item.upscaledImageUrl, temporary: !originalUrl });
    } catch (error) { setMessage('Could not open comparison: ' + (error instanceof Error ? error.message : String(error))); }
  };
  const upscaleSelectedThumbnails = async () => {
    if (upscaleBusy) return;
    const targets = latestDesignsRef.current.filter(item => selectedThumbnailIds.has(item.id) && !item.upscaleJob);
    if (!targets.length) { setMessage('Select at least one thumbnail that is not queued.'); return; }
    if (!window.confirm('Submit ' + targets.length + ' selected thumbnails to Remote GPU? You can close PaletteIQ after all jobs are accepted.')) return;
    setUpscaleBusy(true); setUpscaleSubmitting({ done: 0, total: targets.length }); setMessage('');
    const errors: string[] = [];
    let accepted = 0;
    try {
      for (const item of targets) {
        setMessage('Uploading thumbnail ' + (accepted + errors.length + 1) + '/' + targets.length + ': ' + item.name);
        try {
          const sourceUrlToRender = item.upscaledImageUrl || item.aiImageUrl;
          const source = sourceUrlToRender ? await loadForExport(sourceUrlToRender) : null;
          const png = source ? await (async () => {
            const canvas = document.createElement('canvas');
            canvas.width = source.naturalWidth; canvas.height = source.naturalHeight;
            const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas unavailable');
            ctx.drawImage(source, 0, 0);
            return new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
          })() : await renderDesignBlob(item, 'png');
          if (!png) throw new Error('Could not prepare GPU input PNG');
          const sourceUrl = await uploadRenderedThumbnail(png, 'image/png');
          const response = await fetch('/api/thumbnail-upscale', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, thumbnailId: item.id, sourceUrl, factor: upscaleFactor, previousUpscaledUrl: item.upscaledImageUrl ?? null }) });
          const result = await response.json() as { id?: string; error?: string };
          if (!response.ok || !result.id) throw new Error(result.error || 'GPU did not accept the thumbnail');
          const next = latestDesignsRef.current.map(d => d.id === item.id ? { ...d, upscaleJob: { id: result.id!, sourceUrl, factor: upscaleFactor, submittedAt: Date.now() } } : d);
          latestDesignsRef.current = next;
          onChange(next);
          // A remote job survives app exit only if its ID survives in the collection.
          // Persist each accepted job before moving to the next submission.
          await latestSaveRef.current(next);
          accepted++;
        } catch (error) { errors.push(item.name + ': ' + (error instanceof Error ? error.message : String(error))); }
        setUpscaleSubmitting({ done: accepted + errors.length, total: targets.length });
      }
      setSelectedThumbnailIds(old => new Set([...old].filter(id => !targets.some(t => t.id === id))));
      setMessage('GPU jobs submitted and saved: ' + accepted + '/' + targets.length + '. ' + (errors.length ? errors.join(' | ') : 'All submitted jobs will continue while the app is closed.'));
    } finally { setUpscaleBusy(false); }
  };
  const activeThumbnailJobs = designs.filter(item => item.upscaleJob).map(item => item.id + ':' + item.upscaleJob!.id).join(',');
  useEffect(() => {
    if (!activeThumbnailJobs) return;
    let stopped = false, running = false;
    const poll = async () => {
      if (running || stopped) return;
      running = true;
      try {
        for (const item of latestDesignsRef.current.filter(d => d.upscaleJob)) {
          if (stopped) break;
          const jobId = item.upscaleJob!.id;
          try {
            const response = await fetch('/api/thumbnail-upscale?projectId=' + encodeURIComponent(projectId) + '&thumbnailId=' + encodeURIComponent(item.id));
            const result = await response.json() as { status?: string; url?: string; error?: string; elapsedSeconds?: number; estimatedRemainingSeconds?: number | null };
            if (!response.ok) throw new Error(result.error || 'GPU status unavailable');
            if (stopped) break;
            setUpscaleRemaining(old => ({ ...old, [item.id]: result.estimatedRemainingSeconds ?? null }));
            setUpscaleJobs(old => ({ ...old, [jobId]: { status: result.status || 'unknown', elapsed: result.elapsedSeconds, remaining: result.estimatedRemainingSeconds, error: result.error } }));
            if (result.status === 'succeeded' && result.url) {
              const next = latestDesignsRef.current.map(d => d.id === item.id && d.upscaleJob?.id === jobId ? { ...d, upscaledImageUrl: result.url, upscaleJob: undefined } : d);
              latestDesignsRef.current = next;
              onChange(next);
              setUpscaleStatus('Thumbnail GPU upscale completed');
            }
          } catch (error) {
            if (!stopped) setUpscaleJobs(old => ({ ...old, [jobId]: { ...old[jobId], status: 'sync_error', error: error instanceof Error ? error.message : String(error) } }));
          }
        }
      } finally { running = false; }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 5000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [projectId, activeThumbnailJobs]);
  const queueItems = designs.filter(item => item.upscaleJob || item.upscaledImageUrl);
  const queueDuration = (seconds?: number | null) => seconds == null ? '—' : Math.floor(seconds / 60) + 'm ' + Math.floor(seconds % 60) + 's';
  const renderCacheRef = useRef(new Map<string, { signature: string; url: string }>());
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const saveVersionRef = useRef(0);
  const saveAllWithImages = async (snapshot: ThumbnailDesign[]) => {
    const serial = ++saveVersionRef.current;
    const operation = saveQueueRef.current.catch(() => {}).then(async () => {
      const prepared: ThumbnailDesign[] = [];
      for (const item of snapshot) {
        if (item.aiImageUrl) {
          if (item.aiImageUrl.includes('format=jpg')) { prepared.push(item); continue; }
          // Preserve the AI artwork, but persist its collection thumbnail as JPEG.
          const original = await loadForExport(item.aiImageUrl);
          const canvas = document.createElement('canvas');
          canvas.width = original.naturalWidth; canvas.height = original.naturalHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Could not convert AI thumbnail to JPEG');
          ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(original, 0, 0);
          const jpeg = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', .92));
          if (!jpeg) throw new Error('Could not encode AI thumbnail as JPEG');
          prepared.push({ ...item, aiImageUrl: await uploadRenderedThumbnail(jpeg) });
          continue;
        }
        // Cached JPEG is reusable until the editable content changes.
        const signature = JSON.stringify({ format: 'jpeg', width: item.width, height: item.height, background: item.background, backgroundImageUrl: item.backgroundImageUrl, elements: item.elements });
        const cached = renderCacheRef.current.get(item.id);
        if (cached?.signature === signature) {
          prepared.push({ ...item, renderedImageUrl: cached.url });
          continue;
        }
        const blob = await renderDesignBlob(item, 'jpeg');
        const storedUrl = await uploadRenderedThumbnail(blob).catch(error => { throw new Error('Could not store thumbnail ' + item.name + ': ' + (error instanceof Error ? error.message : String(error))); });
        renderCacheRef.current.set(item.id, { signature, url: storedUrl });
        prepared.push({ ...item, renderedImageUrl: storedUrl });
      }
      if (serial !== saveVersionRef.current) return;
      await latestSaveRef.current(prepared);
      lastSavedDesignsRef.current = JSON.stringify(prepared);
      if (JSON.stringify(prepared) !== JSON.stringify(snapshot)) onChange(prepared);
    });
    saveQueueRef.current = operation;
    return operation;
  };
  const exportPng = async (format: 'png' | 'jpeg') => {
    if (!design) return;
    setBusy(true); setMessage('');
    try {
      let blob: Blob;
      let width = THUMBNAIL_SIZE, height = THUMBNAIL_SIZE;
      if (design.upscaledImageUrl) {
        const source = await loadForExport(design.upscaledImageUrl);
        width = source.naturalWidth; height = source.naturalHeight;
        const response = await fetch(design.upscaledImageUrl);
        if (!response.ok) throw new Error('Could not download upscaled thumbnail');
        const stored = await response.blob();
        if (stored.type === 'image/' + format) {
          // Preserve the stored JPEG bytes and DPI when exporting JPG.
          blob = stored;
        } else {
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Canvas unavailable');
          if (format === 'jpeg') { context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height); }
          context.drawImage(source, 0, 0);
          const converted = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/' + format, .95));
          if (!converted) throw new Error('Could not encode upscaled thumbnail');
          blob = converted;
        }
      } else {
        blob = await renderDesignBlob(design, format);
      }
      const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url;
      link.download = (design.name.replace(/[^a-z0-9_-]/gi, '_') || 'thumbnail') + '.' + (format === 'png' ? 'png' : 'jpg');
      link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      setMessage('Export ready: ' + width + '×' + height + (design.upscaledImageUrl ? ' · Upscaled' : ''));
    } catch (error) { setMessage('Export failed: ' + (error instanceof Error ? error.message : String(error))); }
    finally { setBusy(false); }
  };
  const save = async () => { setBusy(true); try { await saveAllWithImages(designs); setMessage('Thumbnail designs and JPG previews saved.'); } catch (error) { setMessage('Save failed: ' + String(error)); } finally { setBusy(false); } };
  saveRendersRef.current = saveAllWithImages;
  registeredControlsRef.current.save = async () => {
    // Do not navigate away until the render/upload/database save is complete.
    await saveAllWithImages(latestDesignsRef.current);
    await saveQueueRef.current;
  };
  registeredControlsRef.current.hasUnsaved = () =>
    JSON.stringify(latestDesignsRef.current) !== lastSavedDesignsRef.current;

  const control = { width: '100%', minWidth: 0 } as const;
  return <div className="thumbnail-studio">
    <div className="panel" style={{ padding: 16, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
      <h2 style={{ marginRight: 'auto' }}>Etsy Thumbnail Designer</h2>
      <select aria-label="Select thumbnail" value={design?.id || ''} onChange={e => setActiveId(e.target.value)}><option value="">Select thumbnail</option>{designs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
      <button className="outline-btn" type="button" onClick={create}><Plus size={15}/> New</button>
      <button className="outline-btn" disabled={!design} type="button" onClick={duplicate}><Copy size={15}/> Duplicate</button>
      <button className="outline-btn" disabled={!design} type="button" onClick={removeDesign}><Trash2 size={15}/> Delete</button>
      <button className="primary-btn" disabled={!design || busy} type="button" onClick={() => void save()}>Save designs</button>
    </div>
    {message && <p className="notice">{message}</p>}
    {!design ? <div className="panel empty-state" style={{ display: 'grid', gap: 12, maxWidth: 520, margin: '20px auto', padding: 24 }}>
      <h2>Generate Etsy Listing Pack</h2>
      <p>Use original collection clipart directly, without ZIP export. Reference images are optional. AI directs the layout and background; PaletteIQ places exact original PNGs and editable lettering.</p>
      <label className="input-label">GENERATION SCOPE</label>
      <select aria-label="Etsy generation scope" disabled={aiBusy} value={generationScope} onChange={event => setGenerationScope(event.target.value as typeof generationScope)}>
        <option value="single">1 Thumbnail · low-cost trial (default)</option>
        <option value="core-5">5 Thumbnails · core pack</option>
        <option value="complete-10">10 Thumbnails · complete pack</option>
        <option value="category-showcase">Category Showcase Pack</option>
      </select>
      {generationScope === 'single' && <>
        <label className="input-label">THUMBNAIL TYPE</label>
        <select aria-label="Single thumbnail type" disabled={aiBusy} value={singleSlideKey} onChange={event => setSingleSlideKey(event.target.value)}>
          {buildPack('complete-10', title, characters).map((slide,index) => <option key={slide.key} value={slide.key}>{String(index+1).padStart(2,'0')} · {slide.name}</option>)}
        </select>
      </>}
      <label className="input-label">CUSTOM MAIN TITLE (OPTIONAL)</label>
      <input aria-label="Etsy custom cover headline" value={coverHeadline} disabled={aiBusy} maxLength={75} placeholder={title} onChange={event => setCoverHeadline(event.target.value)} />
      <label className="input-label">TYPOGRAPHY MODE</label>
      <select aria-label="Etsy pack typography mode" disabled={aiBusy} value={packTypography} onChange={event => setPackTypography(event.target.value as typeof packTypography)}>
        <option value="editable">Editable artistic fonts · accurate text</option>
        <option value="ai-artwork">AI background + artistic title + badges · recommended</option>
      </select>
      <label className="input-label">COVER STYLE</label>
      <select aria-label="Etsy pack cover style" value={packCoverStyle} disabled={aiBusy} onChange={event => setPackCoverStyle(event.target.value as typeof packCoverStyle)}>
        <option value="editorial">Premium editorial</option><option value="boutique">Modern boutique</option><option value="storybook">Storybook gallery</option><option value="modern">Modern Etsy</option><option value="watercolor">Artistic watercolor</option>
      </select>
      <label className="input-label">CLIPART HIERARCHY</label>
      <select aria-label="Etsy pack clipart hierarchy" value={packHierarchy} disabled={aiBusy} onChange={event => setPackHierarchy(event.target.value as ClipartHierarchy)}>
        <option value="dramatic">Dramatic · larger focal image</option><option value="medium">Medium</option><option value="soft">Soft</option>
      </select>
      <label className="input-label">DESIGN BOLDNESS</label>
      <select aria-label="Etsy pack design boldness" value={packBoldness} disabled={aiBusy} onChange={event => setPackBoldness(event.target.value as typeof packBoldness)}>
        <option value="bold">Bold</option><option value="balanced">Balanced</option><option value="soft">Soft</option>
      </select>
      <label className="input-label">OPTIONAL REFERENCE IMAGE</label>
      <input aria-label="Upload optional reference" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => void onReferenceUpload(event.target.files?.[0])}/>
      {reference && <img src={reference} alt="Optional reference" style={{ maxHeight: 130, maxWidth: '100%', objectFit: 'contain' }}/>}
      <label className="input-label">REFERENCE INTERPRETATION</label>
      <select aria-label="Etsy reference interpretation" value={referenceStyle} disabled={aiBusy} onChange={event => setReferenceStyle(event.target.value as typeof referenceStyle)}>
        <option value="similar">Similar composition · recommended</option><option value="creative">Creative adaptation</option><option value="palette">Palette only</option>
      </select>
      <small>For a reference-like watercolor ring and hand-lettered title, upload the reference image before generating. PaletteIQ extracts only graphic style tokens; it never sends reference product artwork to the image generator.</small>
      <label className="input-label">THUMBNAIL DESIGN PROMPT PREVIEW</label>
      <textarea aria-label="Thumbnail design prompt preview" readOnly rows={7} value={currentBriefPreview} style={{ width: '100%', fontSize: 11, lineHeight: 1.35 }} />
      <button type="button" className="outline-btn" onClick={() => void navigator.clipboard.writeText(currentBriefPreview)}>Copy thumbnail prompt</button>
      <button className="primary-btn" disabled={aiBusy || !characters.some(c => c.imageUrl)} onClick={() => void generateReferenceBatch()}>{aiBusy ? 'Generating ' + (generationScope === 'single' ? '1 thumbnail' : 'Etsy pack') + '...' : generationScope === 'single' ? 'Generate 1 Thumbnail' : generationScope === 'core-5' ? 'Generate 5 Thumbnails' : generationScope === 'complete-10' ? 'Generate 10 Thumbnails' : 'Generate Category Showcase'}</button>
      {aiBusy && <button className="outline-btn" onClick={() => { cancelPackRef.current = true; }}>Stop after current image</button>}
      {packStatus && <small role="status">{packStatus}</small>}
      {onStartListingStudio && <button type="button" className="primary-btn" disabled={aiBusy || !characters.some(c=>c.imageUrl)} onClick={() => void startListingStudio()}><WandSparkles size={15}/> Start 15 Listing Images from Reference & Assets</button>}
      <button className="outline-btn" onClick={create}>Or start with a blank design</button>
    </div> :
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(190px, 245px) minmax(0, 1fr) minmax(245px, 290px)', gap: 12, alignItems: 'start' }}>
      <div className="panel" style={{ padding: 14, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', minWidth: 0, gap: 12, alignContent: 'start', overflowX: 'hidden', maxHeight: 'min(82vh, 950px)', overflowY: 'auto', overscrollBehavior: 'contain' }}>
        <div role="tablist" aria-label="Thumbnail tools" style={{ display: 'flex', gap: 4 }} onKeyDown={event => {
          if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 'reference' : event.key === 'End' ? 'generation' : sideTab === 'reference' ? 'generation' : 'reference';
          setSideTab(next); document.getElementById('thumbnail-' + next + '-tab')?.focus();
        }}>
          <button id="thumbnail-reference-tab" role="tab" type="button" aria-selected={sideTab === 'reference'} aria-controls="thumbnail-reference-panel" tabIndex={sideTab === 'reference' ? 0 : -1} className={sideTab === 'reference' ? 'primary-btn' : 'outline-btn'} style={{ flex: 1, minWidth: 0, whiteSpace: 'normal', justifyContent: 'center', fontSize: 12, padding: '8px 6px' }} onClick={() => setSideTab('reference')}>Reference &amp; Assets</button>
          <button id="thumbnail-generation-tab" role="tab" type="button" aria-selected={sideTab === 'generation'} aria-controls="thumbnail-generation-panel" tabIndex={sideTab === 'generation' ? 0 : -1} className={sideTab === 'generation' ? 'primary-btn' : 'outline-btn'} style={{ flex: 1, minWidth: 0, whiteSpace: 'normal', justifyContent: 'center', fontSize: 12, padding: '8px 6px' }} onClick={() => setSideTab('generation')}>Thumbnail Prompt</button>
        </div>
        {sideTab === 'reference' && <div id="thumbnail-reference-panel" role="tabpanel" aria-labelledby="thumbnail-reference-tab" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', minWidth: 0, gap: 12 }}>
        <h3>Reference & assets</h3>
        <label className="input-label">LAYOUT MODE</label>
        <select value={layoutMode} onChange={e => setLayoutMode(e.target.value as 'ai' | 'manual')}><option value="ai">AI + manual</option><option value="manual">Manual only</option></select>
        {layoutMode === 'ai' && <>
          <label className="input-label">AI PROVIDER</label>
          <select value={provider} onChange={e => { const next = e.target.value as 'openai' | 'gemini'; setProvider(next); setModel(next === 'openai' ? aiDefaults.openaiModel : aiDefaults.geminiModel); }}>
            <option value="openai">OpenAI</option><option value="gemini">Google Gemini</option>
          </select>
          <label className="input-label">AI MODEL</label>
          <select value={model} onChange={e => setModel(e.target.value)}>
            {!models[provider].some(m => m.id === model) && <option value={model}>{model} (saved/default)</option>}
            {models[provider].map(m => <option key={m.id} value={m.id}>{m.name} ({m.id})</option>)}
          </select>
          {modelError && <small>{modelError}</small>}
          <label className="input-label">REFERENCE IMAGE (OPTIONAL)</label>
          <select style={control} value={reference.startsWith('data:') ? 'upload' : reference} onChange={e => setReference(e.target.value === 'upload' ? uploadedReference : e.target.value)}>
            <option value="">Choose listing reference</option>{references.map((r,i)=><option key={r} value={r}>Listing image {i+1}</option>)}{uploadedReference && <option value="upload">Uploaded image</option>}
          </select>
          <input aria-label="Upload reference" type="file" accept="image/png,image/jpeg,image/webp" onChange={e => void onReferenceUpload(e.target.files?.[0])}/>
          {reference && <img src={reference} alt="Layout reference" style={{ maxWidth: '100%', maxHeight: 140, objectFit: 'contain' }}/>}
          <label className="input-label">REFERENCE INTERPRETATION</label>
          <select aria-label="Reference interpretation" value={referenceStyle} onChange={e => setReferenceStyle(e.target.value as 'creative' | 'similar' | 'palette')}>
            <option value="creative">Creative adaptation</option><option value="similar">Similar composition</option><option value="palette">Color and style inspiration</option>
          </select>
          <small>Reference analysis runs automatically when generating a thumbnail. Existing collection PNGs are never regenerated.</small>
          <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12, display: 'grid', gap: 8 }}>
            <small>Settings in this tab define the thumbnail design brief; no clipart image is sent for generation.</small>
            <strong>Generate Etsy Listing Pack</strong>
            <small>Reference optional. AI designs the layout and decorative background; PaletteIQ composites unmodified collection PNGs. Choose accurate editable lettering or experimental AI typography artwork.</small>
            <label className="input-label">GENERATION SCOPE</label>
            <select aria-label="Etsy generation scope" value={generationScope} disabled={aiBusy} onChange={e => setGenerationScope(e.target.value as typeof generationScope)}>
              <option value="single">1 Thumbnail · low-cost trial (default)</option>
              <option value="core-5">5 Thumbnails · core pack</option>
              <option value="complete-10">10 Thumbnails · complete pack</option>
              <option value="category-showcase">Category Showcase Pack · collection groups</option>
            </select>
            {generationScope === 'single' && <>
              <label className="input-label">THUMBNAIL TYPE</label>
              <select aria-label="Single thumbnail type" disabled={aiBusy} value={singleSlideKey} onChange={e => setSingleSlideKey(e.target.value)}>
                {buildPack('complete-10', title, characters).map((slide,index) => <option key={slide.key} value={slide.key}>{String(index+1).padStart(2,'0')} · {slide.name}</option>)}
              </select>
            </>}
            <label className="input-label">CUSTOM MAIN TITLE (OPTIONAL)</label>
            <input aria-label="Etsy custom cover headline" value={coverHeadline} disabled={aiBusy} maxLength={75} placeholder={title} onChange={event => setCoverHeadline(event.target.value)} />
            <label className="input-label">TYPOGRAPHY MODE</label>
            <select aria-label="Etsy pack typography mode" value={packTypography} disabled={aiBusy} onChange={e => setPackTypography(e.target.value as typeof packTypography)}>
              <option value="editable">Editable fonts · precise wording</option>
              <option value="ai-artwork">AI background + artistic lettering + badges</option>
            </select>
            <label className="input-label">DESIGN BOLDNESS</label>
            <select aria-label="Etsy pack design boldness" disabled={aiBusy} value={packBoldness} onChange={e => setPackBoldness(e.target.value as typeof packBoldness)}>
              <option value="soft">Soft · restrained</option><option value="balanced">Balanced · premium</option><option value="bold">Bold · scroll-stopping</option>
            </select>
            <label className="input-label">CLIPART SIZE HIERARCHY</label>
            <select aria-label="Etsy pack clipart hierarchy" disabled={aiBusy} value={packHierarchy} onChange={e => setPackHierarchy(e.target.value as ClipartHierarchy)}>
              <option value="soft">Soft · subtle variation</option><option value="medium">Medium · clear hierarchy</option><option value="dramatic">Dramatic · large hero artwork</option>
            </select>
            <label className="input-label">COVER ART STYLE</label>
            <select aria-label="Etsy pack cover style" disabled={aiBusy} value={packCoverStyle} onChange={e => setPackCoverStyle(e.target.value as typeof packCoverStyle)}>
              <option value="editorial">Premium editorial</option><option value="boutique">Modern boutique</option><option value="storybook">Storybook gallery</option><option value="modern">Modern Etsy</option><option value="watercolor">Artistic watercolor</option>
            </select>
            <label className="input-label">BACKGROUND QUALITY</label>
            <select aria-label="Etsy pack background quality" disabled={aiBusy} value={packQuality} onChange={e => setPackQuality(e.target.value as typeof packQuality)}><option value="low">Low · economical</option><option value="medium">Medium · recommended</option><option value="high">High · premium cost</option></select>
            <label className="input-label">BACKGROUND + TYPOGRAPHY STYLE</label>
            <select aria-label="Etsy pack background style" value={backgroundStyle} disabled={aiBusy} onChange={e => setBackgroundStyle(e.target.value as typeof backgroundStyle)}>
              <option value="watercolor">Watercolor</option><option value="paper">Luxury paper</option><option value="gradient">Color gradient</option><option value="botanical">Botanical accents</option><option value="vintage">Vintage</option>
            </select>
            <label className="input-label">DECORATION INTENSITY</label>
            <select aria-label="Etsy pack intensity" value={backgroundIntensity} disabled={aiBusy} onChange={e => setBackgroundIntensity(e.target.value as typeof backgroundIntensity)}>
              <option value="soft">Soft</option><option value="balanced">Balanced</option><option value="vibrant">Vibrant</option>
            </select>
            <label className="input-label">THUMBNAIL DESIGN PROMPT PREVIEW</label>
            <textarea aria-label="Thumbnail design prompt preview" readOnly rows={7} value={currentBriefPreview} style={{ width: '100%', fontSize: 11, lineHeight: 1.35 }} />
            <button type="button" className="outline-btn" disabled={aiBusy} onClick={() => void navigator.clipboard.writeText(currentBriefPreview)}>Copy thumbnail prompt</button>
            <button className="primary-btn" type="button" disabled={aiBusy || !characters.some(c => c.imageUrl)} onClick={() => void generateReferenceBatch()}>
              <WandSparkles size={15}/> {aiBusy ? 'Generating...' : generationScope === 'single' ? 'Generate 1 Thumbnail' : generationScope === 'core-5' ? 'Generate 5 Thumbnails' : generationScope === 'complete-10' ? 'Generate 10 Thumbnails' : 'Generate Category Showcase'}
            </button>
            {aiBusy && <button type="button" className="outline-btn" onClick={() => { cancelPackRef.current = true; setPackStatus('Stopping after current request...'); }}>Stop after current image</button>}
            {packStatus && <small role="status">{packStatus}</small>}
            {onStartListingStudio && <div style={{ borderTop:'1px solid #e5e7eb', paddingTop:12, display:'grid', gap:8 }}><strong>15-Image Etsy Listing Studio</strong><small>Start the 15-image review workflow using these Reference & Assets settings and only original collection clipart. Output: 3000 × 2250 JPG. AI lettering is enabled for the listing workflow.</small><button type="button" className="primary-btn" disabled={aiBusy || !characters.some(c => c.imageUrl)} onClick={() => void startListingStudio()}><WandSparkles size={15}/> Start 15 Listing Images</button></div>}
            <small>All characters are existing collection PNG files, never reconstructed by AI. Editable mode adds distinct typographic layers over a no-text AI background. AI lettering mode combines text and decoration in one image and checks for generated objects; verify its spelling. Native editor canvas: 1024 × 1024 px. API charges apply.</small>
            <small>Only original collection clipart is placed on top. Upscaled assets are not used.</small>
          </div>
          <small>Optional references inspire layout. Automatically generated designs keep typography areas clear of collection clipart.</small>
        </>}
        {layoutMode === 'manual' && onStartListingStudio && <button type="button" className="primary-btn" disabled={aiBusy || !characters.some(c=>c.imageUrl)} onClick={() => void startListingStudio()}>Start 15 Listing Images (manual placements)</button>}
        <h3>Characters</h3>
        <div style={{ maxHeight: 400, overflowY: 'auto', display: 'grid', gap: 8 }}>
          {characters.filter(c => c.imageUrl).map(c => <button type="button" key={c.id} onClick={() => add(newImage(c, design.elements.filter(e => e.type === 'image').length))} style={{ textAlign: 'left', display: 'flex', gap: 8, alignItems: 'center', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 6 }}>
            <img src={c.imageUrl} alt="" style={{ width: 45, height: 45, objectFit: 'contain' }}/>
            <span style={{ fontSize: 12 }}>{c.name}{c.upscaledImageUrl ? ' · Upscaled' : ''}</span>
          </button>)}
          {!characters.some(c => c.imageUrl) && <p className="sub">Generate character images first.</p>}
        </div>
        <button className="outline-btn" onClick={() => add(newText(title))}>+ Add text</button>
        </div>}
        {sideTab === 'generation' && <div id="thumbnail-generation-panel" role="tabpanel" aria-labelledby="thumbnail-generation-tab" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', minWidth: 0, gap: 12 }}>
        <h3>Thumbnail Prompt</h3>
        <small>Generated from your Reference & Assets settings. OpenAI creates only the abstract background and optional artistic lettering; PaletteIQ overlays the exact original collection PNGs. No clipart is redrawn.</small>
        <label className="input-label">OPENAI BACKGROUND MODEL</label>
        <select aria-label="OpenAI thumbnail background model" disabled={aiBusy} value={imageModel} onChange={e => setImageModel(e.target.value)}>
          {!imageModels.some(m => m.id === imageModel) && <option value={imageModel}>{imageModel} (saved/default)</option>}
          {imageModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <label className="input-label">PROMPT FROM REFERENCE & ASSETS</label>
        <textarea aria-label="Thumbnail design prompt preview" readOnly rows={15} value={currentBriefPreview} style={{ width: '100%', fontSize: 11, lineHeight: 1.35 }} />
        <button className="outline-btn" type="button" onClick={() => void navigator.clipboard.writeText(currentBriefPreview)}>Copy thumbnail prompt</button>
        <button className="primary-btn" type="button" disabled={aiBusy || !characters.some(c => c.imageUrl)} onClick={() => void generateReferenceBatch()}>
          <WandSparkles size={15}/> {aiBusy ? 'Generating...' : generationScope === 'single' ? 'Generate 1 Thumbnail from Prompt' : 'Generate Exact-Asset Pack from Prompt'}
        </button>
        <small>AI image generation uses your chosen background quality in Reference & Assets. AI Vision then fits existing collection assets around the actual lettering. API charges apply.</small>
        </div>}
      </div>
      <div style={{ minWidth: 0, position: 'sticky', top: 12, alignSelf: 'start' }}>
      <div className="panel" style={{ padding: 12, minWidth: 0 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 10, alignItems: 'center' }}>
          <button className="outline-btn" disabled={!history.length} onClick={undo} title="Undo"><Undo2 size={15}/></button>
          <button className="outline-btn" disabled={!future.length} onClick={redo} title="Redo"><Redo2 size={15}/></button>
          <button className="outline-btn" aria-label="Zoom out canvas" onClick={() => setPreviewZoom(z => clamp(z - .25, .5, 3))}>−</button>
          <span>{Math.round(previewZoom*100)}%</span>
          <button className="outline-btn" aria-label="Zoom in canvas" onClick={() => setPreviewZoom(z => clamp(z + .25, .5, 3))}>+</button>
          <button className="outline-btn" onClick={() => setPreviewZoom(1)} title="Reset zoom"><RotateCcw size={15}/></button>
          <button className="outline-btn" type="button" onClick={() => add(newText())}><Plus size={15}/> Text</button>
          <button className="outline-btn" type="button" disabled={!selection || selection.locked} onClick={remove} title="Delete selected object"><Trash2 size={15}/> Delete</button>
          <span style={{ marginLeft: 'auto' }}>{design.width}×{design.height}</span>
        </div>
        <div ref={canvasViewportRef} onPointerDown={startPan} onPointerMove={movePan} onPointerUp={stopPan} onPointerCancel={stopPan} aria-label="Thumbnail canvas viewport" style={{ overflow: previewZoom > 1 ? 'auto' : 'hidden', height: 'min(66vh, 780px)', minHeight: 240, boxSizing: 'border-box', background: '#e8e8e8', padding: 16, borderRadius: 8, cursor: previewZoom > 1 ? 'grab' : 'default', touchAction: 'none' }}>
          <div style={{ width: fittedWidth * previewZoom, margin: '0 auto', marginTop: Math.max(0, (viewportSize.height - fittedHeight * previewZoom) / 2) }}>
            <div ref={stageRef} onPointerDown={() => setSelectedId('')} style={{ width: '100%', aspectRatio: `${design.width}/${design.height}`, backgroundColor: design.background, position: 'relative', containerType: 'inline-size', overflow: 'hidden', boxShadow: '0 5px 25px #0002', touchAction: 'none' }}>
              {(design.backgroundImageUrl || design.aiImageUrl) && <img
                key={design.backgroundImageUrl || design.aiImageUrl}
                src={design.backgroundImageUrl || design.aiImageUrl}
                alt="Thumbnail background"
                onLoad={() => setBackgroundLoadError('')}
                onError={() => setBackgroundLoadError('Background image cannot be displayed. Check the generated image URL or your image storage.')}
                draggable={false}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none', userSelect: 'none' }}
              />}
              {design.elements.map(e => {
                const isSelected = e.id === selectedId;
                return <div key={e.id} data-thumbnail-element="true" onPointerDown={event => startDrag(event,e,'move')} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
                  style={{ position: 'absolute', left: e.x+'%', top: e.y+'%', width: e.width+'%', height: e.height+'%', transform: `rotate(${e.rotation}deg)`, opacity: e.opacity ?? 1, border: isSelected ? '2px dashed #e36a1b' : '1px solid transparent', cursor: e.locked ? 'not-allowed' : 'move', boxSizing: 'border-box', touchAction: 'none', userSelect: 'none' }}>
                  {e.type === 'image' ? (imageUrl(e) ? <img src={imageUrl(e)} alt={assetMap.get(e.characterId || '')?.name || 'Character'} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }}/> : <div style={{ color: '#d33' }}>Image unavailable</div>) :
                    (e.curve ? <CurvedText element={e} designWidth={design.width}/> : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontSize: `clamp(5px, ${(e.fontSize || 80) / design.width * 100}cqw, 250px)`, fontFamily: e.fontFamily || 'Arial', fontWeight: e.fontWeight || 'bold', color: e.color || '#333', whiteSpace: 'pre-line', overflow: 'hidden', pointerEvents: 'none' }}>{e.text}</div>)}
                  {isSelected && !e.locked && <div title="Drag to rotate" onPointerDown={event => startDrag(event,e,'rotate')} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
                    style={{ position: 'absolute', left: '50%', top: -30, transform: 'translateX(-50%)', width: 22, height: 22, background: '#fff', border: '2px solid #e36a1b', borderRadius: '50%', cursor: 'grab', display: 'grid', placeItems: 'center', touchAction: 'none', zIndex: 3 }}>↻</div>}
                  {isSelected && !e.locked && <div onPointerDown={event => startDrag(event,e,'resize')} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
                    style={{ position: 'absolute', right: -7, bottom: -7, width: 15, height: 15, background: '#e36a1b', border: '2px solid white', borderRadius: 3, cursor: 'nwse-resize', touchAction: 'none' }}/>}
                </div>;
              })}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button className="primary-btn" disabled={busy} onClick={() => void exportPng('png')}><Download size={15}/> Export PNG</button>
          <button className="outline-btn" disabled={busy} onClick={() => void exportPng('jpeg')}><Download size={15}/> Export JPG</button>
        </div>
      </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 'min(82vh, 950px)', minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>
      <div className="panel" style={{ padding: 14, display: 'grid', gap: 9 }}>
        <h3>Design properties</h3>
        <label className="input-label">DESIGN NAME</label>
        <input value={design.name} onChange={e => mutate({ name: e.target.value })}/>
        <label className="input-label">THUMBNAIL SIZE</label>
        <input readOnly aria-label="Thumbnail size" value="1024 × 1024 px" />
        <small>Fixed thumbnail creation and standard JPG/PNG export: 1024 × 1024 pixels. Remote upscale is a separate optional action.</small>
        <label className="input-label">BACKGROUND COLOR</label>
        <input type="color" value={design.background} onChange={e => mutate({ background: e.target.value })}/>
        <label className="input-label">AI DECORATIVE BACKGROUND (OPENAI)</label>
        <label className="input-label">BACKGROUND STYLE</label>
        <select aria-label="Background style" value={backgroundStyle} disabled={backgroundGenerating} onChange={event => setBackgroundStyle(event.target.value as typeof backgroundStyle)}><option value="watercolor">Artistic watercolor washes</option><option value="paper">Luxury textured paper</option><option value="gradient">Premium colorful gradient</option><option value="botanical">Abstract botanical motifs</option><option value="vintage">Vintage decorative texture</option></select>
        <label className="input-label">DECORATION INTENSITY</label>
        <select aria-label="Background decoration intensity" value={backgroundIntensity} disabled={backgroundGenerating} onChange={event => setBackgroundIntensity(event.target.value as typeof backgroundIntensity)}><option value="soft">Soft — visible pastel details</option><option value="balanced">Balanced — recommended</option><option value="vibrant">Vibrant — stronger colors</option></select>
        <button className="outline-btn" type="button" disabled={backgroundGenerating || aiBusy} onClick={() => void generateReferenceBackground()}><WandSparkles size={15}/> {backgroundGenerating ? 'Generating background...' : 'Generate background (no clipart or text)'}</button>
        <small>Generate visible decorative textures and color variations. Original clipart and typography stay on top as independent layers. Generating again may incur API charges.</small>
        <label className="input-label">BACKGROUND IMAGE (LOCAL PNG/JPG)</label>
        <input type="file" accept="image/png,image/jpeg" disabled={backgroundUploading} onChange={e => void uploadBackground(e.target.files?.[0])}/>
        {backgroundUploading && <small>Uploading background…</small>}
        {backgroundLoadError && <small role="alert" style={{ color: '#b91c1c' }}>{backgroundLoadError}</small>}
        {design.backgroundImageUrl && <a href={design.backgroundImageUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>View current background image</a>}
        {design.backgroundImageUrl && <button className="outline-btn" type="button" onClick={() => { setBackgroundLoadError(''); mutate({ backgroundImageUrl: undefined }); }}>Remove background image</button>}
        <h3>Layers</h3>
        <div style={{ display: 'grid', gap: 5, maxHeight: 190, overflowY: 'auto' }}>
          {[...design.elements].reverse().map(e => <div key={e.id} style={{ display: 'flex', gap: 5, minWidth: 0 }}>
            <button type="button" className="outline-btn" style={{ flex: 1, justifyContent: 'flex-start', minWidth: 0, background: e.id === selectedId ? '#fff0df' : undefined, overflow: 'hidden', textOverflow: 'ellipsis' }} onClick={() => setSelectedId(e.id)}>{e.type === 'text' ? 'T' : '◫'} {e.type === 'text' ? e.text?.slice(0,24) : assetMap.get(e.characterId || '')?.name || 'Image'}</button>
            <button type="button" className="outline-btn" disabled={e.locked} aria-label={`Delete ${e.type === 'text' ? 'text' : 'character'} from layers`} title="Delete layer" onClick={() => { commit({ ...design, elements: design.elements.filter(item => item.id !== e.id) }); if (selectedId === e.id) setSelectedId(''); }}><Trash2 size={14}/></button>
          </div>)}
        </div>
      </div>
      <div className="panel" style={{ padding: 14, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', alignItems: 'start', gap: 8 }}>
        <h3 style={{ gridColumn: '1 / -1' }}>Selected element</h3>
        {selection ? <>
          {selection.type === 'text' ? <>
            <label className="input-label">TEXT</label><textarea value={selection.text || ''} rows={3} onChange={e => updateElement({ text: e.target.value })}/>
            <label className="input-label">FONT</label><select value={selection.fontFamily || 'Arial'} onChange={e => updateElement({ fontFamily: e.target.value })}>{["Arial","Georgia","Dancing Script","Sacramento","Tangerine","Kaushan Script","Courgette","Playball","Petit Formal Script","Indie Flower","Gloria Hallelujah","Architects Daughter","Chewy","Bangers","Yeseva One","Josefin Sans","Caveat","Amatic SC","Kalam","Patrick Hand","Permanent Marker","Pacifico","Satisfy","Lobster Two","Bebas Neue","Oswald","Abril Fatface","Fredericka the Great","Rye","Special Elite","Playfair Display","Cormorant Garamond","Cinzel","Bodoni Moda","DM Serif Display","Libre Baskerville","EB Garamond","Lora","Prata","Marcellus","Great Vibes","Allura","Poppins","Montserrat","Raleway","Times New Roman","Verdana"].map(f => <option key={f}>{f}</option>)}</select>
            <label className="input-label">FONT SIZE</label><input type="number" min={8} max={500} value={selection.fontSize || 80} onChange={e => updateElement({ fontSize: clamp(Number(e.target.value),8,500) })}/>
            <label className="input-label">TEXT CURVE ({selection.curve || 0}%)</label>
            <input aria-label="Curve text" type="range" min={-100} max={100} step={1} value={selection.curve || 0} onChange={e => updateElement({ curve: Number(e.target.value) })}/>
            <button type="button" className="outline-btn" onClick={() => updateElement({ curve: 0 })}>Straight text</button>
            <label className="input-label">TEXT COLOR</label><div style={{ display: 'flex', gap: 8 }}><input aria-label="Choose text color" type="color" value={selection.color || '#333333'} onChange={e => updateElement({ color: e.target.value })}/><input aria-label="Text color hex" value={selection.color || '#333333'} onChange={e => { if (/^#[0-9a-f]{6}$/i.test(e.target.value)) updateElement({ color: e.target.value }); }}/></div>
            <label className="input-label">WEIGHT</label><select value={selection.fontWeight || 'bold'} onChange={e => updateElement({ fontWeight: e.target.value })}><option value="normal">Normal</option><option value="bold">Bold</option></select>
          </> : <>
            <label className="input-label">ASSET SOURCE</label><select disabled={Boolean(design.originalAssetsOnly)} value={design.originalAssetsOnly ? 'original' : selection.source || 'original'} onChange={e => updateElement({ source: e.target.value as 'original' | 'upscaled' })}><option value="original">Original</option><option value="upscaled" disabled={Boolean(design.originalAssetsOnly) || !assetMap.get(selection.characterId || '')?.upscaledImageUrl}>Upscaled</option></select>
          </>}
          {(['x','y','width','height','rotation','opacity'] as const).map(key => <label key={key} style={{ display: 'grid', gap: 4 }}><span className="input-label">{key.toUpperCase()}{key === 'opacity' ? ' (0–1)' : key === 'rotation' ? ' (DEG)' : ' (%)'}</span><input type="number" step={key === 'opacity' ? .1 : 1} value={selection[key] ?? (key === 'opacity' ? 1 : 0)} onChange={e => updateElement({ [key]: Number(e.target.value) })}/></label>)}
          <label><input type="checkbox" checked={Boolean(selection.locked)} onChange={e => updateElement({ locked: e.target.checked })}/> Lock element</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <button className="outline-btn" onClick={() => { const index = design.elements.findIndex(e => e.id === selectedId); if (index < design.elements.length-1) { const all = [...design.elements]; [all[index],all[index+1]]=[all[index+1],all[index]]; mutate({elements:all}); } }}>Bring forward</button>
            <button className="outline-btn" onClick={() => { const index = design.elements.findIndex(e => e.id === selectedId); if (index > 0) { const all = [...design.elements]; [all[index],all[index-1]]=[all[index-1],all[index]]; mutate({elements:all}); } }}>Send backward</button>
            <button className="outline-btn" onClick={() => add({ ...selection, id: id(), x: selection.x+3, y: selection.y+3 })}>Duplicate</button>
            <button className="outline-btn" onClick={remove}><Trash2 size={15}/> Remove</button>
          </div>
        </> : <p className="sub">Click an element to edit its position, size, rotation, style or layer.</p>}

      </div>
      </div>
    </div>}
    <div className="panel" style={{ marginTop: 14, padding: 16, width: '100%' }}>
      <h3 style={{ marginTop: 0 }}>All collection thumbnails ({designs.length})</h3>
      <p className="sub">Click a thumbnail to show it on the canvas. Check thumbnails for GPU upscale; completed submissions continue on the remote server even if PaletteIQ closes.</p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <button type="button" className="outline-btn" disabled={upscaleBusy} onClick={() => setSelectedThumbnailIds(new Set(designs.filter(item => !item.upscaledImageUrl && !item.upscaleJob).map(item => item.id)))}>Select pending</button>
        <button type="button" className="outline-btn" disabled={upscaleBusy} onClick={() => setSelectedThumbnailIds(new Set())}>Clear selection</button>
        <select style={{ width: 88, flex: '0 0 88px' }} aria-label="Thumbnail upscale factor" value={upscaleFactor} disabled={upscaleBusy} onChange={event => setUpscaleFactor(Number(event.target.value) as 2 | 4 | 6 | 8)}>{[2,4,6,8].map(factor => <option key={factor} value={factor}>{factor}×</option>)}</select>
        <button type="button" className="primary-btn" disabled={upscaleBusy || ![...selectedThumbnailIds].some(id => designs.some(item => item.id === id && !item.upscaleJob))} onClick={() => void upscaleSelectedThumbnails()}>
          {upscaleBusy ? 'Submitting ' + upscaleSubmitting.done + '/' + upscaleSubmitting.total : 'Remote GPU Upscale selected (' + [...selectedThumbnailIds].filter(id => designs.some(d => d.id === id && !d.upscaleJob)).length + ')'}
        </button>
        {upscaleStatus && <small>{upscaleStatus}</small>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button className="outline-btn" type="button" aria-label="Scroll thumbnails left" onClick={() => scrollGallery(-1)} style={{ flexShrink: 0, minWidth: 38 }}>‹</button>
        <div ref={galleryStripRef} style={{ display: 'flex', flexWrap: 'nowrap', overflowX: 'auto', overflowY: 'hidden', gap: 12, flex: 1, minWidth: 0, scrollBehavior: 'smooth', scrollSnapType: 'x mandatory', paddingBottom: 8 }}>
        {designs.map(item => (
          <div key={item.id} style={{ background: item.id === design?.id ? '#fff3e9' : '#fff', border: item.id === design?.id ? '2px solid #f1641e' : '1px solid #ddd', borderRadius: 10, padding: 8, textAlign: 'left', flex: '0 0 170px', scrollSnapAlign: 'start' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, marginBottom: 6 }}>
              <input type="checkbox" checked={selectedThumbnailIds.has(item.id)} disabled={upscaleBusy || Boolean(item.upscaleJob)} onChange={event => setSelectedThumbnailIds(old => { const next = new Set(old); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; })}/>
              Select for upscale
            </label>
            <button type="button" onClick={() => { setActiveId(item.id); setSelectedId(''); }} style={{ border: 0, background: 'transparent', textAlign: 'left', padding: 0, width: '100%', cursor: 'pointer' }}>
            <div style={{ width: '100%', aspectRatio: item.width + '/' + item.height, position: 'relative', overflow: 'hidden', borderRadius: 6, backgroundColor: item.background }}>
              {(item.backgroundImageUrl || item.aiImageUrl) && <img src={item.backgroundImageUrl || item.aiImageUrl} alt="" draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}/>}
              {!item.aiImageUrl && item.elements.map(element => element.type === 'image' ? <img key={element.id} src={imageUrl(element)} alt="" style={{ position: 'absolute', left: element.x + '%', top: element.y + '%', width: element.width + '%', height: element.height + '%', objectFit: 'contain', transform: 'rotate(' + element.rotation + 'deg)' }}/> : <span key={element.id} style={{ position: 'absolute', left: element.x + '%', top: element.y + '%', width: element.width + '%', color: element.color, fontFamily: element.fontFamily, fontSize: 9, overflow: 'hidden' }}>{element.text}</span>)}
            </div>
            <strong style={{ display: 'block', marginTop: 7, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</strong>
            {item.generationError && <small style={{ color: '#b91c1c', display: 'block' }} title={item.generationError}>{item.rejectedBackgroundUrl ? 'Review AI background: ' : 'AI background failed: '}{item.generationError.slice(0, 110)}</small>}
            <small>{item.aiImageUrl ? 'AI image' : 'Editable design'} · {item.width}×{item.height}</small>
            </button>
            {item.rejectedBackgroundUrl && <div style={{ display: 'grid', gap: 5, marginTop: 6 }}>
              <a href={item.rejectedBackgroundUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, textDecoration: 'underline' }}>View rejected AI artwork</a>
              <button type="button" className="outline-btn" style={{ fontSize: 11, padding: '5px 7px' }} disabled={aiBusy || Boolean(backgroundRetryId)} onClick={() => void approveReviewedBackground(item)}>Approve after visual inspection</button>
              <small>QC flagged a possible product illustration. Not used in the thumbnail until approved.</small>
            </div>}
            <small style={{ display: 'block', marginTop: 5 }}>{item.upscaleJob ? (upscaleRemaining[item.id] != null ? 'Est. remaining: ' + Math.ceil(upscaleRemaining[item.id]! / 60) + ' min' : 'Time remaining: waiting for GPU / estimating…') : item.upscaledImageUrl ? '✓ Upscale completed' : 'Not upscaled'}</small>
            {item.upscaledImageUrl ? <button type="button" className="outline-btn" style={{ fontSize: 12, marginTop: 6 }} onClick={() => void compareThumbnail(item)}>Compare images</button>
              : item.aiImageUrl && <a href={item.aiImageUrl} download style={{ display: 'block', fontSize: 12 }}>View AI image</a>}
            <div style={{ display: 'flex', gap: 5, marginTop: 8, flexWrap: 'wrap' }}>
              {item.originalAssetsOnly && item.backgroundImageUrl && <button type="button" className="outline-btn" style={{ fontSize: 11, padding: '5px 7px', flex: 1 }} disabled={aiBusy || Boolean(backgroundRetryId)} onClick={() => void reLayoutWithVision(item)}>
                <WandSparkles size={12}/> {backgroundRetryId === item.id ? 'Analyzing...' : 'Re-layout with AI Vision'}
              </button>}
              {item.originalAssetsOnly && <button type="button" className="outline-btn" style={{ fontSize: 11, padding: '5px 7px', flex: 1 }} disabled={aiBusy || Boolean(backgroundRetryId)} onClick={() => void retryBackground(item)}>
                <WandSparkles size={12}/> {backgroundRetryId === item.id ? 'Generating...' : item.backgroundImageUrl ? 'Regenerate AI' : 'Generate AI Background'}
              </button>}
              <button type="button" className="outline-btn" aria-label={'Delete thumbnail ' + item.name} title="Delete this thumbnail only" style={{ color: '#b91c1c', fontSize: 11, padding: '5px 7px' }} disabled={aiBusy || Boolean(item.upscaleJob)} onClick={() => deleteThumbnail(item.id)}>
                <Trash2 size={13}/> Hapus
              </button>
            </div>
          </div>
        ))}
        </div>
        <button className="outline-btn" type="button" aria-label="Scroll thumbnails right" onClick={() => scrollGallery(1)} style={{ flexShrink: 0, minWidth: 38 }}>›</button>
      </div>
    </div>
    <section className="panel" aria-label="Thumbnail upscale job queue" style={{ marginTop: 14, padding: 16 }}>
      <h3 style={{ marginTop: 0 }}>Upscale job queue</h3>
      <p className="sub">Jobs for this collection · Updates every 5 seconds. GPU processing continues when PaletteIQ is closed.</p>
      {upscaleBusy && <p role="status">Submitting {upscaleSubmitting.done} / {upscaleSubmitting.total} thumbnails…</p>}
      {!queueItems.length ? <p>No thumbnail upscale jobs yet.</p> : <div style={{ overflowX: 'auto' }}><table style={{ width: '100%' }}>
        <thead><tr><th>Thumbnail</th><th>Job ID</th><th>Scale</th><th>Status</th><th>Elapsed</th><th>Est. remaining</th><th>Result / details</th></tr></thead>
        <tbody>{queueItems.map(item => {
          const job = item.upscaleJob;
          const progress = job ? upscaleJobs[job.id] : undefined;
          const status = job ? progress?.status || 'checking' : 'succeeded';
          const label = ({ checking: 'Checking…', queued: 'Queued', processing: 'Processing', succeeded: 'Completed', failed: 'Failed', cancelled: 'Cancelled', cancelling: 'Cancelling', sync_error: 'Status unavailable' } as Record<string, string>)[status] || status;
          return <tr key={item.id}>
            <td>{item.name}</td><td title={job?.id}>{job ? job.id.slice(0, 12) : '—'}</td><td>{job ? job.factor + '×' : '—'}</td>
            <td>{label}</td><td>{queueDuration(progress?.elapsed)}</td>
            <td>{status === 'processing' ? progress?.remaining != null ? '≈ ' + queueDuration(progress.remaining) : 'Estimating…' : status === 'queued' ? 'Waiting for GPU' : '—'}</td>
            <td>{progress?.error || (job ? 'Submitted ' + new Date(job.submittedAt).toLocaleString() : item.upscaledImageUrl ? <a href={item.upscaledImageUrl} target="_blank" rel="noreferrer">View JPG</a> : '—')}</td>
          </tr>;
        })}</tbody>
      </table></div>}
    </section>
    {comparePreview && <UpscaleCompare name={comparePreview.name} originalUrl={comparePreview.originalUrl} upscaledUrl={comparePreview.upscaledUrl} onClose={() => setComparePreview(null)}/>}
  </div>;
}
