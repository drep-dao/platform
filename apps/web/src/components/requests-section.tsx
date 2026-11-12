'use client';

import { useCallback, useEffect, useState } from 'react';
import { internalProposalsApi, requestsApi, submitterApi, REQUEST_KIND_LABEL, REQUEST_KINDS, type InternalProposalSummary, type RequestFieldValue, type RequestFormConfig, type RequestFormElement, type RequestTypeView, type RequestView } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/prefs-context';
import { useUrlNav } from '@/lib/use-url-nav';
import { card } from '@/lib/ui';
import { CopyButton } from './copy-button';
import { Markdown, MarkdownEditor } from './markdown';
import { DiscussionThread } from './discussion-thread';
import { FallbackAvatar } from './fallback-avatar';

/**
 * §R — the Requests view. Approved submitters ask the DReps for something with a title + a rich
 * (markdown) description. A request starts as a private DRAFT the author edits; PUBLISH makes it
 * visible to the DReps (paid types wait for the on-chain fee first) and locks it. DReps comment on
 * a published request; the board moves it Active/Done/Rejected. The author may DELETE their request
 * at any time — it stays findable in History, marked Deleted.
 */

// §R — unified queue labels: New (ACTIVE) → Accepted (ACCEPTED) → Complete (DONE); Rejected at any point.
const STATUS_CLS: Record<string, string> = {
  DRAFT: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  ACTIVE: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  ACCEPTED: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300',
  DONE: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300',
  REJECTED: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300',
  PENDING_FEE: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  DELETED: 'bg-neutral-200 text-neutral-500 line-through dark:bg-neutral-800 dark:text-neutral-400',
};
const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft', ACTIVE: 'New', ACCEPTED: 'Accepted', DONE: 'Complete', REJECTED: 'Rejected', PENDING_FEE: 'Awaiting fee', DELETED: 'Deleted',
};

function StatusChip({ status }: { status: string }) {
  const t = useT();
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLS[status] ?? 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300'}`}>
      {t(STATUS_LABEL[status] ?? status)}
    </span>
  );
}

/** scope='mine' → the My-area "My Requests" tab (only the viewer's own); 'all' → the left-nav view. */
export function RequestsSection({ scope = 'all' }: { scope?: 'all' | 'mine' }) {
  const t = useT();
  const { profile } = useAuth();
  const isBoard = !!profile?.roles.includes('BOARD');
  // §2.1 — approved submitter. Fall back to the application status so the form shows right after
  // approval even before the session's roles refresh.
  const [mineApproved, setMineApproved] = useState(false);
  useEffect(() => { submitterApi.mine().then((m) => setMineApproved(m?.status === 'APPROVED')).catch(() => undefined); }, []);
  const isSubmitter = !!profile?.roles.includes('SUBMITTER') || mineApproved;
  const [rows, setRows] = useState<RequestView[] | null>(null);
  const [filter, setFilter] = useState<'drafts' | 'open' | 'history' | 'all'>(scope === 'mine' ? 'all' : 'open');
  const [editId, setEditId] = useState<string | null | 'new'>(null); // null=closed, 'new'=create, id=edit

  const reload = useCallback(() => {
    requestsApi.list().then(setRows).catch(() => setRows([]));
  }, []);
  useEffect(reload, [reload]);

  const meId = profile?.user.id;
  const mineRows = (rows ?? []).filter((r) => scope === 'all' || r.submitterUserId === meId);
  const hasDrafts = mineRows.some((r) => r.status === 'DRAFT');
  const visible = mineRows.filter((r) =>
    filter === 'all' ? true
      : filter === 'drafts' ? r.status === 'DRAFT'
      : filter === 'open' ? r.status === 'ACTIVE' || r.status === 'ACCEPTED' || r.status === 'PENDING_FEE'
      : r.status === 'DONE' || r.status === 'REJECTED' || r.status === 'DELETED');

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {scope === 'all' ? <h2 className="text-lg font-semibold">{t('Requests')}</h2> : null}
          <p className="text-sm text-neutral-500">
            {t('Requests from submitters to the DReps. A request is drafted, then published for the DReps to see and discuss.')}
          </p>
        </div>
        {isSubmitter ? (
          <button
            onClick={() => setEditId((v) => (v ? null : 'new'))}
            className="shrink-0 whitespace-nowrap rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
          >
            {editId ? t('Close form') : t('New request')}
          </button>
        ) : null}
      </div>

      {editId ? <SubmitRequestForm editId={editId === 'new' ? null : editId} onDone={() => { setEditId(null); setFilter('all'); reload(); }} /> : null}

      <div className="inline-flex overflow-hidden rounded-md border border-neutral-300 text-xs dark:border-neutral-700">
        {([['open', 'New'], ['history', 'History'], ['all', 'All'], ...(hasDrafts ? [['drafts', 'Drafts'] as const] : [])] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`px-2.5 py-1 font-medium ${filter === k ? 'bg-emerald-600 text-white' : 'bg-white text-neutral-600 hover:bg-neutral-100 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800'}`}
          >
            {t(label)}
          </button>
        ))}
      </div>

      {rows === null ? <p className="text-sm text-neutral-500">{t('Loading…')}</p> : null}
      {rows !== null && visible.length === 0 ? (
        <p className="text-sm text-neutral-500">{filter === 'history' ? t('No decided requests yet.') : filter === 'drafts' ? t('No drafts.') : t('No requests yet.')}</p>
      ) : null}

      <div className="space-y-3">
        {visible.map((r) => (
          <RequestCard key={r.id} r={r} isBoard={isBoard} mine={r.submitterUserId === meId} onEdit={() => setEditId(r.id)} onChanged={reload} />
        ))}
      </div>
    </div>
  );
}

