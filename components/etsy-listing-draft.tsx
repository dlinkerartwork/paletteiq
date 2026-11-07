'use client';

import { useEffect, useState } from 'react';
import { playProductionSound, primeProductionAudio, productionSoundEnabled } from '@/lib/production-sounds';
import { Copy, Download, LoaderCircle, Sparkles } from 'lucide-react';
import { listingWarnings, normalizeListing, type EtsyListingDraft } from '@/lib/etsy-listing';
import { auditSeo, type AiSeoReview } from '@/lib/seo-intelligence';

export type SavedSeoReview = AiSeoReview & { sourceFingerprint: string; reviewedAt: number };
type Project = { id: string; name: string; theme: string; characters: Array<{ status: string; imageUrl?: string }>; listing?: EtsyListingDraft; seoReview?: SavedSeoReview };
type Props = { project: Project; onChange: (draft: EtsyListingDraft) => void; onSave: () => Promise<void>; onSeoReview: (review: SavedSeoReview) => Promise<void>; onDownloaded: (receipt: { lastDownloadedAt: number; downloadCount: number; lastDownloadImageCount: number; downloadedImageIds: string[] }) => void; seoProvider: 'openai' | 'gemini'; seoGeminiModel: string; seoTitleMaxLength: number; seoAltTextCount: number };
const download = (name: string, body: string, mime: string) => { const url = URL.createObjectURL(new Blob([body], { type: mime })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); };
const slug = (s: string) => (s || 'paletteiq').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);

type SeoDone = { projectId: string; draft?: EtsyListingDraft; error?: string };
const activeSeoRuns = new Map<string, Promise<EtsyListingDraft>>();
const completedSeoDrafts = new Map<string, EtsyListingDraft>();
const SEO_DONE_EVENT = 'paletteiq:seo-draft-completed';
function notifySeoFinished(projectName: string, success: boolean) {
  if (productionSoundEnabled()) playProductionSound(success ? 'completed' : 'error');
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try { new Notification('paletteIQ SEO Draft', { body: success ? `SEO draft ready: ${projectName}` : `SEO draft failed: ${projectName}` }); } catch { /* Browser notifications are optional. */ }
  }
}

