'use client';

import { useEffect, useRef, useState } from 'react';
import { treasuryApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { connectWalletForTx, type Cip30WalletEntry } from '@/lib/cip30';
import { usePrefs } from '@/lib/prefs-context';
import { useExplorer } from '@/lib/explorer';
import { brand } from '@/lib/brand';

/**
 * §donate — a public donation to the Council treasury. Anyone connects a wallet (no login) and
 * sends ADA to the multisig, optionally with a comment that rides along as CIP-20 metadata and is
 * shown against the incoming tx in the treasury history. The platform builds the unsigned tx
 * (prepare), the wallet signs it, the platform submits it (submit).
 */
export function DonateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = usePrefs();
  const { wallets, refreshWallets } = useAuth();
  const { txUrl, cfg } = useExplorer();
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<string | null>(null); // wallet key currently signing
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  // Re-scan for injected wallets each time the dialog opens (extensions inject late).
  useEffect(() => { if (open) refreshWallets(); }, [open, refreshWallets]);
  // Reset transient state when the dialog is closed so a re-open starts clean.
  useEffect(() => { if (!open) { setError(null); setTxHash(null); setBusy(null); } }, [open]);

  if (!open) return null;

  const amt = Number(amount);
  const amountValid = Number.isFinite(amt) && amt >= 1;
  const network = cfg?.network ?? 'Preprod';
  const isTestnet = network !== 'Mainnet';

  async function donate(entry: Cip30WalletEntry) {
    if (!amountValid || busy) return;
    setError(null);
    setBusy(entry.key);
    try {
      const api = await connectWalletForTx(entry);
      const utxosHex = (await api.getUtxos?.()) ?? [];
      if (!utxosHex.length) throw new Error(t('This wallet has no spendable ADA on this network.'));
      const changeAddressHex = await api.getChangeAddress?.();
      if (!changeAddressHex) throw new Error(t('Could not read an address from your wallet.'));
      const prepared = await treasuryApi.donatePrepare({
        amountAda: amt,
        comment: comment.trim() || undefined,
        changeAddressHex,
        utxosHex,
      });
      // Full sign — the donor owns every input (not a multisig), so partialSign is false.
      const witnessHex = await api.signTx(prepared.txHex, false);
      const { txHash } = await treasuryApi.donateSubmit({ donationId: prepared.donationId, witnessHex });
      setTxHash(txHash);
    } catch (e) {
      // CIP-30 throws a {code,info} object on user-decline; surface a readable line.
      const msg = e instanceof Error ? e.message : typeof e === 'object' && e && 'info' in e ? String((e as { info?: unknown }).info) : String(e);
      setError(msg || t('The donation could not be completed.'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={t('Donate to DRep Council')}
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/60 px-4"
      onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}>
        {txHash ? (
          // ---- Success ----
          <div className="text-center">
            <Confetti />
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              <CheckIcon />
            </div>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{t('Thank you for your donation!')}</h2>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
              {t('Your donation has been submitted to the network. It will appear in the treasury once confirmed.')}
            </p>
            <a href={txUrl(txHash)} target="_blank" rel="noreferrer"
              className="mt-4 inline-block break-all font-mono text-xs text-emerald-700 underline dark:text-emerald-400">
              {txHash}
            </a>
            <button onClick={onClose}
              className="mt-5 w-full rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-105">
              {t('Done')}
            </button>
          </div>
        ) : (
          // ---- Form ----
          <>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{t('Donate to')} {brand.name}</h2>
                <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">{t('Send ADA to the community treasury. Anyone can contribute.')}</p>
              </div>
              <button onClick={onClose} aria-label={t('Close')}
                className="rounded-full p-1 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800">
                <CloseIcon />
              </button>
            </div>

            {isTestnet ? (
              <div className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                {t('Testnet')} ({network}) — {t('this uses test ADA, not real funds.')}
              </div>
            ) : null}

            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">{t('Amount (ADA)')}</label>
            <input type="number" inputMode="decimal" min={1} step={1} value={amount}
              onChange={(e) => setAmount(e.target.value)} placeholder="25"
              className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm tabular-nums outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950" />
            <div className="mt-1.5 flex gap-1.5">
              {[25, 100, 500].map((v) => (
                <button key={v} type="button" onClick={() => setAmount(String(v))}
                  className="rounded-full border border-neutral-200 px-2.5 py-1 text-xs text-neutral-600 transition hover:border-emerald-400 hover:text-emerald-700 dark:border-neutral-700 dark:text-neutral-400">
                  ₳ {v}
                </button>
              ))}
            </div>

            <label className="mt-4 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              {t('Comment')} <span className="font-normal text-neutral-400">({t('optional')})</span>
            </label>
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} maxLength={1000}
              placeholder={t('Shown on-chain and in the treasury history')}
              className="mt-1 w-full resize-none rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950" />

            {error ? (
              <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</div>
            ) : null}

            <div className="mt-5 space-y-2">
              {wallets.length === 0 ? (
                <p className="text-center text-sm text-neutral-500 dark:text-neutral-400">
                  {t('No Cardano wallet detected. Install a wallet extension (Eternl, Lace, …) to donate.')}
                </p>
              ) : (
                wallets.map((w) => (
                  // Icon in a fixed left slot (absolute) so every wallet icon lines up in one column
                  // while the label stays centred.
                  <button key={w.key} type="button" disabled={!amountValid || !!busy} onClick={() => donate(w)}
                    className="relative flex w-full items-center justify-center rounded-full bg-emerald-600 px-11 py-2.5 text-sm font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50">
                    {w.icon ? <img src={w.icon} alt="" className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 object-contain" /> : null}
                    <span>{busy === w.key ? t('Confirm in your wallet…') : `${t('Donate with')} ${w.name}`}</span>
                  </button>
                ))
              )}
            </div>
            <p className="mt-3 text-center text-[11.5px] text-neutral-400">{t('You pay only the network fee. The donation leaves your wallet directly.')}</p>
          </>
        )}
      </div>
    </div>
  );
}

/** A one-shot confetti burst for the thank-you moment — a full-screen canvas, dependency-free.
 *  Skipped when the viewer prefers reduced motion. */
function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    let W = window.innerWidth, H = window.innerHeight;
    const resize = () => { W = window.innerWidth; H = window.innerHeight; canvas.width = W * dpr; canvas.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    resize();
    const colors = ['#10b981', '#34d399', '#fbbf24', '#f472b6', '#60a5fa', '#a78bfa', '#f87171'];
    const parts = Array.from({ length: 150 }, () => ({
      x: W / 2 + (Math.random() - 0.5) * W * 0.4,
      y: H * 0.32 + (Math.random() - 0.5) * 40,
      vx: (Math.random() - 0.5) * 9,
      vy: Math.random() * -8 - 2,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.35,
      size: 6 + Math.random() * 6,
      color: colors[Math.floor(Math.random() * colors.length)],
      round: Math.random() < 0.4,
    }));
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const el = now - start;
      ctx.clearRect(0, 0, W, H);
      for (const p of parts) {
        p.vy += 0.16; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.globalAlpha = Math.max(0, 1 - el / 3000);
        ctx.fillStyle = p.color;
        if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2); ctx.fill(); }
        else ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.55);
        ctx.restore();
      }
      if (el < 3200) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    window.addEventListener('resize', resize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);
  return <canvas ref={ref} className="pointer-events-none fixed inset-0 z-[60]" aria-hidden="true" />;
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
