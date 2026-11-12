'use client';

import { useEffect, useMemo, useState } from 'react';
import { eventsApi, publicApi, type PublicOverview, type ScheduledEvent } from '@/lib/api';
import { useT } from '@/lib/prefs-context';
import { card } from '@/lib/ui';

/**
 * §cal — Calendar. Shows all upcoming events on a Google-Calendar-style grid: the one-off events
 * scheduled via Schedule Event (GET /events/upcoming) and the recurring weekly meeting from the public
 * overview (meetingUrl + meetingTime). Two views — a rolling 2-week window with arrows, or a month —
 * both future-only. Click a day to see its events with the join link and an .ics download.
 */

type Occ = { id: string; title: string; description: string; url: string; start: Date; end: Date; recurring: boolean };

const DAY_MS = 86_400_000;
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d: Date, n: number) => startOfDay(new Date(d.getTime() + n * DAY_MS));
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const startOfWeekMonday = (d: Date) => { const x = startOfDay(d); return addDays(x, -((x.getDay() + 6) % 7)); };
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const fmtTime = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const pad = (n: number) => String(n).padStart(2, '0');

function buildOccurrences(events: ScheduledEvent[], ov: PublicOverview | null, rangeStart: Date, rangeEnd: Date, now: Date): Occ[] {
  const out: Occ[] = [];
  for (const e of events) {
    const start = new Date(e.startAt);
    const end = new Date(e.endAt);
    if (start >= rangeStart && start < rangeEnd) out.push({ id: e.id, title: e.title, description: e.description, url: e.url, start, end, recurring: false });
  }
  const mt = ov?.meetingTime;
  const mUrl = ov?.meetingUrl;
  if (mt && mUrl) {
    const [sh, sm] = mt.start.split(':').map(Number);
    const [eh, em] = mt.end.split(':').map(Number);
    for (let d = new Date(rangeStart); d < rangeEnd; d = addDays(d, 1)) {
      if (d.getDay() !== mt.weekday) continue;
      const start = new Date(d); start.setHours(sh || 0, sm || 0, 0, 0);
      const end = new Date(d); end.setHours(eh || 0, em || 0, 0, 0);
      if (end < now) continue; // future only
      out.push({ id: `rec:${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, title: 'Regular meeting', description: ov?.meetingSchedule ?? '', url: mUrl, start, end, recurring: true });
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

const escapeIcs = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
const icsStamp = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

function downloadIcs(occ: Occ) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DRep Council//Calendar//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    `UID:${occ.id}@drepcouncil`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(occ.start)}`,
    `DTEND:${icsStamp(occ.end)}`,
    `SUMMARY:${escapeIcs(occ.title)}`,
    `DESCRIPTION:${escapeIcs((occ.description ? occ.description + '\n' : '') + occ.url)}`,
    `URL:${occ.url}`,
    'END:VEVENT', 'END:VCALENDAR',
  ];
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${occ.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'event'}.ics`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function CalendarView() {
  const t = useT();
  const now = useMemo(() => new Date(), []);
  const today = useMemo(() => startOfDay(now), [now]);
  const thisWeek = useMemo(() => startOfWeekMonday(today), [today]);
  const thisMonth = useMemo(() => new Date(today.getFullYear(), today.getMonth(), 1), [today]);

  const [events, setEvents] = useState<ScheduledEvent[]>([]);
  const [overview, setOverview] = useState<PublicOverview | null>(null);
  const [mode, setMode] = useState<'fortnight' | 'month'>('fortnight');
  const [fnAnchor, setFnAnchor] = useState<Date>(thisWeek);
  const [monthAnchor, setMonthAnchor] = useState<Date>(thisMonth);
  const [selected, setSelected] = useState<Date | null>(null);

  useEffect(() => { eventsApi.upcoming().then(setEvents).catch(() => setEvents([])); }, []);
  useEffect(() => { publicApi.overview().then(setOverview).catch(() => setOverview(null)); }, []);

  // The grid's day span. Fortnight = 14 days from the anchor week. Month = whole weeks covering the month.
  const gridStart = mode === 'fortnight' ? fnAnchor : startOfWeekMonday(monthAnchor);
  const gridDays = useMemo(() => {
    if (mode === 'fortnight') return Array.from({ length: 14 }, (_, i) => addDays(fnAnchor, i));
    const first = monthAnchor;
    const start = startOfWeekMonday(first);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    const weeks = Math.ceil(((last.getDate()) + ((first.getDay() + 6) % 7)) / 7);
    return Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
  }, [mode, fnAnchor, monthAnchor]);
  const gridEnd = addDays(gridDays[gridDays.length - 1], 1);

  const occurrences = useMemo(() => buildOccurrences(events, overview, gridStart, gridEnd, now), [events, overview, gridStart, gridEnd, now]);
  const occsByDay = useMemo(() => {
    const m = new Map<string, Occ[]>();
    for (const o of occurrences) {
      const k = `${o.start.getFullYear()}-${o.start.getMonth()}-${o.start.getDate()}`;
      (m.get(k) ?? m.set(k, []).get(k)!).push(o);
    }
    return m;
  }, [occurrences]);
  const dayOccs = (d: Date) => occsByDay.get(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`) ?? [];

  const canBack = mode === 'fortnight' ? fnAnchor > thisWeek : monthAnchor > thisMonth;
  const back = () => mode === 'fortnight' ? setFnAnchor((a) => { const n = addDays(a, -14); return n < thisWeek ? thisWeek : n; }) : setMonthAnchor((a) => { const n = addMonths(a, -1); return n < thisMonth ? thisMonth : n; });
  const fwd = () => mode === 'fortnight' ? setFnAnchor((a) => addDays(a, 14)) : setMonthAnchor((a) => addMonths(a, 1));

  const label = mode === 'fortnight'
    ? `${fnAnchor.toLocaleDateString([], { day: 'numeric', month: 'short' })} – ${addDays(fnAnchor, 13).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}`
    : `${t(MONTH_NAMES[monthAnchor.getMonth()])} ${monthAnchor.getFullYear()}`;

  const selectedOccs = selected ? dayOccs(selected) : [];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('Calendar')}</h2>
        <p className="text-sm text-neutral-500">{t('Upcoming meetings and scheduled events. Click a day to see its events and join links.')}</p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={back} disabled={!canBack} title={t('Back')} className="rounded-md border border-neutral-300 px-2 py-1 text-sm disabled:opacity-30 dark:border-neutral-700">←</button>
          <button onClick={fwd} title={t('Forward')} className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700">→</button>
          <span className="text-sm font-medium">{label}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-md border border-neutral-300 text-xs dark:border-neutral-700">
            {(['fortnight', 'month'] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} className={`px-2.5 py-1 font-medium ${mode === m ? 'bg-emerald-600 text-white' : 'bg-white text-neutral-600 hover:bg-neutral-100 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800'}`}>
                {m === 'fortnight' ? t('2 weeks') : t('Month')}
              </button>
            ))}
          </div>
          <input
            type="month"
            min={`${thisMonth.getFullYear()}-${pad(thisMonth.getMonth() + 1)}`}
            value={`${monthAnchor.getFullYear()}-${pad(monthAnchor.getMonth() + 1)}`}
            onChange={(e) => {
              const [y, mo] = e.target.value.split('-').map(Number);
              if (!y || !mo) return;
              const picked = new Date(y, mo - 1, 1);
              setMonthAnchor(picked < thisMonth ? thisMonth : picked);
              setMode('month');
            }}
            className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
        </div>
      </div>

      {/* Grid */}
      <section className={card}>
        <div className="grid grid-cols-7 gap-px">
          {WEEKDAYS.map((w) => <div key={w} className="pb-1 text-center text-xs font-semibold uppercase tracking-wide text-neutral-400">{t(w)}</div>)}
          {gridDays.map((d) => {
            const occs = dayOccs(d);
            const isPast = d < today;
            const isToday = sameDay(d, today);
            const outside = mode === 'month' && d.getMonth() !== monthAnchor.getMonth();
            const isSel = selected && sameDay(d, selected);
            return (
              <button
                key={d.toISOString()}
                onClick={() => setSelected(d)}
                disabled={occs.length === 0}
                className={`flex min-h-[72px] flex-col gap-0.5 rounded-sm border p-1 text-left align-top transition ${
                  isSel ? 'border-emerald-500 ring-1 ring-emerald-500' : 'border-neutral-200 dark:border-neutral-800'
                } ${outside || isPast ? 'bg-neutral-50/60 opacity-60 dark:bg-neutral-900/40' : 'bg-white dark:bg-neutral-900'} ${occs.length ? 'cursor-pointer hover:border-emerald-400' : 'cursor-default'}`}
              >
                <span className={`text-xs font-medium ${isToday ? 'flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-white' : 'text-neutral-500'}`}>{d.getDate()}</span>
                {occs.slice(0, 3).map((o) => (
                  <span key={o.id} className={`truncate rounded px-1 text-[11px] leading-tight ${o.recurring ? 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'}`} title={o.title}>
                    {fmtTime(o.start)} {o.title}
                  </span>
                ))}
                {occs.length > 3 ? <span className="px-1 text-[10px] text-neutral-400">+{occs.length - 3} {t('more')}</span> : null}
              </button>
            );
          })}
        </div>
      </section>

      {/* Selected-day details */}
      {selected ? (
        <section className={card}>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-medium">{selected.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h3>
            <button onClick={() => setSelected(null)} className="text-xs text-neutral-500 hover:underline">{t('Close')}</button>
          </div>
          {selectedOccs.length === 0 ? <p className="text-sm text-neutral-500">{t('No events on this day.')}</p> : (
            <ul className="space-y-3">
              {selectedOccs.map((o) => (
                <li key={o.id} className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{o.title}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${o.recurring ? 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'}`}>{o.recurring ? t('Recurring') : t('Event')}</span>
                    <span className="text-xs text-neutral-500">{fmtTime(o.start)}–{fmtTime(o.end)}</span>
                  </div>
                  {o.description ? <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-600 dark:text-neutral-400">{o.description}</p> : null}
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                    {o.url ? <a href={o.url} target="_blank" rel="noopener noreferrer" className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700">{/meet\.google\.com/.test(o.url) ? t('Join Google Meet') : t('Join meeting')}</a> : null}
                    <button onClick={() => downloadIcs(o)} className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">{t('Add to calendar (.ics)')}</button>
                    {o.url ? <a href={o.url} target="_blank" rel="noopener noreferrer" className="min-w-0 break-all text-xs text-neutral-400 hover:underline">{o.url}</a> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <p className="text-sm text-neutral-500">{t('Click a highlighted day to see its events.')}</p>
      )}
    </div>
  );
}
