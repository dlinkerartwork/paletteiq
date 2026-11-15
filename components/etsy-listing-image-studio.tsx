'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, Download, LoaderCircle, RotateCcw, Sparkles } from 'lucide-react';
import { readApiJson, uploadListingJpg } from '@/lib/listing-image-upload';
import type { ListingStyleSample, ListingVisualStyleProfile } from '@/lib/etsy-listing-visual-style';
import type { ImageGenerationCostEstimate } from '@/lib/etsy-listing-image-cost';
import { listingCreativeDirection, listingMockupScene } from '@/lib/etsy-listing-creative-direction';
import EtsyListingLayoutCanvas from '@/components/etsy-listing-layout-canvas';
import { evaluateListingCoverTitle, suggestListingCoverCopy } from '@/lib/etsy-listing-cover-copy';
import { aiFirstSampleIndices, AI_FIRST_LAYOUT_ARCHETYPES } from '@/lib/etsy-listing-ai-first';
import {
  LISTING_IMAGE_SPECS, LISTING_WIDTH, LISTING_HEIGHT, originalAssets, planCompleteCollectionCatalog, completeCatalogMatchesInventory,
  planListingPlacements, curatedListingHighlights, DEFAULT_MAIN_COVER_CLIPART_COUNT, defaultListingCompositionMode, listingAllowsBleed, listingFilename, listingImageTextDefaults, listingImageTextDefaultsForStep, isSquareListingApproved, type ListingCompositionMode, type ListingImageText, type ListingFinalReview, type ListingAsset, type ListingImageRecord, type ListingPlacement
} from '@/lib/etsy-listing-image-plan';

type Props = {
  projectId: string;
  name: string;
  theme: string;
  subtheme: string;
  style?: string;
  palette?: string;
  texture?: string;
  seoTitle?: string;
  primaryKeyword?: string;
  defaultImageModel?: string;
  defaultImageQuality?: string;
  characters: ListingAsset[];
  onSaved?: (images: ListingImageRecord[]) => void;
};
type ListResponse = { conceptUrl?: string; creativeBrief?: string; selectedSourceIds?: string[]; sampledSourceCount?: number; selectedSourceCount?: number; detailedOriginalReferencesIncluded?: number; backgroundPrompt?: string; layoutPrompt?: string; images?: ListingImageRecord[]; preLayouts?: Record<string, ListingPlacement[]>; compositionModes?: Record<string, ListingCompositionMode>; saved?: boolean; backgroundUrl?: string; placements?: ListingPlacement[]; finalReview?: ListingFinalReview | null; fallback?: string; reviewWarning?: string; costEstimate?: ImageGenerationCostEstimate | null; warning?: string; deleted?: boolean; error?: string };
const apiUrl = '/api/listing-image-studio';
const styleApiUrl = '/api/listing-style-analysis';
type StyleResponse = { profile?: ListingVisualStyleProfile | null; cached?: boolean; error?: string };
async function styleRequest(url: string, options?: RequestInit): Promise<StyleResponse> {
  return readApiJson<StyleResponse>(await fetch(url, options), 'Collection style analysis');
}
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));
const fileName = (number: number) => listingFilename(number);
const smoothName = (name: string) => name.replace(/\s+/g, ' ').trim().slice(0, 75);

async function request(url: string, options?: RequestInit): Promise<ListResponse> {
  const response = await fetch(url, options);
  return readApiJson<ListResponse>(response, 'Listing Image Studio request');
}
const send = (body: object) => request(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function imageFromUrl(url: string): Promise<HTMLImageElement> {
  const image = new window.Image();
  image.crossOrigin = 'anonymous';
  image.src = url;
  await image.decode();
  return image;
}
type CollectionInspection = { sampled: number; checked: number; transparent: number; dimensionSummary: string; failed: number };
async function inspectOriginalCollectionSample(assets: ListingAsset[]): Promise<CollectionInspection> {
  // The full collection remains the source of truth. Limit automatic image decode
  // work so a 120+ asset bundle doesn't download every full-res PNG on page entry.
  const sample = assets.slice(0, 12);
  const results = await Promise.all(sample.map(async asset => {
    try {
      const image = await imageFromUrl(asset.imageUrl!);
      const canvas = document.createElement('canvas');
      canvas.width = 48; canvas.height = 48;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw Error('Canvas inspection unavailable');
      ctx.clearRect(0, 0, 48, 48);
      ctx.drawImage(image, 0, 0, 48, 48);
      const data = ctx.getImageData(0, 0, 48, 48).data;
      let hasAlpha = false;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] < 255) { hasAlpha = true; break; }
      }
      return { width: image.naturalWidth, height: image.naturalHeight, hasAlpha };
    } catch { return null; }
  }));
  const succeeded = results.filter((x): x is NonNullable<typeof x> => Boolean(x));
  const sizes = [...new Set(succeeded.map(x => x.width + '×' + x.height))];
  return { sampled: sample.length, checked: succeeded.length,
    transparent: succeeded.filter(x => x.hasAlpha).length,
    dimensionSummary: sizes.slice(0, 4).join(', ') + (sizes.length > 4 ? ', …' : ''),
    failed: sample.length - succeeded.length };
}

/**
 * Make a compact contact sample from REAL collection PNG pixels. Only these
 * thumbnails are sent to Vision for art STYLE observation; the image model that
 * creates the listing background receives text direction, never original art.
 */
async function createCollectionStyleSamples(assets: ListingAsset[]): Promise<ListingStyleSample[]> {
  const count = Math.min(6, assets.length);
  const choices = Array.from({ length: count }, (_, i) =>
    assets[Math.min(assets.length - 1, Math.floor((i + 0.5) * assets.length / count))]);
  const samples = await Promise.all(choices.map(async asset => {
    try {
      const image = await imageFromUrl(asset.imageUrl!);
      const bounds = imageBounds(image);
      const canvas = document.createElement('canvas');
      canvas.width = 320; canvas.height = 320;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      // Solid neutral backing prevents alpha transparency from becoming black
      // in JPEG and allows Vision to judge the true edges of painted assets.
      ctx.fillStyle = '#fffefd';
      ctx.fillRect(0, 0, 320, 320);
      const ratio = Math.min(292 / bounds.sw, 292 / bounds.sh);
      const width = bounds.sw * ratio, height = bounds.sh * ratio;
      ctx.drawImage(image, bounds.sx, bounds.sy, bounds.sw, bounds.sh,
        (320 - width) / 2, (320 - height) / 2, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
      return dataUrl.length < 230_000
        ? { assetId: asset.id, dataUrl } satisfies ListingStyleSample : null;
    } catch { return null; }
  }));
  return samples.filter((s): s is ListingStyleSample => Boolean(s));
}

function imageBounds(image: HTMLImageElement): { sx: number; sy: number; sw: number; sh: number } {
  // Detect transparent margins in a small temporary raster. The source pixels remain
  // untouched; clipping whitespace only improves sizing of the original PNG layer.
  const sample = document.createElement('canvas');
  const ratio = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight));
  sample.width = Math.max(1, Math.round(image.naturalWidth * ratio));
  sample.height = Math.max(1, Math.round(image.naturalHeight * ratio));
  const ctx = sample.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw Error('Canvas is unavailable');
  ctx.drawImage(image, 0, 0, sample.width, sample.height);
  const data = ctx.getImageData(0, 0, sample.width, sample.height).data;
  let minX = sample.width, minY = sample.height, maxX = -1, maxY = -1;
  for (let y = 0; y < sample.height; y++) for (let x = 0; x < sample.width; x++) {
    if (data[(y * sample.width + x) * 4 + 3] > 12) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) return { sx: 0, sy: 0, sw: image.naturalWidth, sh: image.naturalHeight };
  const margin = 1 / ratio;
  return {
    sx: clamp(minX / ratio - margin, 0, image.naturalWidth),
    sy: clamp(minY / ratio - margin, 0, image.naturalHeight),
    sw: clamp((maxX - minX + 1) / ratio + margin * 2, 1, image.naturalWidth),
    sh: clamp((maxY - minY + 1) / ratio + margin * 2, 1, image.naturalHeight)
  };
}
function cropDraw(ctx: CanvasRenderingContext2D, image: HTMLImageElement) {
  const scale = Math.max(LISTING_WIDTH / image.naturalWidth, LISTING_HEIGHT / image.naturalHeight);
  const sw = LISTING_WIDTH / scale, sh = LISTING_HEIGHT / scale;
  ctx.drawImage(image, (image.naturalWidth - sw) / 2, (image.naturalHeight - sh) / 2, sw, sh, 0, 0, LISTING_WIDTH, LISTING_HEIGHT);
}
/**
 * Draw thumbnails of SELECTED ORIGINAL PNG pixels, never AI reconstructions.
 * Contact sheets are VISION references only: OpenAI proposes coordinates and
 * sizes while PaletteIQ composites unchanged source image pixels afterwards.
 * The ordinal in each cell corresponds exactly to the ID list in the prompt.
 */
async function createArtworkContactSheets(
  placements: ListingPlacement[], assets: ListingAsset[]
): Promise<string[]> {
  const byId = new Map(assets.map(asset => [asset.id,asset]));
  const sheets: string[] = [];
  const perSheet = 24, columns = 8, cell = 128;
  for (let offset=0;offset<placements.length;offset+=perSheet) {
    const slice = placements.slice(offset,offset+perSheet);
    const canvas=document.createElement('canvas');
    canvas.width=columns*cell;
    canvas.height=Math.ceil(slice.length/columns)*cell;
    const ctx=canvas.getContext('2d');
    if (!ctx) throw Error('Canvas unavailable for original artwork inspection');
    ctx.fillStyle='#fffefd';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    const loaded = await Promise.all(slice.map(async placement => {
      const url=byId.get(placement.assetId)?.imageUrl;
      if (!url) return null;
      try { return await imageFromUrl(url); } catch { return null; }
    }));
    loaded.forEach((image,index) => {
      const x=(index%columns)*cell, y=Math.floor(index/columns)*cell;
      ctx.strokeStyle='#e0ddd7';ctx.strokeRect(x,y,cell,cell);
      if(image){
        const bounds=imageBounds(image);
        const scale=Math.min(108/bounds.sw,108/bounds.sh);
        const w=bounds.sw*scale,h=bounds.sh*scale;
        ctx.drawImage(image,bounds.sx,bounds.sy,bounds.sw,bounds.sh,
          x+(cell-w)/2,y+(cell-h)/2+5,w,h);
      }
      ctx.fillStyle='#fffefd';ctx.fillRect(x+3,y+3,33,21);
      ctx.fillStyle='#293c2c';ctx.font='bold 16px Arial,sans-serif';
      ctx.fillText(String(offset+index+1),x+7,y+19);
    });
    // JPEG is limited in payload size; real PNG originals remain unaffected.
    sheets.push(canvas.toDataURL('image/jpeg',0.66));
  }
  return sheets;
}

async function compose(backgroundUrl: string, placements: ListingPlacement[], assets: ListingAsset[]): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = LISTING_WIDTH; canvas.height = LISTING_HEIGHT;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw Error('Your browser cannot create a composition canvas.');
  ctx.fillStyle = '#fbf7ef'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  cropDraw(ctx, await imageFromUrl(backgroundUrl));
  const byId = new Map(assets.map(asset => [asset.id, asset]));
  for (const p of placements) {
    const url = byId.get(p.assetId)?.imageUrl;
    if (!url) throw Error('One original collection asset is missing. Refresh the collection.');
    const image = await imageFromUrl(url);
    const bounds = imageBounds(image);
    const x = p.x * LISTING_WIDTH / 100, y = p.y * LISTING_HEIGHT / 100;
    const w = p.width * LISTING_WIDTH / 100, h = p.height * LISTING_HEIGHT / 100;
    const factor = Math.min(w / bounds.sw, h / bounds.sh);
    const dw = bounds.sw * factor, dh = bounds.sh * factor;
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate((p.rotation || 0) * Math.PI / 180);
    ctx.drawImage(image, bounds.sx, bounds.sy, bounds.sw, bounds.sh, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  }
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('Could not render JPG image.')), 'image/jpeg', 0.92));
}

/**
 * Tile 03 is intentionally NEVER generative. It must draw every actual
 * collection asset exactly once, with no sampling or imagined illustrations.
 * Fail the whole render if even one original image is unavailable.
 */
