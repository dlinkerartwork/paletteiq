'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, CloudDownload, CloudUpload, Eye, EyeOff, KeyRound, LockKeyhole, Save, Settings2, ShieldCheck, Trash2 } from 'lucide-react';

export type SeoPromptKey = 'general' | 'title' | 'description' | 'tags' | 'primaryKeyword' | 'secondaryKeywords' | 'longTailKeywords' | 'categorySuggestion' | 'attributes' | 'materials' | 'imageAltTexts' | 'photoPlan' | 'priceSuggestion' | 'sku' | 'digitalFiles' | 'licenseNotes';
export type SeoPromptSettings = Record<SeoPromptKey, string>;
export const defaultSeoPrompts: SeoPromptSettings = { general: '', title: '', description: '', tags: '', primaryKeyword: '', secondaryKeywords: '', longTailKeywords: '', categorySuggestion: '', attributes: '', materials: '', imageAltTexts: '', photoPlan: '', priceSuggestion: '', sku: '', digitalFiles: '', licenseNotes: '' };

export type StudioPreferences = {
  target: number; model: string; quality: string; analysisModel: string; output: string; background: string; variations: number; defaultStyle: string; autoSave: boolean; seoPrompts: SeoPromptSettings;
};
export const defaultPrefs: StudioPreferences = { target: 120, model: 'gpt-image-1-mini', quality: 'low', analysisModel: 'gpt-4.1-mini', output: 'png', background: 'transparent', variations: 1, defaultStyle: 'Soft hand-painted watercolor illustration', autoSave: false, seoPrompts: { ...defaultSeoPrompts } };
type Props = { preferences: StudioPreferences; onPreferences: (prefs: StudioPreferences) => void; projects: unknown[]; onImport: (data: { projects: unknown[]; preferences: StudioPreferences }) => Promise<void> };
const request = async (body: object): Promise<any> => { const res = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const data: any = await res.json(); if (!res.ok) throw new Error(data.error || 'Request failed'); return data; };

