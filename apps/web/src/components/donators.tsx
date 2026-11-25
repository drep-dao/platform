'use client';

import { useEffect, useState } from 'react';
import { treasuryApi, type DonationRow } from '@/lib/api';
import { CopyButton } from './copy-button';
import { useExplorer } from '@/lib/explorer';
import { useT } from '@/lib/prefs-context';

const ada = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 6 });

/** §donate — the Treasury "Donators" panel: everyone who has donated, their address, comment and
 *  amount. Public, read-only. Long comments collapse behind "show more". */
export function Donators() {
  const t = useT();
  const { txUrl, addressUrl } = useExplorer();
  const [data, setData] = useState<{ donations: DonationRow[]; count: number; totalAda: number } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    treasuryApi.donations()
      .then((d) => alive && setData(d))
      .catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, []);

  if (failed) return <p className="text-sm text-red-600">{t('Could not load donations.')}</p>;
  if (!data) return <p className="text-sm text-neutral-500">{t('Loading…')}</p>;

  return (
    <div className="space-y-3">
      {/* Summary — total raised + how many gifts. Figures bold, treasury-green. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-900/50 dark:bg-emerald-950/30">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-emerald-700/70 dark:text-emerald-300/60">{t('Total donated')}</div>
          <div className="text-xl font-bold tabular-nums text-emerald-800 dark:text-emerald-200">{ada(data.totalAda)} ₳</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-emerald-700/70 dark:text-emerald-300/60">{t('Donations')}</div>
          <div className="text-xl font-bold tabular-nums text-emerald-800 dark:text-emerald-200">{data.count}</div>
        </div>
      </div>

      {data.donations.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-6 text-center text-sm text-neutral-500 dark:border-neutral-700">
          {t('No donations yet — be the first to support the Council.')}
        </p>
      ) : (
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {data.donations.map((d) => (
            <li key={d.id} className="p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {/* Donor address — monospace, linked to the explorer, with copy. */}
                  {d.address ? (
                    <div className="flex items-center gap-1.5">
                      <a href={addressUrl(d.address)} target="_blank" rel="noreferrer"
                        className="min-w-0 truncate font-mono text-xs text-neutral-700 underline-offset-2 hover:underline dark:text-neutral-300" title={d.address}>
                        {d.address}
                      </a>
                      <CopyButton text={d.address} label={t('Copy')} />
                    </div>
                  ) : (
                    <span className="text-xs text-neutral-400">{t('unknown address')}</span>
                  )}
                  {d.at ? (
                    <div className="mt-0.5 text-[11px] text-neutral-400">{new Date(d.at).toLocaleString()}</div>
                  ) : null}
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{ada(d.amountAda)} ₳</div>
                  {d.txHash ? (
                    <a href={txUrl(d.txHash)} target="_blank" rel="noreferrer"
                      className="font-mono text-[11px] text-neutral-500 underline-offset-2 hover:underline">
                      {t('tx')} {d.txHash.slice(0, 10)}… ↗
                    </a>
                  ) : null}
                </div>
              </div>
              {d.comment ? <Comment text={d.comment} t={t} /> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A donor comment — collapsed behind "show more" when long. */
function Comment({ text, t }: { text: string; t: (s: string) => string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 140;
  const shown = open || !long ? text : text.slice(0, 140).trimEnd() + '…';
  return (
    <div className="mt-2 rounded border border-emerald-200 bg-emerald-50/60 px-2.5 py-1.5 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-200">
      <span className="whitespace-pre-wrap italic">“{shown}”</span>
      {long ? (
        <button onClick={() => setOpen((v) => !v)} className="ml-1 font-medium text-emerald-700 underline dark:text-emerald-400">
          {open ? t('show less') : t('show more')}
        </button>
      ) : null}
    </div>
  );
}