export default function EtsyListingDraft({ project, onChange, onSave, onSeoReview, onDownloaded, seoProvider, seoGeminiModel }: Props) {
  const [working, setWorking] = useState(() => activeSeoRuns.has(project.id));
  const [modelChoice, setModelChoice] = useState<{ defaultModel: string; selected: string } | null>(null);
  const selectedGeminiModel = modelChoice?.defaultModel === seoGeminiModel ? modelChoice.selected : seoGeminiModel;
  const [geminiModels, setGeminiModels] = useState<Array<{ id: string; name: string }>>([]);
  const [geminiModelsError, setGeminiModelsError] = useState('');
  const [geminiModelsLoaded, setGeminiModelsLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/settings?models=gemini', { cache: 'no-store' });
        const data = await response.json() as { models?: Array<{ id: string; name: string }>; error?: string };
        if (!response.ok) throw new Error(data.error || 'Unable to load Gemini models');
        if (!cancelled) { setGeminiModels(data.models || []); setGeminiModelsLoaded(true); setGeminiModelsError(''); }
      } catch (error) { if (!cancelled) setGeminiModelsError(error instanceof Error ? error.message : String(error)); }
    })();
    return () => { cancelled = true; };
  }, []);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setWorking(activeSeoRuns.has(project.id));
      const completed = completedSeoDrafts.get(project.id);
      if (completed) {
        completedSeoDrafts.delete(project.id);
        onChange(normalizeListing(completed));
        setNotice('SEO draft completed while you were away and was saved.');
      }
    });
    const onDone = (event: Event) => {
      const detail = (event as CustomEvent<SeoDone>).detail;
      if (detail.projectId !== project.id) return;
      setWorking(false);
      if (detail.draft) { completedSeoDrafts.delete(project.id); onChange(normalizeListing(detail.draft)); setNotice('SEO draft completed and saved to this collection.'); }
      else setNotice(detail.error || 'SEO draft failed.');
    };
    window.addEventListener(SEO_DONE_EVENT, onDone);
    return () => { cancelled = true; window.removeEventListener(SEO_DONE_EVENT, onDone); };
  }, [project.id, onChange]);
  const [exporting, setExporting] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const draft = project.listing ?? normalizeListing({});
  const audit = auditSeo(draft);
  const fingerprint = JSON.stringify({ title: draft.title, description: draft.description, tags: draft.tags, primaryKeyword: draft.primaryKeyword });
  const review = project.seoReview;
  const staleReview = !!review && review.sourceFingerprint !== fingerprint;
  const edit = (fields: Partial<EtsyListingDraft>) => onChange({ ...draft, ...fields });
  const listEdit = (key: 'secondaryKeywords' | 'longTailKeywords' | 'materials' | 'photoPlan' | 'digitalFiles', value: string) => edit({ [key]: value.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 30) });
  const produced = project.characters.filter(c => c.status === 'done').length;
  const warnings = listingWarnings(draft, produced);
  const generate = async () => {
    if (activeSeoRuns.has(project.id)) { setNotice('SEO generation is already running for this collection.'); return; }
    if (seoProvider === 'gemini' && geminiModelsLoaded && !geminiModels.some(model => model.id === selectedGeminiModel)) { setNotice('Choose an available Gemini SEO model before generating.'); return; }
    setWorking(true); setNotice('');
    primeProductionAudio();
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission().catch(() => {});
    }
    try {
      await onSave();
      const projectId = project.id;
      const projectName = project.name;
      const task = (async (): Promise<EtsyListingDraft> => {
        const res = await fetch('/api/studio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'listing-draft', project, seoWarnings: audit.checks.filter(check => !check.passed).map(check => check.fix).slice(0, 10), seoGeminiModel: selectedGeminiModel }) });
        const result = await res.json() as { draft?: EtsyListingDraft; error?: string };
        if (!res.ok || !result.draft) throw new Error(result.error || 'Unable to generate listing');
        return result.draft;
      })();
      activeSeoRuns.set(projectId, task);
      void task.then(draft => {
        completedSeoDrafts.set(projectId, draft);
        notifySeoFinished(projectName, true);
        window.dispatchEvent(new CustomEvent<SeoDone>(SEO_DONE_EVENT, { detail: { projectId, draft } }));
      }).catch(error => {
        notifySeoFinished(projectName, false);
        window.dispatchEvent(new CustomEvent<SeoDone>(SEO_DONE_EVENT, { detail: { projectId, error: error instanceof Error ? error.message : String(error) } }));
      }).finally(() => { activeSeoRuns.delete(projectId); });
      setNotice('SEO generation started. You can switch sections; completion will be saved and notified.');
    } catch (error) {
      setWorking(false);
      setNotice(error instanceof Error ? error.message : 'Unable to start SEO generation');
    }
  };
  const copy = async (text: string) => { await navigator.clipboard.writeText(text); setNotice('Copied to clipboard.'); };
  const reviewWithAi = async () => {
    if (seoProvider === 'gemini' && geminiModelsLoaded && !geminiModels.some(model => model.id === selectedGeminiModel)) { setNotice('Choose an available Gemini SEO model before analyzing.'); return; }
    setReviewing(true); setNotice('');
    try {
      await onSave();
      const response = await fetch('/api/studio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'seo-review', projectId: project.id, draft, seoGeminiModel: seoProvider === 'gemini' ? selectedGeminiModel : undefined }) });
      const data = await response.json() as { review?: AiSeoReview; error?: string };
      if (!response.ok || !data.review) throw new Error(data.error || 'AI SEO review failed');
      await onSeoReview({ ...data.review, sourceFingerprint: fingerprint, reviewedAt: Date.now() });
      setNotice('AI SEO suggestions saved. Review before applying. No search-demand statistics are claimed.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Review failed'); } finally { setReviewing(false); }
  };
  const exportPackage = async () => {
    setExporting(true); setNotice('Saving listing draft and preparing collection ZIP…');
    try {
      await onSave();
      const response = await fetch('/api/exports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: project.id, scope: 'package' }) });
      if (!response.ok) throw new Error(((await response.json()) as { error?: string }).error || 'Export failed');
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `${slug(project.name)}-etsy-package.zip`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
      try {
        const receiptResponse = await fetch('/api/studio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'mark-download', projectId: project.id, scope: 'package' }) });
        const receipt = await receiptResponse.json() as { lastDownloadedAt?: number; downloadCount?: number; lastDownloadImageCount?: number; downloadedImageIds?: string[]; error?: string };
        if (!receiptResponse.ok || !receipt.lastDownloadedAt || typeof receipt.downloadCount !== 'number' || typeof receipt.lastDownloadImageCount !== 'number' || !Array.isArray(receipt.downloadedImageIds)) throw new Error(receipt.error || 'Download receipt was not saved');
        onDownloaded({ lastDownloadedAt: receipt.lastDownloadedAt, downloadCount: receipt.downloadCount, lastDownloadImageCount: receipt.lastDownloadImageCount, downloadedImageIds: receipt.downloadedImageIds });
        setNotice(`Collection ZIP downloaded: ${receipt.lastDownloadImageCount} images. Download history saved.`);
      } catch (error) { setNotice(`ZIP downloaded, but history could not be saved: ${error instanceof Error ? error.message : String(error)}`); }
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Export failed'); } finally { setExporting(false); }
  };
  const formatted = () => `TITLE\n${draft.title}\n\nDESCRIPTION\n${draft.description}\n\nTAGS\n${draft.tags.join(', ')}\n\nPRIMARY KEYWORD\n${draft.primaryKeyword}\n\nSECONDARY KEYWORDS\n${draft.secondaryKeywords.join(', ')}\n\nLONG-TAIL KEYWORDS\n${draft.longTailKeywords.join(', ')}\n\nCATEGORY SUGGESTION\n${draft.categorySuggestion}\n\nATTRIBUTES\n${JSON.stringify(draft.attributes, null, 2)}\n\nMATERIALS\n${draft.materials.join(', ')}\n\nIMAGE ALT TEXT\n${draft.imageAltTexts.join('\n')}\n\nPHOTO PLAN\n${draft.photoPlan.join('\n')}\n\nPRICE SUGGESTION\n${draft.priceSuggestion}\n\nSKU\n${draft.sku}\n\nDIGITAL FILES\n${draft.digitalFiles.join('\n')}\n\nLICENSE NOTES\n${draft.licenseNotes}`;
  return <div className="listing-workspace">
    <div className="panel listing-model-panel"><div className="listing-provider-status"><strong>IMAGE ALT TEXT MODEL</strong><span>Gemini</span></div><label className="input-label" htmlFor="listing-gemini-model">GEMINI MODEL</label><select id="listing-gemini-model" value={selectedGeminiModel} disabled={working || reviewing} onChange={event => setModelChoice({ defaultModel: seoGeminiModel, selected: event.target.value })}>{!geminiModelsLoaded && <option value={selectedGeminiModel}>{selectedGeminiModel} (loading saved selection)</option>}{geminiModelsLoaded && !geminiModels.some(model => model.id === selectedGeminiModel) && <option value={selectedGeminiModel} disabled>Select a supported Gemini model</option>}{geminiModels.map(model => <option key={model.id} value={model.id}>{model.name} ({model.id})</option>)}</select>{geminiModelsError && <p className="sub" role="alert">{geminiModelsError}</p>}<p className="sub">Generate one detailed English image alt text (target 470–500 characters) with Gemini. Title, description and tags come from your Etsy reference URL. SEO analysis uses the review provider selected in Settings.</p></div>
    <div className="panel listing-hero"><div><h2>Etsy Listing Draft Studio</h2><p>Title, description and tags are imported from the reference Etsy listing; review and rewrite them before publishing. Gemini generates one image alt text. Nothing is published automatically.</p></div><button className="primary-btn" disabled={working} onClick={generate}>{working ? <LoaderCircle size={16} className="spin"/> : <Sparkles size={16}/>} {draft.title ? 'Regenerate SEO draft' : 'Generate complete SEO draft'}</button></div>
    {draft.title && audit.checks.some(check => !check.passed) && <div className="panel"><p className="sub">SEO has {audit.checks.filter(check => !check.passed).length} warning(s). You can regenerate a revised draft that addresses these checks. Review the result before publishing.</p><button className="outline-btn" type="button" disabled={working} onClick={generate}>Regenerate to address SEO warnings</button></div>}
    {notice && <div className="panel listing-notice" style={{ color: /failed|error|unable|invalid/i.test(notice) ? '#b42318' : '#1769c2' }}>{notice}</div>}
    <section className="panel seo-intelligence"><div className="seo-intelligence-head"><div><h2>Advanced SEO Intelligence</h2><p className="sub">Editorial draft-readiness checks — not Etsy ranking, traffic, or sales predictions.</p></div><div className="seo-score"><strong>{audit.score}<small>/100</small></strong><span>{audit.passed}/{audit.total} checks</span></div></div><div className="progress"><i style={{ width: `${audit.score}%` }}/></div><div className="seo-check-grid">{audit.checks.map(check => <div key={check.id} className={`seo-check ${check.passed ? 'passed' : 'missing'}`}><b>{check.passed ? '✓' : '!' } {check.label}</b>{!check.passed && <small>{check.fix}</small>}</div>)}</div><button className="primary-btn" disabled={reviewing || !draft.title.trim()} onClick={() => void reviewWithAi()}>{reviewing ? <LoaderCircle size={15} className="spin"/> : <Sparkles size={15}/>} {reviewing ? 'Reviewing with ' + (seoProvider === 'gemini' ? 'Gemini' : 'OpenAI') + '…' : 'Analyze SEO with ' + (seoProvider === 'gemini' ? 'Gemini' : 'OpenAI')}</button>{review && <div className="seo-review"><p className="sub">AI review {new Date(review.reviewedAt).toLocaleString()}{staleReview ? ' · Draft changed since analysis — rerun recommended' : ''}</p><p>{review.summary}</p><h3>Alternative titles</h3><div className="seo-suggestions">{review.titleAlternatives.map((title,i) => <button className="outline-btn" key={i} onClick={() => edit({ title })}>{title} <span>Apply</span></button>)}</div><h3>Suggested tags</h3><div className="seo-tag-suggestions">{review.suggestedTags.map((tag,i) => <span key={i}>{tag}</span>)}</div><button className="outline-btn" onClick={() => edit({ tags: review.suggestedTags })}>Use suggested tags</button><h3>Suggested description opening</h3><p>{review.descriptionOpening}</p><button className="outline-btn" onClick={() => edit({ description: `${review.descriptionOpening}\n\n${draft.description}` })}>Prepend opening</button><h3>Keyword gaps</h3><p>{review.keywordGaps.join(' · ') || 'No specific gaps suggested.'}</p><h3>Potential buyers</h3><p>{review.targetBuyers.join(' · ')}</p><h3>Claims to verify</h3><ul>{review.risks.map((risk,i) => <li key={i}>{risk}</li>)}</ul></div>}</section>
    <div className="listing-grid"><section className="panel"><h2>Listing copy</h2><p className="sub">Natural keyword-rich copy for an English-language digital listing.</p>
      <label className="input-label">TITLE · {draft.title.length}/140 CHARACTERS</label><textarea rows={3} maxLength={140} value={draft.title} onChange={e => edit({ title: e.target.value })}/><button className="outline-btn listing-copy" onClick={() => copy(draft.title)}><Copy size={14}/> Copy title</button>
      <label className="input-label">DESCRIPTION</label><textarea rows={16} value={draft.description} onChange={e => edit({ description: e.target.value })}/><button className="outline-btn listing-copy" onClick={() => copy(draft.description)}><Copy size={14}/> Copy description</button>
      <label className="input-label">TAGS · {draft.tags.length}/13 · MAX 20 CHARACTERS EACH</label><div className="listing-tags">{Array.from({ length: 13 }, (_, i) => <input key={i} maxLength={20} aria-label={`Etsy tag ${i + 1}`} placeholder={`Tag ${i + 1}`} value={draft.tags[i] ?? ''} onChange={e => { const next = Array.from({length: 13}, (_, n) => n === i ? e.target.value : draft.tags[n] ?? ''); edit({ tags: next }); }}/>)}</div><button className="outline-btn listing-copy" onClick={() => copy(draft.tags.filter(Boolean).join(', '))}><Copy size={14}/> Copy tags</button>
    </section><section className="panel"><h2>SEO research & listing details</h2><p className="sub">Suggestions must be checked against actual files and Etsy category options.</p>
      {([['PRIMARY KEYWORD','primaryKeyword'],['CATEGORY SUGGESTION','categorySuggestion'],['PRICE ESTIMATE','priceSuggestion'],['SKU','sku'],['LICENSE NOTES','licenseNotes']] as const).map(([label,key]) => <div key={key}><label className="input-label">{label}</label><input value={draft[key]} onChange={e => edit({ [key]: e.target.value })}/></div>)}
      <label className="input-label">ATTRIBUTES</label><div className="listing-fields">{(Object.keys(draft.attributes) as Array<keyof EtsyListingDraft['attributes']>).map(key => <div key={key}><label className="input-label">{key.replace(/([A-Z])/g,' $1').toUpperCase()}</label><input value={draft.attributes[key]} onChange={e => edit({ attributes: { ...draft.attributes, [key]: e.target.value } })}/></div>)}</div>
      {([['SECONDARY KEYWORDS','secondaryKeywords'],['LONG-TAIL KEYWORDS','longTailKeywords'],['MATERIALS','materials'],['DIGITAL FILE PLAN','digitalFiles'],['LISTING PHOTO PLAN','photoPlan'],['IMAGE ALT TEXT','imageAltTexts']] as const).map(([label,key]) => <div key={key}><label className="input-label">{label} <span>{key === 'imageAltTexts' ? `${draft.imageAltTexts.length}/1 item · max 500 characters` : 'one per line'}</span></label><textarea rows={3} value={draft[key].join('\n')} onChange={e => key === 'imageAltTexts' ? edit({ imageAltTexts: [e.target.value.slice(0, 500)] }) : listEdit(key, e.target.value)}/></div>)}
    </section></div>
    <div className="panel listing-bottom"><div><h2>Draft readiness</h2><p className="sub">{warnings.length} review items · {produced} generated character images</p><ul>{warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></div><div className="listing-actions"><button className="primary-btn" onClick={async () => { try { await onSave(); setNotice('Collection and listing draft saved.'); } catch (e) { setNotice(String(e)); } }}>Save collection</button><button className="outline-btn" onClick={() => download(`${slug(project.name)}-etsy-listing.json`, JSON.stringify({ projectId: project.id, draft, review: warnings }, null, 2), 'application/json')}><Download size={15}/> Export JSON</button><button className="outline-btn" onClick={() => download(`${slug(project.name)}-etsy-listing.txt`, formatted(), 'text/plain')}><Download size={15}/> Export TXT</button><button className="primary-btn" disabled={exporting || !project.characters.some(c => c.imageUrl)} onClick={() => void exportPackage()}><Download size={15}/>{exporting ? 'Preparing ZIP…' : 'Download images + listing ZIP'}</button></div></div>
  </div>;
}
