'use client';

import { useEffect, useState, type KeyboardEvent } from 'react';
import { publicApi, type PublicOverview, type ActiveVote } from '@/lib/api';
import { usePrefs } from '@/lib/prefs-context';
import { brand } from '@/lib/brand';

/** ₳ with thousands separators; em-dash when the value is unknown (chain hiccup). */
function ada(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return '₳ ' + Math.round(n).toLocaleString();
}

// A funding round moves Submission → Filtering → Debate·Vote·Tally → Funding.
const STAGES = [
  { key: 'SUBMISSION', label: 'Submission' },
  { key: 'FILTERING', label: 'Filtering' },
  { key: 'DV', label: 'Debate · Vote · Tally' },
  { key: 'FUNDING', label: 'Funding' },
];
// A governance Council runs a continuous cycle rather than budgeted rounds.
const GOV_FLOW = ['Join', 'Propose', 'Vote', 'Act'];

export function PublicLanding({ onConnect, onExplore, onOpenVote }: { onConnect: () => void; onExplore: () => void; onOpenVote?: (id: string) => void }) {
  const { t } = usePrefs();
  const [data, setData] = useState<PublicOverview | null>(null);
  const [failed, setFailed] = useState(false);
  const governance = brand.kind === 'governance';

  useEffect(() => {
    let alive = true;
    publicApi
      .overview()
      .then((d) => alive && setData(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const round = data?.activeRound ?? null;
  const stageIdx = Math.max(0, STAGES.findIndex((s) => s.key === round?.status));
  const n = (v: number) => v.toLocaleString();

  // ---- hero copy differs by edition (values composed OUTSIDE t() so parts translate) ----
  const hero = governance
    ? {
        badge: data ? (data.board.elected ? `${t('Board elected')} · ${data.board.seats} ${t('seats')}` : t('No board yet — DReps can propose one')) : null,
        title: t('Govern Cardano, together.'),
        blurb: t('A community of DReps that debate, propose and vote on-chain. Anyone can watch; connect a wallet to join and vote — no gatekeeping.'),
        explore: t('Meet the DReps'),
      }
    : {
        badge: round ? `${t('Round')} ${round.number} — ${t('accepting proposals')}` : null,
        title: t('Fund the next wave of Cardano.'),
        blurb: t('A community treasury, governed by DReps, spent in the open. Explore everything here — connect a wallet when you’re ready to submit or vote.'),
        explore: t('Explore proposals'),
      };

  return (
    <div className="space-y-4">
      {/* ---- Hero banner ---- */}
      <section className="relative overflow-hidden rounded-2xl p-8 text-emerald-50 sm:p-10"
        style={{ background: 'radial-gradient(120% 140% at 100% 0, #0e6f73 0%, #0e7a4b 46%, #0b5f3b 100%)' }}>
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(255,255,255,.16), transparent 60%)' }} />
        <div className="relative">
          {hero.badge ? (
            <span className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-[13px] font-medium">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#7dffc0' }} />
              {hero.badge}
            </span>
          ) : null}
          <h1 className="max-w-[18ch] text-4xl font-bold leading-[1.03] tracking-tight sm:text-5xl">{hero.title}</h1>
          <p className="mt-3 max-w-[52ch] text-[16.5px] text-emerald-100/90">{hero.blurb}</p>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <button onClick={onExplore}
              className="rounded-full bg-emerald-50 px-5 py-2.5 text-sm font-semibold text-[#0b5f3b] transition hover:bg-white">
              {hero.explore}
            </button>
            <button onClick={onConnect}
              className="rounded-full bg-white/15 px-5 py-2.5 text-sm font-semibold text-emerald-50 transition hover:bg-white/25">
              {t('Connect wallet')}
            </button>
          </div>
        </div>
      </section>

      {/* ---- Stat tiles ---- */}
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {governance ? (
          <>
            <Tile loading={!data} bg="#0e7a4b" label={t('Voting DReps')} big={`${data?.members.votingDReps ?? 0}`}
              sub={data?.admissionOpen ? t('Open admission — join freely') : t('Board-gated admission')} />
            <Tile loading={!data} bg="#0e6f73" label={t('Governance proposals')} big={`${data?.internalProposals.total ?? 0}`}
              sub={`${data?.internalProposals.passed ?? 0} ${t('passed')} · ${data?.internalProposals.active ?? 0} ${t('in voting')}`} />
            <Tile loading={!data} bg="#4f8f2f" label={t('Requests')} big={`${data?.requests?.active ?? 0}`}
              sub={`${data?.requests?.total ?? 0} ${t('total')} · ${t('submitters → DReps')}`} />
            <Tile loading={!data} bg="#173a2a" label={t('Governance')} big={data?.admissionOpen ? t('Open') : t('Gated')}
              sub={t('Any registered DRep can join & vote')} />
          </>
        ) : (
          <>
            <Tile loading={!data} bg="#0e7a4b" label={t('Treasury balance')} big={ada(data?.treasuryBalanceAda)}
              sub={round ? `₳ ${n(round.budgetAda)} ${t('committed to Round')} ${round.number}` : t('On-chain, live')} />
            <Tile loading={!data} bg="#0e6f73" label={round ? `${t('Round')} ${round.number} ${t('budget')}` : t('Round budget')}
              big={round ? ada(round.budgetAda) : '—'}
              sub={round ? `+ ₳ ${n(round.rewardsPoolAda)} ${t('rewards pool')}` : t('No active round')} />
            <Tile loading={!data} bg="#4f8f2f" label={t('Voting DReps')} big={`${data?.members.votingDReps ?? 0}`}
              sub={`${data?.members.experts ?? 0} ${t('experts advising')}`} />
            <Tile loading={!data} bg="#173a2a" label={t('Proposals')} big={`${data?.proposals.total ?? 0}`}
              sub={`${data?.proposals.approved ?? 0} ${t('approved')} · ${data?.proposals.inReview ?? 0} ${t('in review')}`} />
          </>
        )}
      </div>

      {/* ---- Bottom strip: round stages (funding) or governance flow (DRep) ---- */}
      {governance ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-neutral-200 bg-white px-5 py-4 dark:border-neutral-800 dark:bg-neutral-900">
          {GOV_FLOW.map((label, i) => (
            <div key={label} className="flex items-center gap-3">
              {i > 0 ? <span className="text-neutral-300 dark:text-neutral-700">→</span> : null}
              <span className="flex items-center gap-2 text-[13.5px]">
                <span className="grid h-[22px] w-[22px] place-items-center rounded-full bg-emerald-600 text-[12px] font-bold text-white">{i + 1}</span>
                <span className="font-medium text-neutral-800 dark:text-neutral-200">{t(label)}</span>
              </span>
            </div>
          ))}
          <span className="ml-auto text-[12.5px] text-neutral-500 dark:text-neutral-400">
            {data?.board.elected ? `${t('Board of')} ${data.board.seats} · ${t('DReps propose & vote on governance')}` : t('DReps can propose the founding board')}
          </span>
        </div>
      ) : round ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-neutral-200 bg-white px-5 py-4 dark:border-neutral-800 dark:bg-neutral-900">
          {STAGES.map((s, i) => (
            <div key={s.key} className="flex items-center gap-3">
              {i > 0 ? <span className="text-neutral-300 dark:text-neutral-700">→</span> : null}
              <span className="flex items-center gap-2 text-[13.5px]">
                <span className={`grid h-[22px] w-[22px] place-items-center rounded-full text-[12px] font-bold ${
                  i === stageIdx ? 'bg-emerald-600 text-white' : 'bg-neutral-200 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'
                }`}>{i + 1}</span>
                <span className={i === stageIdx ? 'font-semibold text-neutral-900 dark:text-neutral-100' : 'text-neutral-500 dark:text-neutral-400'}>
                  {t(s.label)}
                </span>
              </span>
            </div>
          ))}
          <span className="ml-auto text-[12.5px] text-neutral-500 dark:text-neutral-400">
            {t('Round')} {round.number} · {round.name} · {data?.admissionOpen ? t('open admission') : t('board-gated admission')}
          </span>
        </div>
      ) : null}

      {/* ---- Telegram coordination group — governance only, and only when an invite is configured ---- */}
      {governance && data?.telegramUrl ? (
        <a href={data.telegramUrl} target="_blank" rel="noreferrer"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-200 bg-sky-50 px-5 py-4 transition hover:bg-sky-100 dark:border-sky-900/60 dark:bg-sky-950/30 dark:hover:bg-sky-950/50">
          <span className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#229ED9] text-white">
              <TelegramIcon />
            </span>
            <span className="min-w-0">
              <span className="block font-semibold text-sky-900 dark:text-sky-100">{t('Join our coordination Telegram group')}</span>
              <span className="block text-[13px] text-sky-800/70 dark:text-sky-200/60">{t('Coordinate with other DReps, ask questions and stay in the loop.')}</span>
            </span>
          </span>
          <span className="shrink-0 rounded-full bg-[#229ED9] px-5 py-2 text-sm font-semibold text-white hover:brightness-105">{t('Open Telegram')}</span>
        </a>
      ) : null}

      {/* ---- Regular meetings — governance only, only when a link is configured. A permanent
             Google Meet link is preferred over a calendar link (guests can just click to join);
             the button label and subtitle adapt to whichever kind of link the admin set. ---- */}
      {governance && data?.meetingUrl ? (() => {
        const isMeet = /meet\.google\.com/i.test(data.meetingUrl);
        return (
        <a href={data.meetingUrl} target="_blank" rel="noreferrer"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 transition hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:hover:bg-emerald-950/50">
          <span className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-600 text-white">
              {isMeet ? <VideoIcon /> : <CalendarIcon />}
            </span>
            <span className="min-w-0">
              <span className="block font-semibold text-emerald-900 dark:text-emerald-100">{t('Join our regular meetings')}</span>
              {data.meetingTime ? <MeetingCountdown m={data.meetingTime} t={t} /> : null}
              <span className="block text-[13px] text-emerald-800/70 dark:text-emerald-200/60">
                {data.meetingSchedule
                  ? data.meetingSchedule
                  : isMeet
                    ? t('Click to join our recurring DRep Council video call.')
                    : t('Add our recurring DRep Council call to your calendar.')}
              </span>
            </span>
          </span>
          <span className="shrink-0 rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:brightness-105">{isMeet ? t('Join Google Meet') : t('Add to calendar')}</span>
        </a>
        );
      })() : null}

      {/* ---- Votes in progress: live internal votes with end date + a result chart ---- */}
      {governance && data && data.activeVotes.length > 0 ? (
        <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <h3 className="mb-3 text-sm font-semibold text-neutral-800 dark:text-neutral-200">{t('Votes in progress')}</h3>
          <div className="space-y-3">
            {data.activeVotes.map((v) => <VoteBar key={v.id} v={v} t={t} onOpen={onOpenVote ? () => onOpenVote(v.id) : undefined} />)}
          </div>
        </div>
      ) : null}

      {/* ---- Transparency footer note ---- */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[12.5px] text-neutral-500 dark:text-neutral-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          {t('Live on')} {data?.network ?? 'Preprod'}
        </span>
        <span>{t('Every vote & payment anchored on-chain')}</span>
        {data?.admissionOpen ? <span>{t('Open admission — any registered DRep can join & vote')}</span> : null}
        {failed ? <span className="text-amber-600 dark:text-amber-500">{t('Some live figures are temporarily unavailable.')}</span> : null}
      </div>
    </div>
  );
}

// A live vote: title, a YES/NO result bar with the threshold marker (like the proposal result
// chart), pass/fail state, and the voting-end date (red when ≤ 1 day remains).
function VoteBar({ v, t, onOpen }: { v: ActiveVote; t: (s: string) => string; onOpen?: () => void }) {
  const end = v.votingEndAt ? new Date(v.votingEndAt) : null;
  const soon = end ? end.getTime() - Date.now() <= 24 * 3600_000 : false;
  const yesPct = Math.min(100, Math.max(0, v.ratioPct ?? 0));
  const thr = v.thresholdPct ?? 67;
  return (
    <div
      className={`rounded-lg border border-neutral-200 p-3 dark:border-neutral-800 ${onOpen ? 'cursor-pointer transition hover:border-emerald-300 hover:bg-neutral-50 dark:hover:border-emerald-800 dark:hover:bg-neutral-800/40' : ''}`}
      {...(onOpen ? { role: 'button', tabIndex: 0, onClick: onOpen, onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } } } : {})}
    >
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          {v.publicId ? <span className="font-mono text-xs text-neutral-500">{v.publicId} </span> : null}
          <span className="font-medium text-neutral-800 dark:text-neutral-200">{v.title}</span>
        </div>
        {v.kind === 'THRESHOLD' ? (
          <span className={`text-xs font-semibold ${v.passing ? 'text-emerald-600' : 'text-red-600'}`}>{v.passing ? t('passing') : t('failing')}</span>
        ) : <span className="text-xs text-neutral-500">{t('poll')}</span>}
      </div>
      {v.kind === 'THRESHOLD' ? (
        <>
          <div className="mb-1 text-xs text-neutral-500">
            {t('YES')} {v.ratioPct}% · {v.voted}/{v.eligible} {t('voted')} · {t('threshold')} {thr}%
          </div>
          <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-red-300 dark:bg-red-900/50">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${yesPct}%` }} />
            <div className="absolute top-[-2px] h-[calc(100%+4px)] w-px bg-neutral-800 dark:bg-neutral-200" style={{ left: `${thr}%` }} />
          </div>
        </>
      ) : null}
      {end ? (
        <div className={`mt-1.5 text-xs ${soon ? 'font-semibold text-red-600 dark:text-red-400' : 'text-neutral-500'}`}>
          {t('ends')} {end.toLocaleString()}
        </div>
      ) : null}
    </div>
  );
}

