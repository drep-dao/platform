'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { proposalCheckerApi as api, type PcScan, type PcScanTool } from '@/lib/api';
import { listInjectedWallets, getStakeAddress, signMessageWithStakeKey, type Cip30Api, type Cip30WalletEntry } from '@/lib/cip30';
import { useT } from '@/lib/prefs-context';
import { ResultCard, frameworkScore, scoreColor } from './proposal-checker';
import { MarkdownEditor } from './markdown';

const SCAN_GRADIENT = 'radial-gradient(120% 140% at 100% 0, #0e6f73 0%, #0e7a4b 46%, #0b5f3b 100%)';

/** Right-rail teaser: a compact gradient card below the login box. Renders nothing while the board
 *  keeps the tool off; clicking opens the full-screen tool (PublicScanPage) in the main window. */
export function PublicScanTool({ onOpen }: { onOpen: () => void }) {
  const t = useT();
  const [tool, setTool] = useState<PcScanTool | null>(null);
  useEffect(() => { api.scanTool().then(setTool).catch(() => setTool(null)); }, []);
  if (!tool || !tool.enabled) return null;
  return (
    <div className="relative overflow-hidden rounded-2xl p-4 text-sm text-emerald-50 shadow-sm" style={{ background: SCAN_GRADIENT }}>
      <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(255,255,255,.16), transparent 60%)' }} />
      <div className="relative">
        <div className="font-semibold">{t('On-chain Proposal Score')}</div>
        <p className="mt-1 text-xs text-emerald-100/90">{t('Score your DRAFT proposal before you submit it on-chain. Connect a wallet, pay')} {tool.feeAda} ₳ {t('and score it against the Template, the Triangle Forces framework and Cardano Vision 2030 — the same reading the Council gives a submitted proposal.')}</p>
        <button onClick={onOpen}
          className="mt-3 rounded-full bg-white/15 px-4 py-1.5 text-xs font-semibold text-emerald-50 transition hover:bg-white/25">
          {t('Open the tool')} →
        </button>
      </div>
    </div>
  );
}

/** Full-screen pay-to-scan tool shown in the main window: connect a wallet, pay a fee in ADA, and run
 *  the proposal-checker engine on a DRAFT proposal before submitting it on-chain. */
