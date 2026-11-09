'use client';

import { useCallback, useEffect, useState } from 'react';
import { eventsApi, type ScheduledEvent } from '@/lib/api';
import { useT } from '@/lib/prefs-context';
import { card } from '@/lib/ui';

const field = 'w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900';

/** §events (board-only) — schedule a one-off landing-page event (a call) and cancel it any time. */
export function ScheduleEvent() {
  const t = useT();
  const [rows, setRows] = useState<ScheduledEvent[] | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [url, setUrl] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    eventsApi.listAll().then(setRows).catch(() => setRows([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const reset = () => { setTitle(''); setDescription(''); setUrl(''); setStartAt(''); setEndAt(''); };

  const create = async () => {
    setError(null);
    if (title.trim().length < 1) { setError(t('Enter a title.')); return; }
    if (!/^https?:\/\//i.test(url.trim())) { setError(t('Enter a valid http(s) link.')); return; }
    if (!startAt || !endAt) { setError(t('Set a start and end time.')); return; }
    const s = new Date(startAt), e = new Date(endAt);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) { setError(t('Invalid start/end time.')); return; }
    if (e.getTime() <= s.getTime()) { setError(t('The end time must be after the start time.')); return; }
    setBusy(true);
    try {
      await eventsApi.create({ title: title.trim(), description: description.trim(), url: url.trim(), startAt: s.toISOString(), endAt: e.toISOString() });
      reset();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (id: string) => { await eventsApi.remove(id).catch(() => undefined); load(); };

  const now = Date.now();

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('Schedule Event')}</h2>
        <p className="text-sm text-neutral-500">{t('Schedule a one-off event (a call) shown on the landing page. It appears until it ends; you can cancel it any time. Board members only.')}</p>
      </div>

      <section className={card}>
        <h3 className="mb-3 text-sm font-semibold">{t('New event')}</h3>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">{t('Title')}</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={field} placeholder={t('e.g. Community call: Q1 roadmap')} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">{t('Supporting text (optional)')}</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} className={field} placeholder={t('A short line shown under the title')} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">{t('Join link (Google Meet or any http(s) link)')}</label>
            <input value={url} onChange={(e) => setUrl(e.target.value)} className={field} placeholder="https://meet.google.com/…" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">{t('Starts')}</label>
              <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} className={field} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">{t('Ends')}</label>
              <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} className={field} />
            </div>
          </div>
          <p className="text-xs text-neutral-400">{t('The event stays on the landing page until its end time (so people can still join while it is live).')}</p>
          {error ? <p className="text-xs text-red-500">{error}</p> : null}
          <button disabled={busy} onClick={create} className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40">
            {busy ? t('Scheduling…') : t('Schedule event')}
          </button>
        </div>
      </section>

      <section className={card}>
        <h3 className="mb-3 text-sm font-semibold">{t('Scheduled events')}</h3>
        {rows === null ? (
          <p className="text-sm text-neutral-500">{t('Loading…')}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-neutral-500">{t('No events scheduled.')}</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((ev) => {
              const ended = new Date(ev.endAt).getTime() <= now;
              const live = !ended && new Date(ev.startAt).getTime() <= now;
              return (
                <li key={ev.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm ${ended ? 'border-neutral-200 opacity-60 dark:border-neutral-800' : 'border-neutral-200 dark:border-neutral-700'}`}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{ev.title}</span>
                      {live ? <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-[11px] font-medium text-indigo-700 dark:text-indigo-300">{t('live now')}</span> : ended ? <span className="rounded-full bg-neutral-400/20 px-2 py-0.5 text-[11px] text-neutral-600 dark:text-neutral-300">{t('ended')}</span> : null}
                    </div>
                    <div className="mt-0.5 text-xs text-neutral-500">
                      {new Date(ev.startAt).toLocaleString()} → {new Date(ev.endAt).toLocaleString()}
                    </div>
                    <a href={ev.url} target="_blank" rel="noreferrer" className="break-all text-xs text-emerald-700 underline dark:text-emerald-400">{ev.url}</a>
                  </div>
                  <button onClick={() => cancel(ev.id)} className="shrink-0 rounded-md border border-rose-300 px-2.5 py-1 text-xs text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950">
                    {t('Cancel')}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