type MeetingTimeT = { weekday: number; start: string; end: string; tz: string };

// Offset (ms) of an IANA timezone relative to UTC at a given instant — the standard
// "format in the zone, reparse as local, take the difference" trick (no tz library).
function tzOffsetMs(tz: string, at: Date): number {
  const utc = new Date(at.toLocaleString('en-US', { timeZone: 'UTC' }));
  const loc = new Date(at.toLocaleString('en-US', { timeZone: tz }));
  return loc.getTime() - utc.getTime();
}

// UTC epoch (ms) of the instant whose wall-clock time in `tz` is y-mo(0-based)-d h:mi.
function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, mo, d, h, mi, 0);
  const off = tzOffsetMs(tz, new Date(guess));
  // One refinement so occurrences right at a DST boundary land on the correct instant.
  return guess - tzOffsetMs(tz, new Date(guess - off));
}

// Start/end epoch (ms) of the meeting occurrence that is current or next, relative to `now`.
function nextMeeting(now: number, m: MeetingTimeT): { start: number; end: number } {
  const [sh, sm] = m.start.split(':').map(Number);
  const [eh, em] = m.end.split(':').map(Number);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: m.tz, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'long',
  }).formatToParts(new Date(now));
  const val = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const y = Number(val('year')), mo = Number(val('month')) - 1, d = Number(val('day'));
  const names = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const curWd = names.indexOf(val('weekday').toLowerCase());
  const delta = (m.weekday - curWd + 7) % 7;
  let start = zonedToUtc(y, mo, d + delta, sh, sm, m.tz);
  let end = zonedToUtc(y, mo, d + delta, eh, em, m.tz);
  if (now >= end) { // this week's occurrence is over → roll to next week
    start = zonedToUtc(y, mo, d + delta + 7, sh, sm, m.tz);
    end = zonedToUtc(y, mo, d + delta + 7, eh, em, m.tz);
  }
  return { start, end };
}