async function composeCompleteCollectionCatalog(
  originals: ListingAsset[], title: string, subtitle: string, badge: string,
  progress?: (drawn:number,total:number)=>void
): Promise<{file:Blob;placements:ListingPlacement[];assetIds:string[];columns:number;rows:number}> {
  const {placements,columns,rows}=planCompleteCollectionCatalog(originals);
  if(!placements.length || placements.length!==originals.length)
    throw Error('Complete Collection needs all saved original clipart images');
  const sourceById=new Map(originals.map(asset=>[asset.id,asset]));
  const used=new Set(placements.map(p=>p.assetId));
  if(used.size!==originals.length || originals.some(a=>!used.has(a.id)))
    throw Error('Complete Collection planner did not include every original');
  const canvas=document.createElement('canvas');
  canvas.width=LISTING_WIDTH;canvas.height=LISTING_HEIGHT;
  const ctx=canvas.getContext('2d',{alpha:false});
  if(!ctx)throw Error('Browser canvas cannot render the complete catalog');
  ctx.fillStyle='#fdfbf6';ctx.fillRect(0,0,LISTING_WIDTH,LISTING_HEIGHT);
  // Compact, carefully fitted title: never obscure real catalog illustrations.
  ctx.fillStyle='#2e493a';ctx.textAlign='center';ctx.textBaseline='middle';
  const heading=(title||'The Complete Collection').trim();
  let headingSize=38;
  do{
    ctx.font='700 '+headingSize+'px Georgia, serif';
    if(ctx.measureText(heading).width<=LISTING_WIDTH-75)break;
    headingSize-=1;
  }while(headingSize>=16);
  if(ctx.measureText(heading).width>LISTING_WIDTH-75)
    throw Error('Complete Collection title is too long. Shorten the title before generating.');
  ctx.fillText(heading,LISTING_WIDTH/2,40);
  if(subtitle.trim()){
    let subtitleSize=19;
    do{
      ctx.font='500 '+subtitleSize+'px Arial, sans-serif';
      if(ctx.measureText(subtitle.trim()).width<=LISTING_WIDTH-90)break;
      subtitleSize-=1;
    }while(subtitleSize>=12);
    if(ctx.measureText(subtitle.trim()).width>LISTING_WIDTH-90)
      throw Error('Complete Collection subtitle is too long. Shorten it before generating.');
    ctx.fillStyle='#716455';ctx.fillText(subtitle.trim(),LISTING_WIDTH/2,83);
  }
  // One slot per ORIGINAL. Bounding-box fit preserves aspect ratio and source
  // artwork; white margin between slots keeps all 120 items recognizable.
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  for(let i=0;i<placements.length;i++){
    const placement=placements[i];
    const source=sourceById.get(placement.assetId);
    if(!source?.imageUrl)throw Error('Missing original artwork ID '+placement.assetId);
    let image:HTMLImageElement;
    try{image=await imageFromUrl(source.imageUrl);}
    catch{throw Error('Could not load original clipart '+(i+1)+'/'+placements.length+': '+source.name);}
    const bounds=imageBounds(image);
    if(bounds.sw<=0||bounds.sh<=0)throw Error('Original artwork has empty dimensions: '+source.name);
    const x=placement.x*LISTING_WIDTH/100,y=placement.y*LISTING_HEIGHT/100;
    const w=placement.width*LISTING_WIDTH/100,h=placement.height*LISTING_HEIGHT/100;
    const scale=Math.min(w/bounds.sw,h/bounds.sh);
    const dw=bounds.sw*scale,dh=bounds.sh*scale;
    ctx.drawImage(image,bounds.sx,bounds.sy,bounds.sw,bounds.sh,
      x+(w-dw)/2,y+(h-dh)/2,dw,dh);
    progress?.(i+1,placements.length);
  }
  // Verified inventory count, not a marketing estimate or a sampled count.
  ctx.fillStyle='#365343';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.font='700 18px Arial, sans-serif';
  ctx.fillText(placements.length+' ORIGINAL CLIPART ILLUSTRATIONS',LISTING_WIDTH/2,979);
  if(badge.trim()){
    let size=15;ctx.fillStyle='#7a6757';
    do{
      ctx.font='600 '+size+'px Arial, sans-serif';
      if(ctx.measureText(badge.trim()).width<LISTING_WIDTH-80)break;
      size--;
    }while(size>=10);
    if(ctx.measureText(badge.trim()).width>LISTING_WIDTH-80)
      throw Error('Complete Collection badge is too long.');
    ctx.fillText(badge.trim(),LISTING_WIDTH/2,1004);
  }
  const file=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(
    b=>b?resolve(b):reject(Error('Could not export complete collection JPG')),'image/jpeg',0.94));
  return {file,placements,assetIds:placements.map(p=>p.assetId),columns,rows};
}

/** Save an AI-generated full cover as JPG WITHOUT overlaying any collection PNGs. */
async function flattenAiFullCover(fullCoverUrl: string): Promise<Blob> {
  const canvas=document.createElement('canvas');
  canvas.width=LISTING_WIDTH;canvas.height=LISTING_HEIGHT;
  const ctx=canvas.getContext('2d',{alpha:false});
  if(!ctx)throw Error('Cannot render full-cover JPG');
  ctx.fillStyle='#fffaf4';ctx.fillRect(0,0,LISTING_WIDTH,LISTING_HEIGHT);
  cropDraw(ctx,await imageFromUrl(fullCoverUrl));
  return new Promise<Blob>((resolve,reject)=>canvas.toBlob(
    blob=>blob?resolve(blob):reject(Error('Could not encode AI-first JPG')),'image/jpeg',0.94));
}

async function upload(projectId: string, number: number, blob: Blob, onProgress?: (done: number, total: number) => void): Promise<string> {
  // Preserve the working fix for Payload Too Large (HTTP 413).
  return uploadListingJpg(projectId, fileName(number), blob, fetch, onProgress);
}

