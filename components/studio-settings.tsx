'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, CloudDownload, CloudUpload, Eye, EyeOff, KeyRound, LockKeyhole, Save, Settings2, ShieldCheck, Trash2 } from 'lucide-react';

export type SeoPromptKey = 'general' | 'title' | 'description' | 'tags' | 'primaryKeyword' | 'secondaryKeywords' | 'longTailKeywords' | 'categorySuggestion' | 'attributes' | 'materials' | 'imageAltTexts' | 'photoPlan' | 'priceSuggestion' | 'sku' | 'digitalFiles' | 'licenseNotes';
export type SeoPromptSettings = Record<SeoPromptKey, string>;
export type SeoDraftField = Exclude<SeoPromptKey, 'general'>;
export const seoDraftFieldOrder: SeoDraftField[] = ['title','description','tags','imageAltTexts','primaryKeyword','secondaryKeywords','longTailKeywords','categorySuggestion','attributes','materials','photoPlan','priceSuggestion','sku','digitalFiles','licenseNotes'];
export const defaultSeoDraftFields: SeoDraftField[] = ['title','description','tags','imageAltTexts'];
export const defaultSeoPrompts: SeoPromptSettings = { general: '', title: '', description: '', tags: '', primaryKeyword: '', secondaryKeywords: '', longTailKeywords: '', categorySuggestion: '', attributes: '', materials: '', imageAltTexts: '', photoPlan: '', priceSuggestion: '', sku: '', digitalFiles: '', licenseNotes: '' };

export type StudioPreferences = {
  target: number; model: string; quality: string; analysisModel: string; output: string; background: string; variations: number; defaultStyle: string; autoSave: boolean; seoProvider: 'openai' | 'gemini'; seoGeminiModel: string; seoOpenaiModel: string; seoDraftFields: SeoDraftField[]; seoTitleMaxLength: number; seoAltTextCount: number; seoFileNaming: string; seoPrompts: SeoPromptSettings; upscaleProvider: 'replicate' | 'realesrgan' | 'fal' | 'canva'; upscaleFactor: 2 | 4; upscaleRequireTransparency: boolean; upscaleQc: boolean;
};
export const defaultPrefs: StudioPreferences = { target: 120, model: 'gpt-image-1-mini', quality: 'low', analysisModel: 'gpt-4.1-mini', output: 'png', background: 'transparent', variations: 1, defaultStyle: 'Soft hand-painted watercolor illustration', autoSave: false, seoProvider: 'openai', seoGeminiModel: 'gemini-2.5-pro', seoOpenaiModel: 'gpt-6.1-terra', seoDraftFields: [...defaultSeoDraftFields], seoTitleMaxLength: 120, seoAltTextCount: 1, seoFileNaming: 'charactername_imagenumber', seoPrompts: { ...defaultSeoPrompts }, upscaleProvider: 'canva', upscaleFactor: 4, upscaleRequireTransparency: true, upscaleQc: true };
type Props = { preferences: StudioPreferences; onPreferences: (prefs: StudioPreferences) => void; projects: unknown[]; onImport: (data: { projects: unknown[]; preferences: StudioPreferences }) => Promise<void> };
type SettingsResponse = { error?: string; credentials: { etsy: boolean; openai: boolean; gemini: boolean }; geminiKeyCount?: number };
const readSettingsResponse = async (res: Response): Promise<SettingsResponse> => {
  const raw = await res.text();
  let data: Partial<SettingsResponse> | null = null;
  try { data = raw ? JSON.parse(raw) as Partial<SettingsResponse> : null; } catch { /* Non-JSON error response from server. */ }
  if (!res.ok) throw new Error(data?.error || `Settings server returned HTTP ${res.status}. Check server logs and database migrations.`);
  if (!data || !data.credentials) throw new Error('Settings server returned an empty or invalid response. Check server logs.');
  return data as SettingsResponse;
};
const request = async (body: object): Promise<SettingsResponse> => {
  const res = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return readSettingsResponse(res);
};