function fmtLeft(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(s / 86400), hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60), secs = s % 60;
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
  return `${mins}m ${secs}s`;
}

// Blue when the meeting is far off, smoothly reddening across the final 24 hours.
function countdownColor(ms: number): string {
  const f = Math.max(0, Math.min(1, ms / 86_400_000)); // 1 = ≥24h away, 0 = imminent
  const red = [239, 68, 68], blue = [59, 130, 246];
  const c = red.map((rv, i) => Math.round(rv + (blue[i] - rv) * f));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/** Live countdown to the next meeting; "Live now" while it runs, then rolls to next week. */
function MeetingCountdown({ m, t }: { m: MeetingTimeT; t: (s: string) => string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (now === null) return null; // render nothing until mounted → no SSR/hydration mismatch

  const { start, end } = nextMeeting(now, m);
  if (now >= start && now < end) {
    return (
      <span className="flex items-center gap-1.5 text-[13px] font-semibold text-emerald-700 dark:text-emerald-300">
        <span className="h-2 w-2 rounded-full bg-emerald-500 motion-safe:animate-pulse" aria-hidden="true" />
        {t('Live now — meeting in progress')}
      </span>
    );
  }
  const ms = start - now;
  return (
    <span className="block text-[13px] font-semibold" style={{ color: countdownColor(ms) }}>
      {t('Next meeting in')} {fmtLeft(ms)}
    </span>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
      <path d="M3 9h18M8 2.5v4M16 2.5v4" />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="6" width="13" height="12" rx="2.5" />
      <path d="M15.5 10l6-3.5v11l-6-3.5" />
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
      <path d="M21.94 4.9 18.9 19.3c-.23 1.02-.84 1.27-1.7.79l-4.7-3.46-2.27 2.18c-.25.25-.46.46-.95.46l.34-4.8 8.73-7.9c.38-.34-.08-.53-.59-.19L6.72 13.2 2.07 11.75c-1.01-.32-1.03-1.01.21-1.5L20.63 3.4c.84-.31 1.58.2 1.31 1.5z" />
    </svg>
  );
}

function Tile({ bg, label, big, sub, loading }: { bg: string; label: string; big: string; sub: string; loading?: boolean }) {
  return (
    <div className="flex min-h-[118px] flex-col justify-between rounded-2xl p-4 text-white" style={{ backgroundColor: bg }}>
      <div className="text-[12.5px] opacity-90">{label}</div>
      <div>
        {loading ? (
          // Skeleton while the overview loads — so a real number appears in place, instead of a
          // placeholder "0" that visibly jumps to the true value a moment later.
          <>
            <div className="h-[26px] w-14 animate-pulse rounded-md bg-white/25" />
            <div className="mt-2 h-3 w-24 animate-pulse rounded bg-white/20" />
          </>
        ) : (
          <>
            <div className="text-[30px] font-bold leading-none tracking-tight tabular-nums">{big}</div>
            <div className="mt-1 text-[12px] opacity-90">{sub}</div>
          </>
        )}
      </div>
    </div>
  );
}
