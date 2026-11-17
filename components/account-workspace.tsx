'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { LoaderCircle, LogOut, Plus, Store, UserRound, CheckCircle2 } from 'lucide-react';

type StoreSummary = { id: string; name: string };
type Session = {
  authenticated: boolean; mode?: 'email-password' | 'trusted-gateway'; email?: string;
  stores: StoreSummary[]; activeStoreId?: string;
};
const WorkspaceContext = createContext<{
  session: Session; submit: (action: string, extra?: Record<string, unknown>) => Promise<void>;
  busy: boolean; error: string;
} | null>(null);
const emptySession: Session = { authenticated: false, stores: [] };

export function AccountWorkspaceGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session>(emptySession);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstStoreName, setFirstStoreName] = useState('');
  useEffect(() => {
    let alive = true;
    void fetch('/api/account', { cache: 'no-store' }).then(async response => {
      const data = await response.json() as Session & { error?: string };
      if (!response.ok) throw Error(data.error || 'Could not load account session');
      if (alive) setSession(data);
    }).catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Account service unavailable'); })
      .finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);
  // New stores created by the Web restore panel must appear in the header
  // immediately, without changing the active store or discarding the upload.
  useEffect(() => {
    let live = true;
    const refresh = () => {
      void fetch('/api/account', { cache: 'no-store' })
        .then(async response => {
          const data = await response.json() as Session & { error?: string };
          if (!response.ok) throw Error(data.error || 'Could not refresh stores');
          if (live) setSession(data);
        }).catch(e => { if (live) setError(e instanceof Error ? e.message : 'Could not refresh stores'); });
    };
    window.addEventListener('paletteiq:stores-updated', refresh);
    return () => { live = false; window.removeEventListener('paletteiq:stores-updated', refresh); };
  }, []);
  const submit = async (action: string, extra: Record<string, unknown> = {}) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/account', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await response.json() as Session & { error?: string };
      if (!response.ok) throw Error(data.error || 'Account operation failed');
      setSession(data);
      if (['switch-store','create-store','logout'].includes(action)) {
        window.dispatchEvent(new Event('paletteiq:store-changing'));
        // Reset in-memory collection, image previews and stored workspace route
        // so an old store cannot temporarily display another store's assets.
        try { localStorage.removeItem('paletteiq-last-workspace'); } catch { /* Optional */ }
        window.location.assign('/');
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Account operation failed'); }
    finally { setBusy(false); }
  };
  if (!ready) return <div className="account-gate"><LoaderCircle size={26} className="spin"/><p>Loading your PaletteIQ account…</p></div>;
  if (!session.authenticated) return <main className="account-gate">
    <section className="account-card">
      <div className="account-logo"><UserRound size={23}/><strong>palette<span>IQ</span></strong></div>
      <h1>{mode === 'register' ? 'Create your PaletteIQ account' : 'Sign in to PaletteIQ'}</h1>
      <p>Each account can manage multiple Etsy stores with separate collections, image assets and settings.</p>
      <form onSubmit={event => { event.preventDefault(); void submit(mode, { email, password, ...(mode === 'register' ? { name: firstStoreName.trim() } : {}) }); }}>
        <label htmlFor="palette-email">Email address</label>
        <input id="palette-email" type="email" autoComplete="email" required maxLength={254}
          value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com"/>
        <label htmlFor="palette-password">Password</label>
        <input id="palette-password" type="password"
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          required minLength={mode === 'register' ? 12 : 1} maxLength={128}
          value={password} onChange={e => setPassword(e.target.value)}
          placeholder={mode === 'register' ? '12 characters minimum' : 'Enter your password'}/>
        {mode === 'register' && <><label htmlFor="palette-first-store">First Etsy store name</label>
          <input id="palette-first-store" type="text" required minLength={2} maxLength={90}
            value={firstStoreName} onChange={e => setFirstStoreName(e.target.value)}
            placeholder="e.g. DLinker Artwork" autoComplete="off"/>
          <p className="account-hint">Your first store will use this name. You can rename it later in Stores.</p></>}
        {error && <p role="alert" className="account-error">{error}</p>}
        <button type="submit" className="account-submit" disabled={busy}>
          {busy && <LoaderCircle size={15} className="spin"/>}
          {mode === 'register' ? 'Create account and first store' : 'Sign in'}
        </button>
      </form>
      <button type="button" className="account-switch-mode"
        onClick={() => { setMode(m => m === 'login' ? 'register' : 'login'); setError(''); }}>
        {mode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in'}
      </button>
      <p className="account-hint"><CheckCircle2 size={15}/> Passwords are hashed and sessions use secure HttpOnly cookies. Use HTTPS for remote access.</p>
    </section>
  </main>;
  return <WorkspaceContext.Provider value={{ session, submit, busy, error }}>{children}</WorkspaceContext.Provider>;
}

/** Identifier only: Settings must mount under the currently authenticated store. */
export function useActiveStoreId(): string {
  return useContext(WorkspaceContext)?.session.activeStoreId || 'trusted';
}

export function StoreSwitcher() {
  const workspace = useContext(WorkspaceContext);
  const [creating, setCreating] = useState(false);
  const [newStore, setNewStore] = useState('');
  if (!workspace) return null;
  const { session, submit, busy, error } = workspace;
  const beforeLeavingStore = () => window.confirm('Switch stores or sign out? Any unsaved edits in the current collection will be discarded. Save your work first.');
  if (session.mode === 'trusted-gateway') return <span className="account-store-hint">Existing workspace</span>;
  return <div className="account-store-switcher">
    <Store size={16}/>
    <select aria-label="Active Etsy store" title="Choose store: collections and settings are separate"
      value={session.activeStoreId || ''}
      disabled={busy}
      onChange={e => { if (beforeLeavingStore()) void submit('switch-store', { storeId: e.target.value }); }}>
      {session.stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}
    </select>
    <button className="account-store-action" type="button" title="Add Etsy store" aria-label="Add Etsy store"
      onClick={() => setCreating(c => !c)} disabled={busy}><Plus size={15}/></button>
    <button className="account-store-action" type="button" title={'Sign out ' + session.email}
      aria-label="Logout" onClick={() => { if (beforeLeavingStore()) void submit('logout'); }} disabled={busy}><LogOut size={15}/><span>Logout</span></button>
    {creating && <div className="account-create-store">
      <form onSubmit={e => { e.preventDefault(); if (newStore.trim().length >= 2 && beforeLeavingStore()) void submit('create-store', { name: newStore.trim() }); }}>
        <label htmlFor="new-store-name">New Etsy store name</label>
        <input id="new-store-name" minLength={2} maxLength={90} required value={newStore}
          onChange={e => setNewStore(e.target.value)} placeholder="My second Etsy shop"/>
        <button type="submit" disabled={busy}>Create & switch</button>
      </form>
      {error && <p role="alert">{error}</p>}
    </div>}
  </div>;
}
