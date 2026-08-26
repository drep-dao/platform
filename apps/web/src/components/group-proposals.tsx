'use client';

import { useCallback, useEffect, useState } from 'react';
import { groupsApi, type GroupProposalDetail, type GroupProposalsResult } from '@/lib/api';
import { card } from '@/lib/ui';
import { useT } from '@/lib/prefs-context';
import { Markdown, MarkdownEditor } from './markdown';
import { DiscussionThread } from './discussion-thread';
import { DateField, toLocalInput } from './round-ui';

const field = 'w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900';

/** §29 — a group's proposals (left-nav "<Name> proposals"): members submit INFORMATIVE/POLL
 *  proposals, members vote (1 member = 1 vote, 67%), everyone allowed may comment. */
export function GroupProposals({ groupKey }: { groupKey: string }) {
  const t = useT();
  const [data, setData] = useState<GroupProposalsResult | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const load = useCallback(() => { groupsApi.proposals(groupKey).then(setData).catch(() => setData(null)); }, [groupKey]);
  useEffect(load, [load]);

  if (!data) return <section className={card}><p className="text-sm text-neutral-500">{t('Loading…')}</p></section>;
  if (openId) return <GroupProposalView id={openId} onBack={() => { setOpenId(null); load(); }} />;

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
      <p className="mt-1 text-sm text-neutral-500">{t('Members only · 1 member = 1 vote · 67% threshold.')}</p>

      {/* §29 OG — member-count quorum not met: submitting is blocked until it is. */}
      {!data.canSubmit && data.submitBlockedReason ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50/60 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
          {data.submitBlockedReason}
        </div>
      ) : null}

      {creating && data.canSubmit ? <SubmitForm group={data.group} onDone={() => { setCreating(false); load(); }} /> : null}

      <div className="mt-4 space-y-2">
        {data.proposals.length === 0 ? <p className="text-sm text-neutral-400">{t('No proposals yet.')}</p> : null}
        {data.proposals.map((p) => (
          <button key={p.id} onClick={() => setOpenId(p.id)} className="flex w-full flex-wrap items-center justify-between gap-2 rounded-md border border-neutral-200 p-3 text-left hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium">{p.title}</span>
              <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">{p.type === 'POLL' ? t('Poll') : p.type === 'INSTRUCTIVE' ? t('Instructive') : t('Informative')}</span>
            </span>
            <span className="flex items-center gap-2 text-xs text-neutral-500">
              <span>{p.author}</span>
              <StatusChip status={p.status} />
            </span>
          </button>
        ))}
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
  const [actors, setActors] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isPoll = type === 'POLL';
  const isInstructive = type === 'INSTRUCTIVE';

  const submit = async () => {
    setError(null);
    if (title.trim().length < 3) return setError(t('Add a title.'));
    if (!content.trim()) return setError(t('Add proposal content.'));
    const end = new Date(votingEnd);
    if (Number.isNaN(end.getTime()) || end.getTime() <= Date.now()) return setError(t('Pick a voting-end date in the future.'));
    const clean = pollOptions.map((o) => o.trim()).filter(Boolean);
    if (isPoll && clean.length < 2) return setError(t('A poll needs at least two options.'));
    setBusy(true);
    try {
      await groupsApi.submit(group.key, { title: title.trim(), contentMd: content, type, votingEndAt: end.toISOString(), ...(isPoll ? { pollOptions: clean, pollMultiple } : {}), ...(isInstructive ? { actors: actors.split(',').map((a) => a.trim()).filter(Boolean), ...(deliveryDate ? { deliveryDate: new Date(deliveryDate).toISOString() } : {}) } : {}) });
      onDone();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="mt-3 space-y-3 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <h3 className="font-medium">{t('New proposal')}</h3>
      {types.length > 1 ? (
        <label className="block text-sm">{t('Type')}
          <select value={type} onChange={(e) => setType(e.target.value)} className={field}>
            {types.map((k) => <option key={k} value={k}>{k === 'POLL' ? t('Poll (choose option(s))') : k === 'INSTRUCTIVE' ? t('Instructive (action with actors)') : t('Informative (yes / no decision)')}</option>)}
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
      </label>
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      <button disabled={busy} onClick={submit} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{busy ? t('Submitting…') : t('Submit proposal')}</button>
    </div>
  );
}

function GroupProposalView({ id, onBack }: { id: string; onBack: () => void }) {
  const t = useT();
  const [p, setP] = useState<GroupProposalDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [picks, setPicks] = useState<string[]>([]);
  const load = useCallback(() => { groupsApi.proposal(id).then((d) => { setP(d); setPicks(d.myVotes); }).catch(() => setP(null)); }, [id]);
  useEffect(load, [load]);

  if (!p) return <section className={card}><button onClick={onBack} className="text-sm text-emerald-700 hover:underline dark:text-emerald-400">← {t('Back')}</button><p className="mt-2 text-sm text-neutral-500">{t('Loading…')}</p></section>;

  const castThreshold = async (choice: string) => { setBusy(true); try { setP(await groupsApi.vote(id, { choice })); } finally { setBusy(false); } };
  const castPoll = async () => {
    setBusy(true);
    try { setP(await groupsApi.vote(id, picks.includes('ABSTAIN') ? { choice: 'ABSTAIN' } : { options: picks })); } finally { setBusy(false); }
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
      <button onClick={onBack} className="text-sm text-emerald-700 hover:underline dark:text-emerald-400">← {t('Back')}</button>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{p.title}</h2>
        <span className="flex items-center gap-2 text-xs text-neutral-500"><span>{p.author}</span><StatusChip status={p.status} /></span>
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

      {/* tally */}
      <div className="mt-3 rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
        {p.tally.kind === 'THRESHOLD' ? (
          <div>
            <div>
              <span className="font-medium">YES</span> {p.tally.yes}/{p.tally.denominator} ({p.tally.ratioPct}%) · {t('threshold')} {p.tally.thresholdPct}% ·{' '}
              <span className={p.tally.approved ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>{p.tally.approved ? t('passing') : t('not passing')}</span>
            </div>
            <div className="mt-0.5 text-xs text-neutral-500">{p.tally.voted} {t('of')} {p.tally.eligible} {t('members voted')} · {t('abstain')} {p.tally.abstain}</div>
          </div>
        ) : (
          <div>
            <div className="text-xs text-neutral-500">{p.tally.voted} {t('of')} {p.tally.eligible} {t('members voted')} {p.poll?.multiple ? `· ${t('multiple choice')}` : `· ${t('single choice')}`}</div>
            <div className="mt-1 space-y-1">
              {p.tally.options.map((o) => {
                const max = Math.max(1, ...(p.tally.kind === 'POLL' ? p.tally.options.map((x) => x.voters) : [1]));
                return (
                  <div key={o.option}>
                    <div className="flex justify-between text-xs"><span>{o.option}</span><span className="tabular-nums">{o.voters} {o.voters === 1 ? t('vote') : t('votes')}</span></div>
                    <div className="mt-0.5 h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"><div className="h-full bg-emerald-500" style={{ width: `${Math.round((o.voters / max) * 100)}%` }} /></div>
                  </div>
                );
              })}
              {p.tally.abstain > 0 ? <div className="text-xs text-neutral-400">{t('abstain')} {p.tally.abstain}</div> : null}
            </div>
          </div>
        )}
      </div>

      {/* vote */}
      {p.canVote ? (
        p.type === 'POLL' ? (
          <div className="mt-3 space-y-2">
            <div className="space-y-1">
              {p.poll?.options.map((o) => (
                <label key={o} className="flex items-center gap-2 text-sm">
                  <input type={p.poll?.multiple ? 'checkbox' : 'radio'} checked={picks.includes(o)} onChange={() => togglePick(o)} /> {o}
                </label>
              ))}
              <label className="flex items-center gap-2 text-sm text-neutral-500"><input type="radio" checked={picks.includes('ABSTAIN')} onChange={() => togglePick('ABSTAIN')} /> {t('Abstain')}</label>
            </div>
            <button disabled={busy || picks.length === 0} onClick={castPoll} className="rounded bg-emerald-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-40">{p.myVotes.length ? t('Change vote') : t('Cast vote')}</button>
          </div>
        ) : (
          <div className="mt-3 flex gap-2">
            {['YES', 'NO', 'ABSTAIN'].map((c) => (
              <button key={c} disabled={busy} onClick={() => castThreshold(c)} className={`rounded px-3 py-1 text-sm font-medium disabled:opacity-40 ${p.myVotes.includes(c) ? 'bg-emerald-600 text-white' : 'border border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'}`}>{t(c === 'YES' ? 'Yes' : c === 'NO' ? 'No' : 'Abstain')}</button>
            ))}
          </div>
        )
      ) : p.status === 'ACTIVE' ? <p className="mt-3 text-xs text-neutral-500">{t('Only group members can vote.')}</p> : null}

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
    </section>
  );
}
