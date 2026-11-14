'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, Download, Image as ImageIcon, LoaderCircle, RotateCcw, Sparkles } from 'lucide-react';
import { readApiJson, uploadListingJpg } from '@/lib/listing-image-upload';
import type { ListingStyleSample, ListingVisualStyleProfile } from '@/lib/etsy-listing-visual-style';
import type { ImageGenerationCostEstimate } from '@/lib/etsy-listing-image-cost';
import { listingCreativeDirection, listingMockupScene } from '@/lib/etsy-listing-creative-direction';
import {
  LISTING_IMAGE_SPECS, LISTING_WIDTH, LISTING_HEIGHT, originalAssets,
  planListingPlacements, curatedListingHighlights, listingFilename, listingImageTextDefaults, isSquareListingApproved, type ListingImageText, type ListingFinalReview, type ListingAsset, type ListingImageRecord, type ListingPlacement
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
  characters: ListingAsset[];
  onSaved?: (images: ListingImageRecord[]) => void;
};
type ListResponse = { images?: ListingImageRecord[]; backgroundUrl?: string; placements?: ListingPlacement[]; finalReview?: ListingFinalReview | null; fallback?: string; reviewWarning?: string; costEstimate?: ImageGenerationCostEstimate | null; warning?: string; deleted?: boolean; error?: string };
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
async function upload(projectId: string, number: number, blob: Blob, onProgress?: (done: number, total: number) => void): Promise<string> {
  // Preserve the working fix for Payload Too Large (HTTP 413).
  return uploadListingJpg(projectId, fileName(number), blob, fetch, onProgress);
}

