'use client';

import { useEffect, useState } from 'react';
import { adminApi } from '@/lib/admin-api';
import type { GovParam } from '@/lib/api';

/**
 * §18 break-glass — platform-admin edits the board-gated governance parameters. Normally the
 * board owns these, but at genesis there is no board yet (open admission → DReps must elect one),
 * so the operator configures the platform here. Every save is written to the admin audit log.
 */
export function AdminConfigPanel({ nonce }: { nonce?: number }) {
  const [params, setParams] = useState<GovParam[] | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [order, setOrder] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    adminApi.config
      .params()
      .then((p) => {
        setParams(p);
        setEdits(Object.fromEntries(p.map((x) => [x.key, String(x.value)])));
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'failed to load config'));
    adminApi.config.onchainSource().then((s) => setOrder(s.order)).catch(() => setOrder(null));
  };
  useEffect(load, [nonce]);

  const save = async (p: GovParam) => {
    setError(null);
    setMsg(null);
    setBusy(p.key);
    try {
      const raw = edits[p.key] ?? '';
      const value = p.type === 'boolean' ? raw === 'true' : p.type === 'number' ? Number(raw) : raw;
      await adminApi.config.updateParam(p.key, value);
      setMsg(`Saved ${p.key}.`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
      <h2 className="text-sm font-semibold text-slate-200">Platform configuration (break-glass)</h2>
      <p className="mt-1 text-xs text-slate-400">
        The board normally owns these settings. Until DReps elect a board, you (admin) can configure the platform here.
        Every change is written to the admin audit log.
      </p>
      {order ? (
        <p className="mt-2 text-xs text-slate-400">
          On-chain data source order: <span className="font-mono text-slate-300">{order.join(' → ')}</span>
        </p>
      ) : null}
      {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
      {msg ? <p className="mt-2 text-xs text-emerald-400">{msg}</p> : null}

      <div className="mt-3 divide-y divide-slate-800">
        {(params ?? []).map((p) => {
          const changed = edits[p.key] !== String(p.value);
          return (
            <div key={p.key} className="flex flex-wrap items-center gap-3 py-2.5">
              <div className="min-w-[200px] flex-1">
                <div className="font-mono text-xs text-slate-200">{p.key}</div>
                {p.description ? <div className="mt-0.5 text-[11px] text-slate-500">{p.description}</div> : null}
              </div>
              <div className="flex items-center gap-2">
                {p.type === 'boolean' ? (
                  <select
                    value={edits[p.key] ?? 'false'}
                    onChange={(e) => setEdits({ ...edits, [p.key]: e.target.value })}
                    className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200"
                  >
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : (
                  <input
                    value={edits[p.key] ?? ''}
                    onChange={(e) => setEdits({ ...edits, [p.key]: e.target.value })}
                    type={p.type === 'number' ? 'number' : 'text'}
                    className="w-40 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200"
                  />
                )}
                <button
                  disabled={busy === p.key || !changed}
                  onClick={() => save(p)}
                  className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40"
                >
                  {busy === p.key ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          );
        })}
        {params && params.length === 0 ? <p className="py-2 text-xs text-slate-500">No parameters.</p> : null}
        {!params && !error ? <p className="py-2 text-xs text-slate-500">Loading…</p> : null}
      </div>
    </section>
  );
}