export default function EtsyListingImageStudio({ projectId, name, theme, subtheme, style, palette, texture, seoTitle, primaryKeyword, defaultImageModel = 'gpt-image-1-mini', defaultImageQuality = 'low', characters, onSaved }: Props) {
  const artDirection = useMemo(() => listingCreativeDirection({ name, theme, subtheme, style, palette, texture, listing: { title: seoTitle } }), [name, theme, subtheme, style, palette, texture, seoTitle]);
  const seoText = useMemo(() => listingImageTextDefaults({ title: seoTitle, primaryKeyword }, artDirection.title), [seoTitle, primaryKeyword, artDirection.title]);
  const assets = useMemo(() => originalAssets(characters), [characters]);
  const [records, setRecords] = useState<ListingImageRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [step, setStep] = useState(1);
  const [working, setWorking] = useState('');
  const [message, setMessage] = useState('');
  const [quality, setQuality] = useState<'low' | 'medium' | 'high'>(() =>
    defaultImageQuality === 'medium' || defaultImageQuality === 'high' ? defaultImageQuality : 'low');
  const [model, setModel] = useState(() =>
    /^gpt-image-[a-z0-9.-]{1,80}$/.test(defaultImageModel) ? defaultImageModel : 'gpt-image-1-mini');
  const [availableModels, setAvailableModels] = useState<Array<{id: string; name: string}>>([]);
  const [changes, setChanges] = useState<Record<number, ListingPlacement[]>>({});
  const [preLayouts, setPreLayouts] = useState<Record<string, ListingPlacement[]>>({});
  const [compositionModes, setCompositionModes] = useState<Record<string, ListingCompositionMode>>({});
  const [savedCompositionModes, setSavedCompositionModes] = useState<Record<string, ListingCompositionMode>>({});
  const [allowVisionRefinement, setAllowVisionRefinement] = useState(false);
  const [promptDrafts, setPromptDrafts] = useState<Record<number, {
    context: string; backgroundPrompt: string; layoutPrompt: string
  }>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [letteringChanges, setLetteringChanges] = useState<Record<number, ListingImageText>>({});
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [assetSearch, setAssetSearch] = useState('');
  const [showAssetPicker, setShowAssetPicker] = useState(false);
  const [autoFinalCritique, setAutoFinalCritique] = useState(true);
  const [categories, setCategories] = useState<Record<string,string>>({});
  const [inspection, setInspection] = useState<CollectionInspection | null>(null);
  const [styleProfile, setStyleProfile] = useState<ListingVisualStyleProfile | null>(null);
  const [styleWarning, setStyleWarning] = useState('');
  const [costNotice, setCostNotice] = useState<{ step: number; model: string; quality: string; estimate: ImageGenerationCostEstimate | null } | null>(null);

  const categorizedAssets = useMemo(() => assets.map(a => ({ ...a, category: categories[a.id] || a.category })), [assets, categories]);
  const current = records.find(item => item.number === step);
  const imageTextDefaults=listingImageTextDefaultsForStep(step,
    {title:seoTitle,primaryKeyword},artDirection.title);
  const currentLettering: ListingImageText = letteringChanges[step] ?? {
    title: current?.title ?? imageTextDefaults.title,
    subtitle: current?.subtitle ?? imageTextDefaults.subtitle,
    badge: current?.badge ?? imageTextDefaults.badge
  };
  const letteringDirty = Boolean(current?.backgroundUrl && (
    currentLettering.title !== (current.title ?? imageTextDefaults.title) ||
    currentLettering.subtitle !== (current.subtitle ?? imageTextDefaults.subtitle) ||
    currentLettering.badge !== (current.badge ?? imageTextDefaults.badge)
  ));
  const compositionMode: ListingCompositionMode = compositionModes[String(step)] ?? defaultListingCompositionMode(step);
  const positions = step===3 ? planCompleteCollectionCatalog(assets).placements : changes[step] ||
    (compositionMode === 'ai-first'
      ? current?.selectedSourceIds?.length
        ? planListingPlacements(step,categorizedAssets,{assetIds:current.selectedSourceIds})
        : preLayouts[String(step)] || planListingPlacements(step,categorizedAssets,{count:assets.length})
      : current?.placements || preLayouts[String(step)] || planListingPlacements(step,categorizedAssets));
  // When any relevant generation input changes, an earlier preview cannot be
  // silently sent. Explicit refresh is free and restores the exact server prompt.
  const promptContext = JSON.stringify({
    projectId, step, compositionMode,
    lettering: currentLettering, revisionNotes: notes[step] ?? current?.notes ?? '',
    placements: compositionMode === 'free' || compositionMode === 'ai-first' ? positions.map(p => p.assetId) : positions
  });
  const promptDraft = promptDrafts[step];
  const promptsReady = Boolean(promptDraft && promptDraft.context === promptContext &&
    promptDraft.backgroundPrompt.trim() &&
    (compositionMode === 'ai-first' || promptDraft.layoutPrompt.trim()));
  const selected = positions[selectedIndex] || positions[0];
  const selectedAssetIds = useMemo(() => positions.map(p=>p.assetId), [positions]);
  const coverCopy = useMemo(() => suggestListingCoverCopy({
    name, theme, subtheme, style, seoTitle, primaryKeyword, collectionSize:assets.length
  }), [name,theme,subtheme,style,seoTitle,primaryKeyword,assets.length]);
  const titleAdvice = evaluateListingCoverTitle(currentLettering.title);
  const preLayoutSaved = JSON.stringify(preLayouts[String(step)] || []) === JSON.stringify(positions) &&
    (savedCompositionModes[String(step)] ?? defaultListingCompositionMode(step)) === compositionMode;
  const visibleAssetChoices = useMemo(() => categorizedAssets.filter(asset =>
    !assetSearch.trim() || (asset.name + ' ' + (asset.category || '')).toLowerCase().includes(assetSearch.trim().toLowerCase())),
    [categorizedAssets, assetSearch]);
  const approved = LISTING_IMAGE_SPECS.filter(s => records.some(r => r.number === s.number &&
    isSquareListingApproved(r) && (s.number!==3 || completeCatalogMatchesInventory(r,assets)))).length;
  const precedingApproved = LISTING_IMAGE_SPECS.slice(0, step - 1).every(s =>
    records.some(r => r.number === s.number && isSquareListingApproved(r) &&
      (s.number!==3 || completeCatalogMatchesInventory(r,assets))));

  useEffect(() => {
    let live = true;
    setLoaded(false);
    request(apiUrl + '?projectId=' + encodeURIComponent(projectId)).then(response => {
      if (live) {
        const images = response.images || [];
        setRecords(images);
        setPreLayouts(response.preLayouts || {});
        setCompositionModes(response.compositionModes || {});
        setSavedCompositionModes(response.compositionModes || {});
        // Resume the first unapproved image on return/reload, instead of always
        // restarting visually at step 01 (approved JPGs are never regenerated).
        setStep(LISTING_IMAGE_SPECS.find(s => !images.some(r =>
          r.number === s.number && isSquareListingApproved(r) &&
          (s.number!==3 || completeCatalogMatchesInventory(r,assets))))?.number || 15);
        setSelectedIndex(0);
        setLoaded(true);
      }
    }).catch(error => { if (live) { setLoaded(true); setMessage('Could not load saved listing images: ' + String(error)); } });
    return () => { live = false; };
  }, [projectId, assets]);
  useEffect(() => {
    let live = true;
    setInspection(null);
    if (assets.length) {
      void inspectOriginalCollectionSample(assets).then(data => {
        if (live) setInspection(data);
      }).catch(() => { if (live) setInspection(null); });
    }
    return () => { live = false; };
  }, [projectId, assets]);
  useEffect(() => {
    let live = true;
    setStyleProfile(null);
    setStyleWarning('');
    setCostNotice(null);
    void styleRequest(styleApiUrl + '?projectId=' + encodeURIComponent(projectId))
      .then(response => { if (live && response.profile) setStyleProfile(response.profile); })
      .catch(() => { /* The initial read is optional; generate will retry. */ });
    return () => { live = false; };
  }, [projectId]);
  // The saved Settings preferences may load after this tab mounts.
  // Keep the initial model/quality in sync with Settings, while leaving both
  // editable locally in the always-visible Advanced AI settings panel.
  useEffect(() => {
    if (/^gpt-image-[a-z0-9.-]{1,80}$/.test(defaultImageModel)) setModel(defaultImageModel);
  }, [defaultImageModel]);
  useEffect(() => {
    if (['low','medium','high'].includes(defaultImageQuality))
      setQuality(defaultImageQuality as 'low' | 'medium' | 'high');
  }, [defaultImageQuality]);
  useEffect(() => {
    let live = true;
    void request('/api/settings?models=openai').then(data => {
      const models = data as ListResponse & { models?: Array<{id:string;name:string}> };
      if (live) setAvailableModels((models.models || []).filter(m => /^gpt-image-/.test(m.id)));
    }).catch(() => {});
    return () => { live = false; };
  }, []);
  const receive = useCallback((images: ListingImageRecord[]) => {
    setRecords(images);
    onSaved?.(images);
  }, [onSaved]);

  const ensureSourceStyle = async (): Promise<string> => {
    // The server owns the durable cache and checks the current collection
    // fingerprint. A reload or switching tabs must not incur repeat Vision fees.
    const existing = await styleRequest(styleApiUrl + '?projectId=' + encodeURIComponent(projectId));
    if (existing.profile) {
      setStyleProfile(existing.profile);
      setStyleWarning('');
      return '';
    }
    setMessage('Inspecting representative ORIGINAL clipart pixels to match the collection visual style...');
    const samples = await createCollectionStyleSamples(assets);
    if (!samples.length) throw Error('Could not decode original clipart previews for Vision analysis');
    const analyzed = await styleRequest(styleApiUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, samples })
    });
    if (!analyzed.profile) throw Error('Style analysis returned no visual profile');
    setStyleProfile(analyzed.profile);
    setStyleWarning('');
    return '';
  };

  const categorize = async () => {
    setWorking('categories'); setMessage('Analyzing collection categories from saved artwork names...');
    try {
      const response = await request('/api/thumbnail-categories', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId })
      }) as ListResponse & { groups?: Array<{ name: string; ids: string[] }> };
      const map: Record<string,string> = {};
      for (const group of response.groups || []) for (const id of group.ids) map[id] = group.name;
      if (new Set(Object.values(map)).size < 2) throw Error('The collection does not have enough distinct verified categories.');
      setCategories(map); setChanges(old => ({ ...old, [step]: planListingPlacements(step, assets.map(a => ({ ...a, category: map[a.id] || a.category }))) }));
      setMessage('Meaningful categories identified. The existing original clipart files remain unchanged.');
    } catch (error) { setMessage('Category analysis unavailable: ' + String(error)); }
    finally { setWorking(''); }
  };

  const savePreLayout = async (layout: ListingPlacement[] = positions) => {
    const result = await send({ action:'prelayout', projectId, number:step, placements:layout, compositionMode });
    if (!result.saved || !result.preLayouts) throw Error('Server did not confirm the pre-layout save');
    setPreLayouts(result.preLayouts);
    if (result.compositionModes) setSavedCompositionModes(result.compositionModes);
    return result;
  };
  const saveWhiteCanvasLayout = async () => {
    if (working || !positions.length) return;
    setWorking('prelayout');
    try {
      await savePreLayout();
      setMessage('White canvas pre-layout saved for Image ' + String(step).padStart(2,'0') + '. No AI generation or charges.');
    } catch (error) {
      setMessage('Could not save pre-layout: ' + (error instanceof Error ? error.message : String(error)));
    } finally { setWorking(''); }
  };
  const saveRecord = async (image: ListingImageRecord) => {
    const result = await send({ action: 'save', projectId, number: step, image });
    receive(result.images || []);
  };
  const renderAndSave = async (background: string, layout: ListingPlacement[], info: string, reviewWarning = '', lettering: ListingImageText = currentLettering): Promise<ListingFinalReview | null> => {
    setWorking('render'); setMessage('Compositing ' + layout.length + ' exact original collection clipart images at 1024 × 1024 px...');
    const file = await compose(background, layout, assets);
    setMessage('Saving JPG preview to the collection in safe upload chunks...');
    const renderedImageUrl = await upload(projectId, step, file, (done, total) => setMessage('Uploading original-asset JPG: ' + done + '/' + total + ' parts...'));
    const image: ListingImageRecord = {
      number: step, status: 'draft', backgroundUrl: background, renderedImageUrl, placements: layout,
      width: LISTING_WIDTH, height: LISTING_HEIGHT, title: lettering.title, subtitle: lettering.subtitle,
      badge: lettering.badge, notes: info, reviewWarning, updatedAt: Date.now()
    };
    await saveRecord(image);
    setChanges(old => { const next = { ...old }; delete next[step]; return next; });
    let finalReview: ListingFinalReview | null = null;
    let critiqueProblem = '';
    if (autoFinalCritique) {
      setWorking('critique');
      setMessage('Evaluating the FINAL composited JPG for covered lettering, artwork prominence and composition...');
      try {
        const critique = await send({ action: 'critique', projectId, number: step });
        if (critique.finalReview) {
          finalReview = critique.finalReview;
          if (critique.images) receive(critique.images);
        } else critiqueProblem = ' Vision did not return a quality score.';
      } catch (error) {
        critiqueProblem = ' Final composition critique unavailable (' +
          (error instanceof Error ? error.message : String(error)) +
          '); the JPG is still saved.';
      }
    }
    setMessage('Image ' + String(step).padStart(2, '0') + ' saved as draft. ' +
      (finalReview ? 'Final visual score ' + finalReview.score.toFixed(1) +
        '/10 (subjective). ' + (finalReview.improvements[0] || 'Inspect readability before approval.') : '') +
      (reviewWarning ? ' Background QC: ' + reviewWarning : '') + critiqueProblem);
    return finalReview;
  };
  /**
   * Every selected original is eligible for AI composition. For large collections
   * Vision plans small batches against the SAME background, using previously
   * arranged layers as context. These batches are an API payload strategy,
   * not a clipart limit or a source of fixed PaletteIQ positions.
   */
  const arrangeWithAI = async (
    backgroundUrl: string, initial: ListingPlacement[], critiqueFeedback = '',
    visionArtPrompt = promptDraft?.layoutPrompt, creativeBrief?: string
  ): Promise<{ placements: ListingPlacement[]; warning: string }> => {
    if (compositionMode === 'structured') {
      const vision = await send({ action:'layout', projectId, number:step,
        backgroundUrl, placements:initial, compositionMode, critiqueFeedback, layoutPrompt:visionArtPrompt });
      return { placements:vision.placements?.length === initial.length ? vision.placements : initial,
        warning:vision.fallback || '' };
    }
    const batchSize = 24;
    const arranged: ListingPlacement[] = [];
    const warnings: string[] = [];
    for (let offset = 0; offset < initial.length; offset += batchSize) {
      const batch = initial.slice(offset, offset + batchSize);
      setMessage('OpenAI Vision designing artwork ' + (offset + 1) + '–' +
        (offset + batch.length) + ' of ' + initial.length + ' (no fixed canvas object limit)...');
      let artworkContactSheets: string[] | undefined;
      try {
        artworkContactSheets = await createArtworkContactSheets(batch, assets);
      } catch {
        warnings.push('Some original previews could not be sampled; Vision used source names.');
      }
      try {
        const vision = await send({ action:'layout', projectId, number:step,
          backgroundUrl, placements:batch, compositionMode,
          creativeBrief, artworkContactSheets, existingPlacements:arranged, totalSelected:initial.length,
          critiqueFeedback, layoutPrompt:visionArtPrompt });
        if (vision.fallback || !vision.placements ||
            (compositionMode === 'ai-first'
              ? vision.placements.length < batch.length
              : vision.placements.length !== batch.length)) {
          arranged.push(...batch);
          warnings.push('Objects ' + (offset + 1) + '–' + (offset + batch.length) +
            ': ' + (vision.fallback || 'AI returned an incomplete layout; starter positions retained.'));
        } else arranged.push(...vision.placements);
      } catch (error) {
        arranged.push(...batch);
        warnings.push('Objects ' + (offset + 1) + '–' + (offset + batch.length) +
          ': AI Vision failed (' + (error instanceof Error ? error.message : String(error)) +
          '); starter positions retained.');
      }
    }
    return { placements:arranged, warning:warnings.join(' ') };
  };

  const prepareOpenAiPrompts = async () => {
    if (working || !positions.length) return;
    setWorking('prompt');
    setMessage('Preparing the exact OpenAI background prompt and Vision art-direction text (no paid generation)...');
    try {
      // No OpenAI calls here: use already-cached source style when available.
      // Generating a preview must never silently incur a Vision API fee.
      const response = await send({
        action:'preview-prompt', projectId, number:step, featuredCount:positions.length,
        placements:positions, compositionMode,
        title:currentLettering.title, subtitle:currentLettering.subtitle, badge:currentLettering.badge,
        revisionNotes:notes[step] ?? current?.notes ?? ''
      });
      if (!response.backgroundPrompt || !response.layoutPrompt)
        throw Error('Server did not return both OpenAI prompts');
      setPromptDrafts(prev => ({...prev, [step]:{
        context:promptContext, backgroundPrompt:response.backgroundPrompt!, layoutPrompt:response.layoutPrompt!
      }}));
      setMessage('OpenAI prompts are ready for review. Edit either textarea freely, then generate. No paid image or Vision request has been sent.');
    } catch(error) {
      setMessage('Could not prepare OpenAI prompts: ' +
        (error instanceof Error ? error.message : String(error)));
    } finally { setWorking(''); }
  };


  /**
   * AI-first phase 1: Vision sees original-art contact boards and selects
   * references / provides the creative brief. The image generator sees TEXT
   * ONLY and produces typography/background with ZERO illustrated subjects.
   */
  /**
   * Package EXACT selected original image bytes and the user's editable
   * prompt into a download ZIP. The AI API sees the same source IDs through
   * contact sheet image inputs: OpenAI does not visually decode ZIP files.
   */
  const downloadAiFirstSourceZip = async () => {
    if(working||!positions.length)return;
    setWorking('source-zip');
    setMessage('Packaging selected original clipart PNGs/JPGs and the current creative prompt into a source ZIP...');
    try{
      const response=await fetch(apiUrl,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'source-zip',projectId,number:step,
          selectedAssetIds:[...new Set(positions.map(p=>p.assetId))],
          title:currentLettering.title,subtitle:currentLettering.subtitle,badge:currentLettering.badge,
          backgroundPrompt:compositionMode === 'ai-first' && promptsReady
            ? promptDraft!.backgroundPrompt : undefined
        })
      });
      if(!response.ok){
        const body=await response.json().catch(()=>null) as {error?:string}|null;
        throw Error(body?.error||'ZIP export failed (HTTP '+response.status+')');
      }
      const blob=await response.blob();
      if(!blob.size)throw Error('The original source ZIP was empty');
      const url=URL.createObjectURL(blob);
      try{
        const a=document.createElement('a');
        a.href=url;
        a.download=(name||'paletteiq-collection').replace(/[^a-zA-Z0-9-_ ]/g,'').replace(/\s+/g,'-').slice(0,64)+'-original-clipart-source.zip';
        document.body.appendChild(a);a.click();a.remove();
      }finally{window.setTimeout(()=>URL.revokeObjectURL(url),60000);}
      setMessage('Downloaded '+new Set(positions.map(p=>p.assetId)).size+
        ' original artwork files in a ZIP with a '+(compositionMode === 'ai-first' && promptsReady ? 'user-edited' : 'theme-adapted default')+
        ' creative prompt and manifest. OpenAI receives separate image references, not the ZIP itself.');
    }catch(error){
      setMessage('Original source ZIP failed: '+(error instanceof Error?error.message:String(error)));
    }finally{setWorking('');}
  };

