'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Mail, Save, Send, Trash2 } from 'lucide-react';

type SmtpInfo = {
  available: boolean; configured: boolean; source: string;
  hasOverride: boolean; bundledConfigured: boolean; passwordConfigured: boolean;
  host: string; port: number; username: string; sender: string; error?: string;
};
const EMPTY: SmtpInfo = {
  available: true, configured: false, source: 'installer-env',
  hasOverride: false, bundledConfigured: false, passwordConfigured: false,
  host: '', port: 587, username: '', sender: '',
};

export default function DesktopSmtpSettings({ storeId }: { storeId: string }) {
  const [info, setInfo] = useState<SmtpInfo>(EMPTY);
  const [host, setHost] = useState('');
  const [port, setPort] = useState(587);
  const [username, setUsername] = useState('');
  const [sender, setSender] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const update = (next: SmtpInfo) => {
    setInfo(next);
    setHost(next.host || '');
    setPort(next.port === 465 ? 465 : 587);
    setUsername(next.username || '');
    setSender(next.sender || '');
    setPassword('');
    setReady(true);
  };
  useEffect(() => {
    let mounted = true;
    setReady(false); setNotice(''); setLoadError('');
    fetch('/api/desktop-smtp', { cache: 'no-store' })
      .then(async res => {
        const body = await res.json() as SmtpInfo;
        if (!res.ok) throw new Error(body.error || 'Unable to load SMTP settings');
        return body;
      }).then(body => { if (mounted) update(body); })
      .catch(error => { if (mounted) { setReady(true); setInfo({ ...EMPTY, available: false }); setLoadError(error instanceof Error ? error.message : String(error)); } });
    return () => { mounted = false; };
  }, [storeId, refreshKey]);

  async function perform(action: 'save' | 'reset' | 'test') {
    setBusy(action); setNotice('');
    try {
      const response = await fetch('/api/desktop-smtp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'save'
          ? { action, host, port, username, sender, password }
          : { action }),
      });
      const data = await response.json() as SmtpInfo & { accepted?: boolean };
      if (!response.ok) throw new Error(data.error || 'SMTP request failed');
      if (action !== 'test') update(data);
      setNotice(action === 'test'
        ? 'SMTP server accepted the test email to your PaletteIQ account address. Check inbox and spam folder.'
        : action === 'save' ? 'SMTP overrides saved encrypted for this store.'
          : 'Store SMTP overrides cleared. Installer .env defaults restored.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally { setBusy(''); }
  }

  if (!ready) return <section className="panel settings-panel"><p className="sub">Loading Desktop SMTP configuration…</p></section>;
  if (loadError) return <section className="panel settings-panel" role="tabpanel" aria-labelledby="settings-tab-smtp">
    <div className="settings-header"><div className="heading-icon violet"><Mail size={21}/></div><div><h2>SMTP Email</h2><p>Unable to connect to the Desktop SMTP service.</p></div></div>
    <p className="notice" role="alert">{loadError}</p>
    <p className="sub">If you are using PaletteIQ Desktop, restart the application and its local backend. If you are using <code>npm run dev</code> in a browser, SMTP requires <code>npm run desktop:dev</code> or the updated Windows installer.</p>
    <button className="outline-btn" type="button" onClick={() => setRefreshKey(k => k + 1)}>Retry SMTP connection</button>
  </section>;
  if (!info.available) return <section className="panel settings-panel" role="tabpanel" aria-labelledby="settings-tab-smtp">
    <div className="settings-header"><div className="heading-icon violet"><Mail size={21}/></div><div><h2>SMTP Email — Desktop only</h2><p>The local SMTP sender is not available in this PaletteIQ session.</p></div></div>
    <p className="sub">You are viewing the Web/Next.js runtime rather than the Windows Electron Desktop service. To configure SMTP and send batch completion notifications directly from this computer, run <code>npm run desktop:dev</code> or install the updated PaletteIQ Desktop. The browser version cannot access local SMTP passwords.</p>
    <button className="outline-btn" type="button" onClick={() => setRefreshKey(k => k + 1)}>Check again</button>
  </section>;

  return <section className="panel settings-panel" role="tabpanel" aria-labelledby="settings-tab-smtp">
    <div className="settings-header">
      <div className="heading-icon violet"><Mail size={21}/></div>
      <div><h2>Desktop SMTP Email Notifications</h2>
        <p>Emails are sent directly from this Windows Desktop when OpenAI Batch generation completes. No GPU server or public HTTPS webhook is required.</p>
      </div>
    </div>
    <div className="secret-row">
      <div className="secret-heading">
        <div><b>Active SMTP configuration</b><p>{info.hasOverride ? 'Custom encrypted SMTP settings for this store' : 'Bundled installer .env defaults'}</p></div>
        <span className={'credential-status ' + (info.configured ? 'connected' : '')}>{info.configured ? <><CheckCircle2 size={13}/> Configured</> : 'Not configured'}</span>
      </div>
      <p className="sub">Configured defaults require no changes. You can optionally override them for this store. Passwords are never shown or returned by the API.</p>
    </div>
    <div className="settings-fields">
      <div><label className="input-label" htmlFor="desktop-smtp-host">SMTP HOST</label><input id="desktop-smtp-host" autoComplete="off" value={host} onChange={e=>setHost(e.target.value)} placeholder="smtp.gmail.com"/></div>
      <div><label className="input-label" htmlFor="desktop-smtp-port">SMTP PORT</label><select id="desktop-smtp-port" value={port} onChange={e=>setPort(Number(e.target.value))}><option value={587}>587 — STARTTLS</option><option value={465}>465 — TLS/SSL</option></select></div>
      <div><label className="input-label" htmlFor="desktop-smtp-username">USERNAME / GMAIL</label><input id="desktop-smtp-username" autoComplete="off" value={username} onChange={e=>setUsername(e.target.value)} placeholder="sender@gmail.com"/></div>
      <div><label className="input-label" htmlFor="desktop-smtp-from">FROM EMAIL</label><input id="desktop-smtp-from" autoComplete="off" value={sender} onChange={e=>setSender(e.target.value)} placeholder="sender@gmail.com"/></div>
      <div className="full"><label className="input-label" htmlFor="desktop-smtp-password">GOOGLE APP PASSWORD / SMTP PASSWORD</label>
        <input id="desktop-smtp-password" type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}
          placeholder={info.passwordConfigured ? 'Leave empty to keep the currently configured password' : 'Enter the SMTP App Password'}/>
        <p className="sub">For Gmail use your Google App Password, not your Google login password. Saving stores an encrypted per-store override; never put this password in a public Git repository.</p>
      </div>
    </div>
    <div className="settings-actions" style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
      <button type="button" className="primary-btn" disabled={Boolean(busy)} onClick={()=>void perform('save')}><Save size={15}/> {busy==='save'?'Saving…':'Save SMTP'}</button>
      <button type="button" className="outline-btn" disabled={Boolean(busy)||!info.configured} onClick={()=>void perform('test')}><Send size={15}/> {busy==='test'?'Sending…':'Send test email'}</button>
      <button type="button" className="outline-btn danger-btn" disabled={Boolean(busy)||!info.hasOverride} onClick={()=>void perform('reset')}><Trash2 size={15}/> Use installer defaults</button>
    </div>
    <div className="security-note"><Mail size={16}/><span>Bundled .env passwords can be extracted from an installer. Use a dedicated SMTP sender with limited access. Every store can override the default without modifying the installer.</span></div>
    {notice && <div className="notice production-notice" role="status">{notice}</div>}
  </section>;
}
