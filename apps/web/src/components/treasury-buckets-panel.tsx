'use client';

import { useCallback, useEffect, useState } from 'react';
import { treasuryBucketsApi, type TreasuryBucket } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { CopyButton } from './copy-button';
import { useT } from '@/lib/prefs-context';

/**
 * §15.5/§R — the FIXED treasury bucket set: Main (the bare multisig address),
 * Request fees, Operations and Rewards. The labeled buckets are distinct
 * on-chain addresses that spend with the same N board signatures (see
 * TreasuryBucketsService docstring). The set is auto-provisioned per multisig —
 * no creating or deleting buckets in this edition; the board can only re-point
 * which bucket is the default for each operation.
 *
 * Self-hides until the multisig is assembled (no script to wrap).
 */
export function TreasuryBucketsPanel({ onChange }: { onChange?: () => void }) {
  const t = useT();
  const { profile } = useAuth();
  const isBoard = !!profile?.roles.includes('BOARD');
  const [data, setData] = useState<{ multisigConfigured: boolean; buckets: TreasuryBucket[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    treasuryBucketsApi.list().then(setData).catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, []);
  useEffect(load, [load]);

  if (!data) return null;
  if (!data.multisigConfigured) return null;

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold">{t('Treasury buckets')} ({data.buckets.length})</div>
        <span className="text-xs text-neutral-500">
          {t('Fixed set: Main, Request fees, Operations, Rewards — sub-addresses of the same multisig, same signing requirement, distinct on-chain addresses.')}
        </span>
      </div>
      <div className="space-y-1">
        {data.buckets.map((b) => (
          <BucketRow key={b.id} b={b} isBoard={isBoard} onChange={() => { load(); onChange?.(); }} />
        ))}
      </div>
      {error ? <div className="mt-1 text-xs text-red-600">{error}</div> : null}
    </section>
  );
}

function BucketRow({ b, isBoard, onChange }: { b: TreasuryBucket; isBoard: boolean; onChange: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleDefault = async (
    op: 'REWARDS' | 'OPERATIONS' | 'SUBMISSION_FEES',
    value: boolean,
  ) => {
    setError(null); setBusy(true);
    try { await treasuryBucketsApi.setDefault(b.id, op, value); onChange(); }
    catch (e) { setError(e instanceof Error ? e.message : 'failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className={`mt-1 rounded border p-2 text-xs ${
      b.isPrimary
        ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30'
        : 'border-neutral-200 bg-neutral-50/60 dark:border-neutral-800 dark:bg-neutral-800/30'
    }`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-medium">
          {b.label}
          {b.isPrimary ? <span className="ml-1 text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-400">{t('primary')}</span> : null}
        </span>
        <span className="tabular-nums text-neutral-700 dark:text-neutral-300">{b.balanceAda.toLocaleString()} ₳ {t('on-chain')}</span>
      </div>
      {/* §15.6 — per-operation default chips: which bucket each flow uses.
            OUTBOUND (spend from): Rewards, Operations
            INBOUND (receive at):  Request fees
          Toggling one bucket clears the same op on others (single default
          per op per multisig). */}
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <span className="text-[10px] uppercase tracking-wide text-neutral-500">{t('default for:')}</span>
        {([
          ['REWARDS',         t('Rewards'),      b.isDefaultRewards,        t('DRep / board reward payouts spend from this bucket')],
          ['OPERATIONS',      t('Operations'),   b.isDefaultOperations,     t('hot-wallet top-ups spend from this bucket')],
          ['SUBMISSION_FEES', t('Request fees'), b.isDefaultSubmissionFees, t('submitters are told to pay request fees here')],
        ] as const).map(([op, label, on, hint]) => (
          <button
            key={op}
            disabled={busy || !isBoard}
            onClick={() => toggleDefault(op, !on)}
            title={isBoard ? hint : `${t('Default for')} ${label}: ${on ? t('yes') : t('no')}`}
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
              on
                ? 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-80'
                : 'border border-neutral-300 text-neutral-600 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'
            }`}
          >
            {on ? '✓ ' : ''}{label}
          </button>
        ))}
      </div>
      <div className="mt-1 flex items-start gap-2">
        <div className="flex-1 break-all font-mono text-[11px] text-neutral-600 dark:text-neutral-400">{b.bech32Address}</div>
        <CopyButton text={b.bech32Address} label={t('Copy')} />
      </div>
      {error ? <div className="mt-1 text-[11px] text-red-600">{error}</div> : null}
    </div>
  );
}