function catalogGridLabel(count:number):string{
  return count+'-artwork complete catalog';
}

  /** Tile 03 always renders 100% of current collection sources, not a sample. */
  const generateCompleteCollection = async () => {
    if(working||!assets.length)return;
    const copy={...currentLettering};
    setCostNotice(null);
    setWorking('complete-catalog');
    setMessage('Rendering Complete Collection from ALL '+assets.length+' original clipart files; no AI request or sampling...');
    try{
      const catalog=await composeCompleteCollectionCatalog(assets,copy.title,copy.subtitle,copy.badge,
        (drawn,total)=>{
          if(drawn===total||drawn%10===0)
            setMessage('Compositing exact original artwork '+drawn+'/'+total+' in '+catalogGridLabel(total)+'...');
        });
      if(catalog.placements.length!==assets.length ||
        new Set(catalog.assetIds).size!==assets.length)
        throw Error('Complete Collection is incomplete. No JPG will be saved.');
      setMessage('All '+assets.length+'/'+assets.length+' originals rendered. Uploading 1024 × 1024 JPG...');
      const renderedImageUrl=await upload(projectId,3,catalog.file,
        (done,total)=>setMessage('Uploading complete catalog '+done+'/'+total+' chunks...'));
      const record:ListingImageRecord={
        number:3,status:'draft',backgroundUrl:'',renderedImageUrl,
        placements:catalog.placements,catalogAssetIds:catalog.assetIds,
        catalogExpectedCount:assets.length,selectedSourceIds:catalog.assetIds,
        aiGeneratedFullCover:false,
        title:copy.title,subtitle:copy.subtitle,badge:copy.badge,
        width:LISTING_WIDTH,height:LISTING_HEIGHT,updatedAt:Date.now(),
        notes:notes[3]??current?.notes??'',reviewWarning:''
      };
      await saveRecord(record);
      setChanges(old=>{const next={...old};delete next[3];return next;});
      // No automatic paid Vision request for tile03: exact count/inventory
      // validation is deterministic. The user may manually choose a paid
      // "Analyze final JPG quality" action after rendering.
      setMessage('Complete Collection JPG saved: '+catalog.assetIds.length+'/'+assets.length+
        ' ORIGINAL cliparts in '+catalog.columns+' columns × '+catalog.rows+
        ' rows. Every source is present exactly once. No OpenAI charge.');
    }catch(error){
      setMessage('Complete Collection not saved: '+(error instanceof Error?error.message:String(error)));
    }finally{setWorking('');}
  };

  /** One paid image edit: selected clipart references + prompt -> entire full cover. */
  const generateAiFirstConcept = async () => {
    if(!promptsReady||working)return;
    setCostNotice(null);
    setWorking('concept');
    setMessage('Preparing numbered reference images of selected clipart. No pre-layout geometry is sent...');
    const lettering={...currentLettering};
    try{
      const sourceIds=[...new Set(positions.map(p=>p.assetId))];
      const sample=aiFirstSampleIndices(sourceIds.length).map(index=>({assetId:sourceIds[index]} as ListingPlacement));
      const referenceSheets=await createArtworkContactSheets(sample,assets);
      if(!referenceSheets.length)throw Error('Cannot decode the selected source artwork references');
      setMessage('OpenAI is generating the ENTIRE artistic Etsy cover: original-reference subjects, typography, badge and background together...');
      const response=await send({
        action:'generate-concept',projectId,number:step,model,quality,
        selectedAssetIds:sourceIds,sampledAssetIds:sample.map(p=>p.assetId),
        referenceSheets,backgroundPrompt:promptDraft!.backgroundPrompt,
        title:lettering.title,subtitle:lettering.subtitle,badge:lettering.badge
      });
      if(!response.backgroundUrl)throw Error('OpenAI returned no full cover');
      setCostNotice({step,model,quality,estimate:response.costEstimate??null});
      const warning=response.reviewWarning||
        'This full cover was generated by AI from visual references. Clipart may be reinterpreted; review every subject and all lettering.';
      // Do not overlay selected source images or calculate canvas geometry.
      // The OpenAI image is already the COMPLETE thumbnail.
      setMessage('Saving the single AI-generated full cover as 1024 × 1024 JPG...');
      const file=await flattenAiFullCover(response.backgroundUrl);
      const renderedImageUrl=await upload(projectId,step,file,
        (done,total)=>setMessage('Uploading AI full-cover JPG '+done+'/'+total+' parts...'));
      await saveRecord({
        number:step,status:'draft',backgroundUrl:response.backgroundUrl,
        renderedImageUrl,aiGeneratedFullCover:true,placements:[],
        selectedSourceIds:sourceIds,creativeBrief:'',
        title:lettering.title,subtitle:lettering.subtitle,badge:lettering.badge,
        width:LISTING_WIDTH,height:LISTING_HEIGHT,
        notes:notes[step]??current?.notes??'',reviewWarning:warning,updatedAt:Date.now()
      });
      setChanges(old=>{const next={...old};delete next[step];return next;});
      let qualityMessage='';
      if(autoFinalCritique){
        setWorking('critique');
        try{
          setMessage('Reviewing the finished OpenAI full cover for artistic quality and title readability...');
          const critique=await send({action:'critique',projectId,number:step});
          if(critique.finalReview){
            if(critique.images)receive(critique.images);
            qualityMessage=' Final Vision score '+critique.finalReview.score.toFixed(1)+'/10.';
          }
        }catch(error){qualityMessage=' Optional final review unavailable: '+String(error);}
      }
      setMessage('AI-First '+spec.title+' saved as JPG. Its unique layout follows the '+(AI_FIRST_LAYOUT_ARCHETYPES[step]?.name||'Main Cover hero')+' design.'+
        (response.detailedOriginalReferencesIncluded
          ? ' Included '+response.detailedOriginalReferencesIncluded+' full-detail original PNG/JPG files alongside contact sheets to help reference fidelity (not a guarantee of identical pixels).' : '')+
        ' No PNG positioning, mapping or post-compositing was performed.'+
        (response.sampledSourceCount && response.selectedSourceCount &&
        response.sampledSourceCount<response.selectedSourceCount
          ? ' Reference boards sampled '+response.sampledSourceCount+' of '+response.selectedSourceCount+' selected assets.' : '')+
        qualityMessage+' Inspect text and illustrations before approving.');
    }catch(error){
      setMessage('AI-First full-cover generation failed: '+(error instanceof Error?error.message:String(error)));
    }finally{setWorking('');}
  };

  const generate = async () => {
    if (working) return;
    if(step!==3 && !promptsReady) return setMessage('Prepare and review both OpenAI prompts before paid generation. Refresh prompts after changing settings or selected originals.');
    if (!assets.length) return setMessage('Generate collection clipart in Image Production first.');
    if (!precedingApproved) return setMessage('Approve all preceding listing images before generating this one.');
    if (current?.status === 'approved' && !window.confirm('Regenerate an approved image? Its approval will be reset to Draft.')) return;
    const evaluation = evaluateListingCoverTitle(currentLettering.title);
    if (evaluation.status === 'too-long' && step!==3 && !window.confirm(
      'Your cover title has ' + evaluation.words + ' words (' + evaluation.characters +
      ' characters). It may be difficult to read at Etsy thumbnail size. Generate anyway?')) return;
    if (step===3) return generateCompleteCollection();
    if (compositionMode === 'ai-first') return generateAiFirstConcept();
    const lettering = { ...currentLettering };
    setCostNotice(null);
    setWorking('generate');
    setMessage('Preparing visual style direction from original collection clipart...');
    try {
      let styleFallback = '';
      try {
        await ensureSourceStyle();
      } catch (error) {
        styleFallback = ' Collection style Vision unavailable: ' +
          (error instanceof Error ? error.message : String(error)) +
          '. Used saved theme/style description instead.';
        setStyleWarning(styleFallback.trim());
      }
      let effectivePositions = positions;
      if ((step === 3 || step === 5) && !current?.placements && !changes[step] && !preLayouts[String(step)] &&
          !Object.keys(categories).length && !assets.some(a => a.category || a.subtheme || a.group)) {
        setMessage('Organizing the collection into honest categories before designing...');
        try {
          const groupResult = await request('/api/thumbnail-categories', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId })
          }) as ListResponse & { groups?: Array<{ name: string; ids: string[] }> };
          const map: Record<string,string> = {};
          for (const group of groupResult.groups || []) for (const id of group.ids) map[id] = group.name;
          if (new Set(Object.values(map)).size >= 2) {
            setCategories(map);
            effectivePositions = planListingPlacements(step, assets.map(a => ({ ...a, category: map[a.id] || a.category })));
          }
        } catch { /* Continue with a neutral collection gallery rather than invent categories. */ }
      }
      await savePreLayout(effectivePositions);
      setMessage(compositionMode === 'free' ? 'Generating free-composition background and artistic lettering; original clipart positions will be designed independently by AI Vision...' : 'Generating AI background and lettering using your structured white-canvas composition...');
      const response = await send({ action: 'generate', projectId, number: step, model, quality,
        featuredCount: effectivePositions.length, placements: effectivePositions, compositionMode,
        backgroundPrompt:promptDraft!.backgroundPrompt,
        title: lettering.title, subtitle: lettering.subtitle, badge: lettering.badge,
        revisionNotes: (notes[step] ?? current?.notes ?? '').trim() });
      if (!response.backgroundUrl) throw Error('OpenAI did not return the background');
      // Cost belongs to a separate dismissible floating notice, not workflow status.
      setCostNotice({ step, model, quality, estimate: response.costEstimate ?? null });
      let suggested = effectivePositions;
      let layoutWarning = '';
      if (compositionMode === 'free' || allowVisionRefinement) {
        setMessage('OpenAI Vision is designing original artwork positions, sizes, layer hierarchy and tasteful edge bleed...');
        try {
          const vision = await arrangeWithAI(response.backgroundUrl, effectivePositions, '', promptDraft!.layoutPrompt);
          suggested = vision.placements;
          layoutWarning = vision.warning;
        } catch (error) {
          layoutWarning = 'AI Vision composition failed (' +
            (error instanceof Error ? error.message : String(error)) +
            '); PaletteIQ starter positions were kept. Use Auto Arrange to retry.';
        }
      }
      // Free Mode uses an independent AI layout; Structured Mode retains the
      // white pre-layout unless the user explicitly enables AI refinement.
      // The paid AI background is recorded before JPG transfer so a failed
      // upload can be retried without generating and paying for the AI again.
      // An empty renderedImageUrl intentionally invalidates prior approved pixels.
      await saveRecord({
        number: step, status: 'draft', backgroundUrl: response.backgroundUrl,
        renderedImageUrl: '', placements: suggested, width: LISTING_WIDTH, height: LISTING_HEIGHT,
        title: lettering.title, subtitle: lettering.subtitle, badge: lettering.badge,
        notes: notes[step] || current?.notes || '', reviewWarning: response.reviewWarning || '', updatedAt: Date.now()
      });
      const scored = await renderAndSave(response.backgroundUrl, suggested, notes[step] || current?.notes || '', response.reviewWarning || '', lettering);
      setMessage('Image ' + String(step).padStart(2, '0') + ' saved as draft.' +
        (scored ? ' Final design critique: ' + scored.score.toFixed(1) + '/10. ' + (scored.improvements[0] || '') :
          autoFinalCritique ? ' Final Vision critique unavailable; inspect the result manually or use Recheck Final Quality.' : '') +
        (layoutWarning ? ' Layout note: ' + layoutWarning + ' Check original clipart placement.' : '') + styleFallback);
    } catch (error) { setMessage('Generation failed: ' + (error instanceof Error ? error.message : String(error))); }
    finally { setWorking(''); }
  };
  const rerender = async () => {
    if (working) return;
    if (!current?.backgroundUrl) return setMessage('Generate the background first.');
    if (current.status === 'approved' && !window.confirm('Revise this approved image and reset approval?')) return;
    if (letteringDirty) return setMessage('Title, Subtitle, or Badge changed. Regenerate AI background & typography to apply the new lettering before saving.');
    try { await renderAndSave(current.backgroundUrl, positions, notes[step] || current.notes || '', current.reviewWarning || ''); }
    catch (error) { setMessage('Could not save revised image: ' + (error instanceof Error ? error.message : String(error))); }
    finally { setWorking(''); }
  };
  const recheckFinalQuality = async () => {
    if (!current?.renderedImageUrl || working) return;
    setWorking('critique');
    setMessage('Reviewing the actual final composited JPG (paid Vision request)...');
    try {
      const answer = await send({ action: 'critique', projectId, number: step });
      if (!answer.finalReview) throw Error('No final review received');
      if (answer.images) receive(answer.images);
      setMessage('Final composition score: ' + answer.finalReview.score.toFixed(1) +
        '/10. ' + (answer.finalReview.improvements.join(' • ') || 'Review the actual thumbnail visually.'));
    } catch (error) { setMessage('Final critique unavailable: ' + String(error)); }
    finally { setWorking(''); }
  };

  const review = async (status: 'approved' | 'needs_revision') => {
    if (!current?.renderedImageUrl || working) return;
    if (status === 'approved' && (current.width !== LISTING_WIDTH || current.height !== LISTING_HEIGHT))
      return setMessage('Render a new 1024 × 1024 square JPG before approval. Your older 4:3 image remains saved.');
    if (status === 'approved' && current.finalReview && current.finalReview.score < 8.5 &&
      !window.confirm('Final design critique scored this JPG ' + current.finalReview.score + '/10. Suggested improvement: ' +
        (current.finalReview.improvements[0] || 'Check text and visual balance') + '\nApprove anyway?')) return;
    if (status === 'approved' && step===3 &&
        !completeCatalogMatchesInventory(current,assets))
      return setMessage('Complete Collection approval blocked: all '+assets.length+
        ' CURRENT originals must appear exactly once. Generate Complete Collection again.');
    if (status === 'approved' && current.reviewWarning &&
        !window.confirm('Automatic review flagged a possible issue:\n' + current.reviewWarning + '\n\nHave you carefully checked the artwork, mockup, text and verified facts and want to approve this JPG anyway?')) return;
    if (letteringDirty) return setMessage('Title, Subtitle, or Badge changed. Regenerate the AI artwork before approving the new text.');
    if (changes[step]) return setMessage(compositionMode === 'ai-first'
      ? 'Your selected reference clipart changed. Generate a NEW full creative thumbnail before approving.'
      : 'You changed the layout. Click Apply layout & save JPG before approval.');
    setWorking('review');
    try {
      await saveRecord({ ...current, status, title: currentLettering.title, subtitle: currentLettering.subtitle,
        badge: currentLettering.badge, notes: notes[step] || current.notes || '', updatedAt: Date.now() });
      setMessage(status === 'approved' ? 'Image ' + step + ' approved and saved.' : 'Image marked for revision. Edit placement for a free JPG re-render, or write feedback and regenerate the AI background to apply those notes.');
      if (status === 'approved' && step < 15) { setStep(step + 1); setSelectedIndex(0); }
    } catch (error) { setMessage('Could not save review: ' + String(error)); }
    finally { setWorking(''); }
  };
  const rejectAndDelete = async () => {
    if (working || !current || (!current.backgroundUrl && !current.renderedImageUrl)) return;
    if (!window.confirm('Reject & permanently delete generated Image ' + String(step).padStart(2,'0') +
      '? The AI background, saved JPG and approval for this image will be removed. This cannot be undone; other listing images and collection clipart remain untouched.')) return;
    setWorking('reject');
    setMessage('Deleting this generated listing image and its saved background...');
    try {
      const result = await send({ action: 'reject', projectId, number: step });
      if (!result.deleted) throw Error('The server did not confirm deletion.');
      receive(result.images || []);
      setChanges(old => { const next = { ...old }; delete next[step]; return next; });
      setNotes(old => { const next = { ...old }; delete next[step]; return next; });
      setLetteringChanges(old => { const next = { ...old }; delete next[step]; return next; });
      setSelectedIndex(0);
      setMessage(result.warning
        ? 'Image rejected and removed from the collection. ' + result.warning
        : 'Image ' + String(step).padStart(2,'0') + ' rejected and deleted. Title and Subtitle were reset to Etsy SEO defaults, Badge cleared. Generate from the beginning.');
    } catch (error) {
      setMessage('Reject & Delete failed: ' + (error instanceof Error ? error.message : String(error)));
    } finally { setWorking(''); }
  };

  const move = (field: 'assetId' | 'x' | 'y' | 'width' | 'height' | 'rotation', value: string) => {
    setChanges(prev => {
      const list = [...(prev[step] || current?.placements || preLayouts[String(step)] || planListingPlacements(step, categorizedAssets))];
      const target = list[selectedIndex];
      if (!target) return prev;
      list[selectedIndex] = { ...target, [field]: field === 'assetId' ? value :
        clamp(Number(value),
          field === 'rotation' ? -180 : field === 'width' || field === 'height' ? 2 : listingAllowsBleed(step) ? -100 : 0,
          field === 'rotation' ? 180 : field === 'width' || field === 'height' ? (listingAllowsBleed(step) ? 200 : 100) : listingAllowsBleed(step) ? 99 : 100) };
      return { ...prev, [step]: list };
    });
  };
  const changeArtworkSelection = (ids: string[], preservePositions = true) => {
    const unique = [...new Set(ids)].filter(id => assets.some(a => a.id === id));
    if (!unique.length) {
      setMessage('At least one original collection clipart must remain selected.');
      return;
    }
    const planned = planListingPlacements(step, categorizedAssets, { assetIds: unique });
    const previous = new Map(positions.map(p => [p.assetId, p]));
    const next = planned.map(p => preservePositions ? previous.get(p.assetId) || p : p);
    setChanges(old => ({ ...old, [step]: next }));
    setSelectedIndex(0);
    setMessage(current?.backgroundUrl
      ? 'Artwork selection updated. Apply layout & save JPG to refresh the exact original layers without another image-generation charge.'
      : 'Artwork selection ready. Generate AI background to use these original collection images.');
  };
  const changeArtworkCount = (count: number) => {
    if (!Number.isInteger(count) || count < 1 || count > assets.length) return;
    const currentIds = selectedAssetIds.slice(0, count);
    if (count > currentIds.length) {
      for (const asset of curatedListingHighlights(categorizedAssets, assets.length)) {
        if (!currentIds.includes(asset.id)) currentIds.push(asset.id);
        if (currentIds.length >= count) break;
      }
    }
    changeArtworkSelection(currentIds);
  };
  const autoSelectArtwork = () => {
    const count = positions.length;
    const planned = planListingPlacements(step, categorizedAssets, { count });
    setChanges(old => ({ ...old, [step]: planned }));
    setSelectedIndex(0);
    setMessage('Automatically selected ' + planned.length + ' diverse ORIGINAL clipart layers. Positions can be adjusted before applying.');
  };
  const toggleArtwork = (assetId: string, checked: boolean) => {
    changeArtworkSelection(checked
      ? [...selectedAssetIds, assetId]
      : selectedAssetIds.filter(id => id !== assetId));
  };
  const autoArrangeArtwork = async () => {
    if (working) return;
    if (compositionMode === 'ai-first')
      return setMessage('AI-First is a complete single-layer AI-generated image. Change source references or prompt, then generate a new full cover; no original-PNG layout action is available.');
    if (current?.backgroundUrl && !promptsReady)
      return setMessage('Prepare or refresh the OpenAI Vision prompt above before paid Auto Arrange. You can edit the composition instructions first.');
    if (current?.status === 'approved' && !window.confirm('Rearrange this approved image? Save the updated JPG to reset approval.')) return;
    const localPlan = planListingPlacements(step, categorizedAssets, { assetIds: selectedAssetIds });
    if (!current?.backgroundUrl) {
      setChanges(old => ({ ...old, [step]: localPlan }));
      setMessage('Starter layout arranged locally. Generate background to let AI Vision independently plan a Free Composition, or adjust it manually.');
      return;
    }
    setWorking('layout');
    setMessage('AI Vision is arranging the selected original PNGs around the actual lettering...');
    try {
      const sourcePositions=positions;
      const answer = await arrangeWithAI(current.backgroundUrl, sourcePositions,
        current.finalReview?.improvements.join('; ') || '', promptDraft!.layoutPrompt);
      setChanges(old => ({ ...old, [step]: answer.placements }));
      setMessage(answer.warning
        ? answer.warning + ' Review the updated preview; retry Auto Arrange for any fallback objects.'
        : 'AI Vision independently rearranged ' + positions.length + ' originals. Apply layout & save JPG (no image-generation cost), then review the final composition.');
    } catch (error) { setMessage('Auto Arrange unavailable: ' + String(error)); }
    finally { setWorking(''); }
  };

  const editLettering = (field: keyof ListingImageText, value: string) => {
    setLetteringChanges(previous => ({
      ...previous, [step]: { ...currentLettering, [field]: value }
    }));
  };
  const setPage = (number: number) => { setStep(number); setSelectedIndex(0); setMessage(''); setAssetSearch(''); setShowAssetPicker(false); setCostNotice(null); };
  const spec = LISTING_IMAGE_SPECS[step - 1];

  return <div style={{ display: 'grid', gap: 18 }}>
    <div className="panel" style={{ padding: 20 }}>
      <h2>Etsy Clipart Listing Studio</h2>
      <p className="sub">Etsy Clipart Listing Studio v1.1 • 15 separate JPGs • 1024 × 1024 px (1:1 square) • automatic art direction • exact originals from the selected PaletteIQ collection, not ZIP.</p>
      {inspection && <p className="sub">Original collection check: {assets.length} distinct source-image references; {inspection.checked}/{inspection.sampled} sampled images decoded{inspection.dimensionSummary ? ' (dimensions: ' + inspection.dimensionSummary + ')' : ''}; {inspection.transparent} show transparency in the sample{inspection.failed ? '; ' + inspection.failed + ' could not be inspected' : ''}. Counts exclude duplicate URLs. Other image formats, dimensions, DPI and licensing are not assumed.</p>}
      <p className="sub">Creative direction: {artDirection.family} · {artDirection.palette} · {styleProfile ? 'Visual style observed from ' + styleProfile.sampleCount + ' original clipart samples.' : 'Visual style will be checked against original clipart before generation.'} {step === 1 ? 'Review the cover first to set the visual direction.' : 'Approved images remain saved; use the same visual language across the series.'}</p>
      {styleProfile && <div style={{ border: '1px solid #ddd7cc', background: '#faf9f5', borderRadius: 9, padding: '10px 12px', fontSize: 12 }}>
        <strong>Observed original clipart style:</strong> {styleProfile.summary}
        <small style={{ display: 'block', marginTop: 5, color: '#655c50' }}>Medium: {styleProfile.medium} · Palette: {styleProfile.palette} · Texture: {styleProfile.texture}. AI still creates its own background and lettering; original collection images are never redrawn.</small>
      </div>}
      {styleWarning && <p className="sub" role="status" style={{ color: '#a15a20' }}>{styleWarning}</p>}
      {!styleProfile && <small className="sub">The first generation may run one additional paid OpenAI Vision analysis on downsized original clipart samples. Its result is cached and reused across the collection. Subsequent image costs are separate from this analysis.</small>}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <strong>{approved}/15 approved • {assets.length} original images available</strong>
        <button type="button" className="primary-btn" disabled={approved !== 15 || !!working} onClick={() => {
          const a = document.createElement('a'); a.href = apiUrl + '?projectId=' + encodeURIComponent(projectId) + '&export=1'; a.click();
        }}><Download size={16}/> Export 15 approved JPGs as ZIP</button>
      </div>
      <div className="progress" style={{ marginTop: 10 }}><i style={{ width: approved / 15 * 100 + '%' }}/></div>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(145px,1fr))', gap: 8 }}>
      {LISTING_IMAGE_SPECS.map(s => {
        const item = records.find(r => r.number === s.number);
        return <button type="button" key={s.number} onClick={() => setPage(s.number)} style={{
          padding: 10, textAlign: 'left', borderRadius: 10,
          border: step === s.number ? '2px solid #e65b24' : '1px solid #d8d1c7',
          background: step === s.number ? '#fff4ed' : '#fff', color: '#37302a', cursor: 'pointer'
        }}>
          <strong>{String(s.number).padStart(2, '0')} · {s.title}</strong>
          <small style={{ display: 'block', marginTop: 6, color: item?.status === 'approved' ? '#247046' : '#786a5b' }}>
            {isSquareListingApproved(item) && (s.number!==3 || completeCatalogMatchesInventory(item,assets)) ? '✓ Approved (square)' : item?.renderedImageUrl && (item.width !== LISTING_WIDTH || item.height !== LISTING_HEIGHT) ? 'Legacy 4:3 • remake as square' : item?.status === 'needs_revision' ? 'Needs revision' : item?.renderedImageUrl ? 'Draft • Review' : 'Not generated'}
          </small>
        </button>;
      })}
    </div>
    <div className="panel" style={{ padding: 18 }}>
      <h2>{String(step).padStart(2,'0')} — {spec.title}</h2>
      <p className="sub">{spec.purpose}. Source: {smoothName(subtheme || theme || name)}.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 18 }}>
        <div style={{ minWidth: 0 }}>
          {current?.renderedImageUrl && <div>
            <strong style={{ display: 'block', marginBottom: 8 }}>Saved JPG — last rendered composition</strong>
            <div style={{ aspectRatio: '1 / 1', background: '#f7f1e9', border: '1px solid #e5dbcb', borderRadius: 10, overflow: 'hidden', display: 'grid', placeItems: 'center' }}>
              <img key={current.renderedImageUrl} src={current.renderedImageUrl} alt={'Saved listing image '+step} style={{ width: '100%', height: '100%', objectFit: 'contain' }}/>
            </div>
          </div>}
          {step===3 && <div data-complete-collection-required="true"
            style={{marginTop:10,padding:12,border:'1px solid #9abd9b',borderRadius:10,fontSize:13}}>
            <strong>Complete Collection — ALL {assets.length} original cliparts</strong>
            <p style={{margin:'7px 0 0'}}>Purpose: a complete visual catalog, not an AI-generated selection. PaletteIQ uses every actual PNG/JPG exactly once, organized into {planCompleteCollectionCatalog(assets).columns} columns × {planCompleteCollectionCatalog(assets).rows} rows.</p>
            <p style={{margin:'6px 0 0'}}>Required: {assets.length} · {completeCatalogMatchesInventory(current,assets)
              ? 'Saved: '+current!.catalogAssetIds!.length+' of '+assets.length+' originals ✓'
              : 'Incomplete / not yet generated — regenerate all '+assets.length+' originals'}.</p>
            <small>No OpenAI image request and no extra image generation cost. If the collection changes, regenerate this image before approval or export.</small>
          </div>}
          {compositionMode === 'ai-first' && step!==3 && <div data-ai-first-full-cover-notice="true"
            style={{marginTop:10,padding:12,border:'1px solid #e5dacb',borderRadius:10,fontSize:12}}>
            <strong>One-step OpenAI {spec.title} artwork</strong>
            {step>1 && AI_FIRST_LAYOUT_ARCHETYPES[step] && <div data-listing-layout-archetype={AI_FIRST_LAYOUT_ARCHETYPES[step].name}
              style={{marginTop:8,padding:9,borderRadius:7,background:'#f8f2ea'}}>
              <strong>Distinct layout: {AI_FIRST_LAYOUT_ARCHETYPES[step].name}</strong>
              <p style={{margin:'5px 0 0',lineHeight:1.45}}>{AI_FIRST_LAYOUT_ARCHETYPES[step].layout}</p>
              <p style={{margin:'5px 0 0'}}><strong>Do not use:</strong> {AI_FIRST_LAYOUT_ARCHETYPES[step].forbidden}</p>
            </div>}
            <p style={{margin:'6px 0 0'}}>Generate a COMPLETE image with clipart collage, artistic typography, badge and background together. No PNG positioning, mapping or second generation step.</p>
            <p style={{margin:'6px 0 0'}}>OpenAI receives source-art contact sheets plus a few larger original PNG/JPG references when available. The Main Cover image is NOT supplied for supporting tiles, to prevent cloning its layout; only its documented color/style direction is reused. AI may still reinterpret artwork, so inspect characters, words and claims before approval.</p>
          </div>}
          {compositionMode !== 'ai-first' && step!==3 && <section style={{ marginTop: current?.renderedImageUrl ? 16 : 0, display: 'grid', gap: 8 }}>
            <strong>{current?.backgroundUrl ? 'Editable Original Clipart Layers (post-generate)' : 'White Canvas Pre-Layout — arrange before AI generation'}</strong>
            <EtsyListingLayoutCanvas
              assets={assets} placements={positions} selectedIndex={selectedIndex}
              onSelect={setSelectedIndex}
              onChange={layout => setChanges(old => ({ ...old, [step]: layout }))}
              backgroundUrl={current?.backgroundUrl}
              allowBleed={listingAllowsBleed(step)}
              disabled={!!working}
            />
            {!current?.backgroundUrl && <div style={{ display:'grid',gap:7 }}>
              <button type="button" className="outline-btn" disabled={!!working || !positions.length || preLayoutSaved}
                onClick={() => void saveWhiteCanvasLayout()}>
                {preLayoutSaved ? 'Pre-Layout Saved ✓' : 'Save White Canvas Pre-Layout (no AI cost)'}
              </button>
              <small>{compositionMode === 'free'
                ? 'Optional white canvas: choose which original cliparts appear and roughly preview them. OpenAI may freely change their size, position and rotation for a lively cover, including partial edge bleed. After generation, every original layer stays editable.'
                : 'Arrange original clipart on the white square first. This structured layout guides AI background creation and can still be edited after generation.'}</small>
            </div>}
            {current?.backgroundUrl && changes[step] && <small role="status" style={{ color:'#9a572a' }}>
              Unsaved placement changes are visible above. Click Apply layout &amp; save JPG to update the final thumbnail without AI background generation.
            </small>}
          </section>}
          {current?.renderedImageUrl && <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <a className="outline-btn" href={current.renderedImageUrl} download={fileName(step)}><Download size={15}/> Download JPG</a>
            <span className="sub">{current.width || 'Legacy'} × {current.height || '4:3'} • {isSquareListingApproved(current) &&
              (step!==3 || completeCatalogMatchesInventory(current,assets))
                ? 'Approved square JPG' : 'Awaiting square approval'}</span>
          </div>}
          {current?.renderedImageUrl && (current.width !== LISTING_WIDTH || current.height !== LISTING_HEIGHT) && <p role="alert" className="notice">This saved image was produced by the previous 4:3 workflow. It is preserved for reference; regenerate the AI background, or re-render its background as 1024 × 1024 before approving the square edition.</p>}
          {current?.reviewWarning && <p role="alert" style={{ border: '1px solid #d48c48', borderRadius: 8, padding: 10, color: '#7b431b', background: '#fff6e9' }}>Manual quality review required: {current.reviewWarning}. Approval requires your explicit confirmation.</p>}
          {current?.finalReview && <div data-final-design-critique="true" style={{ border: '1px solid #e2d6c7', borderRadius: 10, background: '#faf9f4', padding: 13, marginTop: 12, display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <strong>{current.aiGeneratedFullCover ? 'AI Full Cover Design Critique' : 'AI Final Design Critique (after clipart compositing)'}</strong>
              <span style={{ fontWeight: 750, color: current.finalReview.score >= 8.5 ? '#247046' : '#9c4c29', fontSize: 20 }}>
                {current.finalReview.score.toFixed(1)}/10
              </span>
            </div>
            <small>Subjective visual assessment of the saved JPG. Goal ≥8.5, not an automatic guarantee of 10/10.</small>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 6, fontSize: 12 }}>
              <span>Headline readability: {current.finalReview.titleReadability.toFixed(1)}/10</span>
              <span>Art prominence: {current.finalReview.artworkProminence.toFixed(1)}/10</span>
              <span>Balance: {current.finalReview.visualBalance.toFixed(1)}/10</span>
              <span>Style harmony: {current.finalReview.styleHarmony.toFixed(1)}/10</span>
            </div>
            {current.finalReview.strengths.length > 0 && <div style={{ fontSize: 12 }}><strong>What works:</strong><ul>{current.finalReview.strengths.map((v,i)=><li key={i}>{v}</li>)}</ul></div>}
            {current.finalReview.improvements.length > 0 && <div style={{ fontSize: 12 }}><strong>Suggestions for a stronger cover:</strong><ol>{current.finalReview.improvements.map((v,i)=><li key={i}>{v}</li>)}</ol></div>}
            {current.finalReview.improvements.length > 0 && <button type="button" className="outline-btn" disabled={!!working}
              onClick={() => setNotes(old => ({
                ...old, [step]: [old[step] ?? current.notes ?? '', ...current.finalReview!.improvements].filter(Boolean).join('\n').slice(0,800)
              }))}>Use AI Suggestions as Revision Notes</button>}
            <button type="button" className="outline-btn" disabled={!!working}
              onClick={()=>void recheckFinalQuality()}>Recheck Final Quality (Vision API cost)</button>
            <small>{current.aiGeneratedFullCover
              ? 'To revise this single-layer artwork, change your prompt or reference selection and regenerate the whole image (paid).'
              : 'Adjust source PNG positions/number, choose Auto Arrange (uses feedback above), then re-render the final JPG without paying image-generation fees. AI cannot edit the original PNG artwork.'}</small>
          </div>}
          {current?.renderedImageUrl && !current.finalReview && <button type="button" className="outline-btn" disabled={!!working}
            style={{ marginTop: 8 }} onClick={()=>void recheckFinalQuality()}>Analyze final JPG quality (Vision API cost)</button>}
          {(spec.kind === 'mockup') && <p className="sub">Application example: {listingMockupScene(step, artDirection.family)?.name}. Mockup is a demonstration, not included in the sold collection. Inspect printable placement: the photograph is AI-generated, while the featured clipart is composited from its original file.</p>}
        </div>
        <div style={{ display: 'grid', alignContent: 'start', gap: 10 }}>
          {step!==3 && <section data-listing-advanced-settings="always-visible" aria-label="Advanced AI settings (optional)"
            style={{ border: '1px solid #e5d9cb', borderRadius: 9, padding: '9px 12px' }}>
            <strong style={{ fontSize: 13 }}>Advanced AI settings (optional)</strong>
            <div style={{ display: 'grid', gap: 9, marginTop: 12 }}>
              <label className="input-label">OPENAI ARTISTIC BACKGROUND MODEL</label>
              <select value={model} disabled={!!working} onChange={e => setModel(e.target.value)}>
                {!availableModels.some(x => x.id === model) && <option value={model}>{model}</option>}
                {availableModels.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
              <label className="input-label">BACKGROUND QUALITY</label>
              <select value={quality} disabled={!!working} onChange={e => setQuality(e.target.value as typeof quality)}>
                <option value="low">Low — economical</option><option value="medium">Medium — recommended</option><option value="high">High</option>
              </select>
              <small style={{color:'#75695e'}}>OpenAI chooses the lettering style, font, relative scale, placement and background treatment using your editable prompt. No fixed typography or background presets.</small>
            </div>
          </section>}
          <div style={{ border: '1px solid #eadfce', borderRadius: 10, padding: 12, display: 'grid', gap: 9 }}>
            <strong>Title, Subtitle &amp; Badge for Image {String(step).padStart(2,'0')}</strong>
            <small style={{ color: '#75695e' }}>{step === 1
              ? 'Main Cover defaults to the SEO title and primary keyword. Keep the heading short and readable. All fields are editable.'
              : 'Supporting image defaults to a concise '+spec.title+' heading, with no automatic subtitle or badge. Edit only if the design benefits from additional words.'}</small>
            <label className="input-label" htmlFor="listing-image-title">TITLE ({step === 1 ? 'SEO TITLE DEFAULT' : 'IMAGE TYPE DEFAULT'})</label>
            <input id="listing-image-title" aria-label="Listing image title" type="text" maxLength={140}
              value={currentLettering.title} disabled={!!working}
              onChange={e => editLettering('title', e.target.value)}
              placeholder="Listing title"/>
            <div role={titleAdvice.status !== 'good' ? 'alert' : 'status'} data-listing-title-length={titleAdvice.status}
              style={{ border:'1px solid ' + (titleAdvice.status === 'too-long' ? '#d78b78' : titleAdvice.status === 'warning' ? '#e6c88f' : '#c9dbc6'),
                background: titleAdvice.status === 'too-long' ? '#fff0ed' : titleAdvice.status === 'warning' ? '#fff8e8' : '#f5faf2',
                padding:'8px 10px',borderRadius:8,fontSize:12,color:'#675143' }}>
              <strong>{titleAdvice.status === 'good' ? 'Good cover title length' : titleAdvice.status === 'too-long' ? 'Title is too long for a thumbnail' : 'Title readability warning'}</strong>
              <div>{titleAdvice.words} words · {titleAdvice.characters} characters. {titleAdvice.message}</div>
            </div>
            <label className="input-label" htmlFor="listing-image-subtitle">SUBTITLE ({step === 1 ? 'PRIMARY KEYWORD DEFAULT' : 'OPTIONAL'})</label>
            <input id="listing-image-subtitle" aria-label="Listing image subtitle" type="text" maxLength={140}
              value={currentLettering.subtitle} disabled={!!working}
              onChange={e => editLettering('subtitle', e.target.value)}
              placeholder="Primary keyword"/>
            {step === 1 && <div style={{ border:'1px solid #e6e0d6',borderRadius:8,padding:10,display:'grid',gap:9 }}>
              <strong style={{ fontSize:12 }}>Suggested Cover Copy — based on this collection</strong>
              <small>Quick, cost-free suggestions based on your SEO Title, Primary Keyword, theme, style and verified collection size. These change only the words on this image, not your Etsy SEO listing.</small>
              <span className="input-label">SUGGESTED TITLES</span>
              <div style={{ display:'flex',gap:6,flexWrap:'wrap' }}>
                {coverCopy.titles.map(option => <button key={option} type="button" className="outline-btn" disabled={!!working}
                  style={{ padding:'6px 9px',fontSize:12 }} onClick={() => editLettering('title', option)}>{option}</button>)}
              </div>
              <span className="input-label">SUGGESTED SUBTITLES</span>
              <div style={{ display:'flex',gap:6,flexWrap:'wrap' }}>
                {coverCopy.subtitles.map(option => <button key={option} type="button" className="outline-btn" disabled={!!working}
                  style={{ padding:'6px 9px',fontSize:12 }} onClick={() => editLettering('subtitle', option)}>{option}</button>)}
              </div>
            </div>}
            <label className="input-label" htmlFor="listing-image-badge">BADGE (OPTIONAL)</label>
            <input id="listing-image-badge" aria-label="Listing image badge" type="text" maxLength={60}
              value={currentLettering.badge} disabled={!!working}
              onChange={e => editLettering('badge', e.target.value)}
              placeholder="e.g. 80 CLIPART • Leave blank for no badge"/>
            <button type="button" className="outline-btn" disabled={!!working}
              onClick={() => setLetteringChanges(prev => ({ ...prev, [step]: { ...imageTextDefaults } }))}>
              Reset to {step === 1 ? 'Etsy SEO' : 'image type'} text defaults
            </button>
            {letteringDirty && <small role="alert" style={{ color: '#a04c22' }}>{step===3
              ? 'Title, Subtitle or Badge changed. Regenerate the full original-asset catalog (no AI cost) before approving.'
              : 'Title, Subtitle or Badge changed. Regenerate the AI artwork before approving.'}</small>}
          </div>
          <div style={{ border: '1px solid #eadfce', padding: 12, borderRadius: 10, display: 'grid', gap: 9 }}>
            <strong>{step===3 ? 'Complete Collection — ALL Original Cliparts' : 'Original clipart selection — Image '+String(step).padStart(2,'0')}</strong>
            <div data-listing-source-zip-download="always-visible" style={{display:'grid',gap:5}}>
              <button type="button" className="outline-btn"
                style={{display:'flex',gap:8,alignItems:'center',justifyContent:'center',minHeight:40}}
                disabled={!!working || !positions.length}
                onClick={() => void downloadAiFirstSourceZip()}>
                <Download size={16}/>
                Download selected source ZIP ({new Set(positions.map(p=>p.assetId)).size} originals)
              </button>
              <small>Available in every composition mode. Packages your selected original images, Title, Subtitle, Badge and a theme-adapted premium Etsy prompt. No OpenAI payment or prompt preparation needed. In AI-First, a prepared edited prompt is included instead.</small>
            </div>
            <label className="input-label" htmlFor="listing-composition-mode">{step===3 ? 'COMPOSITION MODE — COMPLETE CATALOG REQUIRED' : 'COMPOSITION MODE'}</label>
            <select id="listing-composition-mode" aria-label="Listing composition mode" value={step===3?'complete-catalog':compositionMode}
              disabled={!!working || step===3}
              onChange={e => {
                const mode=e.target.value as ListingCompositionMode;
                setCompositionModes(old => ({...old,[String(step)]:mode}));
                if(mode === 'ai-first' && !current?.backgroundUrl){
                  setChanges(old => ({...old,[step]:planListingPlacements(step,categorizedAssets,{count:assets.length})}));
                  setSelectedIndex(0);
                  setMessage('AI-First now offers the entire original collection to OpenAI as candidate artwork. OpenAI chooses the final selection and composition. You may narrow the source pool before preparing prompts.');
                }
              }}>
              {step===3 && <option value="complete-catalog">Complete Catalog — every original exactly once (automatic)</option>}
              <option value="free">Free Composition — OpenAI chooses sizes and positions (Main Cover default)</option>
              <option value="ai-first">AI-First Composition — OpenAI generates complete listing image</option>
              <option value="structured">Structured — preserve my white-canvas arrangement</option>
            </select>
            <small>{step===3
              ? '03 Complete Collection always displays 100% of your current collection: '+assets.length+'/'+assets.length+' original cliparts. This image cannot use AI-First generation, samples, or a smaller selected subset.'
              : compositionMode === 'ai-first'
              ? 'AI-First: Pick clipart references, title, subtitle, badge and creative prompt. OpenAI directly generates ONE finished artistic thumbnail from numbered visual reference sheets. No geometry extraction, original PNG paste or second generation step. AI illustration details may differ from the source files.'
              : compositionMode === 'free'
                ? 'AI Vision acts as the art director after the background is generated: it can resize, move, rotate, overlap or partially crop any selected ORIGINAL clipart. White-canvas positions are inspiration only, NOT a constraint. Clipart selection and identity remain unchanged.'
                : 'PaletteIQ preserves the composition you created on the white canvas. You can still choose optional AI Vision refinement or Auto Arrange.'}</small>
            <small>{step===3
              ? 'PaletteIQ creates the dense catalog itself from your source files. No OpenAI reinterpretation, no 80-of-120 sampling, no invented or duplicated artworks.'
              : compositionMode === 'ai-first'
              ? 'These images are visual REFERENCES, not fixed canvas positions. OpenAI freely determines which subjects to depict and how they appear. A generative result is not a pixel-identical copy of the original clipart.'
              : 'Choose how many ORIGINAL collection assets appear in this listing image. Main Cover defaults to '+DEFAULT_MAIN_COVER_CLIPART_COUNT+' but you can choose any count up to your collection size.'}</small>
            <label className="input-label" htmlFor="listing-clipart-count">{step===3
              ? 'ALL ORIGINAL COLLECTION CLIPARTS — LOCKED'
              : compositionMode === 'ai-first' ? 'ELIGIBLE ORIGINAL CLIPART SOURCES' : 'NUMBER OF CLIPARTS'}
              {step===3 ? ' ('+assets.length+' required)' : ' (1–'+assets.length+')'}</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input id="listing-clipart-count" aria-label="Number of listing cliparts" type="number" min={1} max={assets.length} step={1} value={positions.length}
                disabled={!assets.length || !!working || step===3} onChange={e => changeArtworkCount(Number(e.target.value))}
                style={{ width: 105, flexShrink: 0 }}/>
              {step!==3 && <button type="button" className="outline-btn" disabled={!!working || !assets.length} onClick={autoSelectArtwork}>Auto Select ({positions.length})</button>}
              {step!==3 && compositionMode === 'ai-first' && <button type="button" className="outline-btn"
                disabled={!!working || !assets.length}
                onClick={() => {
                  setChanges(old => ({...old,[step]:planListingPlacements(step,categorizedAssets,{count:assets.length})}));
                  setSelectedIndex(0);
                  setMessage('All '+assets.length+' collection clipart images are eligible as visual references for a complete AI-generated thumbnail.');
                }}>Use Entire Collection as Sources</button>}
              {step === 1 && compositionMode !== 'ai-first' && <button type="button" className="outline-btn"
                disabled={!assets.length || !!working}
                onClick={() => {
                  if ((current?.backgroundUrl || preLayouts[String(step)] || changes[step]) &&
                      !window.confirm('Replace the current Main Cover placement with the recommended ' +
                        Math.min(DEFAULT_MAIN_COVER_CLIPART_COUNT, assets.length) +
                        '-clipart art-first composition? This will not regenerate or delete the AI background.')) return;
                  const richLayout = planListingPlacements(1, categorizedAssets, {
                    count: Math.min(DEFAULT_MAIN_COVER_CLIPART_COUNT, assets.length)
                  });
                  setChanges(old => ({ ...old, [step]: richLayout }));
                  setSelectedIndex(0);
                  setMessage('Recommended Main Cover: ' + richLayout.length +
                    ' original cliparts with large heroes, medium supports, and small accents. ' +
                    (current?.backgroundUrl
                      ? 'Click Apply layout & save JPG to update the existing background without another image generation.'
                      : 'Adjust the white canvas, save pre-layout and generate when ready.'));
                }}>Recommended {Math.min(DEFAULT_MAIN_COVER_CLIPART_COUNT, assets.length)}-Clipart Cover</button>}
              <button type="button" className="outline-btn" disabled={!!working} aria-expanded={showAssetPicker}
                onClick={() => setShowAssetPicker(value => !value)}>{showAssetPicker ? 'Hide Clipart Picker' : 'Select Cliparts'}</button>
            </div>
            {showAssetPicker && <div style={{ display: 'grid', gap: 7 }}>
              <input aria-label="Search original collection cliparts" type="search" placeholder="Search clipart names or categories..."
                value={assetSearch} disabled={!!working} onChange={e => setAssetSearch(e.target.value)}/>
              <div style={{ maxHeight: 300, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 7, border: '1px solid #eee7dc', padding: 8, borderRadius: 8 }}>
                {visibleAssetChoices.map(asset => <label key={asset.id} style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #eee4d8', borderRadius: 6, padding: 6, minWidth: 0, cursor: 'pointer' }}>
                  <input type="checkbox" aria-label={'Include ' + asset.name} checked={selectedAssetIds.includes(asset.id)}
                    disabled={!!working || step===3 || (selectedAssetIds.length === 1 && selectedAssetIds.includes(asset.id))}
                    onChange={e => toggleArtwork(asset.id, e.target.checked)}/>
                  <img src={asset.imageUrl} alt="" loading="lazy" style={{ width: 36, height: 36, objectFit: 'contain', flexShrink: 0 }}/>
                  <span style={{ fontSize: 11, overflowWrap: 'anywhere' }}>{asset.name}</span>
                </label>)}
                {!visibleAssetChoices.length && <small>No matching original clipart.</small>}
              </div>
              <small>{step===3
                ? 'Complete Collection: all '+assets.length+' originals are required and checked. Selection cannot be reduced for this listing image.'
                : compositionMode === 'ai-first'
                ? 'Source references: '+new Set(positions.map(p=>p.assetId)).size+' of '+assets.length+' original images. OpenAI directly designs the whole thumbnail and may reinterpret illustrations.'
                : 'Checked: '+positions.length+' / '+assets.length+'. Each selected original appears once.'}</small>
            </div>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {step!==3 && compositionMode !== 'ai-first' && <button type="button" className="outline-btn" disabled={!!working || !positions.length}
                onClick={() => void autoArrangeArtwork()}>Auto Arrange ({positions.length})</button>}
              <button type="button" className="outline-btn" disabled={!!working || step===3 || !selected || positions.length <= 1}
                onClick={() => {
                  if(!selected)return;
                  if(compositionMode === 'ai-first' && current?.renderedImageUrl){
                    setChanges(old => ({...old,[step]:positions.filter((_,i)=>i!==selectedIndex)}));
                    setSelectedIndex(0);
                  }else toggleArtwork(selected.assetId,false);
                }}>Remove Selected Clipart</button>
            </div>
            <small>{compositionMode === 'ai-first'
              ? 'Change source references, refresh the creative prompt and Generate Full Creative Thumbnail. Every new version is a paid image request, not a free PNG layer edit.'
              : 'Change source selection, then use Auto Arrange or adjust the PNG layers directly. Apply layout & save JPG without another image-generation charge.'}</small>
            <small>{compositionMode === 'ai-first'
              ? 'Large source selections are sampled into up to eight reference boards; boards are visual input, not enforced object counts or canvas geometry.'
              : 'There is no preset maximum number of canvas objects. You can select every distinct original; larger selections are arranged by AI Vision in batches.'}</small>
          </div>
          {compositionMode !== 'ai-first' && <>
          <strong>Original asset placement ({positions.length})</strong>
          {listingAllowsBleed(step) && <small>Canvas bleed is allowed: X/Y may be negative and artwork may extend beyond edges. The final 1024×1024 JPG crops only the overflow, preserving original artwork pixels inside.</small>}
          <label className="input-label">SELECT ARTWORK TO ADJUST</label>
          <select value={selectedIndex < positions.length ? selectedIndex : 0} disabled={!positions.length || !!working} onChange={e => setSelectedIndex(Number(e.target.value))}>
            {positions.map((p, i) => <option key={i} value={i}>{i + 1}. {assets.find(a => a.id === p.assetId)?.name || 'Original artwork'}</option>)}
          </select>
          {selected && <>
            <label className="input-label">REPLACE WITH ORIGINAL COLLECTION ASSET</label>
            <select value={selected.assetId} disabled={!!working} onChange={e => move('assetId', e.target.value)}>
              {assets.map(a => <option key={a.id} value={a.id} disabled={positions.some(p => p.assetId === a.id && p.assetId !== selected.assetId)}>{a.name}</option>)}
            </select>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8 }}>
              {(['x','y','width','height'] as const).map(field => <label key={field} style={{ fontSize: 12, display: 'grid', gap: 3 }}>{field.toUpperCase()} (%)
                <input type="number" min={listingAllowsBleed(step) && (field === 'x' || field === 'y') ? -100 : 0}
                  max={listingAllowsBleed(step) ? (field === 'width' || field === 'height' ? 200 : 99) : 100}
                  step={0.5} value={Number(selected[field]).toFixed(1)}
                  disabled={!!working} onChange={e => move(field, e.target.value)}/>
              </label>)}
            </div>
            <label style={{ fontSize:12, display:'grid',gap:3 }}>ROTATION (°)
              <input type="number" min={-180} max={180} step={1} value={selected.rotation || 0}
                disabled={!!working} onChange={e => move('rotation',e.target.value)}/>
            </label>
            <button type="button" className="outline-btn" disabled={!!working || !current?.backgroundUrl} onClick={() => void rerender()}><RotateCcw size={15}/> {current?.renderedImageUrl ? 'Apply layout & save JPG (no AI cost)' : 'Retry save JPG (no AI cost)'}</button>
          </>}
          {compositionMode === 'structured' && <label style={{ display: 'flex', gap: 9, alignItems: 'center', fontSize: 12, color: '#564d43' }}>
            <input type="checkbox" aria-label="Let AI Vision refine pre-layout" checked={allowVisionRefinement}
              disabled={!!working} onChange={e => setAllowVisionRefinement(e.target.checked)}/>
            Let AI Vision refine my clipart positions after generating the background (optional paid Vision request). Off by default — my white-canvas arrangement is preserved.
          </label>}
          </>}
          <label style={{ display: 'flex', gap: 9, alignItems: 'center', fontSize: 12, color: '#564d43' }}>
            <input type="checkbox" aria-label="Automatically critique final JPG" checked={autoFinalCritique}
              disabled={!!working} onChange={e=>setAutoFinalCritique(e.target.checked)}/>
            {compositionMode === 'ai-first'
              ? 'Optionally critique the finished AI-generated JPG (additional paid Vision API request)'
              : 'Automatically critique the FINAL composited JPG (recommended, additional paid Vision API request)'}
          </label>
          {step!==3 && <section data-listing-openai-prompt-editor="true" style={{ border:'1px solid #e5d9cb',
            borderRadius:10, padding:12, display:'grid', gap:9 }}>
            <strong>OpenAI prompt editor — review before sending</strong>
            <small style={{ color:'#75695e' }}>{compositionMode === 'ai-first'
              ? 'A dedicated creative prompt for '+spec.title+' is prepared automatically. Main Cover retains the premium artistic collage template, while other listing images use their own overview, category, close-up, feature, mockup or information design direction. OpenAI creates the entire image directly.'
              : 'Edit the background and optional Vision art direction. PaletteIQ then composes original PNGs.'}</small>
            <button type="button" className="outline-btn" disabled={!!working || !positions.length}
              onClick={() => {
                if (promptsReady && !window.confirm('Replace your edited OpenAI prompt drafts with fresh defaults?')) return;
                void prepareOpenAiPrompts();
              }}>
              {promptsReady
                ? compositionMode === 'ai-first' ? 'Reset / refresh full-cover creative prompt' : 'Reset / refresh both OpenAI prompts'
                : 'Prepare OpenAI prompts (no generation cost)'}
            </button>
            {!promptsReady && <small role="status" style={{ color:'#96501f' }}>Prompts have not been prepared for the current collection selection and settings. Refresh them before generating; any previous draft for this image remains saved in this session.</small>}
            <label className="input-label" htmlFor="listing-background-prompt">{compositionMode === 'ai-first'
              ? 'OPENAI IMAGE EDIT — '+spec.title.toUpperCase()+' CREATIVE PROMPT'
              : 'OPENAI IMAGE GENERATION — BACKGROUND & TYPOGRAPHY PROMPT'}</label>
            <textarea id="listing-background-prompt" aria-label="Editable OpenAI background and typography prompt"
              rows={10} maxLength={24000} spellCheck={false}
              value={promptsReady ? promptDraft!.backgroundPrompt : ''}
              onChange={e => setPromptDrafts(old => ({...old,[step]:{...old[step]!,backgroundPrompt:e.target.value}}))}
              disabled={!!working || !promptsReady}
              placeholder="Click Prepare OpenAI prompts to review the art direction sent to OpenAI."
              style={{ width:'100%', boxSizing:'border-box', resize:'vertical', fontFamily:'inherit', fontSize:12, lineHeight:1.55 }}/>
            <small style={{ color:'#75695e' }}>This creative prompt is sent to {compositionMode === 'ai-first'
              ? 'OpenAI image editing together with selected clipart visual references. OpenAI generates ALL art and typography; source clipart is not pixel-exactly preserved'
              : 'the image-generation model for a background without replacement clipart'}. Review and edit before paying.</small>
            {compositionMode !== 'ai-first' && <>
            <label className="input-label" htmlFor="listing-vision-prompt">OPENAI VISION — ORIGINAL CLIPART COMPOSITION PROMPT</label>
            <textarea id="listing-vision-prompt" aria-label="Editable OpenAI Vision composition prompt"
              rows={8} maxLength={12000} spellCheck={false}
              value={promptsReady ? promptDraft!.layoutPrompt : ''}
              onChange={e => setPromptDrafts(old => ({...old,[step]:{...old[step]!,layoutPrompt:e.target.value}}))}
              disabled={!!working || !promptsReady}
              placeholder="Click Prepare OpenAI prompts to see and edit Vision's artistic composition instructions."
              style={{ width:'100%', boxSizing:'border-box', resize:'vertical', fontFamily:'inherit', fontSize:12, lineHeight:1.55 }}/>
            <small style={{ color:'#75695e' }}>Vision chooses geometry for original PNG layers in Free and Structured modes.</small>
            </>}
          </section>}
          <button type="button" className="primary-btn" onClick={() => void generate()} disabled={!loaded || !assets.length || !!working || !precedingApproved || (step!==3 && !promptsReady)}>
            {working === 'generate' ? <LoaderCircle className="spin" size={16}/> : <Sparkles size={16}/>}
            {step===3
              ? 'Generate Complete Collection — '+assets.length+'/'+assets.length+' Original Cliparts (no AI cost)'
              : compositionMode === 'ai-first'
                ? 'Generate '+spec.title+' (OpenAI paid)'
                : current?.backgroundUrl ? 'Revise Image ' + String(step).padStart(2,'0') + ' (AI background)' : step === 1 ? 'Start /new-listing — Generate Main Cover' : 'Generate Image ' + String(step).padStart(2,'0')}
          </button>
          {!precedingApproved && <small style={{ color: '#94502e' }}>Approve the earlier images in order before generating this image.</small>}
          {step === 5 && <button className="outline-btn" type="button" onClick={() => void categorize()} disabled={!!working}>Analyze collection categories (optional)</button>}
          <small style={{ color: '#74695e' }}>{step===3
            ? 'Complete Collection is rendered locally from every actual collection image, no sampling or AI redraw. If even one source cannot load, saving fails rather than silently leaving it out.'
            : compositionMode === 'ai-first'
            ? 'The OpenAI image is the complete SINGLE-LAYER cover. No mapping, image replacement or PNG compositing. Some depicted details may differ from the original references.'
            : 'Free Composition ignores starter canvas coordinates in the AI background prompt. OpenAI Vision chooses original asset positions, and PaletteIQ composites the source PNGs.'}</small>
          <hr style={{ width: '100%', border: 0, borderTop: '1px solid #eee4d9' }}/>
          <label className="input-label">REVISION NOTES</label>
          <textarea rows={3} maxLength={800} value={notes[step] ?? current?.notes ?? ''} onChange={e => setNotes(old => ({ ...old, [step]: e.target.value }))} placeholder="Specify desired revision to the current image, if any."/>
          <small style={{ color: '#74695e' }}>{step===3
            ? 'Complete Collection revisions: edit the Title, Subtitle or Badge, then regenerate the exact full catalog at no OpenAI cost. All '+assets.length+' source illustrations remain included.'
            : compositionMode === 'ai-first'
            ? 'Revision notes apply on the NEXT paid full-cover generation. This artwork has no separately editable source layers. Review all source subjects, spelling and claims.'
            : 'Revision notes are included in the next paid AI background regeneration. Original clipart positions can be adjusted with a free JPG re-render. Review spelling, crop, verified facts and mockup realism before approving.'}</small>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="outline-btn" disabled={!current?.renderedImageUrl || !!working} onClick={() => void review('needs_revision')}>Needs revision</button>
            <button type="button" className="outline-btn" disabled={!loaded || !!working || (!current?.backgroundUrl && !current?.renderedImageUrl)}
              style={{ color: '#a8342b', borderColor: '#d7a19c' }}
              onClick={() => void rejectAndDelete()}>Reject &amp; Delete</button>
            <button type="button" className="primary-btn" disabled={!current?.renderedImageUrl || !!working || letteringDirty ||
              current.width !== LISTING_WIDTH || current.height !== LISTING_HEIGHT ||
              (step===3 && !completeCatalogMatchesInventory(current,assets))} onClick={() => void review('approved')}><Check size={16}/> Approve & Next (/next) <ArrowRight size={15}/></button>
          </div>
        </div>
      </div>
      {!!message && <p role="status" className="notice" style={{ marginTop: 12 }}>{working ? <LoaderCircle className="spin" size={16}/> : null}{message}</p>}
    </div>
    {costNotice && <aside role="status" aria-live="polite" aria-label="Estimated image generation cost"
      data-listing-floating-cost="true" style={{
        position: 'fixed', bottom: 20, right: 20, zIndex: 1100,
        width: 'min(405px, calc(100vw - 32px))', maxHeight: 'min(65vh, 430px)',
        overflowY: 'auto', boxSizing: 'border-box',
        background: '#fffaf0', border: '1px solid #e8bc7b', borderRadius: 12,
        padding: '13px 15px', boxShadow: '0 10px 32px rgba(51,40,29,.19)',
        color: '#604526', fontSize: 13, lineHeight: 1.5
      }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12 }}>
        <strong>Estimated OpenAI Image Cost — Image {String(costNotice.step).padStart(2,'0')}</strong>
        <button type="button" className="outline-btn" aria-label="Dismiss image cost notice"
          onClick={() => setCostNotice(null)}
          style={{ padding: '1px 7px', fontSize: 18, lineHeight: 1.3, minWidth: 28 }}>×</button>
      </div>
      {costNotice.estimate
        ? <div style={{ marginTop: 8, fontSize: 18, fontWeight: 750 }}>{'US$' + costNotice.estimate.usd.toFixed(5)}</div>
        : <div style={{ marginTop: 8 }}>Price estimate unavailable for this model.</div>}
      <div style={{ marginTop: 4 }}>{costNotice.model} · {costNotice.quality} quality · 1024 × 1024 px</div>
      <small style={{ display: 'block', marginTop: 5, color: '#806b51' }}>
        {costNotice.estimate?.basis === 'reported-usage'
          ? 'Estimated from provider-reported image generation tokens.'
          : costNotice.estimate?.basis === 'published-square-output'
            ? 'Published square-image output estimate; prompt tokens not included.'
            : 'No reliable pricing information returned for this model.'}
        {' '}Additional Vision (style/layout), QC and other API requests are not included. This is not the final OpenAI invoice.
      </small>
    </aside>}
  </div>;
}
