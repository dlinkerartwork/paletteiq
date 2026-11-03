'use client';

import { useState } from 'react';
import { Copy, Download, LoaderCircle, Sparkles } from 'lucide-react';
import { listingWarnings, normalizeListing, type EtsyListingDraft } from '@/lib/etsy-listing';

type Project = { id: string; name: string; theme: string; characters: Array<{ status: string }>; listing?: EtsyListingDraft };
type Props = { project: Project; onChange: (draft: EtsyListingDraft) => void; onSave: () => Promise<void> };
const download = (name: string, body: string, mime: string) => { const url = URL.createObjectURL(new Blob([body], { type: mime })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); };
const slug = (s: string) => (s || 'paletteiq').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);

export default function EtsyListingDraft({ project, onChange, onSave }: Props) {
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState('');
  const draft = project.listing ?? normalizeListing({});
  const edit = (fields: Partial<EtsyListingDraft>) => onChange({ ...draft, ...fields });
  const listEdit = (key: 'secondaryKeywords' | 'longTailKeywords' | 'materials' | 'imageAltTexts' | 'photoPlan' | 'digitalFiles', value: string) => edit({ [key]: value.split('\n').map(x => x.trim()).filter(Boolean) });
  const produced = project.characters.filter(c => c.status === 'done').length;
  const warnings = listingWarnings(draft, produced);
  const generate = async () => {
    setWorking(true); setNotice('');
    try {
      const res = await fetch('/api/studio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'listing-draft', project }) });
      const result = await res.json() as { draft?: EtsyListingDraft; error?: string };
      if (!res.ok || !result.draft) throw new Error(result.error || 'Unable to generate listing');
      onChange(normalizeListing(result.draft)); setNotice('AI draft ready. Review details and save the collection.');
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Generation failed'); } finally { setWorking(false); }
  };
  const copy = async (text: string) => { await navigator.clipboard.writeText(text); setNotice('Copied to clipboard.'); };
  const formatted = () => `TITLE\n${draft.title}\n\nDESCRIPTION\n${draft.description}\n\nTAGS\n${draft.tags.join(', ')}\n\nPRIMARY KEYWORD\n${draft.primaryKeyword}\n\nSECONDARY KEYWORDS\n${draft.secondaryKeywords.join(', ')}\n\nLONG-TAIL KEYWORDS\n${draft.longTailKeywords.join(', ')}\n\nCATEGORY SUGGESTION\n${draft.categorySuggestion}\n\nATTRIBUTES\n${JSON.stringify(draft.attributes, null, 2)}\n\nMATERIALS\n${draft.materials.join(', ')}\n\nIMAGE ALT TEXT\n${draft.imageAltTexts.join('\n')}\n\nPHOTO PLAN\n${draft.photoPlan.join('\n')}\n\nPRICE SUGGESTION\n${draft.priceSuggestion}\n\nSKU\n${draft.sku}\n\nDIGITAL FILES\n${draft.digitalFiles.join('\n')}\n\nLICENSE NOTES\n${draft.licenseNotes}`;
  return <div className="listing-workspace">
    <div className="panel listing-hero"><div><h2>Etsy Listing Draft Studio</h2><p>Original SEO package based on this collection. Editable and saved in your collection JSON. No listing will be published to Etsy.</p></div><button className="primary-btn" disabled={working} onClick={generate}>{working ? <LoaderCircle size={16} className="spin"/> : <Sparkles size={16}/>} {draft.title ? 'Regenerate SEO draft' : 'Generate complete SEO draft'}</button></div>
    {notice && <div className="panel listing-notice">{notice}</div>}
    <div className="listing-grid"><section className="panel"><h2>Listing copy</h2><p className="sub">Natural keyword-rich copy for an English-language digital listing.</p>
      <label className="input-label">TITLE · {draft.title.length}/140 CHARACTERS</label><textarea rows={3} maxLength={140} value={draft.title} onChange={e => edit({ title: e.target.value })}/><button className="outline-btn listing-copy" onClick={() => copy(draft.title)}><Copy size={14}/> Copy title</button>
      <label className="input-label">DESCRIPTION</label><textarea rows={16} value={draft.description} onChange={e => edit({ description: e.target.value })}/><button className="outline-btn listing-copy" onClick={() => copy(draft.description)}><Copy size={14}/> Copy description</button>
      <label className="input-label">TAGS · {draft.tags.length}/13 · MAX 20 CHARACTERS EACH</label><div className="listing-tags">{Array.from({ length: 13 }, (_, i) => <input key={i} maxLength={20} aria-label={`Etsy tag ${i + 1}`} placeholder={`Tag ${i + 1}`} value={draft.tags[i] ?? ''} onChange={e => { const next = Array.from({length: 13}, (_, n) => n === i ? e.target.value : draft.tags[n] ?? ''); edit({ tags: next }); }}/>)}</div><button className="outline-btn listing-copy" onClick={() => copy(draft.tags.filter(Boolean).join(', '))}><Copy size={14}/> Copy tags</button>
    </section><section className="panel"><h2>SEO research & listing details</h2><p className="sub">Suggestions must be checked against actual files and Etsy category options.</p>
      {([['PRIMARY KEYWORD','primaryKeyword'],['CATEGORY SUGGESTION','categorySuggestion'],['PRICE ESTIMATE','priceSuggestion'],['SKU','sku'],['LICENSE NOTES','licenseNotes']] as const).map(([label,key]) => <div key={key}><label className="input-label">{label}</label><input value={draft[key]} onChange={e => edit({ [key]: e.target.value })}/></div>)}
      <label className="input-label">ATTRIBUTES</label><div className="listing-fields">{(Object.keys(draft.attributes) as Array<keyof EtsyListingDraft['attributes']>).map(key => <div key={key}><label className="input-label">{key.replace(/([A-Z])/g,' $1').toUpperCase()}</label><input value={draft.attributes[key]} onChange={e => edit({ attributes: { ...draft.attributes, [key]: e.target.value } })}/></div>)}</div>
      {([['SECONDARY KEYWORDS','secondaryKeywords'],['LONG-TAIL KEYWORDS','longTailKeywords'],['MATERIALS','materials'],['DIGITAL FILE PLAN','digitalFiles'],['LISTING PHOTO PLAN','photoPlan'],['IMAGE ALT TEXT','imageAltTexts']] as const).map(([label,key]) => <div key={key}><label className="input-label">{label} <span>one per line</span></label><textarea rows={3} value={draft[key].join('\n')} onChange={e => listEdit(key, e.target.value)}/></div>)}
    </section></div>
    <div className="panel listing-bottom"><div><h2>Draft readiness</h2><p className="sub">{warnings.length} review items · {produced} generated character images</p><ul>{warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></div><div className="listing-actions"><button className="primary-btn" onClick={async () => { await onSave(); setNotice('Save attempted. Check the save notification above.'); }}>Save collection</button><button className="outline-btn" onClick={() => download(`${slug(project.name)}-etsy-listing.json`, JSON.stringify({ projectId: project.id, draft, review: warnings }, null, 2), 'application/json')}><Download size={15}/> Export JSON</button><button className="outline-btn" onClick={() => download(`${slug(project.name)}-etsy-listing.txt`, formatted(), 'text/plain')}><Download size={15}/> Export TXT</button></div></div>
  </div>;
}
