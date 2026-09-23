'use client';

import { useCallback, useEffect, useState } from 'react';
import { groupsApi, type GroupProposalDetail, type GroupProposalsResult } from '@/lib/api';
import { card } from '@/lib/ui';
import { useT } from '@/lib/prefs-context';
import { Markdown, MarkdownEditor } from './markdown';
import { useUrlNav } from '@/lib/use-url-nav';
import { ShareLinkButton } from './share-link-button';
import { DiscussionThread } from './discussion-thread';
import { DateField, toLocalInput, RationaleText } from './round-ui';
import { useExplorer } from '@/lib/explorer';
import { DocHashRow } from './doc-hash-row';
import { ConfirmDialog } from './confirm-dialog';

const field = 'w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900';

/** §29 — a group's proposals (left-nav "<Name> proposals"): members submit INFORMATIVE/POLL
 *  proposals, members vote (1 member = 1 vote, 67%), everyone allowed may comment. */
export function GroupProposals({ groupKey }: { groupKey: string }) {
  const t = useT();
  const [data, setData] = useState<GroupProposalsResult | null>(null);
  const { get, setParams } = useUrlNav();
  const openId = get('gp');
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<'all' | 'active' | 'decided' | 'discarded'>('all');
  const load = useCallback(() => { groupsApi.proposals(groupKey).then(setData).catch(() => setData(null)); }, [groupKey]);
  useEffect(load, [load]);

  if (!data) return <section className={card}><p className="text-sm text-neutral-500">{t('Loading…')}</p></section>;
  if (openId) return <GroupProposalView id={openId} onBack={() => { setParams({ gp: null }); load(); }} />;

  return (
    <section className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{data.group.name} · {t('proposals')}</h2>
        {data.canSubmit ? (
          <button onClick={() => setCreating((v) => !v)} className="shrink-0 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">
            {creating ? t('Close') : t('New proposal')}
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-neutral-500">{t('Members only · 1 member = 1 vote')} · {data.group.voting.thresholdPct}% {t('threshold')}.</p>

      {/* §29 OG — member-count quorum not met: submitting is blocked until it is. */}
      {!data.canSubmit && data.submitBlockedReason ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50/60 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
          {data.submitBlockedReason}
        </div>
      ) : null}

      {creating && data.canSubmit ? <SubmitForm group={data.group} onDone={() => { setCreating(false); load(); }} /> : null}

      {/* §29 — filter by lifecycle: All (default) / Active / Decided (passed·failed·closed) / Discarded. */}
      {(() => {
        const decidedSet = ['PASSED', 'FAILED', 'CLOSED'];
        const count = (f: typeof filter) => data.proposals.filter((p) =>
          f === 'all' ? true : f === 'active' ? p.status === 'ACTIVE' : f === 'discarded' ? p.status === 'DISCARDED' : decidedSet.includes(p.status)).length;
        const tabs: { key: typeof filter; label: string }[] = [
          { key: 'all', label: t('All') }, { key: 'active', label: t('Active') }, { key: 'decided', label: t('Decided') }, { key: 'discarded', label: t('Discarded') },
        ];
        return (
          <div className="mt-3 flex flex-wrap gap-1">
            {tabs.map((tab) => (
              <button key={tab.key} onClick={() => setFilter(tab.key)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${filter === tab.key ? 'bg-emerald-600 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'}`}>
                {tab.label} ({count(tab.key)})
              </button>
            ))}
          </div>
        );
      })()}

      <div className="mt-4 space-y-2">
        {(() => {
          const decidedSet = ['PASSED', 'FAILED', 'CLOSED'];
          const filtered = data.proposals.filter((p) =>
            filter === 'all' ? true : filter === 'active' ? p.status === 'ACTIVE' : filter === 'discarded' ? p.status === 'DISCARDED' : decidedSet.includes(p.status));
          return (<>
        {filtered.length === 0 ? <p className="text-sm text-neutral-400">{data.proposals.length === 0 ? t('No proposals yet.') : t('No proposals match this filter.')}</p> : null}
        {filtered.map((p) => (
          <button key={p.id} onClick={() => setParams({ gp: p.id })} className="flex w-full flex-col gap-1 rounded-md border border-neutral-200 p-3 text-left hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900">
            <span className="flex w-full flex-wrap items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium">{p.title}</span>
                <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">{p.type === 'POLL' ? t('Poll') : p.type === 'BULK' ? t('Bulk') : p.type === 'INSTRUCTIVE' ? t('Instructive') : t('Informative')}</span>
              </span>
              <span className="flex items-center gap-2 text-xs text-neutral-500">
                <span>{t('Submitter')}: {p.author}</span>
                <StatusChip status={p.status} />
              </span>
            </span>
            <span className="flex flex-wrap items-center gap-x-1 text-xs text-neutral-500">
              <span>{p.votedCount} {t('of')} {p.eligible} {t('members voted')}</span>
              {p.bulk ? (
                <span>· {p.bulk.items} {t('items')}{p.bulk.passed != null ? <> · <span className="text-emerald-600 dark:text-emerald-400">YES: {p.bulk.passed}</span> · <span className="text-rose-600 dark:text-rose-400">NO: {p.bulk.items - p.bulk.passed}</span></> : null}</span>
              ) : null}
              {p.result ? (
                <>
                  <span>· {t('YES')} {p.result.ratioPct}% · {t('threshold')} {p.result.thresholdPct}% ·</span>
                  <span className={p.result.approved ? 'font-medium text-emerald-600 dark:text-emerald-400' : 'font-medium text-rose-600 dark:text-rose-400'}>{p.result.approved ? t('passing') : t('not passing')}</span>
                </>
              ) : null}
              {p.voters.length ? (
                <span className="flex flex-wrap items-center gap-x-1">·{' '}
                  {p.voters.map((v, i) => (
                    <span key={i}>{v.voter} (<span className={`font-medium ${CHOICE_TONE[v.choice] ?? ''}`}>{choiceLabel(v.choice, t)}</span>){i < p.voters.length - 1 ? ',' : ''}</span>
                  ))}
                </span>
              ) : null}
            </span>
          </button>
        ))}
          </>);
        })()}
      </div>
    </section>
  );
}

function StatusChip({ status }: { status: string }) {
  const t = useT();
  const map: Record<string, string> = {
    ACTIVE: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    PASSED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    FAILED: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
    CLOSED: 'bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300',
    DISCARDED: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${map[status] ?? map.CLOSED}`}>{t(status)}</span>;
}

function SubmitForm({ group, onDone }: { group: GroupProposalsResult['group']; onDone: () => void }) {
  const t = useT();
  const types = group.proposalTypes;
  const [type, setType] = useState(types[0] ?? 'INFORMATIVE');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [votingEnd, setVotingEnd] = useState(() => { const d = new Date(Date.now() + 7 * 86400000); return toLocalInput(d.toISOString()); });
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [pollMultiple, setPollMultiple] = useState(false);
  const [bulkItems, setBulkItems] = useState<{ title: string; description: string }[]>([{ title: '', description: '' }, { title: '', description: '' }]);
  const [actors, setActors] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isPoll = type === 'POLL';
  const isInstructive = type === 'INSTRUCTIVE';
  const isBulk = type === 'BULK';
  // §29 — show how long voting will run (mirrors internal proposals) so the picked time is obvious.
  const votingDuration = (() => {
    const mins = Math.floor((new Date(votingEnd).getTime() - Date.now()) / 60_000);
    if (mins < 1) return null;
    const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
    const parts: string[] = [];
    if (d) parts.push(`${d} ${d === 1 ? t('day') : t('days')}`);
    if (h) parts.push(`${h} ${h === 1 ? t('hour') : t('hours')}`);
    if (m) parts.push(`${m} ${m === 1 ? t('minute') : t('minutes')}`);
    return parts.slice(0, 2).join(' ');
  })();

  const submit = async () => {
    setError(null);
    if (title.trim().length < 3) return setError(t('Add a title.'));
    if (!content.trim()) return setError(t('Add proposal content.'));
    const end = new Date(votingEnd);
    if (Number.isNaN(end.getTime()) || end.getTime() <= Date.now()) return setError(t('Pick a voting-end date in the future.'));
    const clean = pollOptions.map((o) => o.trim()).filter(Boolean);
    if (isPoll && clean.length < 2) return setError(t('A poll needs at least two options.'));
    const cleanItems = bulkItems.map((it) => ({ title: it.title.trim(), description: it.description.trim() })).filter((it) => it.title);
    if (isBulk && cleanItems.length < 2) return setError(t('A bulk proposal needs at least two items, each with a title.'));
    setBusy(true);
    try {
      await groupsApi.submit(group.key, { title: title.trim(), contentMd: content, type, votingEndAt: end.toISOString(), ...(isPoll ? { pollOptions: clean, pollMultiple } : {}), ...(isBulk ? { bulkItems: cleanItems.map((it) => ({ title: it.title, ...(it.description ? { description: it.description } : {}) })) } : {}), ...(isInstructive ? { actors: actors.split(',').map((a) => a.trim()).filter(Boolean), ...(deliveryDate ? { deliveryDate: new Date(deliveryDate).toISOString() } : {}) } : {}) });
      onDone();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="mt-3 space-y-3 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <h3 className="font-medium">{t('New proposal')}</h3>
      {types.length > 1 ? (
        <label className="block text-sm">{t('Type')}
          <select value={type} onChange={(e) => setType(e.target.value)} className={field}>
            {types.map((k) => <option key={k} value={k}>{k === 'POLL' ? t('Poll (choose option(s))') : k === 'BULK' ? t('Bulk (several proposals to vote on)') : k === 'INSTRUCTIVE' ? t('Instructive (action with actors)') : t('Informative (yes / no decision)')}</option>)}
          </select>
        </label>
      ) : null}
      <label className="block text-sm">{t('Title')}
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={field} placeholder={t('Proposal title')} />
      </label>
      <MarkdownEditor value={content} onChange={setContent} title={t('Content')} minRows={5} placeholder={t('Describe the proposal… (supports **bold**, *italics*, ## headings, lists, [links](https://…))')} />
      {isPoll ? (
        <div className="space-y-2 rounded border border-neutral-200 p-2 dark:border-neutral-800">
          <div className="text-sm font-medium">{t('Poll options')}</div>
          {pollOptions.map((o, i) => (
            <div key={i} className="flex gap-2">
              <input value={o} onChange={(e) => setPollOptions((opts) => opts.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`${t('Option')} ${i + 1}`} className={field} />
              {pollOptions.length > 2 ? <button onClick={() => setPollOptions((opts) => opts.filter((_, j) => j !== i))} className="rounded border border-neutral-300 px-2 text-sm dark:border-neutral-700">×</button> : null}
            </div>
          ))}
          <button onClick={() => setPollOptions((opts) => [...opts, ''])} className="text-xs text-emerald-700 hover:underline dark:text-emerald-400">{t('+ add option')}</button>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={pollMultiple} onChange={(e) => setPollMultiple(e.target.checked)} /> {t('Allow voters to choose more than one option')}</label>
        </div>
      ) : null}
      {isBulk ? (
        <div className="space-y-2 rounded border border-neutral-200 p-2 dark:border-neutral-800">
          <div className="text-sm font-medium">{t('Items to vote on')}</div>
          <p className="text-xs text-neutral-500">{t('Each item is voted on separately (YES / NO / Abstain). Add a title and, optionally, a description with a link.')}</p>
          {bulkItems.map((it, i) => (
            <div key={i} className="space-y-1 rounded border border-neutral-200 p-2 dark:border-neutral-700">
              <div className="flex items-center gap-2">
                <span className="text-xs text-neutral-400">{i + 1}.</span>
                <input value={it.title} onChange={(e) => setBulkItems((arr) => arr.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} placeholder={t('Item title')} className={field} />
                {bulkItems.length > 2 ? <button onClick={() => setBulkItems((arr) => arr.filter((_, j) => j !== i))} className="rounded border border-neutral-300 px-2 text-sm dark:border-neutral-700">×</button> : null}
              </div>
              <textarea value={it.description} onChange={(e) => setBulkItems((arr) => arr.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} placeholder={t('Description (optional) — may include a link')} rows={2} className={`${field} resize-y`} />
            </div>
          ))}
          <button onClick={() => setBulkItems((arr) => [...arr, { title: '', description: '' }])} className="text-xs text-emerald-700 hover:underline dark:text-emerald-400">{t('+ add item')}</button>
        </div>
      ) : null}
      {isInstructive ? (
        <div className="space-y-2 rounded border border-neutral-200 p-2 dark:border-neutral-800">
          <label className="block text-sm">{t('Actors (comma-separated)')}
            <input value={actors} onChange={(e) => setActors(e.target.value)} placeholder={t('who is expected to act')} className={field} />
          </label>
          <label className="block text-sm">{t('Expected delivery (optional)')}
            <DateField value={deliveryDate} onChange={setDeliveryDate} min={toLocalInput(new Date().toISOString())} />
          </label>
        </div>
      ) : null}
      <label className="block text-sm">{t('Voting ends')}
        <DateField value={votingEnd} onChange={setVotingEnd} min={toLocalInput(new Date().toISOString())} required />
        {votingDuration ? <span className="mt-1 block text-xs text-neutral-500">{t('Voting will last')} {votingDuration}.</span> : null}
      </label>
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      <button disabled={busy} onClick={submit} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{busy ? t('Submitting…') : t('Submit proposal')}</button>
    </div>
  );
}

function GroupProposalView({ id, onBack }: { id: string; onBack: () => void }) {
  const t = useT();
  const { txUrl } = useExplorer();
  const [p, setP] = useState<GroupProposalDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [picks, setPicks] = useState<string[]>([]);
  const [rationale, setRationale] = useState('');
  // §29 — once a member has voted the ballot is LOCKED (buttons + rationale disabled); editing a
  // rationale alone does nothing. They must click "Change my vote" to re-open it, and only clicking
  // a vote button then persists the new vote + rationale — otherwise the old vote stands.
  const [editing, setEditing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const load = useCallback(() => { groupsApi.proposal(id).then((d) => { setP(d); setPicks(d.myVotes); setRationale(d.myRationale ?? ''); setEditing(false); }).catch(() => setP(null)); }, [id]);
  useEffect(load, [load]);

  if (!p) return <section className={card}><button onClick={onBack} className="text-sm text-emerald-700 hover:underline dark:text-emerald-400">← {t('Back')}</button><p className="mt-2 text-sm text-neutral-500">{t('Loading…')}</p></section>;

  // Bind to a const so TS keeps the narrowing (null vs THRESHOLD vs POLL) inside the tally callbacks below.
  const tally = p.tally;

  const castThreshold = async (choice: string) => { setBusy(true); try { setP(await groupsApi.vote(id, { choice, rationale: rationale.trim() || undefined })); setEditing(false); } finally { setBusy(false); } };
  const castPoll = async () => {
    setBusy(true);
    try { setP(await groupsApi.vote(id, picks.includes('ABSTAIN') ? { choice: 'ABSTAIN', rationale: rationale.trim() || undefined } : { options: picks, rationale: rationale.trim() || undefined })); setEditing(false); } finally { setBusy(false); }
  };
  const togglePick = (opt: string) => {
    if (!p.poll) return;
    if (opt === 'ABSTAIN') return setPicks(['ABSTAIN']);
    setPicks((cur) => {
      const base = cur.filter((x) => x !== 'ABSTAIN');
      if (p.poll!.multiple) return base.includes(opt) ? base.filter((x) => x !== opt) : [...base, opt];
      return [opt];
    });
  };

  return (
    <section className={card}>
      <div className="flex items-center justify-between gap-2">
        <button onClick={onBack} className="text-sm text-emerald-700 hover:underline dark:text-emerald-400">← {t('Back')}</button>
        <span className="flex items-center gap-2">
          {/* §29 — a member may discard an active proposal before voting ends (kept as DISCARDED). */}
          {p.canDiscard ? (
            <button onClick={() => setDiscarding(true)} className="rounded border border-amber-300 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950">{t('Discard')}</button>
          ) : null}
          <ShareLinkButton />
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{p.title}</h2>
        <span className="flex items-center gap-2 text-xs text-neutral-500"><span>{t('Submitter')}: {p.author}</span><StatusChip status={p.status} /></span>
      </div>
      <div className="prose prose-sm mt-3 max-w-none text-sm dark:prose-invert"><Markdown>{p.contentMd}</Markdown></div>
      {p.type === 'INSTRUCTIVE' && ((p.actors && p.actors.length) || p.deliveryDate) ? (
        <div className="mt-2 rounded-md border border-neutral-200 p-2 text-xs text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
          {p.actors && p.actors.length ? <div><span className="font-medium">{t('Actors')}:</span> {p.actors.join(', ')}</div> : null}
          {p.deliveryDate ? <div><span className="font-medium">{t('Expected delivery')}:</span> {new Date(p.deliveryDate).toLocaleDateString()}</div> : null}
        </div>
      ) : null}
      <p className="mt-2 text-xs text-neutral-500">
        {p.status === 'ACTIVE'
          ? `${t('Voting ends')} ${new Date(p.votingEndAt).toLocaleString()}`
          : `${t('Voting ended')} ${new Date(p.decidedAt ?? p.votingEndAt).toLocaleString()}`}
      </p>

      {p.bulk ? <BulkSection p={p} id={id} onChange={setP} /> : (<>
      {/* tally */}
      <div className="mt-3 rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
        {!tally ? null : tally.kind === 'THRESHOLD' ? (
          <div className="space-y-2">
            <div>
              <span className="font-medium">YES</span> {tally.yes}/{tally.denominator} ({tally.ratioPct}%) · {t('threshold')} {tally.thresholdPct}% ·{' '}
              <span className={tally.approved ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>{tally.approved ? t('passing') : t('not passing')}</span>
            </div>
            <div className="flex h-3 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
              <div className="bg-emerald-500" style={{ width: `${pct(tally.yes, tally.eligible)}%` }} />
              <div className="bg-rose-500" style={{ width: `${pct(tally.no, tally.eligible)}%` }} />
              <div className="bg-amber-400" style={{ width: `${pct(tally.abstain, tally.eligible)}%` }} />
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-emerald-500" /> {t('Yes')} {tally.yes}</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-rose-500" /> {t('No')} {tally.no}</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-amber-400" /> {t('Abstain')} {tally.abstain}</span>
              <span className="text-neutral-500">· {tally.voted} {t('of')} {tally.eligible} {t('members voted')}</span>
            </div>
            <VoterBreakdown voters={p.voters} t={t} />
          </div>
        ) : (
          <div>
            <div className="text-xs text-neutral-500">{tally.voted} {t('of')} {tally.eligible} {t('members voted')} {p.poll?.multiple ? `· ${t('multiple choice')}` : `· ${t('single choice')}`}</div>
            <div className="mt-1 space-y-1">
              {tally.options.map((o) => {
                const max = Math.max(1, ...tally.options.map((x) => x.voters));
                const names = p.voters.filter((v) => v.choice === o.option).map((v) => v.voter);
                return (
                  <div key={o.option}>
                    <div className="flex justify-between text-xs"><span>{o.option}</span><span className="tabular-nums">{o.voters} {o.voters === 1 ? t('vote') : t('votes')}</span></div>
                    <div className="mt-0.5 h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"><div className="h-full bg-emerald-500" style={{ width: `${Math.round((o.voters / max) * 100)}%` }} /></div>
                    {names.length ? <div className="mt-0.5 text-[11px] text-neutral-400">{names.join(', ')}</div> : null}
                  </div>
                );
              })}
              {tally.abstain > 0 ? <div className="text-xs text-amber-600 dark:text-amber-400">{t('Abstain')} {tally.abstain}</div> : null}
            </div>
          </div>
        )}
        <DocHashRow hash={p.docHash} />
        {p.anchorTxHash ? (
          <div className="mt-2 text-xs"><a href={txUrl(p.anchorTxHash)} target="_blank" rel="noreferrer" className="text-emerald-700 underline dark:text-emerald-400">{t('on-chain record ↗')}</a></div>
        ) : p.status !== 'ACTIVE' ? (
          <div className="mt-2 text-xs text-neutral-400">{t('on-chain anchor recorded (pending submission)')}</div>
        ) : null}
      </div>

      {/* vote */}
      {p.canVote && p.myVotes.length > 0 && !editing ? (
        // LOCKED — the member has voted; show it read-only until they explicitly choose to change.
        <div className="mt-3 space-y-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
          <div className="text-sm">
            <span className="text-neutral-500">{t('You voted')}</span>{' '}
            {p.type === 'POLL'
              ? <span className="font-semibold">{p.myVotes.join(', ')}</span>
              : <span className={`font-semibold ${CHOICE_TONE[p.myVotes[0]] ?? ''}`}>{choiceLabel(p.myVotes[0], t)}</span>}
          </div>
          {p.myRationale ? (
            <div>
              <div className="text-xs text-neutral-500">{t('Your rationale')}</div>
              <RationaleText text={p.myRationale} />
            </div>
          ) : null}
          <button onClick={() => { setPicks(p.myVotes); setRationale(p.myRationale ?? ''); setEditing(true); }} className="rounded border border-emerald-300 px-3 py-1 text-sm font-medium text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950">{t('Change my vote')}</button>
        </div>
      ) : p.canVote ? (
        <div className="mt-3 space-y-2">
          <MarkdownEditor value={rationale} onChange={setRationale} title={t('Rationale')} hint={t('optional — Markdown supported')} minRows={2} placeholder={t('Why are you voting this way? (optional)')} />
          {p.type === 'POLL' ? (
          <div className="mt-3 space-y-2">
            <div className="space-y-1">
              {p.poll?.options.map((o) => (
                <label key={o} className="flex items-center gap-2 text-sm">
                  <input type={p.poll?.multiple ? 'checkbox' : 'radio'} checked={picks.includes(o)} onChange={() => togglePick(o)} /> {o}
                </label>
              ))}
              <label className="flex items-center gap-2 text-sm text-neutral-500"><input type="radio" checked={picks.includes('ABSTAIN')} onChange={() => togglePick('ABSTAIN')} /> {t('Abstain')}</label>
            </div>
            <div className="flex items-center gap-2">
              <button disabled={busy || picks.length === 0} onClick={castPoll} className="rounded bg-emerald-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-40">{p.myVotes.length ? t('Save new vote') : t('Cast vote')}</button>
              {editing ? <button disabled={busy} onClick={() => { setPicks(p.myVotes); setRationale(p.myRationale ?? ''); setEditing(false); }} className="text-xs text-neutral-500 hover:underline">{t('Cancel')}</button> : null}
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="flex gap-2">
              {(['YES', 'NO', 'ABSTAIN'] as const).map((c) => {
                const on = p.myVotes.includes(c);
                const palette = c === 'YES'
                  ? (on ? 'bg-emerald-600 text-white border-emerald-600' : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950')
                  : c === 'NO'
                    ? (on ? 'bg-rose-600 text-white border-rose-600' : 'border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950')
                    : (on ? 'bg-neutral-600 text-white border-neutral-600' : 'border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800');
                return (
                  <button key={c} disabled={busy} onClick={() => castThreshold(c)} className={`rounded border px-3 py-1 text-sm font-medium disabled:opacity-40 ${palette}`}>
                    {on ? '✓ ' : ''}{t(c === 'YES' ? 'Yes' : c === 'NO' ? 'No' : 'Abstain')}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-neutral-500">{editing ? t('Pick an option to save your new vote — your rationale is saved with it.') : t('Click an option to cast your vote.')}</p>
            {editing ? <button disabled={busy} onClick={() => { setPicks(p.myVotes); setRationale(p.myRationale ?? ''); setEditing(false); }} className="text-xs text-neutral-500 hover:underline">{t('Cancel')}</button> : null}
          </div>
        )}
        </div>
      ) : p.status === 'ACTIVE' ? <p className="mt-3 text-xs text-neutral-500">{t('Only group members can vote.')}</p> : null}

      {/* §29 — voters' rationales */}
      {p.rationales.length > 0 ? (
        <div className="mt-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Rationales')}</div>
          <ul className="mt-1 space-y-2">
            {p.rationales.map((r, i) => (
              <li key={i} className="text-sm">
                <span className="font-medium">{r.voter}</span>{' '}
                <span className={`text-xs font-medium ${CHOICE_TONE[r.choice] ?? 'text-neutral-400'}`}>({choiceLabel(r.choice, t)})</span>
                {/* long rationales are shrinkable — the member can collapse/expand each one */}
                <RationaleText text={r.rationale} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      </>)}

      {/* comments */}
      <div className="mt-4">
        <DiscussionThread
          comments={p.comments}
          canComment={p.canComment}
          canModerate={p.canModerate}
          onPost={(md, pid) => groupsApi.comment(id, md, pid).then(() => load())}
          onDelete={(cid) => groupsApi.deleteComment(cid).then(() => load())}
          label="Discussion"
          submitLabel="Comment"
          placeholder={t('Write a comment… (supports **bold**, *italics*, ## headings, lists, [links](https://…))')}
          emptyText={t('No comments yet.')}
        />
      </div>

      <ConfirmDialog
        open={discarding}
        title={t('Discard this proposal?')}
        message={t('Voting stops now and the proposal is marked DISCARDED. It stays in the list for the record but gets no outcome and is not anchored. This cannot be undone.')}
        confirmLabel={t('Yes, discard')}
        tone="danger"
        onCancel={() => setDiscarding(false)}
        onConfirm={async () => { setDiscarding(false); setBusy(true); try { setP(await groupsApi.discard(id)); } finally { setBusy(false); } }}
      />
    </section>
  );
}

/** §29 — the YES/NO/Abstain result bar (ratio + threshold + segmented bar + legend + who-voted),
 *  shared by an INFORMATIVE proposal and by each BULK item. */
function ThresholdBar({ ti, voters }: { ti: { yes: number; no: number; abstain: number; eligible: number; denominator: number; ratioPct: number; thresholdPct: number; approved: boolean; voted: number }; voters: { voter: string; choice: string }[] }) {
  const t = useT();
  return (
    <div className="space-y-2">
      <div>
        <span className="font-medium">YES</span> {ti.yes}/{ti.denominator} ({ti.ratioPct}%) · {t('threshold')} {ti.thresholdPct}% ·{' '}
        <span className={ti.approved ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>{ti.approved ? t('passing') : t('not passing')}</span>
      </div>
      <div className="flex h-3 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
        <div className="bg-emerald-500" style={{ width: `${pct(ti.yes, ti.eligible)}%` }} />
        <div className="bg-rose-500" style={{ width: `${pct(ti.no, ti.eligible)}%` }} />
        <div className="bg-amber-400" style={{ width: `${pct(ti.abstain, ti.eligible)}%` }} />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-emerald-500" /> {t('Yes')} {ti.yes}</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-rose-500" /> {t('No')} {ti.no}</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-amber-400" /> {t('Abstain')} {ti.abstain}</span>
        <span className="text-neutral-500">· {ti.voted} {t('of')} {ti.eligible} {t('members voted')}</span>
      </div>
      <VoterBreakdown voters={voters} t={t} />
    </div>
  );
}

/** §29 BULK — several sub-proposals voted on together: per-item YES/NO/Abstain + rationale, a per-item
 *  pass/fail tally, a "close voting now" button once everyone has voted, and a result JSON+hash download. */
function BulkSection({ p, id, onChange }: { p: GroupProposalDetail; id: string; onChange: (p: GroupProposalDetail) => void }) {
  const t = useT();
  const { txUrl } = useExplorer();
  const bulk = p.bulk!;
  const initial = useCallback(() => Object.fromEntries(bulk.items.map((it) => [it.id, { choice: it.myChoice ?? '', rationale: it.myRationale ?? '' }])), [bulk.items]);
  const [ballot, setBallot] = useState<Record<string, { choice: string; rationale: string }>>(initial);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [confirming, setConfirming] = useState(false);
  // The bulk proposal has no single approved/rejected outcome — its result is the summary of item outcomes.
  const passed = bulk.items.filter((it) => it.tally?.approved).length;
  const failed = bulk.items.length - passed;
  // Reset the local ballot to the saved votes whenever the proposal reloads (after a save / close).
  useEffect(() => { setBallot(initial()); }, [initial]);

  const setItem = (itemId: string, patch: Partial<{ choice: string; rationale: string }>) => setBallot((b) => ({ ...b, [itemId]: { ...b[itemId], ...patch } }));
  const changed = bulk.items.some((it) => (ballot[it.id]?.choice ?? '') !== (it.myChoice ?? '') || (ballot[it.id]?.rationale ?? '') !== (it.myRationale ?? ''));

  const submitVotes = async () => {
    const items = bulk.items.flatMap((it) => {
      const choice = ballot[it.id]?.choice;
      if (!choice) return [];
      const rationale = ballot[it.id]?.rationale?.trim();
      return [{ itemId: it.id, choice, ...(rationale ? { rationale } : {}) }];
    });
    if (items.length === 0) return;
    setBusy(true);
    try { onChange(await groupsApi.vote(id, { items })); } finally { setBusy(false); }
  };
  const closeNow = async () => { setBusy(true); try { onChange(await groupsApi.closeEarly(id)); } finally { setBusy(false); } };

  return (
    <div className="mt-3 space-y-3">
      <div className="rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
        <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-neutral-600 dark:text-neutral-300">{bulk.votedMembers} {t('of')} {bulk.eligible} {t('members voted on all items')} · {bulk.items.length} {t('items')}</span>
          {/* Result = the summary of item outcomes (never a single approved/rejected). */}
          {p.status !== 'ACTIVE' ? (
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
              {t('Result')}: <span className="text-emerald-600 dark:text-emerald-400">YES: {passed}</span> · <span className="text-rose-600 dark:text-rose-400">NO: {failed}</span>
            </span>
          ) : null}
        </span>
        <span className="flex items-center gap-2">
          {p.canCloseEarly ? <button disabled={busy} onClick={() => setConfirming(true)} className="rounded bg-emerald-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-40">{t('Close voting now')}</button> : null}
          {p.resultAvailable ? <a href={groupsApi.resultZipUrl(id)} target="_blank" rel="noreferrer" className="rounded border border-emerald-300 px-3 py-1 text-sm font-medium text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950">{t('Download result (JSON + hash)')}</a> : null}
        </span>
        </div>
        {/* §29 BULK — how to independently verify the downloaded result against the on-chain anchor. */}
        {p.bulk?.resultHash ? (
          <div className="mt-2 border-t border-neutral-100 pt-2 text-xs text-neutral-500 dark:border-neutral-800">
            <span className="font-medium">{t('Hash of the downloadable JSON file')}</span>{' '}
            <span className="text-[10px] text-neutral-400">({t('the same hash is anchored on-chain — it locks the downloadable file')})</span>
            <div className="mt-0.5 break-all font-mono text-[11px] text-neutral-500 dark:text-neutral-400">{p.bulk.resultHash}</div>
            <div className="mt-1">
              {t('To check it yourself: download the zip, then compute the SHA-256 of the raw result.json with an')}{' '}
              <a href="https://emn178.github.io/online-tools/sha256.html" target="_blank" rel="noreferrer" className="text-emerald-700 underline dark:text-emerald-400">{t('online SHA-256 tool ↗')}</a>{' '}
              {t('(paste the file’s contents or upload the file) and confirm it matches this hash and the on-chain anchor.')}
            </div>
          </div>
        ) : null}
      </div>

      <ol className="space-y-3">
        {bulk.items.map((it, idx) => {
          const ti = it.tally;
          const b = ballot[it.id] ?? { choice: '', rationale: '' };
          return (
            <li key={it.id} className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-xs text-neutral-400">{idx + 1}.</span>
                  <span className="font-medium">{it.title}</span>
                </div>
                {ti && p.status !== 'ACTIVE' ? (
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${ti.approved ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'}`}>{ti.approved ? t('Passed') : t('Failed')}</span>
                ) : null}
              </div>
              {it.description ? (
                <div className="mt-1">
                  <button onClick={() => setOpen((o) => ({ ...o, [it.id]: !o[it.id] }))} className="text-xs text-emerald-700 hover:underline dark:text-emerald-400">{open[it.id] ? t('Hide details') : t('Show details')}</button>
                  {open[it.id] ? <div className="prose prose-sm mt-1 max-w-none text-sm dark:prose-invert"><Markdown>{it.description}</Markdown></div> : null}
                </div>
              ) : null}
              {ti ? <div className="mt-2 text-sm"><ThresholdBar ti={ti} voters={it.voters} /></div> : null}
              {it.rationales.length ? (
                <ul className="mt-1 space-y-1">
                  {it.rationales.map((r, i) => (
                    <li key={i} className="text-sm"><span className="font-medium">{r.voter}</span> <span className={`text-xs font-medium ${CHOICE_TONE[r.choice] ?? 'text-neutral-400'}`}>({choiceLabel(r.choice, t)})</span><RationaleText text={r.rationale} /></li>
                  ))}
                </ul>
              ) : null}
              {p.canVote ? (
                <div className="mt-2 space-y-1.5">
                  <div className="flex gap-2">
                    {(['YES', 'NO', 'ABSTAIN'] as const).map((c) => {
                      const on = b.choice === c;
                      const palette = c === 'YES'
                        ? (on ? 'bg-emerald-600 text-white border-emerald-600' : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950')
                        : c === 'NO'
                          ? (on ? 'bg-rose-600 text-white border-rose-600' : 'border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950')
                          : (on ? 'bg-neutral-600 text-white border-neutral-600' : 'border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800');
                      return <button key={c} onClick={() => setItem(it.id, { choice: c })} className={`rounded border px-3 py-1 text-sm font-medium ${palette}`}>{on ? '✓ ' : ''}{choiceLabel(c, t)}</button>;
                    })}
                  </div>
                  <textarea value={b.rationale} onChange={(e) => setItem(it.id, { rationale: e.target.value })} placeholder={t('Rationale for this item (optional)')} rows={2} className="w-full resize-y rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      {p.canVote ? (
        <div className="flex flex-wrap items-center gap-3">
          <button disabled={busy || !changed} onClick={submitVotes} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40">{busy ? t('Saving…') : t('Save my votes')}</button>
          <span className="text-xs text-neutral-500">{t('You can change your votes until voting closes.')}</span>
        </div>
      ) : p.status === 'ACTIVE' ? <p className="text-xs text-neutral-500">{t('Only group members can vote.')}</p> : null}

      {/* For a bulk proposal the single canonical hash is the result-JSON hash shown above (= download =
          on-chain); the title+content docHash is not shown here to avoid a second, confusing hash. */}
      {p.anchorTxHash || p.status !== 'ACTIVE' ? (
        <div className="rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
          {p.anchorTxHash ? (
            <div className="text-xs"><a href={txUrl(p.anchorTxHash)} target="_blank" rel="noreferrer" className="text-emerald-700 underline dark:text-emerald-400">{t('on-chain record ↗')}</a></div>
          ) : (
            <div className="text-xs text-neutral-400">{t('on-chain anchor recorded (pending submission)')}</div>
          )}
        </div>
      ) : null}

      <ConfirmDialog
        open={confirming}
        title={t('Close voting before it expires?')}
        message={t('This ends voting for all items now, freezes the result and anchors it on-chain. This cannot be undone.')}
        confirmLabel={t('Yes, close voting')}
        onCancel={() => setConfirming(false)}
        onConfirm={async () => { setConfirming(false); await closeNow(); }}
      />
    </div>
  );
}

/** §29 — percentage helper for the tally bar (0 when there are no eligible voters). */
function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 100) : 0;
}

/** §29 — human label for a vote choice. */
function choiceLabel(c: string, t: (s: string) => string): string {
  return c === 'YES' ? t('Yes') : c === 'NO' ? t('No') : c === 'ABSTAIN' ? t('Abstain') : c;
}

/** §29 — who voted, grouped by choice (Yes / No / Abstain), shown under the tally. */
const CHOICE_TONE: Record<string, string> = {
  YES: 'text-emerald-600 dark:text-emerald-400',
  NO: 'text-rose-600 dark:text-rose-400',
  ABSTAIN: 'text-amber-600 dark:text-amber-400',
};

function VoterBreakdown({ voters, t }: { voters: { voter: string; choice: string }[]; t: (s: string) => string }) {
  if (!voters.length) return null;
  const groups: Record<string, string[]> = {};
  for (const v of voters) { if (!groups[v.choice]) groups[v.choice] = []; groups[v.choice].push(v.voter); }
  const label = (c: string) => (c === 'YES' ? t('Yes') : c === 'NO' ? t('No') : c === 'ABSTAIN' ? t('Abstain') : c);
  return (
    <div className="space-y-0.5">
      {['YES', 'NO', 'ABSTAIN'].map((c) => (groups[c]?.length ? (
        <div key={c} className="text-xs"><span className={`font-semibold ${CHOICE_TONE[c] ?? ''}`}>{label(c)}:</span> <span className="text-neutral-600 dark:text-neutral-300">{groups[c].join(', ')}</span></div>
      ) : null))}
    </div>
  );
}