export default function StudioSettings({ preferences, onPreferences, projects, onImport }: Props) {
  const [credentials, setCredentials] = useState({ etsy: false, openai: false });
  const [secrets, setSecrets] = useState({ etsy: '', openai: '' });
  const [visible, setVisible] = useState({ etsy: false, openai: false });
  const [active, setActive] = useState('');
  const [message, setMessage] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => { fetch('/api/settings').then(r => r.json()).then((data: any) => { if (data.credentials) setCredentials(data.credentials); }).catch(() => {}); }, []);
  const edit = (key: keyof StudioPreferences, value: string | number | boolean) => onPreferences({ ...preferences, [key]: value });
  const act = async (action: string, op: () => Promise<unknown>) => { setActive(action); setMessage(''); try { await op(); setMessage('Saved successfully.'); } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); } finally { setActive(''); } };
  const saveKey = (provider: 'etsy' | 'openai', remove = false) => act(provider, async () => { const response = await request({ action: 'credential', provider, ...(remove ? { remove: true } : { key: secrets[provider] }) }); setCredentials(response.credentials); setSecrets(s => ({ ...s, [provider]: '' })); });
  const backup = () => { const payload = { format: 'paletteiq-backup', version: 1, exportedAt: new Date().toISOString(), preferences, projects }; const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }); const href = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = href; a.download = `paletteiq-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(href), 1000); setMessage('JSON backup downloaded. API keys are excluded.'); };
  const importBackup = async (file: File | undefined) => { if (!file) return; if (file.size > 10_000_000) { setMessage('Backup file exceeds 10 MB.'); return; } await act('import', async () => { const parsed = JSON.parse(await file.text()); if (parsed.format !== 'paletteiq-backup' || parsed.version !== 1 || !Array.isArray(parsed.projects) || typeof parsed.preferences !== 'object' || !parsed.preferences) throw new Error('Invalid paletteIQ backup format'); if (parsed.projects.length > 500) throw new Error('Backup has too many collections'); await onImport({ projects: parsed.projects, preferences: parsed.preferences }); }); if (picker.current) picker.current.value = ''; };
  const seoFields: Array<[SeoPromptKey, string, string]> = [
    ['general', 'Global SEO instructions', 'Rules applied to the entire Etsy listing.'],
    ['title', 'Title', 'Tone, keyword placement and title structure.'],
    ['description', 'Description', 'Opening keyword, section order and buyer-friendly details.'],
    ['tags', 'Tags', 'Tag phrasing and diversity.'],
    ['primaryKeyword', 'Primary keyword', 'Most relevant central search phrase.'],
    ['secondaryKeywords', 'Secondary keywords', 'Supporting relevant keyword phrases.'],
    ['longTailKeywords', 'Long-tail keywords', 'Specific buyer-intent phrases.'],
    ['categorySuggestion', 'Category suggestion', 'Desired category direction; verify Etsy taxonomy.'],
    ['attributes', 'Attributes', 'Occasion, recipient, color and style guidance.'],
    ['materials', 'Materials', 'Only truthful materials or digital-product terms.'],
    ['imageAltTexts', 'Image alt texts', 'Accessible, accurate image descriptions.'],
    ['photoPlan', 'Photo plan', 'Listing preview/mockup recommendations.'],
    ['priceSuggestion', 'Price suggestion', 'Pricing assumptions and disclaimer.'],
    ['sku', 'SKU', 'Naming scheme or SKU convention.'],
    ['digitalFiles', 'Digital files', 'File plan; do not invent specs.'],
    ['licenseNotes', 'License notes', 'License wording; do not invent rights.'],
  ];
  return <div className="settings-layout">
    {message && <div className="notice"><ShieldCheck size={17}/>{message}</div>}
    <section className="panel settings-panel settings-wide settings-credentials"><div className="settings-header"><div className="heading-icon amber"><KeyRound size={21}/></div><div><h2>API credentials</h2><p>Keep your credentials private. Stored encrypted on the server and never included in JSON exports.</p></div></div>
      {([{ id: 'openai', label: 'OpenAI API key', hint: 'Required for AI analysis, character expansion and image generation.', placeholder: 'sk-...' }, { id: 'etsy', label: 'Etsy API credential', hint: 'Enter the Etsy keystring and shared secret separated by a colon.', placeholder: 'keystring:shared_secret' }] as const).map(c => <div className="secret-row" key={c.id}><div className="secret-heading"><div><b>{c.label}</b><p>{c.hint}</p></div><span className={`credential-status ${credentials[c.id] ? 'connected' : ''}`}>{credentials[c.id] ? <><CheckCircle2 size={13}/> Saved</> : 'Not configured'}</span></div><div className="secret-input"><input autoComplete="off" type={visible[c.id] ? 'text' : 'password'} value={secrets[c.id]} placeholder={credentials[c.id] ? '•••••••••••• (replace existing key)' : c.placeholder} onChange={e => setSecrets(s => ({ ...s, [c.id]: e.target.value }))}/><button aria-label={visible[c.id] ? 'Hide key' : 'Show key'} onClick={() => setVisible(v => ({ ...v, [c.id]: !v[c.id] }))}>{visible[c.id] ? <EyeOff size={17}/> : <Eye size={17}/>}</button><button className="primary-btn" disabled={!secrets[c.id] || Boolean(active)} onClick={() => saveKey(c.id)}><Save size={15}/> {active === c.id ? 'Saving…' : 'Save key'}</button>{credentials[c.id] && <button className="outline-btn danger-btn" disabled={Boolean(active)} onClick={() => saveKey(c.id, true)} title="Remove stored key"><Trash2 size={15}/></button>}</div></div>)}
      <div className="security-note"><LockKeyhole size={16}/><span>API keys are encrypted with a server-held encryption key. Stored keys are never sent back to the browser. Your backup intentionally excludes credentials.</span></div>
    </section>



    <section className="panel settings-panel settings-production"><div className="settings-header"><div className="heading-icon violet"><Settings2 size={21}/></div><div><h2>Production defaults</h2><p>Applied when opening the studio and creating new collections.</p></div></div><div className="settings-fields">
      <div><label className="input-label">TARGET CHARACTERS</label><input type="number" min={1} max={1000} value={preferences.target} onChange={e => edit('target', Number(e.target.value))}/></div>
      <div><label className="input-label">VARIATIONS (RESERVED FOR BULK QUEUE)</label><input type="number" min={1} max={8} value={preferences.variations} onChange={e => edit('variations', Number(e.target.value))}/></div>
      <div><label className="input-label">IMAGE GENERATION MODEL</label><select value={preferences.model} onChange={e => edit('model', e.target.value)}><option value="gpt-image-1-mini">GPT Image 1 Mini</option><option value="gpt-image-1">GPT Image 1</option><option value="gpt-image-1.5">GPT Image 1.5</option><option value="gpt-image-2.5-flare">GPT Image 2.5 Flare</option><option value="gpt-image-2.5-sunburst">GPT Image 2.5 Sunburst</option></select></div>
      <div><label className="input-label">DEFAULT IMAGE QUALITY</label><select value={preferences.quality} onChange={e => edit('quality', e.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
      <div><label className="input-label">IMAGE FILE FORMAT</label><select value={preferences.output} onChange={e => edit('output', e.target.value)}><option value="png">PNG</option><option value="jpg">JPG</option></select></div>
      <div><label className="input-label">BACKGROUND</label><select value={preferences.background} onChange={e => edit('background', e.target.value)}><option value="transparent">Transparent</option><option value="opaque">Opaque</option></select></div>
      <div className="full"><label className="input-label">DEFAULT VISUAL STYLE</label><textarea rows={3} value={preferences.defaultStyle} onChange={e => edit('defaultStyle', e.target.value)} /></div>
    </div><div className="settings-actions"><button className="primary-btn" disabled={Boolean(active)} onClick={() => act('preferences', async () => { if (preferences.output === 'jpg' && preferences.background === 'transparent') throw new Error('JPG requires an opaque background. Choose PNG for transparency.'); await request({ action: 'preferences', preferences }); })}><Save size={16}/> {active === 'preferences' ? 'Saving…' : 'Save preferences'}</button></div></section>

    <section className="panel settings-panel settings-backup"><div className="settings-header"><div className="heading-icon amber"><CloudDownload size={21}/></div><div><h2>JSON backup & restore</h2><p>Portable backup for all collections, subjects, prompts and non-secret settings.</p></div></div><div className="backup-actions"><button className="outline-btn" onClick={backup}><CloudDownload size={17}/> Export all data (.json)</button><button className="outline-btn" disabled={Boolean(active)} onClick={() => picker.current?.click()}><CloudUpload size={17}/> Import JSON backup</button><input hidden ref={picker} type="file" accept="application/json,.json" onChange={e => void importBackup(e.target.files?.[0])}/></div><p className="backup-footnote">Import updates matching collection IDs and adds new collections. Generated image URLs remain linked to their original account and Site; image binaries are not embedded. Secrets are never exported or imported.</p></section>

    <section className="panel settings-panel settings-wide settings-seo"><div className="settings-header"><div className="heading-icon violet"><Settings2 size={21}/></div><div><h2>Custom OpenAI SEO prompts</h2><p>Instructions below are included when generating the Etsy listing draft and running Advanced SEO Intelligence. Leave fields blank to use built-in guidance.</p></div></div>
      <div className="settings-fields">{seoFields.map(([key, label, hint]) => <div className="seo-prompt-field" key={key}><label className="input-label">{label.toUpperCase()}</label><p className="sub">{hint}</p><textarea rows={3} maxLength={2000} placeholder={key === 'description' ? 'Example: Mention the primary keyword naturally in the opening paragraph.' : `Optional custom instructions for ${label.toLowerCase()}…`} value={preferences.seoPrompts?.[key] ?? ''} onChange={e => onPreferences({ ...preferences, seoPrompts: { ...defaultSeoPrompts, ...preferences.seoPrompts, [key]: e.target.value } })}/></div>)}</div>
      <div className="settings-actions"><button className="primary-btn" disabled={Boolean(active)} onClick={() => act('seo-prompts', async () => { await request({ action: 'preferences', preferences }); })}><Save size={16}/> {active === 'seo-prompts' ? 'Saving…' : 'Save SEO prompts'}</button></div>
    </section>


  </div>;
}
