'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, Download, Image as ImageIcon, LoaderCircle, RotateCcw, Sparkles } from 'lucide-react';
import { readApiJson, uploadListingJpg } from '@/lib/listing-image-upload';
import AutoDismissNotice from '@/components/auto-dismiss-notice';
import { DEFAULT_LISTING_STUDIO_CONFIG, type ListingStudioConfig } from '@/lib/listing-studio-config';
import {
  LISTING_IMAGE_SPECS, LISTING_WIDTH, LISTING_HEIGHT, originalAssets,
  planListingPlacements, listingFilename, type ListingAsset, type ListingImageRecord, type ListingPlacement
} from '@/lib/etsy-listing-image-plan';
import { fitListingPlacementsBelowText, isListingPlacementTextSafe, duplicateListingAssetIds } from '@/lib/listing-text-safe';

type Props = {
  projectId: string;
  config?: ListingStudioConfig;
  references: string[];
  onConfigSave: (config: ListingStudioConfig) => Promise<void>;
  name: string;
  theme: string;
  subtheme: string;
  characters: ListingAsset[];
  onSaved?: (images: ListingImageRecord[]) => void;
};
type ListResponse = { images?: ListingImageRecord[]; backgroundUrl?: string; placements?: ListingPlacement[]; fallback?: string; error?: string; layout?: { graphicMotif?: string; letteringStyle?: string; paletteMood?: string } };
const apiUrl = '/api/listing-image-studio';
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
  return uploadListingJpg(projectId, fileName(number), blob, fetch, onProgress);
}