export function PublicScanPage() {
  const t = useT();
  const [tool, setTool] = useState<PcScanTool | null>(null);
  const [wallets, setWallets] = useState<Cip30WalletEntry[]>([]);
  const [stake, setStake] = useState<string | null>(null);
  const apiRef = useRef<Cip30Api | null>(null);
  const [view, setView] = useState<'form' | 'flow' | 'mine'>('form');
  const [scan, setScan] = useState<PcScan | null>(null);
  const [editing, setEditing] = useState(false);
  const [mine, setMine] = useState<PcScan[] | null>(null);
  const [form, setForm] = useState({ title: '', amount: '', abstract: '', motivation: '', rationale: '', links: [] as string[] });
  const [linkDraft, setLinkDraft] = useState('');
  const [tx, setTx] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Ownership proof for "My scans", cached in memory for this page session so the wallet only has to
  // sign (ask for its password) ONCE, not on every click. The signed message is static per address
  // (no server session exists — the public tool is identified purely by this wallet signature), so the
  // proof stays valid until the page reloads or the wallet is disconnected.
  const [auth, setAuth] = useState<{ signature: string; key: string } | null>(null);

  useEffect(() => { api.scanTool().then(setTool).catch(() => setTool(null)); }, []);

  // Wallets inject asynchronously — poll briefly on mount until one appears.
  useEffect(() => {
    const poll = () => setWallets(listInjectedWallets());
    poll();
    const id = setInterval(poll, 1500);
    const stop = setTimeout(() => clearInterval(id), 6000);
    return () => { clearInterval(id); clearTimeout(stop); };
  }, []);

  // Auto-poll a pending payment so SCAN unlocks on its own. This is a READ (getScan), not a write:
  // the server's own 30s poller does the on-chain reconciliation and flips PAID, and we just read the
  // refreshed total every 15s. Keeping the background poll read-only matters — a POST here would make
  // every open scan tab register as an "active writer" and block deploys (it did, once).
  useEffect(() => {
    if (!scan || scan.status !== 'PENDING_PAYMENT' || scan.payments.length === 0) return;
    const id = scan.id;
    const t = setInterval(async () => {
      try { const s = await api.getScan(id); setScan(s); } catch { /* keep polling */ }
    }, 15000);
    return () => clearInterval(t);
  }, [scan?.id, scan?.status, scan?.payments.length]);

  const connect = useCallback(async (entry: Cip30WalletEntry) => {
    setBusy('connect'); setErr(null);
    try { const { api: a, stakeAddress } = await getStakeAddress(entry); apiRef.current = a; setStake(stakeAddress); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not connect the wallet.'); }
    finally { setBusy(null); }
  }, []);

  const linksFromForm = () => form.links.map((l) => l.trim()).filter(Boolean).slice(0, 10);
  // Add one link at a time (like the board's Re-score composer), rather than a free textarea.
  const addLink = () => {
    const v = linkDraft.trim();
    if (!v) return;
    if (!/^https?:\/\//i.test(v)) { setErr(t('Enter a valid http(s) link.')); return; }
    if (form.links.length >= 10) { setErr(t('Up to 10 links.')); return; }
    setErr(null);
    setForm((f) => (f.links.includes(v) ? f : { ...f, links: [...f.links, v] }));
    setLinkDraft('');
  };
  // Requested amount is optional and only applies to treasury withdrawals. Accept thousands separators
  // (e.g. "3,810,423"); undefined when blank or not a number so the field stays optional end-to-end.
  const amountFromForm = (): number | undefined => {
    const n = parseFloat(form.amount.replace(/[\s,]/g, ''));
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };

  const create = async () => {
    if (!stake) return;
    if (!form.title.trim()) { setErr(t('Enter at least a title.')); return; }
    setBusy('create'); setErr(null);
    try {
      const c = await api.createScan({ walletStakeAddr: stake, title: form.title, abstract: form.abstract, motivation: form.motivation, rationale: form.rationale, amountAda: amountFromForm(), extraLinks: linksFromForm() });
      const s = await api.getScan(c.id);
      setScan(s); setView('flow');
    } catch (e) { setErr(e instanceof Error ? e.message : 'failed'); }
    finally { setBusy(null); }
  };

  // Edit the draft of an existing scan (before SCAN is spent): pre-fill the form from the stored text.
  const startEdit = () => {
    if (!scan) return;
    setForm({ title: scan.title ?? '', amount: scan.amountAda != null ? String(scan.amountAda) : '', abstract: scan.abstract ?? '', motivation: scan.motivation ?? '', rationale: scan.rationale ?? '', links: scan.extraLinks ?? [] }); setLinkDraft('');
    setEditing(true); setView('form'); setErr(null);
  };
  const saveEdit = async () => {
    if (!scan) return;
    if (!form.title.trim()) { setErr(t('Enter at least a title.')); return; }
    setBusy('save'); setErr(null);
    try {
      const s = await api.updateScan(scan.id, { title: form.title, abstract: form.abstract, motivation: form.motivation, rationale: form.rationale, amountAda: amountFromForm(), extraLinks: linksFromForm() });
      setScan(s); setEditing(false); setView('flow');
    } catch (e) { setErr(e instanceof Error ? e.message : 'failed'); }
    finally { setBusy(null); }
  };

  const attach = async () => {
    if (!scan) return;
    const hash = tx.trim();
    const already = scan.payments.some((p) => p.txHash === hash);
    setBusy('attach'); setErr(null); setNote(null);
    try {
      const s = await api.attachScanTx(scan.id, hash);
      setScan(s);
      if (s.status === 'PAID' || s.status === 'DONE') { setNote(t('Payment complete — you can run the scan now.')); setTx(''); }
      else if (already) { setNote(t('That transaction is already recorded on this scan — it can only count once. Paste a different transaction to add to the total.')); }
      else { setNote(t('Transaction recorded. We are checking the blockchain — the total updates below in a few seconds.')); setTx(''); }
    }
    catch (e) { setErr(e instanceof Error ? e.message : 'failed'); }
    finally { setBusy(null); }
  };
  const recheck = async () => {
    if (!scan) return;
    setBusy('recheck'); setErr(null); setNote(null);
    try {
      const s = await api.verifyScan(scan.id); setScan(s);
      if (s.status === 'PENDING_PAYMENT') setNote(t('Checked the blockchain — still {missing} ₳ short of the fee.').replace('{missing}', String(Math.round((s.feeAda - s.paidAda) * 100) / 100)));
    }
    catch (e) { setErr(e instanceof Error ? e.message : 'failed'); }
    finally { setBusy(null); }
  };
  const run = async () => {
    if (!scan) return;
    setBusy('run'); setErr(null); setNote(null);
    try { const s = await api.runScan(scan.id); setScan(s); }
    catch (e) { setErr(e instanceof Error ? e.message : 'failed'); }
    finally { setBusy(null); }
  };
  // Edit and rescan: fork the current (usually DONE) scan into a new editable version, prefill the edit
  // form from it, and drop into the edit flow. The old version is kept and linked as the new one's parent.
  const forkAndEdit = async () => {
    if (!scan) return;
    setBusy('fork'); setErr(null); setNote(null);
    try {
      const s = await api.forkScan(scan.id);
      setScan(s);
      setForm({ title: s.title ?? '', amount: s.amountAda != null ? String(s.amountAda) : '', abstract: s.abstract ?? '', motivation: s.motivation ?? '', rationale: s.rationale ?? '', links: s.extraLinks ?? [] }); setLinkDraft('');
      setEditing(true); setView('form'); setTx('');
      setNote(t('New version created — edit it, then pay the fee and run the scan. The previous version is kept.'));
    } catch (e) { setErr(e instanceof Error ? e.message : 'failed'); }
    finally { setBusy(null); }
  };
  const openParent = async (parentId: string) => {
    setBusy('parent'); setErr(null); setNote(null);
    try { const s = await api.getScan(parentId); setScan(s); setEditing(false); setView('flow'); setTx(''); }
    catch (e) { setErr(e instanceof Error ? e.message : 'failed'); }
    finally { setBusy(null); }
  };
  const loadMine = async () => {
    if (!stake || !apiRef.current) return;
    setBusy('mine'); setErr(null);
    try {
      // Reuse the cached proof when we have one, so the wallet doesn't re-prompt for a password every
      // time. Only sign (the password prompt) when there is no proof yet.
      let proof = auth;
      if (!proof) {
        const { message } = await api.scanSignMessage(stake);
        const { signature, key } = await signMessageWithStakeKey(apiRef.current, message);
        proof = { signature, key };
        setAuth(proof);
      }
      const list = await api.myScans({ stakeAddress: stake, signature: proof.signature, key: proof.key });
      setMine(list); setView('mine');
    } catch (e) {
      // Drop a stale/failed proof so the next click signs afresh rather than looping on a bad one.
      setAuth(null);
      setErr(e instanceof Error ? e.message : 'failed');
    }
    finally { setBusy(null); }
  };
  // Disconnect the wallet from the (standalone) tool: clears the connection + cached proof and returns
  // to a fresh New-scan state. There is no server session to end — identity here is only the wallet.
  const disconnect = () => {
    apiRef.current = null;
    setStake(null); setAuth(null); setMine(null); setScan(null); setEditing(false);
    setView('form'); setTx(''); setNote(null); setErr(null);
    setForm({ title: '', amount: '', abstract: '', motivation: '', rationale: '', links: [] }); setLinkDraft('');
  };
  const download = (s: PcScan) => {
    try {
      const blob = new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `proposal-scan-${s.id.slice(0, 8)}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch { /* ignore */ }
  };
  const copy = (text: string) => { try { void navigator.clipboard.writeText(text); } catch { /* ignore */ } };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <section className="relative overflow-hidden rounded-2xl p-6 text-emerald-50 shadow-sm sm:p-8" style={{ background: SCAN_GRADIENT }}>
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(255,255,255,.16), transparent 60%)' }} />
        <div className="relative">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t('On-chain Proposal Score')}</h1>
          <p className="mt-2 max-w-[60ch] text-[15px] text-emerald-100/90">
            {t('Score your DRAFT proposal before you submit it on-chain. Connect a wallet, pay')} {tool?.feeAda ?? ''} ₳ {t('and score it against the Template, the Triangle Forces framework and Cardano Vision 2030 — the same reading the Council gives a submitted proposal.')}
          </p>
        </div>
      </section>

      {!tool ? (
        <p className="text-sm text-neutral-400">{t('Loading…')}</p>
      ) : !tool.enabled ? (
        <div className="rounded-2xl border border-neutral-200 bg-white p-5 text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950">
          {t('This tool is currently unavailable.')}
        </div>
      ) : (
        <div className="space-y-4 rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
          {err ? <div className="text-sm text-red-600">{err}</div> : null}
          {note ? <div className="rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-800 dark:bg-sky-950/40 dark:text-sky-300">{note}</div> : null}

          {!stake ? (
            <div className="space-y-2">
              <p className="text-sm text-neutral-500">{t('Connect a Cardano wallet to begin.')}</p>
              {wallets.length === 0 ? <p className="text-xs text-neutral-400">{t('No wallet detected — install or enable a Cardano wallet extension.')}</p> : null}
              <div className="flex flex-wrap gap-2">
                {wallets.map((w) => (
                  <button key={w.key} onClick={() => connect(w)} disabled={busy !== null}
                    className="flex items-center gap-1.5 rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800">
                    {w.icon ? <img src={w.icon} alt="" className="h-4 w-4" /> : null}{w.name}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-neutral-500">{t('Wallet')}: <span className="font-mono text-xs">{stake.slice(0, 16)}…{stake.slice(-8)}</span></span>
                <div className="flex gap-2">
                  <button onClick={() => { setView('form'); setScan(null); setEditing(false); setForm({ title: '', amount: '', abstract: '', motivation: '', rationale: '', links: [] }); setLinkDraft(''); }} className={`rounded px-2.5 py-1 ${view === 'form' && !scan ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'text-neutral-500 hover:text-neutral-700'}`}>{t('New scan')}</button>
                  <button onClick={loadMine} disabled={busy !== null} className={`rounded px-2.5 py-1 ${view === 'mine' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'text-neutral-500 hover:text-neutral-700'}`}>{busy === 'mine' ? t('Loading…') : t('My scans')}</button>
                  <button onClick={disconnect} disabled={busy !== null} className="rounded px-2.5 py-1 text-neutral-500 hover:text-red-600 disabled:opacity-40">{t('Disconnect')}</button>
                </div>
              </div>

              {view === 'form' && (!scan || editing) ? (
                <div className="space-y-3">
                  {editing ? <p className="text-xs text-neutral-500">{t('Editing your draft — your payment still applies; the changes are scored when you run the scan.')}</p> : null}
                  <label className="block text-sm">
                    <span className="mb-1 block text-neutral-500">{t('Title')}</span>
                    <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                      className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-neutral-500">{t('Requested amount in ADA (optional — only treasury withdrawals)')}</span>
                    <div className="flex items-center gap-2">
                      <input value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                        inputMode="decimal" placeholder={t('e.g. 3,810,423')}
                        className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm tabular-nums dark:border-neutral-700 dark:bg-neutral-900" />
                      <span className="shrink-0 text-sm text-neutral-500">₳</span>
                    </div>
                  </label>
                  {(() => {
                    const tt = tool?.tiers;
                    if (!tt?.enabled) return null;
                    const n = parseFloat(form.amount.replace(/[\s,]/g, ''));
                    const tier = !Number.isFinite(n) ? null : n <= tt.smallMax ? tt.names.small : n <= tt.middleMax ? tt.names.middle : tt.names.large;
                    return (
                      <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                        {t('The requested amount is a decisive factor in the score: larger asks are scored against more template requirements.')}{' '}
                        {tt.names.small} ≤ {tt.smallMax.toLocaleString()} ₳ · {tt.names.middle} ≤ {tt.middleMax.toLocaleString()} ₳ · {tt.names.large} &gt; {tt.middleMax.toLocaleString()} ₳.
                        {tier ? <> {' '}<span className="font-semibold">{t('Your ask:')} {tier}.</span></> : null}
                      </p>
                    );
                  })()}
                  {/* Abstract / Motivation / Rationale: collapsible Markdown editors with a live Preview,
                      matching the proposal composer — the scan engine reads the text as written. */}
                  <MarkdownEditor title={t('Abstract')} value={form.abstract} onChange={(v) => setForm((f) => ({ ...f, abstract: v }))} minRows={3} />
                  <MarkdownEditor title={t('Motivation')} value={form.motivation} onChange={(v) => setForm((f) => ({ ...f, motivation: v }))} minRows={4} />
                  <MarkdownEditor title={t('Rationale')} value={form.rationale} onChange={(v) => setForm((f) => ({ ...f, rationale: v }))} minRows={6} />
                  <div className="block text-sm">
                    <span className="mb-1 block text-neutral-500">{t('Links (optional — GitHub repos, specs; add one at a time)')}</span>
                    {form.links.length ? (
                      <ul className="mb-1.5 space-y-1">
                        {form.links.map((l, i) => (
                          <li key={i} className="flex items-center gap-2 text-xs">
                            {/github\.com/i.test(l) ? <span className="shrink-0 rounded bg-neutral-200 px-1 text-[10px] text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">GitHub</span> : null}
                            <span className="min-w-0 flex-1 truncate font-mono text-neutral-600 dark:text-neutral-300">{l}</span>
                            <button type="button" onClick={() => setForm((f) => ({ ...f, links: f.links.filter((_, j) => j !== i) }))} className="shrink-0 text-red-600 hover:underline">{t('remove')}</button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <div className="flex gap-2">
                      <input value={linkDraft} onChange={(e) => setLinkDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } }}
                        placeholder="https://…" disabled={form.links.length >= 10}
                        className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
                      <button type="button" onClick={addLink} disabled={!linkDraft.trim() || form.links.length >= 10}
                        className="shrink-0 rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800">{t('Next link')}</button>
                    </div>
                  </div>
                  {editing ? (
                    <div className="flex items-center gap-3">
                      <button onClick={saveEdit} disabled={busy !== null} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">{busy === 'save' ? t('Saving…') : t('Save changes')}</button>
                      <button onClick={() => { setEditing(false); setView('flow'); setErr(null); }} className="text-sm text-neutral-500 hover:underline">{t('Cancel')}</button>
                    </div>
                  ) : (
                    <button onClick={create} disabled={busy !== null} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                      {busy === 'create' ? t('Preparing…') : `${t('Continue to payment')} (${tool.feeAda} ₳)`}
                    </button>
                  )}
                </div>
              ) : null}

              {view === 'flow' && scan && !editing ? (
                <ScanFlow scan={scan} tx={tx} setTx={setTx} busy={busy} onAttach={attach} onRecheck={recheck} onRun={run} onEdit={startEdit} onDownload={download} onCopy={copy} onFork={forkAndEdit} onOpenParent={openParent} onNew={() => { setScan(null); setEditing(false); setView('form'); setTx(''); setNote(null); setErr(null); setForm({ title: '', amount: '', abstract: '', motivation: '', rationale: '', links: [] }); setLinkDraft(''); }} />
              ) : null}

              {view === 'mine' ? (
                <div className="space-y-2">
                  {mine === null ? <p className="text-sm text-neutral-400">{t('Loading…')}</p>
                    : mine.length === 0 ? <p className="text-sm text-neutral-400">{t('No scans yet for this wallet.')}</p>
                    : mine.map((s) => (
                      <button key={s.id} onClick={() => { setScan(s); setView('flow'); }} className="block w-full rounded-md border border-neutral-200 p-3 text-left text-sm hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate font-medium">{s.title || s.id.slice(0, 8)}</span>
                          <StatusChip status={s.status} />
                        </span>
                        <span className="text-xs text-neutral-400">
                          {new Date(s.createdAt).toLocaleString()}
                          {s.status === 'DONE' ? (() => {
                            const fw = frameworkScore(s.questions ?? []);
                            return (
                              <span title={t('Template coverage / Triangle framework / Cardano Vision 2030')}> · <span className={`font-semibold tabular-nums ${scoreColor(s.scorePct ?? 0)}`}>{s.scorePct ?? '—'}%</span> / <span className={`font-semibold tabular-nums ${scoreColor(fw ?? 0)}`}>{fw ?? '—'}%</span> / <span className={`font-semibold tabular-nums ${scoreColor(s.visionPct ?? 0)}`}>{s.visionPct ?? '—'}%</span></span>
                            );
                          })() : null}
                        </span>
                      </button>
                    ))}
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const t = useT();
  const map: Record<string, { label: string; cls: string }> = {
    PENDING_PAYMENT: { label: t('awaiting payment'), cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
    PAID: { label: t('paid — ready to scan'), cls: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300' },
    DONE: { label: t('done'), cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
    FAILED_RETRY: { label: t('failed — retry'), cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
    FAILED_CONTACT_ADMIN: { label: t('failed — contact admin'), cls: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' },
  };
  const s = map[status] ?? { label: status, cls: 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800' };
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${s.cls}`}>{s.label}</span>;
}

function ScanFlow({ scan, tx, setTx, busy, onAttach, onRecheck, onRun, onEdit, onDownload, onCopy, onNew, onFork, onOpenParent }: {
  scan: PcScan; tx: string; setTx: (v: string) => void; busy: string | null;
  onAttach: () => void; onRecheck: () => void; onRun: () => void; onEdit: () => void; onDownload: (s: PcScan) => void; onCopy: (v: string) => void; onNew: () => void;
  onFork: () => void; onOpenParent: (parentId: string) => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const doCopy = (text: string) => { onCopy(text); setCopied(true); setTimeout(() => setCopied(false), 1200); };
  // The draft text can still be changed until the scan is spent — DONE freezes it, and a twice-failed
  // scan is out of attempts.
  const canEdit = scan.status !== 'DONE' && scan.status !== 'FAILED_CONTACT_ADMIN';
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{scan.title || scan.id.slice(0, 8)}</span>
          {scan.version > 1 ? <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-500 dark:bg-neutral-800 dark:text-neutral-300" title={t('This is a newer version of an earlier scan')}>v{scan.version}</span> : null}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {canEdit ? <button onClick={onEdit} className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800">{t('Edit proposal')}</button> : null}
          <StatusChip status={scan.status} />
        </div>
      </div>
      {scan.parentId ? <button onClick={() => onOpenParent(scan.parentId!)} disabled={busy !== null} className="text-[11px] text-sky-700 hover:underline disabled:opacity-40 dark:text-sky-400">← {t('previous version')}</button> : null}

      {scan.status === 'PENDING_PAYMENT' ? (
        <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
          <p className="text-sm">{t('Pay')} <span className="font-semibold">{scan.feeAda} ₳</span> {t('from your wallet to this address, then paste the transaction hash below.')}</p>
          <div className="flex items-center gap-1 rounded bg-white px-2 py-1.5 dark:bg-neutral-900">
            <span className="flex-1 break-all font-mono text-[11px]">{scan.toAddress}</span>
            <button onClick={() => doCopy(scan.toAddress)} className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] transition ${copied ? 'border-emerald-400 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'}`}>{copied ? t('Copied') : t('copy')}</button>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('Insert transaction hash')}</span>
            <div className="flex gap-1">
              <input value={tx} onChange={(e) => setTx(e.target.value)} placeholder={t('transaction hash')} className="flex-1 rounded-md border border-neutral-300 px-2 py-1.5 font-mono text-sm dark:border-neutral-700 dark:bg-neutral-900" />
              <button onClick={onAttach} disabled={busy !== null || !tx.trim()} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">{busy === 'attach' ? t('Checking…') : t('Submit')}</button>
            </div>
          </label>
          {scan.payments.length > 0 ? (
            <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50/60 p-3 dark:border-amber-800 dark:bg-amber-950/30">
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">{t('Not enough paid yet — the scan stays locked.')}</p>
              {/* Each payment counts: several small transactions add up to the fee. */}
              <ul className="space-y-0.5 text-xs">
                {scan.payments.map((p) => (
                  <li key={p.txHash} className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-neutral-500">{p.txHash.slice(0, 12)}…{p.txHash.slice(-6)}</span>
                    <span className={`shrink-0 tabular-nums ${p.seen ? 'text-neutral-700 dark:text-neutral-300' : 'text-neutral-400'}`}>{p.seen ? `${p.ada} ₳` : t('confirming…')}</span>
                  </li>
                ))}
              </ul>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 border-t border-amber-200 pt-1 text-sm tabular-nums dark:border-amber-900">
                <dt className="text-neutral-600 dark:text-neutral-400">{t('Paid so far')}</dt>
                <dd className="text-right font-semibold text-neutral-800 dark:text-neutral-200">{scan.paidAda} ₳</dd>
                <dt className="text-neutral-600 dark:text-neutral-400">{t('Fee required')}</dt>
                <dd className="text-right font-semibold text-neutral-800 dark:text-neutral-200">{scan.feeAda} ₳</dd>
                <dt className="font-semibold text-red-700 dark:text-red-300">{t('Still missing')}</dt>
                <dd className="text-right font-bold text-red-700 dark:text-red-300">{Math.round((scan.feeAda - scan.paidAda) * 100) / 100} ₳</dd>
              </dl>
              <p className="text-xs text-neutral-600 dark:text-neutral-400">{t('Your payments add up — send another transaction for the missing amount (or more) and paste its hash above. It unlocks automatically; the chain is re-checked every few seconds.')} <button onClick={onRecheck} disabled={busy !== null} className="font-medium text-sky-700 hover:underline disabled:opacity-40 dark:text-sky-400">{busy === 'recheck' ? t('Checking…') : t('Check now')}</button></p>
            </div>
          ) : null}
        </div>
      ) : null}

      {scan.status === 'PAID' ? (
        <div className="space-y-2">
          <p className="text-sm text-emerald-600">{t('Payment confirmed. Run the scan to generate your score.')}</p>
          <button onClick={onRun} disabled={busy !== null} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">{busy === 'run' ? t('Scanning… (this can take up to a minute)') : t('Run scan')}</button>
        </div>
      ) : null}

      {scan.status === 'FAILED_RETRY' ? (
        <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
          <p className="text-sm text-amber-700 dark:text-amber-300">{t('The scan did not complete.')}{scan.error ? ` (${scan.error})` : ''} {t('Your payment still covers one more attempt.')}</p>
          <button onClick={onRun} disabled={busy !== null} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">{busy === 'run' ? t('Scanning…') : t('Try again')}</button>
        </div>
      ) : null}

      {scan.status === 'FAILED_CONTACT_ADMIN' ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {t('The scan failed twice. Please contact the Council board — your payment is recorded and eligible for a refund.')}{scan.error ? ` (${scan.error})` : ''}
        </div>
      ) : null}

      {scan.status === 'DONE' ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-emerald-600">{t('Your score')}</span>
            <div className="flex shrink-0 items-center gap-2">
              <button onClick={onFork} disabled={busy !== null} className="rounded-md border border-emerald-500 px-2.5 py-1 text-sm text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950">{busy === 'fork' ? t('Creating…') : t('Edit and rescan')}</button>
              <button onClick={() => onDownload(scan)} className="rounded-md border border-neutral-300 px-2.5 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">{t('Download')}</button>
            </div>
          </div>
          <p className="text-[11px] text-neutral-400">{t('Edit and rescan keeps this version and creates a new one you can edit, pay for and run again.')}</p>
          <ResultCard r={scan} />
        </div>
      ) : null}

      <button onClick={onNew} className="text-xs text-sky-600 hover:underline dark:text-sky-400">← {t('New scan')}</button>
    </div>
  );
}