function RequestCard({ r, isBoard, mine, onEdit, onChanged }: { r: RequestView; isBoard: boolean; mine: boolean; onEdit: () => void; onChanged: () => void }) {
  const t = useT();
  const { setParams } = useUrlNav();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // The list omits comments/canComment (they're on the detail) — fetch the full request on open.
  const [detail, setDetail] = useState<RequestView | null>(null);
  const loadDetail = useCallback(() => { requestsApi.get(r.id).then(setDetail).catch(() => undefined); }, [r.id]);
  useEffect(() => { if (open) loadDetail(); }, [open, loadDetail]);
  const d = detail ?? r;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null);
    try { await fn(); onChanged(); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  return (
    <section className={card}>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full flex-wrap items-center justify-between gap-2 text-left">
        <span className="flex min-w-0 items-center gap-2">
          <span className={`truncate font-medium ${r.status === 'DELETED' ? 'line-through text-neutral-400' : ''}`}>{r.title}</span>
          <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-700 dark:bg-sky-950/60 dark:text-sky-300">{t(REQUEST_KIND_LABEL[r.kind] ?? r.kind)}</span>
          {r.type ? (
            <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">{r.type.name} · {r.type.priceAda.toLocaleString()} ₳</span>
          ) : (
            <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">{t('Free')}</span>
          )}
        </span>
        <span className="flex items-center gap-2 text-xs text-neutral-500">
          <span>{r.submitter}</span>
          <span>{new Date(r.createdAt).toLocaleDateString()}</span>
          <StatusChip status={r.status} />
        </span>
      </button>
      {open ? (
        <div className="mt-3 space-y-3 border-t border-neutral-200 pt-3 dark:border-neutral-800">
          {/* §R — submitter identity: avatar + name, click through to their full profile. */}
          <button onClick={() => setParams({ view: 'submitters', sub: d.submitterUserId })} className="flex items-center gap-2 text-left">
            {d.submitterAvatar
              ? <img src={d.submitterAvatar} alt="" className="h-8 w-8 rounded object-cover" />
              : <FallbackAvatar name={d.submitter} className="h-8 w-8 rounded" />}
            <span className="text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400">{d.submitter}</span>
            <span className="text-xs text-neutral-400">{t('view profile →')}</span>
          </button>
          <RequestFieldsView r={d} />
          {r.expectedResponseAt ? <p className="text-xs text-neutral-500">{t('Response expected by:')} <span className={`font-medium ${new Date(r.expectedResponseAt).getTime() < Date.now() && r.status === 'ACTIVE' ? 'text-red-600 dark:text-red-400' : 'text-neutral-700 dark:text-neutral-300'}`}>{new Date(r.expectedResponseAt).toLocaleString()}</span></p> : null}

          {/* §R — submitter contact, so a reader can reach them directly. Same data as the public directory. */}
          {d.submitterEmail || d.submitterTelegram || d.submitterSocialLinks?.length ? (
            <div className="rounded-md border border-neutral-200 bg-neutral-50/60 p-2 text-xs dark:border-neutral-800 dark:bg-neutral-900/40">
              <p className="mb-1 font-semibold text-neutral-600 dark:text-neutral-300">{t('Contact the submitter')}</p>
              <div className="flex flex-col gap-0.5">
                {d.submitterEmail ? <span className="text-neutral-600 dark:text-neutral-400">{t('Email:')} <a href={`mailto:${d.submitterEmail}`} className="text-emerald-700 underline dark:text-emerald-400">{d.submitterEmail}</a></span> : null}
                {d.submitterTelegram ? <span className="text-neutral-600 dark:text-neutral-400">{t('Telegram:')} <span className="font-mono">{d.submitterTelegram}</span></span> : null}
                {d.submitterSocialLinks?.length ? (
                  <span className="flex flex-wrap items-center gap-x-2 text-neutral-600 dark:text-neutral-400">{t('Links:')} {d.submitterSocialLinks.map((l, i) => <a key={i} href={/^https?:\/\//i.test(l) ? l : `https://${l}`} target="_blank" rel="noreferrer" className="text-emerald-700 underline dark:text-emerald-400">{l}</a>)}</span>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* §R — author's draft controls: edit, publish (locks it), or delete. */}
          {mine && r.status === 'DRAFT' ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50/50 p-2 text-xs dark:border-amber-900 dark:bg-amber-950/20">
              <span className="text-amber-800 dark:text-amber-300">{t('This is a draft — only you can see it. Publish it for the DReps to review.')}</span>
              <button disabled={busy} onClick={onEdit} className="rounded border border-neutral-300 px-2.5 py-1 font-medium hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800">{t('Edit')}</button>
              <button disabled={busy} onClick={() => act(() => requestsApi.publish(r.id))} className="rounded bg-emerald-600 px-2.5 py-1 font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{t('Publish')}</button>
            </div>
          ) : null}

          {r.status === 'PENDING_FEE' && mine ? <FeePanel r={r} onChanged={onChanged} /> : null}
          {r.status === 'PENDING_FEE' && !mine && isBoard ? (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {t('Awaiting the on-chain fee — the request enters the queue automatically once the fee transaction is verified.')}
            </p>
          ) : null}
          {r.decidedAt && r.status !== 'DRAFT' ? <p className="text-xs text-neutral-500">{r.status === 'DELETED' ? t('Deleted on') : t('Decided on')} {new Date(r.decidedAt).toLocaleDateString()}</p> : null}

          {/* §R2 — the board's result/response (shown to everyone once set; board adds/edits it). */}
          {['ACTIVE', 'ACCEPTED', 'DONE', 'REJECTED'].includes(d.status) ? <ResultPanel r={d} isBoard={isBoard} onChanged={() => { loadDetail(); onChanged(); }} /> : null}

          {/* §R — the internal proposal this request was escalated to (shown to everyone; set by the board). */}
          {['ACTIVE', 'ACCEPTED', 'DONE', 'REJECTED'].includes(d.status) ? <LinkedProposal r={d} isBoard={isBoard} onChanged={() => { loadDetail(); onChanged(); }} /> : null}

          {/* §R — DReps discuss a published request. */}
          {['ACTIVE', 'ACCEPTED', 'DONE', 'REJECTED'].includes(d.status) ? <RequestComments r={d} onChanged={() => { loadDetail(); onChanged(); }} /> : null}

          {/* §R — board moves a published request: New → Accepted → Complete, or Rejected. */}
          {isBoard && ['ACTIVE', 'ACCEPTED', 'DONE', 'REJECTED'].includes(r.status) ? (
            <div className="flex flex-wrap items-center gap-2">
              {r.status === 'ACTIVE' ? <button disabled={busy} onClick={() => act(() => requestsApi.setStatus(r.id, 'ACCEPTED'))} className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50">{t('Accept')}</button> : null}
              {r.status !== 'DONE' ? <button disabled={busy} onClick={() => act(() => requestsApi.setStatus(r.id, 'DONE'))} className="rounded-md bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50">{t('Mark complete')}</button> : null}
              {r.status !== 'REJECTED' ? <button disabled={busy} onClick={() => act(() => requestsApi.setStatus(r.id, 'REJECTED'))} className="rounded-md bg-rose-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50">{t('Reject')}</button> : null}
              {r.status !== 'ACTIVE' ? <button disabled={busy} onClick={() => act(() => requestsApi.setStatus(r.id, 'ACTIVE'))} className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">{t('Set to New')}</button> : null}
            </div>
          ) : null}

          {/* §R — the author may delete their request any time; it stays in history as Deleted. */}
          {mine && r.status !== 'DELETED' ? (
            <button disabled={busy} onClick={() => act(() => requestsApi.remove(r.id))} className="rounded-md border border-rose-300 px-2.5 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950">{t('Delete request')}</button>
          ) : null}
          {err ? <p className="text-xs text-rose-600">{err}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

/** §R — flat comment thread. Admitted Council members comment; author/board may delete a comment. */
// Collect ids of every comment (at any depth) that has at least one reply — used by "Collapse all".
function RequestComments({ r, onChanged }: { r: RequestView; onChanged: () => void }) {
  const t = useT();
  return (
    <DiscussionThread
      comments={r.comments ?? []}
      canComment={!!r.canComment}
      canModerate={!!r.canModerate}
      onPost={(md, pid) => requestsApi.comment(r.id, md, pid).then(() => onChanged())}
      onDelete={(id) => requestsApi.deleteComment(id).then(() => onChanged())}
      label="Discussion"
      submitLabel="Comment"
      placeholder={t('Write a comment… (supports **bold**, *italics*, ## headings, lists, [links](https://…))')}
      emptyText={t('No comments yet.')}
    />
  );
}

/**
 * §R — optional link from a request to an internal proposal (escalation to a vote). The default
 * request flow is notification + status only; the board links a proposal here when a request should
 * go to a vote. Everyone sees the link; only the board sets or clears it.
 */
function LinkedProposal({ r, isBoard, onChanged }: { r: RequestView; isBoard: boolean; onChanged: () => void }) {
  const t = useT();
  const { setParams } = useUrlNav();
  const [editing, setEditing] = useState(false);
  const [options, setOptions] = useState<InternalProposalSummary[] | null>(null);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const openPicker = () => {
    setEditing(true);
    if (options === null) internalProposalsApi.list().then(setOptions).catch(() => setOptions([]));
  };
  const link = async (proposalId: string | null) => {
    setBusy(true); setErr(null);
    try { await requestsApi.setLinkedProposal(r.id, proposalId); setEditing(false); onChanged(); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  const lp = r.linkedProposal;
  if (!lp && !isBoard) return null; // nothing to show a non-board viewer when unlinked
  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50/60 p-2 text-xs dark:border-neutral-800 dark:bg-neutral-900/40">
      {lp ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-neutral-500">{t('Linked proposal:')}</span>
          <button onClick={() => setParams({ view: 'internal', ip: lp.id })} className="font-medium text-emerald-700 hover:underline dark:text-emerald-400">
            {lp.publicId ? `${lp.publicId} · ` : ''}{lp.title}
          </button>
          <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{lp.status}</span>
          {isBoard ? <button disabled={busy} onClick={() => link(null)} className="text-rose-600 hover:underline disabled:opacity-50 dark:text-rose-400">{t('Unlink')}</button> : null}
        </div>
      ) : isBoard ? (
        editing ? (
          <div className="flex flex-wrap items-center gap-2">
            <select value={pick} onChange={(e) => setPick(e.target.value)} className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900">
              <option value="">{options === null ? t('Loading…') : t('Choose an internal proposal…')}</option>
              {(options ?? []).map((p) => <option key={p.id} value={p.id}>{p.publicId ? `${p.publicId} · ` : ''}{p.title}</option>)}
            </select>
            <button disabled={busy || !pick} onClick={() => link(pick)} className="rounded-md bg-emerald-600 px-2.5 py-1 font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{t('Link')}</button>
            <button disabled={busy} onClick={() => setEditing(false)} className="rounded-md border border-neutral-300 px-2.5 py-1 font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">{t('Cancel')}</button>
          </div>
        ) : (
          <button onClick={openPicker} className="text-neutral-600 hover:underline dark:text-neutral-300">{t('Link an internal proposal (escalate to a vote)')}</button>
        )
      ) : null}
      {err ? <p className="mt-1 text-rose-600">{err}</p> : null}
    </div>
  );
}

/**
 * §R2 — the board's result/response attached to a request. Everyone sees it once set; only the board
 * can add or edit it (at any time, independent of the status).
 */
function ResultPanel({ r, isBoard, onChanged }: { r: RequestView; isBoard: boolean; onChanged: () => void }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(r.result ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setText(r.result ?? ''); }, [r.result]);

  const run = async (value: string, close = true) => {
    setBusy(true); setErr(null);
    try { await requestsApi.setResult(r.id, value); if (close) setEditing(false); onChanged(); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  if (!r.result && !isBoard) return null;
  return (
    <div className="rounded-md border border-emerald-300 bg-emerald-50/60 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/30">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">{t('Result')}</span>
        {isBoard && !editing ? (
          <button onClick={() => { setText(r.result ?? ''); setEditing(true); }} className="text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400">{r.result ? t('Edit result') : t('Add Result')}</button>
        ) : null}
      </div>
      {editing ? (
        <div className="space-y-2">
          <MarkdownEditor value={text} onChange={setText} title="Result" minRows={5} placeholder={t('Write the result… (supports **bold**, *italics*, ## headings, lists, [links](https://…))')} />
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => run(text.trim())} className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{busy ? t('Saving…') : t('Save result')}</button>
            <button disabled={busy} onClick={() => setEditing(false)} className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">{t('Cancel')}</button>
            {r.result ? <button disabled={busy} onClick={() => run('')} className="text-xs text-rose-600 hover:underline">{t('Remove result')}</button> : null}
            {err ? <span className="text-xs text-rose-600">{err}</span> : null}
          </div>
        </div>
      ) : r.result ? (
        <>
          <div className="prose prose-sm max-w-none text-sm dark:prose-invert"><Markdown>{r.result}</Markdown></div>
          {r.resultAt ? <p className="mt-1 text-xs text-neutral-500">{t('Updated')} {new Date(r.resultAt).toLocaleString()}</p> : null}
        </>
      ) : (
        <p className="text-xs text-emerald-800/70 dark:text-emerald-300/70">{t('No result yet — add the response to this request.')}</p>
      )}
    </div>
  );
}

function FeePanel({ r, onChanged }: { r: RequestView; onChanged: () => void }) {
  const t = useT();
  const [addr, setAddr] = useState<string | null>(null);
  const [tx, setTx] = useState(r.feeTxHash ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { requestsApi.feeAddress().then((a) => setAddr(a.address)).catch(() => setAddr(null)); }, []);

  const send = async () => {
    setBusy(true); setMsg(null);
    try {
      const updated = await requestsApi.submitFeeTx(r.id, tx.trim());
      if (updated.status === 'ACTIVE') { setMsg(t('Fee verified — your request is now in the queue.')); onChanged(); }
      else setMsg(t('Transaction saved. Not confirmed on-chain yet — it is re-checked automatically; you can also re-check manually.'));
    } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  };
  const recheck = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await requestsApi.recheckFee(r.id);
      if (res.verified) { setMsg(t('Fee verified — your request is now in the queue.')); onChanged(); }
      else setMsg(t('Not confirmed on-chain yet — try again in a minute.'));
    } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  };

  return (
    <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50/60 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
      <p className="font-medium text-amber-800 dark:text-amber-300">{t('This request enters the queue once the fee is paid and verified on-chain.')}</p>
      {r.type ? <p className="text-xs text-neutral-700 dark:text-neutral-300">{t('Send')} <strong>{r.type.priceAda.toLocaleString()} ₳</strong> {t('to the Request-fees address:')}</p> : null}
      {addr ? <p className="flex items-center gap-2 break-all font-mono text-xs">{addr} <CopyButton text={addr} /></p> : <p className="text-xs text-neutral-500">{t('The fee address is not configured yet — please contact the board.')}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <input value={tx} onChange={(e) => setTx(e.target.value)} placeholder={t('Fee transaction hash (64 hex characters)')} className="w-full max-w-md rounded-md border border-neutral-300 bg-white px-2 py-1 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900" />
        <button disabled={busy || tx.trim().length !== 64} onClick={send} className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{t('Submit fee tx')}</button>
        {r.feeTxHash ? <button disabled={busy} onClick={recheck} className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">{t('Re-check')}</button> : null}
      </div>
      {msg ? <p className="text-xs text-neutral-600 dark:text-neutral-400">{msg}</p> : null}
    </div>
  );
}

// §R2 — a filled-in form value: a plain string, or a list of links.
export type LinkValue = { url: string; title?: string };
type FieldVals = Record<string, string | LinkValue[]>;
export const emptyValue = (el: RequestFormElement): string | LinkValue[] => (el.type === 'links' ? [] : '');
const isFilled = (v: string | LinkValue[] | undefined): boolean => (Array.isArray(v) ? v.length > 0 : !!(v && String(v).trim()));

/** §R2 — render a published request's configured fields (falls back to the legacy description). */
function RequestFieldsView({ r }: { r: RequestView }) {
  const fields = r.fields && r.fields.length ? r.fields : null;
  if (!fields) return <div className="prose prose-sm max-w-none text-sm dark:prose-invert"><Markdown>{r.description}</Markdown></div>;
  return (
    <div className="space-y-3">
      {fields.map((f) => {
        if (!isFilled(f.value)) return null;
        return (
          <div key={f.key}>
            <p className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">{f.label}</p>
            {f.type === 'markdown' ? (
              <div className="prose prose-sm max-w-none text-sm dark:prose-invert"><Markdown>{f.value as string}</Markdown></div>
            ) : f.type === 'links' ? (
              <ul className="space-y-1 text-sm">
                {(f.value as LinkValue[]).map((l, i) => (
                  <li key={i} className="flex items-baseline gap-1.5">
                    <span className="text-neutral-400">🔗</span>
                    <a href={l.url} target="_blank" rel="noopener noreferrer" className="break-all text-emerald-700 underline dark:text-emerald-400">{l.title || l.url}</a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-300">{f.value as string}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** §R2 — editor for a links element: add/remove external document links, each with an optional label. */
function LinksField({ value, onChange }: { value: LinkValue[]; onChange: (v: LinkValue[]) => void }) {
  const t = useT();
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const valid = /^https?:\/\//i.test(url.trim());
  const add = () => {
    if (!valid) return;
    onChange([...value, { url: url.trim(), ...(label.trim() ? { title: label.trim() } : {}) }]);
    setUrl(''); setLabel('');
  };
  return (
    <div className="space-y-2">
      {value.length ? (
        <ul className="space-y-1">
          {value.map((l, i) => (
            <li key={i} className="flex items-center gap-2 text-sm">
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-emerald-700 underline dark:text-emerald-400">{l.title ? `${l.title} — ${l.url}` : l.url}</a>
              <button type="button" onClick={() => onChange(value.filter((_, idx) => idx !== i))} className="shrink-0 text-xs text-rose-600 hover:underline">{t('Remove')}</button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('Label (optional)')} className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900 sm:w-44" />
        <input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} placeholder={t('https://… (document link)')} className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
        <button type="button" disabled={!valid} onClick={add} className="shrink-0 rounded-md border border-neutral-300 px-2.5 py-1 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800">{t('Add link')}</button>
      </div>
    </div>
  );
}

/** §R2 — one input in the submit form, rendered from its configured element definition. */
export function DynamicField({ el, value, onChange }: { el: RequestFormElement; value: string | LinkValue[]; onChange: (v: string | LinkValue[]) => void }) {
  const t = useT();
  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">{el.label}{el.required ? ' *' : ''}</span>
      {el.type === 'markdown' ? (
        <MarkdownEditor value={(value as string) ?? ''} onChange={(v) => onChange(v)} title={el.label} minRows={el.size === 'large' ? 8 : 4} placeholder={t('Describe your request… (supports **bold**, *italics*, ## headings, lists, [links](https://…))')} />
      ) : el.type === 'select' ? (
        <select value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} className="w-full max-w-md rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900">
          <option value="">{t('Choose…')}</option>
          {(el.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : el.type === 'links' ? (
        <LinksField value={Array.isArray(value) ? value : []} onChange={onChange} />
      ) : el.type === 'date' ? (
        <input type="datetime-local" min={new Date().toISOString().slice(0, 16)} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} className="w-full max-w-xs rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
      ) : (
        <input value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
      )}
    </div>
  );
}

/** Create a new draft, or edit an existing one (editId set). Saving keeps it a DRAFT; the author
 *  publishes it from the list. The form is shaped per request type by the board (Request formatter). */
function SubmitRequestForm({ editId, onDone }: { editId: string | null; onDone: () => void }) {
  const t = useT();
  const [types, setTypes] = useState<RequestTypeView[] | null>(null);
  const [config, setConfig] = useState<RequestFormConfig | null>(null);
  const [typeId, setTypeId] = useState<string>('');
  const [kind, setKind] = useState<string>('NOTIFICATION');
  const [title, setTitle] = useState('');
  const [values, setValues] = useState<FieldVals>({});
  const [loadedReq, setLoadedReq] = useState<RequestView | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { requestsApi.types().then(setTypes).catch(() => setTypes([])); }, []);
  useEffect(() => { requestsApi.formConfig().then(setConfig).catch(() => setConfig({})); }, []);
  useEffect(() => {
    if (!editId) return;
    requestsApi.get(editId).then((r) => {
      setTitle(r.title); setTypeId(r.type?.id ?? ''); setKind(r.kind || 'NOTIFICATION');
      setLoadedReq(r);
    }).catch(() => undefined);
  }, [editId]);

  const elements = (config?.[kind] ?? []) as RequestFormElement[];

  // Seed/keep the field values whenever the kind's element list changes: keep anything the user has
  // already typed (by element id), otherwise hydrate from a loaded draft's snapshot, falling back to a
  // legacy request's plain description for the first markdown element.
  useEffect(() => {
    if (!config) return;
    setValues((prev) => {
      const next: FieldVals = {};
      for (const el of elements) {
        if (prev[el.id] !== undefined) { next[el.id] = prev[el.id]; continue; }
        const snap = loadedReq?.fields?.find((f) => f.key === el.id);
        next[el.id] = snap ? snap.value : emptyValue(el);
      }
      if (loadedReq && (!loadedReq.fields || loadedReq.fields.length === 0) && loadedReq.description) {
        const firstMd = elements.find((e) => e.type === 'markdown');
        if (firstMd && !isFilled(next[firstMd.id])) next[firstMd.id] = loadedReq.description;
      }
      // §R2 — a date element is driven by the request's expectedResponseAt column, not the snapshot.
      const dateEl = elements.find((e) => e.type === 'date');
      if (dateEl && loadedReq?.expectedResponseAt && !isFilled(next[dateEl.id])) {
        next[dateEl.id] = new Date(loadedReq.expectedResponseAt).toISOString().slice(0, 16);
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, kind, loadedReq]);

  const paid = types?.find((x) => x.id === typeId) ?? null;
  const setVal = (id: string, v: string | LinkValue[]) => setValues((s) => ({ ...s, [id]: v }));

  const missingRequired = elements.some((el) => el.required && !isFilled(values[el.id]));
  const canSubmit = title.trim().length >= 4 && !missingRequired;

  const save = async () => {
    setBusy(true); setErr(null);
    const dateEl = elements.find((e) => e.type === 'date');
    const rawDate = dateEl ? String(values[dateEl.id] ?? '') : '';
    const iso = rawDate ? new Date(rawDate).toISOString() : undefined;
    // §R2 — date values go to expectedResponseAt; the rest are the field snapshot.
    const fields: RequestFieldValue[] = elements.filter((el) => el.type !== 'date').map((el) => ({ key: el.id, label: el.label, type: el.type, value: values[el.id] ?? emptyValue(el) }));
    try {
      if (editId) await requestsApi.update(editId, { title: title.trim(), kind, fields, typeId: typeId || undefined, expectedResponseAt: iso ?? null });
      else await requestsApi.submit({ title: title.trim(), kind, fields, typeId: typeId || undefined, expectedResponseAt: iso });
      onDone();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  return (
    <section className={card}>
      <h3 className="font-medium">{editId ? t('Edit draft') : t('New request')}</h3>
      <p className="mt-1 text-xs text-neutral-500">{t('Describe what you are asking the DReps for. It is saved as a draft you can keep editing until you publish it.')}</p>
      <div className="mt-3 space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Request type')}</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="w-full max-w-md rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900">
            {REQUEST_KINDS.map((k) => <option key={k} value={k}>{t(REQUEST_KIND_LABEL[k])}</option>)}
          </select>
        </label>
        {kind === 'NOTIFICATION' ? <p className="text-xs text-neutral-500">{t('A notification — no extra action required. It is a public announcement for the DReps.')}</p> : null}
        {types && types.length > 0 ? (
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Paid type')}</span>
            <select value={typeId} onChange={(e) => setTypeId(e.target.value)} className="w-full max-w-md rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900">
              <option value="">{t('Free request')}</option>
              {types.map((x) => <option key={x.id} value={x.id}>{x.name} — {x.priceAda.toLocaleString()} ₳</option>)}
            </select>
          </label>
        ) : null}
        {paid ? <p className="text-xs text-amber-700 dark:text-amber-400">{t('This is a paid request: after you publish, it enters the queue only once the fee of')} <strong>{paid.priceAda.toLocaleString()} ₳</strong> {t('is verified on-chain.')}</p> : null}
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Title')}</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
        </label>
        {config === null ? <p className="text-sm text-neutral-500">{t('Loading…')}</p> : null}
        {elements.map((el) => <DynamicField key={el.id} el={el} value={values[el.id] ?? emptyValue(el)} onChange={(v) => setVal(el.id, v)} />)}
        <div className="flex items-center gap-2">
          <button disabled={busy || !canSubmit} onClick={save} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            {busy ? t('Saving…') : editId ? t('Save draft') : t('Create draft')}
          </button>
          {err ? <p className="text-xs text-rose-600">{err}</p> : null}
        </div>
      </div>
    </section>
  );
}