export default function EtsyListingImageStudio({ config: initialConfig, references, onConfigSave, projectId, name, theme, subtheme, characters, onSaved }: Props) {
  const assets = useMemo(() => originalAssets(characters), [characters]);
  const [records, setRecords] = useState<ListingImageRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [step, setStep] = useState(1);
  const [working, setWorking] = useState('');
  const [message, setMessage] = useState('');
  const [config, setConfig] = useState<ListingStudioConfig>(() => ({ ...DEFAULT_LISTING_STUDIO_CONFIG, ...initialConfig }));
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [visionModels, setVisionModels] = useState<Record<'openai' | 'gemini', Array<{id: string; name: string}>>>({ openai: [], gemini: [] });
  const [quality, setQuality] = useState<'low' | 'medium' | 'high'>(initialConfig?.quality || 'medium');
  const [referenceDesign, setReferenceDesign] = useState<ListResponse['layout']>();
  const [availableModels, setAvailableModels] = useState<Array<{id: string; name: string}>>([]);
  const [changes, setChanges] = useState<Record<number, ListingPlacement[]>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [categories, setCategories] = useState<Record<string,string>>({});
  function changeConfig<K extends keyof ListingStudioConfig>(key: K, value: ListingStudioConfig[K]) {
    setConfig(current => ({ ...current, [key]: value }));
    setSettingsDirty(true);
  }
  const persistConfig = async () => {
    if (settingsBusy) return;
    setSettingsBusy(true);
    try {
      await onConfigSave(config);
      setSettingsDirty(false);
      setMessage('Reference & Assets settings saved for this collection. Ready to generate the next listing image.');
    } catch (error) {
      setMessage('Could not save listing design settings: ' + (error instanceof Error ? error.message : String(error)));
    } finally { setSettingsBusy(false); }
  };
  const uploadReference = async (file?: File) => {
    if (!file) return;
    if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 15_000_000) {
      setMessage('Select a PNG, JPG, or WebP reference smaller than 15 MB.');
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 720 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw Error('Canvas unavailable');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      changeConfig('referenceImage', canvas.toDataURL('image/jpeg', 0.76));
      setMessage('Reference loaded for style analysis. Uploaded pixels stay in this browser session; use a collection reference for persistent selection.');
    } catch (error) {
      setMessage('Could not load reference: ' + (error instanceof Error ? error.message : String(error)));
    }
  };

  const categorizedAssets = useMemo(() => assets.map(a => ({ ...a, category: categories[a.id] || a.category })), [assets, categories]);
  const initialPlacements = useCallback((number: number) => {
    return fitListingPlacementsBelowText(planListingPlacements(number, categorizedAssets));
  }, [categorizedAssets]);
  const current = records.find(item => item.number === step);
  const positions = changes[step] || current?.placements || initialPlacements(step);
  const selected = positions[selectedIndex] || positions[0];
  const approved = LISTING_IMAGE_SPECS.filter(s => records.some(r => r.number === s.number && r.status === 'approved')).length;
  const precedingApproved = LISTING_IMAGE_SPECS.slice(0, step - 1).every(s => records.some(r => r.number === s.number && r.status === 'approved'));

  useEffect(() => {
    let live = true;
    setLoaded(false);
    request(apiUrl + '?projectId=' + encodeURIComponent(projectId)).then(response => {
      if (live) { setRecords(response.images || []); setLoaded(true); }
    }).catch(error => { if (live) { setLoaded(true); setMessage('Could not load saved listing images: ' + String(error)); } });
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
  useEffect(() => {
    let live = true;
    void Promise.all((['openai','gemini'] as const).map(async provider => {
      try {
        const response = await fetch('/api/settings?models=' + (provider === 'openai' ? 'openai-seo' : 'gemini'));
        if (!response.ok) return;
        const result = await response.json() as { models?: Array<{id: string; name: string}> };
        if (live) setVisionModels(old => ({ ...old, [provider]: result.models || [] }));
      } catch { /* The selected saved model stays available offline. */ }
    }));
    return () => { live = false; };
  }, []);
  const receive = useCallback((images: ListingImageRecord[]) => {
    setRecords(images);
    onSaved?.(images);
  }, [onSaved]);

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
  const renderAndSave = async (background: string, layout: ListingPlacement[], info: string) => {
    setWorking('render'); setMessage('Compositing ' + layout.length + ' exact original clipart images at 1024 × 1024 px...');
    if (!layout.length || duplicateListingAssetIds(layout).length ||
        !layout.every(p => isListingPlacementTextSafe(p)))
      throw Error('One or more original PNGs overlap the protected title/subtitle area, or repeat an asset. Adjust the layout before saving.');
    const file = await compose(background, layout, assets);
    setMessage('Saving JPG preview to the collection in safe upload chunks...');
    const renderedImageUrl = await upload(projectId, step, file, (done, total) => setMessage('Uploading original-asset JPG: ' + done + '/' + total + ' parts...'));
    const image: ListingImageRecord = {
      number: step, status: 'draft', backgroundUrl: background, renderedImageUrl, placements: layout,
      notes: info, updatedAt: Date.now()
    };
    await saveRecord(image);
    setChanges(old => { const next = { ...old }; delete next[step]; return next; });
    setMessage('Image ' + String(step).padStart(2, '0') + ' saved as a draft. Review the actual pixels and approve or revise.');
  };
  const generate = async () => {
    if (working || settingsBusy) return;
    if (settingsDirty) return setMessage('Save Reference & Assets settings before generating.');
    if (!assets.length) return setMessage('Generate collection clipart in Image Production first.');
    if (!precedingApproved) return setMessage('Approve all preceding listing images before generating this one.');
    if (current?.status === 'approved' && !window.confirm('Regenerate an approved image? Its approval will be reset to Draft.')) return;
    setWorking('generate'); setMessage('Generating artistic background + exact typography with OpenAI (no clipart regeneration)...');
    try {
      let effectivePositions = fitListingPlacementsBelowText(positions);
      if (duplicateListingAssetIds(effectivePositions).length)
        throw Error('Duplicate clipart is selected. Replace repeated artwork with distinct collection PNGs.');
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
            effectivePositions = fitListingPlacementsBelowText(planListingPlacements(step, assets.map(a => ({ ...a, category: map[a.id] || a.category }))));
          }
        } catch { /* Continue with a neutral collection gallery rather than invent categories. */ }
      }
      let styleTokens = referenceDesign;
      if (!styleTokens && config?.referenceImage) {
        setMessage('Analyzing selected Reference & Assets image for nonfigurative design cues...');
        try {
          const refResult = await request('/api/thumbnail-layout', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectId, imageUrl: config.referenceImage, provider: config.analysisProvider,
              model: config.analysisModel, count: Math.min(assets.length, 12), referenceStyle: config.referenceStyle
            })
          });
          styleTokens = refResult.layout;
          if (styleTokens) setReferenceDesign(styleTokens);
        } catch {
          setMessage('Reference analysis unavailable; continuing with the chosen Reference & Assets style.');
        }
      }
      setMessage('Generating the AI graphic background and artistic typography...');
      const response = await send({ action: 'generate', projectId, number: step, model: config.imageModel, quality,
        settings: config ? { ...config, referenceImage: undefined } : undefined,
        referenceDesign: styleTokens
      });
      if (!response.backgroundUrl) throw Error('OpenAI did not return the background');
      let suggested = effectivePositions;
      let layoutWarning = '';
      if (config?.layoutMode !== 'manual' && effectivePositions.length <= 24) {
        setMessage('AI Vision is finding typography-safe original artwork slots on the actual generated background...');
        try {
          const vision = await send({ action: 'layout', projectId, number: step, backgroundUrl: response.backgroundUrl, placements: effectivePositions, settings: config ? { ...config, referenceImage: undefined } : undefined });
          if (vision.placements?.length === effectivePositions.length) {
            suggested = fitListingPlacementsBelowText(vision.placements);
            if (!suggested.length) throw Error('Vision positions could not be kept outside the text zone.');
          }
          layoutWarning = vision.fallback || '';
        } catch { layoutWarning = 'Vision placement unavailable; original image placements retained.'; }
      }
      // Save the paid AI background before transferring the large composed JPG.
      // If upload fails, "Apply layout & save JPG" retries without another AI bill.
      await saveRecord({
        number: step, status: 'draft', backgroundUrl: response.backgroundUrl,
        renderedImageUrl: '', placements: suggested,
        notes: notes[step] || current?.notes || '', updatedAt: Date.now()
      });
      await renderAndSave(response.backgroundUrl, suggested, notes[step] || current?.notes || '');
      if (layoutWarning) setMessage('Image saved as draft. ' + layoutWarning);
    } catch (error) { setMessage('Generation failed: ' + (error instanceof Error ? error.message : String(error))); }
    finally { setWorking(''); }
  };
  const rerender = async () => {
    if (working) return;
    if (!current?.backgroundUrl) return setMessage('Generate the background first.');
    if (current.status === 'approved' && !window.confirm('Revise this approved image and reset approval?')) return;
    try { await renderAndSave(current.backgroundUrl, positions, notes[step] || current.notes || ''); }
    catch (error) { setMessage('Could not save revised image: ' + (error instanceof Error ? error.message : String(error))); }
    finally { setWorking(''); }
  };
  const review = async (status: 'approved' | 'needs_revision') => {
    if (!current?.renderedImageUrl || working) return;
    if (changes[step]) return setMessage('You changed the layout. Click Apply layout & save JPG before approval.');
    setWorking('review');
    try {
      await saveRecord({ ...current, status, notes: notes[step] || current.notes || '', updatedAt: Date.now() });
      setMessage(status === 'approved' ? 'Image ' + step + ' approved and saved.' : 'Image marked for revision. Change placements or regenerate the AI background.');
      if (status === 'approved' && step < 15) { setStep(step + 1); setSelectedIndex(0); }
    } catch (error) { setMessage('Could not save review: ' + String(error)); }
    finally { setWorking(''); }
  };
  const move = (field: 'assetId' | 'x' | 'y' | 'width' | 'height' | 'rotation', value: string) => {
    setChanges(prev => {
      const list = [...(prev[step] || current?.placements || initialPlacements(step))];
      const target = list[selectedIndex];
      if (!target) return prev;
      list[selectedIndex] = { ...target, [field]: field === 'assetId' ? value : clamp(Number(value), field === 'rotation' ? -30 : field === 'width' || field === 'height' ? 2 : 0, field === 'rotation' ? 30 : 100) };
      return { ...prev, [step]: list };
    });
  };
  const setPage = (number: number) => { setStep(number); setSelectedIndex(0); setMessage(''); };
  const spec = LISTING_IMAGE_SPECS[step - 1];

  return <div style={{ display: 'grid', gap: 18 }}>
    <div className="panel" style={{ padding: 20, display: 'grid', gap: 12 }}>
      <h2>Reference & Assets — Listing Image Studio</h2>
      <p className="sub">Configure the 15-image workflow here. The legacy Thumbnail Designer is temporarily hidden, but its existing designs remain saved. Only collection originals are placed over AI backgrounds.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(215px, 1fr))', gap: 12 }}>
        <label style={{ display: 'grid', gap: 5 }}><span className="input-label">LAYOUT MODE</span>
          <select value={config.layoutMode} disabled={!!working || settingsBusy} onChange={e => changeConfig('layoutMode', e.target.value as ListingStudioConfig['layoutMode'])}>
            <option value="ai">AI + manual</option><option value="manual">Manual placement</option>
          </select>
        </label>
        <label style={{ display: 'grid', gap: 5 }}><span className="input-label">VISION PROVIDER</span>
          <select value={config.analysisProvider} disabled={!!working || settingsBusy} onChange={e => {
            const value = e.target.value as ListingStudioConfig['analysisProvider'];
            setConfig(old => ({ ...old, analysisProvider: value, analysisModel: value === 'openai' ? 'gpt-4.1-mini' : 'gemini-2.5-pro' }));
            setSettingsDirty(true);
          }}><option value="openai">OpenAI</option><option value="gemini">Gemini (reference analysis)</option></select>
        </label>
        <label style={{ display: 'grid', gap: 5 }}><span className="input-label">OPENAI BACKGROUND GENERATION MODEL</span>
          <select value={config.imageModel} disabled={!!working || settingsBusy} onChange={e => changeConfig('imageModel', e.target.value)}>
            {!availableModels.some(x => x.id === config.imageModel) && <option value={config.imageModel}>{config.imageModel}</option>}
            {availableModels.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <small>For creating backgrounds and artistic lettering. Vision model above is for analyzing the reference image.</small>
        </label>
        <label style={{ display: 'grid', gap: 5 }}><span className="input-label">VISION MODEL</span>
          <select value={config.analysisModel} disabled={!!working || settingsBusy} onChange={e => changeConfig('analysisModel', e.target.value)}>
            {!visionModels[config.analysisProvider].some(m => m.id === config.analysisModel) && <option value={config.analysisModel}>{config.analysisModel}</option>}
            {visionModels[config.analysisProvider].map(m => <option key={m.id} value={m.id}>{m.name} ({m.id})</option>)}
          </select>
        </label>






        <label style={{ display: 'grid', gap: 5 }}><span className="input-label">CUSTOM MAIN TITLE</span>
          <input maxLength={75} value={config.headline || ''} disabled={!!working || settingsBusy} placeholder={subtheme || theme || name} onChange={e => changeConfig('headline', e.target.value)}/>
        </label>
        <label style={{ display: 'grid', gap: 5 }}><span className="input-label">REFERENCE IMAGE (OPTIONAL)</span>
          <select value={config.referenceImage?.startsWith('data:') ? '__uploaded__' : config.referenceImage || ''} disabled={!!working || settingsBusy}
            onChange={e => changeConfig('referenceImage', e.target.value || undefined)}>
            <option value="">None — auto style</option>
            {config.referenceImage?.startsWith('data:') && <option value="__uploaded__">Uploaded image (this session)</option>}
            {config.referenceImage && !config.referenceImage.startsWith('data:') && !references.includes(config.referenceImage) && <option value={config.referenceImage}>Previously selected reference</option>}
            {references.map((src,i) => <option value={src} key={src}>Etsy reference {i + 1}</option>)}
          </select>
        </label>

      </div>
      <label style={{ display: 'grid', gap: 6 }}><span className="input-label">UPLOAD DESIGN REFERENCE (OPTIONAL)</span>
        <input type="file" accept="image/jpeg,image/png,image/webp" disabled={!!working || settingsBusy} onChange={e => { void uploadReference(e.target.files?.[0]); e.target.value = ''; }}/>
      </label>
      {config.referenceImage && <img src={config.referenceImage} alt="Selected graphic-style reference" style={{ maxHeight: 145, maxWidth: 240, objectFit: 'contain', borderRadius: 8 }}/>}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <button className="primary-btn" disabled={settingsBusy || !!working || !settingsDirty} onClick={() => void persistConfig()}>
          {settingsBusy ? <LoaderCircle className="spin" size={16}/> : <Check size={16}/>} Save listing design settings
        </button>
        <small>{settingsDirty ? 'Unsaved settings — save before generating.' : 'Settings saved. Ready for listing generation.'}</small>
      </div>
    </div>
    <div className="panel" style={{ padding: 20 }}>
      <h2>Etsy Listing Image Studio</h2>
      <p className="sub">15-image workflow • 1024 × 1024 px • square 1:1 • OpenAI artistic lettering • exact original collection clipart. Configure Reference & Assets above; existing legacy thumbnail projects stay intact.</p>
      <p className="sub">Layout follows the chosen reference, available original artwork and protected headline area. {config.referenceImage ? 'Design reference selected.' : 'Automatic design direction.'}</p>
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
            {item?.status === 'approved' ? '✓ Approved' : item?.status === 'needs_revision' ? 'Needs revision' : item?.renderedImageUrl ? 'Draft • Review' : 'Not generated'}
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
            <span className="sub">{LISTING_WIDTH} × {LISTING_HEIGHT} • {current.status === 'approved' ? 'Approved' : 'Awaiting approval'}</span>
          </div>}
          {(spec.kind === 'mockup') && <p className="sub">Mockup is a demonstration, not included in the sold collection. Inspect printable placement: the photograph is AI-generated, while the featured clipart is composited from its original file.</p>}
        </div>
        <div style={{ display: 'grid', alignContent: 'start', gap: 10 }}>
          <label className="input-label">BACKGROUND QUALITY</label>
          <select value={quality} disabled={!!working || settingsBusy} onChange={e => { const value = e.target.value as typeof quality; setQuality(value); changeConfig('quality', value); }}>
            <option value="low">Low — economical</option><option value="medium">Medium — recommended</option><option value="high">High</option>
          </select>
          <button type="button" className="primary-btn" onClick={() => void generate()} disabled={!loaded || !assets.length || !!working || settingsBusy || settingsDirty || !precedingApproved}>
            {working === 'generate' ? <LoaderCircle className="spin" size={16}/> : <Sparkles size={16}/>}
            {current?.backgroundUrl ? 'Regenerate AI background + lettering' : 'Generate Image ' + String(step).padStart(2,'0')}
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
          <textarea rows={3} maxLength={800} value={notes[step] ?? current?.notes ?? ''} onChange={e => setNotes(old => ({ ...old, [step]: e.target.value }))} placeholder="What would you change in this image?"/>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="outline-btn" disabled={!current?.renderedImageUrl || !!working} onClick={() => void review('needs_revision')}>Needs revision</button>
            <button type="button" className="primary-btn" disabled={!current?.renderedImageUrl || !!working} onClick={() => void review('approved')}><Check size={16}/> Approve & Next <ArrowRight size={15}/></button>
          </div>
        </div>
      </div>
      <AutoDismissNotice message={message} onClose={() => setMessage('')} />
    </div>
  </div>;
}
