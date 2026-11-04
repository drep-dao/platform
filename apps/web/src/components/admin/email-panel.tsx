'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminApi, type EmailStatus } from '@/lib/admin-api';

/**
 * §20.3 — sysadmin config for OUTBOUND email (SMTP relay). The platform only SENDS notification
 * emails; it never receives mail (no inbox). Works before a board is elected. The password is
 * write-only (stored encrypted, never returned) — leave it blank to keep the existing one.
 */
export function EmailPanel() {
  const [s, setS] = useState<EmailStatus | null>(null);
  const [password, setPassword] = useState('');
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    try { setS(await adminApi.email.get()); } catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'load failed' }); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (!s) return <section className={card}><h2 className={h2}>Email notifications (SMTP)</h2><p className="mt-2 text-sm text-neutral-500">Loading…</p></section>;

  const set = (patch: Partial<EmailStatus>) => setS((prev) => (prev ? { ...prev, ...patch } : prev));

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await adminApi.email.save({ enabled: s.enabled, host: s.host, port: s.port, secure: s.secure, user: s.user, from: s.from, ...(password ? { password } : {}) });
      setS(r); setPassword('');
      setMsg({ kind: 'ok', text: 'Saved.' });
    } catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'save failed' }); } finally { setBusy(false); }
  };

  const sendTest = async () => {
    setBusy(true); setMsg(null);
    try { await adminApi.email.test(testTo.trim()); setMsg({ kind: 'ok', text: `Test email sent to ${testTo.trim()} — check the inbox.` }); }
    catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'test failed' }); } finally { setBusy(false); }
  };

  return (
    <section className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={h2}>Email notifications (SMTP)</h2>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.configured ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'}`}>
          {s.configured ? 'active' : 'not configured'}
        </span>
      </div>
      <p className="mt-1 text-sm text-neutral-500 dark:text-slate-400">
        The platform only <strong>sends</strong> notification emails over this SMTP relay — it never receives mail. Users get emails for their notifications unless they turn them off.
      </p>

      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Enable email sending
      </label>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="SMTP host" value={s.host} onChange={(v) => set({ host: v })} placeholder="smtp.your-provider.com" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Port" type="number" value={String(s.port)} onChange={(v) => set({ port: Number(v) || 0 })} placeholder="587" />
          <label className="flex flex-col gap-1 text-xs text-neutral-500 dark:text-slate-400">Encryption
            <select value={s.secure ? 'ssl' : 'starttls'} onChange={(e) => set({ secure: e.target.value === 'ssl' })} className={input}>
              <option value="starttls">STARTTLS (587)</option>
              <option value="ssl">SSL/TLS (465)</option>
            </select>
          </label>
        </div>
        <Field label="Username" value={s.user} onChange={(v) => set({ user: v })} placeholder="apikey / user@domain" />
        <Field label={`Password ${s.hasPassword ? '(set — leave blank to keep)' : ''}`} type="password" value={password} onChange={setPassword} placeholder={s.hasPassword ? '••••••••' : 'SMTP password / API key'} />
        <Field label="From address" value={s.from} onChange={(v) => set({ from: v })} placeholder="DRep Council <noreply@drepcouncil.org>" className="sm:col-span-2" />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button disabled={busy} onClick={save} className={btnPrimary}>{busy ? 'Saving…' : 'Save'}</button>
        <div className="flex items-center gap-2">
          <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" className={`${input} w-56`} />
          <button disabled={busy || !testTo.includes('@')} onClick={sendTest} className={btnGhost}>Send test</button>
        </div>
      </div>

      {msg ? <p className={`mt-2 text-sm ${msg.kind === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{msg.text}</p> : null}
    </section>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text', className = '' }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; className?: string }) {
  return (
    <label className={`flex flex-col gap-1 text-xs text-neutral-500 dark:text-slate-400 ${className}`}>{label}
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={input} />
    </label>
  );
}

const card = 'rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900';
const h2 = 'text-base font-semibold text-neutral-900 dark:text-slate-100';
const input = 'w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900';
const btnPrimary = 'rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50';
const btnGhost = 'rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800';