export default function StudioSettings({ preferences, onPreferences, projects, onImport }: Props) {
  const [credentials, setCredentials] = useState({ etsy: false, openai: false, gemini: false });
  const [geminiKeyCount, setGeminiKeyCount] = useState(0);
  const [secrets, setSecrets] = useState({ etsy: '', openai: '', gemini: '' });
  const [visible, setVisible] = useState({ etsy: false, openai: false, gemini: false });
  const [active, setActive] = useState('');
  const [message, setMessage] = useState('');
  const [geminiModels, setGeminiModels] = useState<Array<{ id: string; name: string }>>([]);
  const [geminiModelsLoaded, setGeminiModelsLoaded] = useState(false);
  const [openaiSeoModels, setOpenaiSeoModels] = useState<Array<{ id: string; name: string }>>([]);
  const [openaiSeoModelsError, setOpenaiSeoModelsError] = useState('');
  const [openaiImageModels, setOpenaiImageModels] = useState<Array<{ id: string; name: string }>>([]);
  const [openaiModelsError, setOpenaiModelsError] = useState('');
  const [modelsError, setModelsError] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => { fetch('/api/settings').then(readSettingsResponse).then(data => { setCredentials(data.credentials); setGeminiKeyCount(data.geminiKeyCount ?? (data.credentials.gemini ? 1 : 0)); }).catch(e => setMessage(e instanceof Error ? e.message : String(e))); }, []);
  const loadOpenaiSeoModels = async () => {
    try {
      const response = await fetch('/api/settings?models=openai-seo');
      const data = await response.json() as { models?: Array<{ id: string; name: string }>; error?: string };
      if (!response.ok) throw new Error(data.error || 'Unable to fetch OpenAI SEO models');
      setOpenaiSeoModels(data.models || []); setOpenaiSeoModelsError('');
    } catch (error) { setOpenaiSeoModelsError(error instanceof Error ? error.message : String(error)); }
  };
  const loadOpenaiModels = async () => {
    setOpenaiModelsError('');
    try {
      const response = await fetch('/api/settings?models=openai');
      const data = await response.json() as { models?: Array<{ id: string; name: string }>; error?: string };
      if (!response.ok) throw new Error(data.error || 'Unable to fetch OpenAI models');
      setOpenaiImageModels(data.models || []);
    } catch (error) { setOpenaiModelsError(error instanceof Error ? error.message : String(error)); }
  };
    const loadGeminiModels = async () => {
    setModelsError('');
    setGeminiModelsLoaded(false);
    try {
      const response = await fetch('/api/settings?models=gemini');
      const data = await response.json() as { models?: Array<{ id: string; name: string }>; error?: string };
      if (!response.ok) throw new Error(data.error || 'Unable to fetch Gemini models');
      setGeminiModels(data.models || []);
      setGeminiModelsLoaded(true);
    } catch (error) { setModelsError(error instanceof Error ? error.message : String(error)); }
  };
  useEffect(() => { if (credentials.gemini) queueMicrotask(() => void loadGeminiModels()); }, [credentials.gemini]);
  useEffect(() => { if (credentials.openai) queueMicrotask(() => { void loadOpenaiModels(); void loadOpenaiSeoModels(); }); }, [credentials.openai]);
  const edit = (key: keyof StudioPreferences, value: string | number | boolean) => onPreferences({ ...preferences, [key]: value });
  const act = async (action: string, op: () => Promise<unknown>) => { setActive(action); setMessage(''); try { await op(); setMessage('Saved successfully.'); } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); } finally { setActive(''); } };
  const saveKey = (provider: 'etsy' | 'openai' | 'gemini', remove = false) => act(provider, async () => {
    const response = await request(provider === 'gemini' && !remove
      ? { action: 'gemini-key-add', key: secrets.gemini }
      : { action: 'credential', provider, ...(remove ? { remove: true } : { key: secrets[provider] }) });
    setCredentials(response.credentials);
    if (response.geminiKeyCount !== undefined) setGeminiKeyCount(response.geminiKeyCount);
    setSecrets(s => ({ ...s, [provider]: '' }));
  });
  const removeGeminiKey = (index: number) => act('gemini-remove-' + index, async () => {
    const response = await request({ action: 'gemini-key-remove', index });
    setCredentials(response.credentials);
    setGeminiKeyCount(response.geminiKeyCount ?? 0);
  });
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
      {([{ id: 'openai', label: 'OpenAI API key', hint: 'Required for AI analysis, character expansion and image generation.', placeholder: 'sk-...' }, { id: 'gemini', label: 'Google Gemini API key', hint: 'Used only when Gemini is selected for SEO drafting/review.', placeholder: 'Gemini API key' }, { id: 'etsy', label: 'Etsy API credential', hint: 'Enter the Etsy keystring and shared secret separated by a colon.', placeholder: 'keystring:shared_secret' }] as const).map(c => <div className="secret-row" key={c.id}><div className="secret-heading"><div><b>{c.label}</b><p>{c.hint}</p></div><span className={`credential-status ${credentials[c.id] ? 'connected' : ''}`}>{credentials[c.id] ? <><CheckCircle2 size={13}/> Saved</> : 'Not configured'}</span></div><div className="secret-input"><input autoComplete="off" type={visible[c.id] ? 'text' : 'password'} value={secrets[c.id]} placeholder={c.id === 'gemini' ? 'Add another Gemini API key' : credentials[c.id] ? '•••••••••••• (replace existing key)' : c.placeholder} onChange={e => setSecrets(s => ({ ...s, [c.id]: e.target.value }))}/><button aria-label={visible[c.id] ? 'Hide key' : 'Show key'} onClick={() => setVisible(v => ({ ...v, [c.id]: !v[c.id] }))}>{visible[c.id] ? <EyeOff size={17}/> : <Eye size={17}/>}</button><button className="primary-btn" disabled={!secrets[c.id] || Boolean(active)} onClick={() => saveKey(c.id)}><Save size={15}/> {active === c.id ? 'Saving…' : c.id === 'gemini' ? 'Add key' : 'Save key'}</button>{credentials[c.id] && c.id !== 'gemini' && <button className="outline-btn danger-btn" disabled={Boolean(active)} onClick={() => saveKey(c.id, true)} title="Remove stored key"><Trash2 size={15}/></button>}</div>{c.id === 'gemini' && <div className="sub" style={{ marginTop: 8 }}><p>{geminiKeyCount} Gemini API key(s) configured. Rotation follows the order below on quota exhaustion.</p>{Array.from({ length: geminiKeyCount }, (_, index) => <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}><span>Key {index + 1} · ••••••••</span><button type="button" className="outline-btn" disabled={Boolean(active)} onClick={() => removeGeminiKey(index)}><Trash2 size={14}/> Remove</button></div>)}</div>}</div>)}
      <div className="security-note"><LockKeyhole size={16}/><span>API keys are encrypted with a server-held encryption key. Stored keys are never sent back to the browser. Your backup intentionally excludes credentials.</span></div>
    </section>



    <section className="panel settings-panel settings-production"><div className="settings-header"><div className="heading-icon violet"><Settings2 size={21}/></div><div><h2>Production defaults</h2><p>Applied when opening the studio and creating new collections.</p></div></div><div className="settings-fields">
      <div><label className="input-label">TARGET CHARACTERS</label><input type="number" min={1} max={1000} value={preferences.target} onChange={e => edit('target', Number(e.target.value))}/></div>
      <div><label className="input-label">VARIATIONS (RESERVED FOR BULK QUEUE)</label><input type="number" min={1} max={8} value={preferences.variations} onChange={e => edit('variations', Number(e.target.value))}/></div>
      <div><label className="input-label">IMAGE GENERATION MODEL</label><select value={preferences.model} onChange={e => edit('model', e.target.value)}>{!openaiImageModels.some(m => m.id === preferences.model) && <option value={preferences.model}>{preferences.model} (saved model)</option>}{openaiImageModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select><button type="button" onClick={() => void loadOpenaiModels()}>Refresh OpenAI image models</button><p className="sub">{openaiModelsError || "Models are fetched from OpenAI. Only GPT Image family IDs are shown; transparency requires PNG and model API support."}</p></div>
      <div><label className="input-label">DEFAULT IMAGE QUALITY</label><select value={preferences.quality} onChange={e => edit('quality', e.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
      <div><label className="input-label">IMAGE FILE FORMAT</label><select value={preferences.output} onChange={e => edit('output', e.target.value)}><option value="png">PNG</option><option value="jpg">JPG</option></select></div>
      <div><label className="input-label">BACKGROUND</label><select value={preferences.background} onChange={e => edit('background', e.target.value)}><option value="transparent">Transparent</option><option value="opaque">Opaque</option></select></div>
      <div className="full"><label className="input-label">DEFAULT VISUAL STYLE</label><textarea rows={3} value={preferences.defaultStyle} onChange={e => edit('defaultStyle', e.target.value)} /></div>
    </div><div className="settings-actions"><button className="primary-btn" disabled={Boolean(active)} onClick={() => act('preferences', async () => { if (preferences.output === 'jpg' && preferences.background === 'transparent') throw new Error('JPG requires an opaque background. Choose PNG for transparency.'); await request({ action: 'preferences', preferences }); })}><Save size={16}/> {active === 'preferences' ? 'Saving…' : 'Save preferences'}</button></div></section>

    <section className="panel settings-panel settings-wide">
      <div className="settings-header"><div className="heading-icon violet"><Settings2 size={21}/></div><div><h2>Upscale settings</h2><p>Choose an image upscale workflow. Canva Companion uses the browser extension; Replicate uses your configured cloud token.</p></div></div>
      <div className="settings-fields">
        <div><label className="input-label">UPSCALE PROVIDER</label><select value={preferences.upscaleProvider ?? 'canva'} onChange={e => edit('upscaleProvider', e.target.value)}><option value="replicate">Replicate API — Cloud (requires REPLICATE_API_TOKEN on server)</option><option value="realesrgan" disabled>Real-ESRGAN — Local (coming soon)</option><option value="fal" disabled>Fal.ai — Cloud (coming soon)</option><option value="canva">Canva Companion — Browser</option></select></div>
        <div><label className="input-label">UPSCALE FACTOR</label><select value={preferences.upscaleFactor ?? 4} onChange={e => edit('upscaleFactor', Number(e.target.value))}><option value={2}>2×</option><option value={4}>4×</option></select></div>
        <label className="full"><input type="checkbox" checked={preferences.upscaleRequireTransparency ?? true} onChange={e => edit('upscaleRequireTransparency', e.target.checked)}/> Require transparent PNG when original has transparency</label>
        <label className="full"><input type="checkbox" checked={preferences.upscaleQc ?? true} onChange={e => edit('upscaleQc', e.target.checked)}/> Run automatic quality control after upscale</label>
        <p className="sub full">Replicate's Real-ESRGAN may discard alpha transparency. If transparency is required, incompatible output will be rejected instead of replacing your image. Native Real-ESRGAN and Fal.ai integration are not enabled yet.</p>
      </div>
      <div className="settings-actions"><button className="primary-btn" disabled={Boolean(active)} onClick={() => act('upscale-preferences', async () => { await request({ action: 'preferences', preferences }); })}><Save size={16}/> Save upscale settings</button></div>
    </section>
    <section className="panel settings-panel settings-backup"><div className="settings-header"><div className="heading-icon amber"><CloudDownload size={21}/></div><div><h2>JSON backup & restore</h2><p>Portable backup for all collections, subjects, prompts and non-secret settings.</p></div></div><div className="backup-actions"><button className="outline-btn" onClick={backup}><CloudDownload size={17}/> Export all data (.json)</button><button className="outline-btn" disabled={Boolean(active)} onClick={() => picker.current?.click()}><CloudUpload size={17}/> Import JSON backup</button><input hidden ref={picker} type="file" accept="application/json,.json" onChange={e => void importBackup(e.target.files?.[0])}/></div><p className="backup-footnote">Import updates matching collection IDs and adds new collections. Generated image URLs remain linked to their original account and Site; image binaries are not embedded. Secrets are never exported or imported.</p></section>

    <section className="panel settings-panel settings-wide settings-seo"><div className="settings-header"><div className="heading-icon violet"><Settings2 size={21}/></div><div><h2>SEO generation settings & custom prompts</h2><p>Instructions below are included when generating the Etsy listing draft and running Advanced SEO Intelligence. Leave fields blank to use built-in guidance.</p></div></div>
      <div className="settings-fields seo-generation-options">
        <div><label className="input-label">SEO AI PROVIDER</label><select value={preferences.seoProvider ?? 'openai'} onChange={e => edit('seoProvider', e.target.value)}><option value="openai">OpenAI</option><option value="gemini">Google Gemini</option></select><p className="sub">Selects the provider for SEO Draft generation, image alt text and Advanced SEO review. Etsy API remains the source for title, description and tags.</p></div>
        <div><label className="input-label">OPENAI SEO MODEL</label><select value={preferences.seoOpenaiModel ?? 'gpt-6.1-terra'} onChange={e => edit('seoOpenaiModel', e.target.value)}>{!openaiSeoModels.some(m => m.id === (preferences.seoOpenaiModel ?? 'gpt-6.1-terra')) && <option value={preferences.seoOpenaiModel ?? 'gpt-6.1-terra'}>{preferences.seoOpenaiModel ?? 'gpt-6.1-terra'} (saved/default model)</option>}{openaiSeoModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select><button type="button" onClick={() => void loadOpenaiSeoModels()}>Refresh advanced OpenAI models</button><p className="sub">{openaiSeoModelsError || 'Used when OpenAI is the SEO AI provider.'}</p></div>
        <div><label className="input-label">GEMINI ALT TEXT MODEL</label><select value={preferences.seoGeminiModel ?? 'gemini-2.5-pro'} onChange={e => edit('seoGeminiModel', e.target.value)}>{!geminiModelsLoaded && <option value={preferences.seoGeminiModel ?? 'gemini-2.5-pro'}>{preferences.seoGeminiModel ?? 'gemini-2.5-pro'} (loading)</option>}{geminiModelsLoaded && !geminiModels.some(m => m.id === (preferences.seoGeminiModel ?? 'gemini-2.5-pro')) && <option value={preferences.seoGeminiModel ?? 'gemini-2.5-pro'} disabled>Select a supported Gemini model</option>}{geminiModels.map(m => <option key={m.id} value={m.id}>{m.name} ({m.id})</option>)}</select><button type="button" onClick={() => void loadGeminiModels()}>Refresh Gemini Pro models</button><p className="sub">{modelsError || 'Model list is fetched from your Gemini API key. Model availability depends on the account.'}</p></div>
        <div className="full"><label className="input-label">FIELDS INCLUDED IN SEO DRAFT</label><p className="sub">Default order: Title, Description, Tags, Image ALT Text, followed by selected SEO Research & Listing Details. Every field remains visible and editable in Etsy Listing Draft. Unchecked fields are omitted only from TXT, JSON, and image + listing ZIP exports; saved data is preserved.</p><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10, marginTop: 12 }}>{seoDraftFieldOrder.map(field => <label key={field} style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={(preferences.seoDraftFields ?? defaultSeoDraftFields).includes(field)} onChange={e => onPreferences({ ...preferences, seoDraftFields: seoDraftFieldOrder.filter(key => key === field ? e.target.checked : (preferences.seoDraftFields ?? defaultSeoDraftFields).includes(key)) })}/>{field === 'imageAltTexts' ? 'Image ALT Text' : field.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())}</label>)}</div></div>
        <div><label className="input-label">TITLE MAX CHARACTERS (1–140)</label><input type="number" min={1} max={140} value={preferences.seoTitleMaxLength ?? 120} onChange={e => edit('seoTitleMaxLength', Number(e.target.value))}/><p className="sub">Default: 120 characters.</p></div>
        <div><label className="input-label">IMAGE ALT TEXT</label><input readOnly value="1 AI-generated alt text · max 500 characters" /><p className="sub">Title, description and tags are imported from the Etsy reference listing.</p></div>
        <div><label className="input-label">IMAGE FILE NAMING</label><input maxLength={120} value={preferences.seoFileNaming ?? 'charactername_imagenumber'} onChange={e => edit('seoFileNaming', e.target.value)} placeholder="{theme}_{number}" /><p className="sub">ZIP filename pattern: type generaltheme, subtheme, microtheme, charactername, or imagenumber directly (e.g. generaltheme_charactername_imagenumber). Also supports {'{theme}'}, {'{collection}'}, {'{character}'} and {'{number}'}. Microtheme uses the collection name when no separate microtheme is saved. Duplicate filenames receive _2, _3, etc.</p></div>
      </div>
      <div className="settings-fields">{seoFields.map(([key, label, hint]) => <div className="seo-prompt-field" key={key}><label className="input-label">{label.toUpperCase()}</label><p className="sub">{hint}</p><textarea rows={3} maxLength={2000} placeholder={key === 'description' ? 'Example: Mention the primary keyword naturally in the opening paragraph.' : `Optional custom instructions for ${label.toLowerCase()}…`} value={preferences.seoPrompts?.[key] ?? ''} onChange={e => onPreferences({ ...preferences, seoPrompts: { ...defaultSeoPrompts, ...preferences.seoPrompts, [key]: e.target.value } })}/></div>)}</div>
      <div className="settings-actions"><button className="primary-btn" disabled={Boolean(active)} onClick={() => act('seo-prompts', async () => { await request({ action: 'preferences', preferences }); })}><Save size={16}/> {active === 'seo-prompts' ? 'Saving…' : 'Save SEO prompts'}</button></div>
    </section>


  </div>;
}