export default function EtsyListingImageStudio({ projectId, name, theme, subtheme, style, palette, texture, seoTitle, primaryKeyword, characters, onSaved }: Props) {
  const artDirection = useMemo(() => listingCreativeDirection({ name, theme, subtheme, style, palette, texture, listing: { title: seoTitle } }), [name, theme, subtheme, style, palette, texture, seoTitle]);
  const seoText = useMemo(() => listingImageTextDefaults({ title: seoTitle, primaryKeyword }, artDirection.title), [seoTitle, primaryKeyword, artDirection.title]);
  const assets = useMemo(() => originalAssets(characters), [characters]);
  const [records, setRecords] = useState<ListingImageRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [step, setStep] = useState(1);
  const [working, setWorking] = useState('');
  const [message, setMessage] = useState('');
  const [quality, setQuality] = useState<'low' | 'medium' | 'high'>('medium');
  const [model, setModel] = useState('gpt-image-1-mini');
  const [availableModels, setAvailableModels] = useState<Array<{id: string; name: string}>>([]);
  const [changes, setChanges] = useState<Record<number, ListingPlacement[]>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [letteringChanges, setLetteringChanges] = useState<Record<number, ListingImageText>>({});
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [assetSearch, setAssetSearch] = useState('');
  const [showAssetPicker, setShowAssetPicker] = useState(false);
  const [categories, setCategories] = useState<Record<string,string>>({});
  const [inspection, setInspection] = useState<CollectionInspection | null>(null);
  const [styleProfile, setStyleProfile] = useState<ListingVisualStyleProfile | null>(null);
  const [styleWarning, setStyleWarning] = useState('');
  const [costNotice, setCostNotice] = useState<{ step: number; model: string; quality: string; estimate: ImageGenerationCostEstimate | null } | null>(null);

  const categorizedAssets = useMemo(() => assets.map(a => ({ ...a, category: categories[a.id] || a.category })), [assets, categories]);
  const current = records.find(item => item.number === step);
  const currentLettering: ListingImageText = letteringChanges[step] ?? {
    title: current?.title ?? seoText.title,
    subtitle: current?.subtitle ?? seoText.subtitle,
    badge: current?.badge ?? seoText.badge
  };
  const letteringDirty = Boolean(current?.backgroundUrl && (
    currentLettering.title !== (current.title ?? seoText.title) ||
    currentLettering.subtitle !== (current.subtitle ?? seoText.subtitle) ||
    currentLettering.badge !== (current.badge ?? seoText.badge)
  ));
  const positions = changes[step] || current?.placements || planListingPlacements(step, categorizedAssets);
  const selected = positions[selectedIndex] || positions[0];
  const selectedAssetIds = useMemo(() => positions.map(p=>p.assetId), [positions]);
  const visibleAssetChoices = useMemo(() => categorizedAssets.filter(asset =>
    !assetSearch.trim() || (asset.name + ' ' + (asset.category || '')).toLowerCase().includes(assetSearch.trim().toLowerCase())),
    [categorizedAssets, assetSearch]);
  const approved = LISTING_IMAGE_SPECS.filter(s => records.some(r => r.number === s.number && isSquareListingApproved(r))).length;
  const precedingApproved = LISTING_IMAGE_SPECS.slice(0, step - 1).every(s => records.some(r => r.number === s.number && isSquareListingApproved(r)));

  useEffect(() => {
    let live = true;
    setLoaded(false);
    request(apiUrl + '?projectId=' + encodeURIComponent(projectId)).then(response => {
      if (live) {
        const images = response.images || [];
        setRecords(images);
        // Resume the first unapproved image on return/reload, instead of always
        // restarting visually at step 01 (approved JPGs are never regenerated).
        setStep(LISTING_IMAGE_SPECS.find(s => !images.some(r => r.number === s.number && isSquareListingApproved(r)))?.number || 15);
        setSelectedIndex(0);
        setLoaded(true);
      }
    }).catch(error => { if (live) { setLoaded(true); setMessage('Could not load saved listing images: ' + String(error)); } });
    return () => { live = false; };
  }, [projectId]);
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

  const saveRecord = async (image: ListingImageRecord) => {
    const result = await send({ action: 'save', projectId, number: step, image });
    receive(result.images || []);
  };
  const renderAndSave = async (background: string, layout: ListingPlacement[], info: string, reviewWarning = '', lettering: ListingImageText = currentLettering) => {
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
    setMessage('Image ' + String(step).padStart(2, '0') + ' saved as a draft. ' + (reviewWarning ? 'Background flagged for visual review: ' + reviewWarning : 'Review the actual pixels, spelling and crop before approving.'));
  };
  const generate = async () => {
    if (working) return;
    if (!assets.length) return setMessage('Generate collection clipart in Image Production first.');
    if (!precedingApproved) return setMessage('Approve all preceding listing images before generating this one.');
    if (current?.status === 'approved' && !window.confirm('Regenerate an approved image? Its approval will be reset to Draft.')) return;
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
      if ((step === 3 || step === 5) && !current?.placements && !changes[step] &&
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
      setMessage('Generating the AI graphic background and artistic typography...');
      const response = await send({ action: 'generate', projectId, number: step, model, quality,
        title: lettering.title, subtitle: lettering.subtitle, badge: lettering.badge,
        revisionNotes: (notes[step] ?? current?.notes ?? '').trim() });
      if (!response.backgroundUrl) throw Error('OpenAI did not return the background');
      // Cost belongs to a separate dismissible floating notice, not workflow status.
      setCostNotice({ step, model, quality, estimate: response.costEstimate ?? null });
      let suggested = effectivePositions;
      let layoutWarning = '';
      if (effectivePositions.length <= 24) {
        setMessage('AI Vision is arranging original artwork around the real lettering with natural partial overlap...');
        try {
          const vision = await send({ action: 'layout', projectId, number: step, backgroundUrl: response.backgroundUrl, placements: effectivePositions });
          if (vision.placements?.length === effectivePositions.length) suggested = vision.placements;
          layoutWarning = vision.fallback || '';
        } catch { layoutWarning = 'Vision placement unavailable; original image placements retained.'; }
      }
      // The paid AI background is recorded before JPG transfer so a failed
      // upload can be retried without generating and paying for the AI again.
      // An empty renderedImageUrl intentionally invalidates prior approved pixels.
      await saveRecord({
        number: step, status: 'draft', backgroundUrl: response.backgroundUrl,
        renderedImageUrl: '', placements: suggested, width: LISTING_WIDTH, height: LISTING_HEIGHT,
        title: lettering.title, subtitle: lettering.subtitle, badge: lettering.badge,
        notes: notes[step] || current?.notes || '', reviewWarning: response.reviewWarning || '', updatedAt: Date.now()
      });
      await renderAndSave(response.backgroundUrl, suggested, notes[step] || current?.notes || '', response.reviewWarning || '', lettering);
      setMessage('Image ' + String(step).padStart(2, '0') + ' saved as draft.' +
        (layoutWarning ? ' Layout note: ' + layoutWarning : ' Review lettering legibility and clipart overlap before approving.') + styleFallback);
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
  const review = async (status: 'approved' | 'needs_revision') => {
    if (!current?.renderedImageUrl || working) return;
    if (status === 'approved' && (current.width !== LISTING_WIDTH || current.height !== LISTING_HEIGHT))
      return setMessage('Render a new 1024 × 1024 square JPG before approval. Your older 4:3 image remains saved.');
    if (status === 'approved' && current.reviewWarning &&
        !window.confirm('Automatic review flagged a possible issue:\n' + current.reviewWarning + '\n\nHave you carefully checked the artwork, mockup, text and verified facts and want to approve this JPG anyway?')) return;
    if (letteringDirty) return setMessage('Title, Subtitle, or Badge changed. Regenerate the AI artwork before approving the new text.');
    if (changes[step]) return setMessage('You changed the layout. Click Apply layout & save JPG before approval.');
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
      const list = [...(prev[step] || current?.placements || planListingPlacements(step, categorizedAssets))];
      const target = list[selectedIndex];
      if (!target) return prev;
      list[selectedIndex] = { ...target, [field]: field === 'assetId' ? value : clamp(Number(value), field === 'rotation' ? -30 : field === 'width' || field === 'height' ? 2 : 0, field === 'rotation' ? 30 : 100) };
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
    if (current?.status === 'approved' && !window.confirm('Rearrange this approved image? Save the updated JPG to reset approval.')) return;
    const localPlan = planListingPlacements(step, categorizedAssets, { assetIds: selectedAssetIds });
    if (!current?.backgroundUrl || positions.length > 24) {
      setChanges(old => ({ ...old, [step]: localPlan }));
      setMessage(current?.backgroundUrl
        ? 'Auto arranged with a local grid/perimeter layout (Vision supports up to 24 assets). Apply layout & save JPG to preview the result.'
        : 'Starter layout arranged locally; AI Vision can refine it during image generation for up to 24 assets.');
      return;
    }
    setWorking('layout');
    setMessage('AI Vision is arranging the selected original PNGs around the actual lettering...');
    try {
      const answer = await send({
        action:'layout', projectId, number:step, backgroundUrl:current.backgroundUrl,
        placements:positions, critiqueFeedback: current.finalReview?.improvements.join('; ') || ''
      });
      setChanges(old => ({ ...old, [step]: answer.placements?.length === positions.length ? answer.placements : localPlan }));
      setMessage(answer.fallback
        ? answer.fallback + ' Apply layout & save JPG to preview the local arrangement.'
        : 'AI Vision rearranged ' + positions.length + ' originals. Apply layout & save JPG (no image-generation cost), then review the final composition.');
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
            {isSquareListingApproved(item) ? '✓ Approved (square)' : item?.renderedImageUrl && (item.width !== LISTING_WIDTH || item.height !== LISTING_HEIGHT) ? 'Legacy 4:3 • remake as square' : item?.status === 'needs_revision' ? 'Needs revision' : item?.renderedImageUrl ? 'Draft • Review' : 'Not generated'}
          </small>
        </button>;
      })}
    </div>
    <div className="panel" style={{ padding: 18 }}>
      <h2>{String(step).padStart(2,'0')} — {spec.title}</h2>
      <p className="sub">{spec.purpose}. Source: {smoothName(subtheme || theme || name)}.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 18 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ aspectRatio: '1 / 1', background: '#f7f1e9', border: '1px solid #e5dbcb', borderRadius: 10, overflow: 'hidden', display: 'grid', placeItems: 'center' }}>
            {current?.renderedImageUrl ? <img key={current.renderedImageUrl} src={current.renderedImageUrl} alt={'Saved listing image '+step} style={{ width: '100%', height: '100%', objectFit: 'contain' }}/> :
              <div style={{ textAlign: 'center', padding: 24, color: '#68594a' }}><ImageIcon size={40}/><p>Generate the AI graphic background, then PaletteIQ will composite original collection PNGs.</p></div>}
          </div>
          {current?.renderedImageUrl && <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <a className="outline-btn" href={current.renderedImageUrl} download={fileName(step)}><Download size={15}/> Download JPG</a>
            <span className="sub">{current.width || 'Legacy'} × {current.height || '4:3'} • {isSquareListingApproved(current) ? 'Approved square JPG' : 'Awaiting square approval'}</span>
          </div>}
          {current?.renderedImageUrl && (current.width !== LISTING_WIDTH || current.height !== LISTING_HEIGHT) && <p role="alert" className="notice">This saved image was produced by the previous 4:3 workflow. It is preserved for reference; regenerate the AI background, or re-render its background as 1024 × 1024 before approving the square edition.</p>}
          {current?.reviewWarning && <p role="alert" style={{ border: '1px solid #d48c48', borderRadius: 8, padding: 10, color: '#7b431b', background: '#fff6e9' }}>Manual quality review required: {current.reviewWarning}. Approval requires your explicit confirmation.</p>}
          {(spec.kind === 'mockup') && <p className="sub">Application example: {listingMockupScene(step, artDirection.family)?.name}. Mockup is a demonstration, not included in the sold collection. Inspect printable placement: the photograph is AI-generated, while the featured clipart is composited from its original file.</p>}
        </div>
        <div style={{ display: 'grid', alignContent: 'start', gap: 10 }}>
          <details style={{ border: '1px solid #e5d9cb', borderRadius: 9, padding: '9px 12px' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>Advanced AI settings (optional)</summary>
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
            </div>
          </details>
          <div style={{ border: '1px solid #eadfce', borderRadius: 10, padding: 12, display: 'grid', gap: 9 }}>
            <strong>Title, Subtitle &amp; Badge for Image {String(step).padStart(2,'0')}</strong>
            <small style={{ color: '#75695e' }}>Default Title = SEO Title, Subtitle = Primary Keyword from Etsy Listing Draft. Both can be edited. Badge is optional and empty by default.</small>
            <label className="input-label" htmlFor="listing-image-title">TITLE (SEO TITLE DEFAULT)</label>
            <input id="listing-image-title" aria-label="Listing image title" type="text" maxLength={140}
              value={currentLettering.title} disabled={!!working}
              onChange={e => editLettering('title', e.target.value)}
              placeholder="Listing title"/>
            <label className="input-label" htmlFor="listing-image-subtitle">SUBTITLE (PRIMARY KEYWORD DEFAULT)</label>
            <input id="listing-image-subtitle" aria-label="Listing image subtitle" type="text" maxLength={140}
              value={currentLettering.subtitle} disabled={!!working}
              onChange={e => editLettering('subtitle', e.target.value)}
              placeholder="Primary keyword"/>
            <label className="input-label" htmlFor="listing-image-badge">BADGE (OPTIONAL)</label>
            <input id="listing-image-badge" aria-label="Listing image badge" type="text" maxLength={60}
              value={currentLettering.badge} disabled={!!working}
              onChange={e => editLettering('badge', e.target.value)}
              placeholder="e.g. 80 CLIPART • Leave blank for no badge"/>
            <button type="button" className="outline-btn" disabled={!!working}
              onClick={() => setLetteringChanges(prev => ({ ...prev, [step]: { ...seoText } }))}>
              Reset text to Etsy SEO defaults
            </button>
            {letteringDirty && <small role="alert" style={{ color: '#a04c22' }}>Title, Subtitle or Badge has changed since this background was generated. Click Regenerate AI background + lettering to apply the new text. A layout-only re-render cannot change AI lettering.</small>}
          </div>
          <button type="button" className="primary-btn" onClick={() => void generate()} disabled={!loaded || !assets.length || !!working || !precedingApproved}>
            {working === 'generate' ? <LoaderCircle className="spin" size={16}/> : <Sparkles size={16}/>}
            {current?.backgroundUrl ? 'Revise Image ' + String(step).padStart(2,'0') + ' (AI background)' : step === 1 ? 'Start /new-listing — Generate Main Cover' : 'Generate Image ' + String(step).padStart(2,'0')}
          </button>
          {!precedingApproved && <small style={{ color: '#94502e' }}>Approve the earlier images in order before generating this image.</small>}
          {(step === 3 || step === 5) && <button className="outline-btn" type="button" onClick={() => void categorize()} disabled={!!working}>Analyze collection categories (optional)</button>}
          <small style={{ color: '#74695e' }}>Only the graphic background, premium lettering and blank mockup environment are AI-generated. PaletteIQ composites original collection assets, preserving their identity. Generation uses paid API requests.</small>
          <hr style={{ width: '100%', border: 0, borderTop: '1px solid #eee4d9' }}/>
          <strong>Original asset placement ({positions.length})</strong>
          <label className="input-label">SELECT ARTWORK TO ADJUST</label>
          <select value={selectedIndex < positions.length ? selectedIndex : 0} disabled={!positions.length || !!working} onChange={e => setSelectedIndex(Number(e.target.value))}>
            {positions.map((p, i) => <option key={i} value={i}>{i + 1}. {assets.find(a => a.id === p.assetId)?.name || 'Original artwork'}</option>)}
          </select>
          {selected && <>
            <label className="input-label">REPLACE WITH ORIGINAL COLLECTION ASSET</label>
            <select value={selected.assetId} disabled={!!working} onChange={e => move('assetId', e.target.value)}>
              {assets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8 }}>
              {(['x','y','width','height'] as const).map(field => <label key={field} style={{ fontSize: 12, display: 'grid', gap: 3 }}>{field.toUpperCase()} (%)
                <input type="number" min={0} max={100} step={0.5} value={Number(selected[field]).toFixed(1)} disabled={!!working} onChange={e => move(field, e.target.value)}/>
              </label>)}
            </div>
            <button type="button" className="outline-btn" disabled={!!working || !current?.backgroundUrl} onClick={() => void rerender()}><RotateCcw size={15}/> {current?.renderedImageUrl ? 'Apply layout & save JPG (no AI cost)' : 'Retry save JPG (no AI cost)'}</button>
          </>}
          <label className="input-label">REVISION NOTES</label>
          <textarea rows={3} maxLength={800} value={notes[step] ?? current?.notes ?? ''} onChange={e => setNotes(old => ({ ...old, [step]: e.target.value }))} placeholder="Specify desired revision to the current image, if any."/>
          <small style={{ color: '#74695e' }}>Your revision notes are included in the next paid AI background regeneration for this image only. To adjust original clipart positions without AI charges, use Apply layout & save JPG. Review spelling, crop, verified facts and mockup realism before approving.</small>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="outline-btn" disabled={!current?.renderedImageUrl || !!working} onClick={() => void review('needs_revision')}>Needs revision</button>
            <button type="button" className="outline-btn" disabled={!loaded || !!working || (!current?.backgroundUrl && !current?.renderedImageUrl)}
              style={{ color: '#a8342b', borderColor: '#d7a19c' }}
              onClick={() => void rejectAndDelete()}>Reject &amp; Delete</button>
            <button type="button" className="primary-btn" disabled={!current?.renderedImageUrl || !!working || letteringDirty || current.width !== LISTING_WIDTH || current.height !== LISTING_HEIGHT} onClick={() => void review('approved')}><Check size={16}/> Approve & Next (/next) <ArrowRight size={15}/></button>
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
