'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { internalProposalsApi, proposalCheckerApi, requestsApi, submitterApi, REQUEST_KIND_LABEL, REQUEST_KINDS, type InternalProposalSummary, type PcFinding, type PcResult, type PcScan, type RequestFieldValue, type RequestFormConfig, type RequestFormElement, type RequestTypeView, type RequestView } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { fmtDateTime } from './round-ui';
import { useT } from '@/lib/prefs-context';
import { useUrlNav } from '@/lib/use-url-nav';
import { card } from '@/lib/ui';
import { CopyButton } from './copy-button';
import { Markdown, MarkdownEditor } from './markdown';
import { frameworkScore, scoreColor } from './proposal-checker';
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

/** §R2 — board/owner view: the required fields of the request's current type that are still empty in its
 *  snapshot (e.g. after a type switch that carried only what existed). Nothing to show when all are filled. */
function MissingRequiredFields({ r, mine }: { r: RequestView; mine?: boolean }) {
  const t = useT();
  const [config, setConfig] = useState<RequestFormConfig | null>(null);
  useEffect(() => { requestsApi.formConfig().then(setConfig).catch(() => setConfig({})); }, []);
  if (!config) return null;
  const elements = (config[r.kind] ?? []) as RequestFormElement[];
  const byKey = new Map((r.fields ?? []).map((f) => [f.key, f] as const));
  const missing = elements.filter((el) => {
    if (!el.required) return false;
    if (el.type === 'date') return !r.expectedResponseAt;
    const f = byKey.get(el.id);
    return !f || !isFilled(f.value);
  });
  if (!missing.length) return null;
  return (
    <div className="rounded-md border border-rose-300 bg-rose-50/70 p-3 dark:border-rose-900 dark:bg-rose-950/30">
      <p className="text-sm font-medium text-rose-700 dark:text-rose-300">{t('Missing required fields')}</p>
      <p className="mt-0.5 text-xs text-rose-600 dark:text-rose-400">{mine ? t('These required fields for this request type are still empty — complete them while your request is New by clicking Edit above.') : t('These required fields for this request type are still empty — the submitter needs to complete them while the request is New.')}</p>
      <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-sm text-rose-700 dark:text-rose-300">
        {missing.map((el) => <li key={el.id}>{el.label}</li>)}
      </ul>
    </div>
  );
}

function RequestCard({ r, isBoard, mine, onEdit, onChanged }: { r: RequestView; isBoard: boolean; mine: boolean; onEdit: () => void; onChanged: () => void }) {
  const t = useT();
  const { setParams } = useUrlNav();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [typeOpen, setTypeOpen] = useState(false);
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
        <span className="flex min-w-0 items-center gap-2 text-xs text-neutral-500">
          <span className="max-w-[12rem] truncate" title={r.submitter}>{r.submitter}</span>
          <span className="shrink-0">{new Date(r.createdAt).toLocaleDateString()}</span>
          <StatusChip status={r.status} />
          {r.status === 'ACTIVE' ? <span title={t('New requests can still be edited by the submitter — ask the board to return it to New to reopen editing.')} className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">✎ {t('Editable')}</span> : null}
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
          {(isBoard || mine) ? <MissingRequiredFields r={d} mine={mine} /> : null}
          <RequestFieldsView r={d} />
          {r.expectedResponseAt ? <p className="text-xs text-neutral-500">{t('Response expected by:')} <span className={`font-medium ${new Date(r.expectedResponseAt).getTime() < Date.now() && r.status === 'ACTIVE' ? 'text-red-600 dark:text-red-400' : 'text-neutral-700 dark:text-neutral-300'}`}>{fmtDateTime(r.expectedResponseAt)}</span></p> : null}

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
              <button disabled={busy} onClick={onEdit} className="shrink-0 whitespace-nowrap rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{t('Edit')}</button>
              <button disabled={busy} onClick={() => act(() => requestsApi.publish(r.id))} className="shrink-0 whitespace-nowrap rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{t('Publish')}</button>
            </div>
          ) : null}

          {/* §R — a published request stays editable by its author while it is New (ACTIVE), so DReps can ask
              for additions. It locks once the board accepts it; the board can return it to New to reopen. */}
          {mine && r.status === 'ACTIVE' ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50/50 p-2 text-xs dark:border-emerald-900 dark:bg-emerald-950/20">
              <span className="text-emerald-800 dark:text-emerald-300">{t('This request is New — you can still edit it to add information a DRep asked for. Once the board accepts it, editing locks until they return it to New.')}</span>
              <button disabled={busy} onClick={onEdit} className="shrink-0 whitespace-nowrap rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{t('Edit')}</button>
              <button disabled={busy} onClick={() => setTypeOpen(true)} className="shrink-0 whitespace-nowrap rounded-md border border-emerald-300 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/40">{t('Change type')}</button>
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
              {/* §R2 — board switches the request type while it is New; a mapping window carries the content across. */}
              {d.status === 'ACTIVE' ? (
                <button disabled={busy} onClick={() => setTypeOpen(true)} className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">{t('Change type')}</button>
              ) : null}
            </div>
          ) : null}
          {typeOpen ? <ChangeTypeModal r={d} isBoard={isBoard} mine={mine} onClose={() => setTypeOpen(false)} onChanged={() => { loadDetail(); onChanged(); }} /> : null}

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
          {r.resultAt ? <p className="mt-1 text-xs text-neutral-500">{t('Updated')} {fmtDateTime(r.resultAt)}</p> : null}
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
/** §R2 — coerce a stored value to the shape the element's CURRENT type expects (links → array, else
 *  string). Guards an edit form against a field whose type changed after the value was saved. */
const coerceToType = (el: RequestFormElement, v: unknown): string | LinkValue[] =>
  el.type === 'links' ? (Array.isArray(v) ? (v as LinkValue[]) : []) : (typeof v === 'string' ? v : '');
const isFilled = (v: string | LinkValue[] | undefined): boolean => (Array.isArray(v) ? v.length > 0 : !!(v && String(v).trim()));

const SCAN_ID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const shortId = (id: string) => (id.length > 24 ? `${id.slice(0, 14)}…${id.slice(-6)}` : id);

/** §R2 — the compact Coverage / Framework / Vision card with the outcome tally, linking to the full
 *  scoring. Shared by a pasted public scan (getScan) and a selected on-chain board score (results). */
function ScoreCard({ coverage, framework, vision, findings, title, amountAda, href }: {
  coverage: number | null; framework: number | null; vision: number | null;
  findings: PcFinding[]; title: string; amountAda: number | null; href: string;
}) {
  const t = useT();
  let sup = 0, cond = 0, na = 0;
  for (const f of findings) {
    const l = (f.outcome || '').toLowerCase();
    if (l.includes('not applicable') || l.includes('n/a')) na += 1;
    else if (l.includes('condition')) cond += 1;
    else if (l.includes('supported') && !l.includes('unsupported')) sup += 1;
  }
  const cell = (pct: number | null, label: string) => (
    <div className="text-center">
      <div className={`text-sm font-bold tabular-nums ${pct == null ? 'text-neutral-400' : scoreColor(pct)}`}>{pct == null ? '—' : `${pct}%`}</div>
      <div className="text-[9px] uppercase tracking-wide text-neutral-400">{label}</div>
    </div>
  );
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="block rounded-md border border-neutral-200 p-3 transition hover:border-emerald-400 dark:border-neutral-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-4">{cell(coverage, t('Coverage'))}{cell(framework, t('Framework'))}{cell(vision, t('Vision 2030'))}</div>
        <div className="flex flex-wrap gap-1">
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">{sup} {t('Supported')}</span>
          <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] text-sky-700 dark:bg-sky-950/60 dark:text-sky-300">{cond} {t('Supported with condition')}</span>
          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">{na} {t('Not applicable')}</span>
        </div>
      </div>
      <div className="mt-2 text-sm font-medium text-neutral-800 dark:text-neutral-200">
        {title}
        {amountAda != null ? <span className="ml-2 text-xs font-normal text-neutral-500">{amountAda.toLocaleString()} ₳ {t('requested')}</span> : null}
      </div>
      <div className="mt-0.5 text-xs text-emerald-700 underline dark:text-emerald-400">{t('Open full scoring ↗')}</div>
    </a>
  );
}

/** §R2 — resolve a pasted public-scan link (…&scan=<uuid>) and render its score card. */
function ScanScoreRowScan({ scanId }: { scanId: string }) {
  const t = useT();
  const [scan, setScan] = useState<PcScan | null | 'err'>(null);
  useEffect(() => {
    let live = true;
    proposalCheckerApi.getScan(scanId).then((s) => { if (live) setScan(s); }).catch(() => { if (live) setScan('err'); });
    return () => { live = false; };
  }, [scanId]);
  if (scan === null) return <p className="text-xs text-neutral-400">{t('Loading score…')}</p>;
  if (scan === 'err') return <p className="text-xs text-rose-500">{t('This scoring link could not be loaded.')}</p>;
  if (scan.status !== 'DONE') return <p className="text-xs text-amber-600 dark:text-amber-500">{t('This proposal has not been scored yet.')}</p>;
  return (
    <ScoreCard
      coverage={scan.scorePct ?? null}
      framework={frameworkScore(scan.questions ?? [])}
      vision={scan.visionPct ?? frameworkScore(scan.visionFindings ?? [])}
      findings={[...(scan.templateFindings ?? []), ...(scan.questions ?? []), ...(scan.visionFindings ?? [])]}
      title={scan.title}
      amountAda={scan.amountAda ?? null}
      href={`?view=scantool&scan=${scan.id}`}
    />
  );
}

/** §R2 — resolve a selected on-chain governance action to its board score (the latest result for that
 *  govActionId) and render its score card, linking to the public On-chain Proposal Score page. */
function OnchainScoreRow({ govActionId }: { govActionId: string }) {
  const t = useT();
  const [res, setRes] = useState<PcResult | 'err' | 'none' | null>(null);
  useEffect(() => {
    let live = true;
    // results are newest-first, so the first match for a govActionId is its latest score.
    proposalCheckerApi.results().then((list) => { if (live) setRes(list.find((r) => r.govActionId === govActionId) ?? 'none'); }).catch(() => { if (live) setRes('err'); });
    return () => { live = false; };
  }, [govActionId]);
  if (res === null) return <p className="text-xs text-neutral-400">{t('Loading score…')}</p>;
  if (res === 'err') return <p className="text-xs text-rose-500">{t('This score could not be loaded.')}</p>;
  if (res === 'none') return <p className="text-xs text-amber-600 dark:text-amber-500">{t('This proposal has not been scored yet.')}</p>;
  return (
    <ScoreCard
      coverage={res.scorePct}
      framework={frameworkScore(res.questions ?? [])}
      vision={res.visionPct ?? frameworkScore(res.visionFindings ?? [])}
      findings={[...(res.templateFindings ?? []), ...(res.questions ?? []), ...(res.visionFindings ?? [])]}
      title={res.govActionTitle || shortId(res.govActionId)}
      amountAda={res.amountAda != null ? Number(res.amountAda) : null}
      href="?view=proposalchecker"
    />
  );
}

/** §R2 — a proposal-score value is either a public-scan link (contains a UUID) or an on-chain
 *  governance-action id (selected from the board-scored list). Dispatch to the right resolver. */
function ScanScoreRow({ value }: { value: string }) {
  const t = useT();
  const v = (typeof value === 'string' ? value : '').trim();
  const scanId = (v.match(SCAN_ID_RE)?.[0] ?? '').toLowerCase();
  if (scanId) return <ScanScoreRowScan scanId={scanId} />;
  if (v) return <OnchainScoreRow govActionId={v} />;
  return <p className="text-xs text-amber-600 dark:text-amber-500">{t('Pick an already-scored proposal, or paste a valid scoring link.')}</p>;
}

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
            ) : f.type === 'score' ? (
              <ScanScoreRow value={f.value as string} />
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

/** §R2 — editor for a proposal-score element. The submitter either picks a governance action that the
 *  board has already scored on-chain (the On-chain Proposal Score list), or pastes a link to their own
 *  public scan. Both resolve to the same compact score card. The stored value is the govActionId (for a
 *  picked on-chain score) or the pasted scan link. */
function ScoreField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT();
  const [results, setResults] = useState<PcResult[] | null>(null);
  useEffect(() => { proposalCheckerApi.results().then(setResults).catch(() => setResults([])); }, []);
  // Latest score per on-chain Treasury Withdrawal (results are newest-first) — mirrors the public list.
  const scored: PcResult[] = [];
  const seen = new Set<string>();
  for (const r of results ?? []) {
    if (r.govActionType && r.govActionType !== 'TreasuryWithdrawals') continue;
    if (!seen.has(r.govActionId)) { seen.add(r.govActionId); scored.push(r); }
  }
  const v = (value ?? '').trim();
  const pickedGov = scored.some((r) => r.govActionId === v) ? v : ''; // dropdown is "selected" only on an exact match
  return (
    <div className="space-y-2">
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{t('Pick a proposal the board has already scored on-chain, or paste a link to your own scan. Once attached, the score becomes public — everyone viewing this request will see it (you can remove it and attach a different one while your request is still New).')}</p>
      <select value={pickedGov} onChange={(e) => onChange(e.target.value)} className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900">
        <option value="">{results === null ? t('Loading scored proposals…') : scored.length ? t('Select an already-scored on-chain proposal…') : t('No on-chain proposals scored yet')}</option>
        {scored.map((r) => <option key={r.govActionId} value={r.govActionId}>{(r.govActionTitle || shortId(r.govActionId))} — {r.scorePct}% {t('coverage')}</option>)}
      </select>
      <p className="text-center text-[11px] uppercase tracking-wide text-neutral-400">{t('or')}</p>
      <input value={pickedGov ? '' : (value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder={t('Paste your scan link (…?view=scantool&scan=…)')} className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
      <p className="text-[11px] text-neutral-500 dark:text-neutral-400">{t('No on-chain score yet?')} <a href="?view=scantool" target="_blank" rel="noopener noreferrer" className="font-medium text-emerald-700 underline dark:text-emerald-400">{t('Score a draft in the scoring tool ↗')}</a></p>
      {isFilled(value) ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">{t('Attached score')}</span>
            <button type="button" onClick={() => onChange('')} className="text-xs font-medium text-rose-600 hover:underline dark:text-rose-400">{t('Remove')}</button>
          </div>
          <ScanScoreRow value={value} />
        </div>
      ) : null}
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
      ) : el.type === 'score' ? (
        <ScoreField value={typeof value === 'string' ? value : ''} onChange={onChange} />
      ) : (
        <input value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
      )}
    </div>
  );
}

/** §R2 — platform modal to change a request's type while it is New. The left side is the new type's
 *  form (live preview, editable). The right side lists the previous content; each piece has a combobox
 *  of the new form's fields, so the board/team just pick where it goes and it appears on the left — no
 *  manual copying. Nothing is wiped. The submitter applies via the normal update; the board (any New
 *  request) via changeKind. */
const stringyType = (ty: string) => ty === 'text' || ty === 'markdown' || ty === 'select';
const typesCompatible = (a: string, b: string) => a === b || (stringyType(a) && stringyType(b));
function ChangeTypeModal({ r, isBoard, mine, onClose, onChanged }: { r: RequestView; isBoard: boolean; mine: boolean; onClose: () => void; onChanged: () => void }) {
  const t = useT();
  const [config, setConfig] = useState<RequestFormConfig | null>(null);
  const [kind, setKind] = useState<string>(r.kind);
  const [values, setValues] = useState<FieldVals>({});
  const [assignedTo, setAssignedTo] = useState<Record<string, string>>({}); // old-content key → new element id ('' = nowhere)
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  void isBoard; void mine;

  useEffect(() => { requestsApi.formConfig().then(setConfig).catch(() => setConfig({})); }, []);

  const allElements = (config?.[kind] ?? []) as RequestFormElement[];
  const elements = allElements.filter((e) => e.type !== 'date');
  const dateEl = allElements.find((e) => e.type === 'date');
  const elById = new Map(allElements.map((e) => [e.id, e] as const));
  // The previous content as movable pieces (fall back to the plain description for a legacy request).
  const oldItems: RequestFieldValue[] = (r.fields && r.fields.length)
    ? r.fields.filter((f) => isFilled(f.value))
    : (r.description ? [{ key: '__desc', label: t('Description'), type: 'markdown', value: r.description }] : []);
  const oldByKey = new Map(oldItems.map((o) => [o.key, o] as const));

  // Auto-map the old pieces into the new type (first free compatible field, preferring a key/label match)
  // whenever the target type changes. The user can re-point any piece with its combobox afterwards.
  useEffect(() => {
    if (!config) return;
    const norm = (s: string) => s.trim().toLowerCase();
    const next: FieldVals = {};
    for (const el of allElements) next[el.id] = el.type === 'date' ? (r.expectedResponseAt ? new Date(r.expectedResponseAt).toISOString().slice(0, 16) : '') : emptyValue(el);
    const assign: Record<string, string> = {};
    const used = new Set<string>();
    for (const o of oldItems) {
      const pick = (pred: (e: RequestFormElement) => boolean) => elements.find((e) => typesCompatible(e.type, o.type) && !used.has(e.id) && pred(e));
      const target = pick((e) => e.id === o.key) ?? pick((e) => norm(e.label) === norm(o.label)) ?? pick(() => true);
      if (target) { next[target.id] = o.value as string | LinkValue[]; assign[o.key] = target.id; used.add(target.id); }
      else assign[o.key] = '';
    }
    setValues(next);
    setAssignedTo(assign);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, kind]);

  const setVal = (id: string, v: string | LinkValue[]) => setValues((s) => ({ ...s, [id]: v }));
  // Move one old piece into a chosen new field (clearing the field it previously filled).
  const moveOld = (oldKey: string, newElId: string) => {
    const o = oldByKey.get(oldKey);
    if (!o) return;
    const prev = assignedTo[oldKey] ?? '';
    setValues((v) => {
      const nv = { ...v };
      if (prev && prev !== newElId) { const pe = elById.get(prev); if (pe) nv[prev] = emptyValue(pe); }
      if (newElId) nv[newElId] = o.value as string | LinkValue[];
      return nv;
    });
    setAssignedTo((a) => ({ ...a, [oldKey]: newElId }));
  };

  const missingRequired = elements.some((el) => el.required && !isFilled(values[el.id]));
  // Previous content set to "nowhere" would be lost — never allow a silent drop.
  const droppedPieces = oldItems.filter((o) => isFilled(o.value) && !assignedTo[o.key]);

  const apply = async () => {
    setBusy(true); setErr(null);
    const rawDate = dateEl ? String(values[dateEl.id] ?? '') : '';
    const iso = rawDate ? new Date(rawDate).toISOString() : null;
    const fields: RequestFieldValue[] = elements.map((el) => ({ key: el.id, label: el.label, type: el.type, value: values[el.id] ?? emptyValue(el) }));
    try {
      // Type switch = move what exists; required fields the new type adds are completed later while New.
      await requestsApi.changeKind(r.id, kind, fields, iso);
      onChanged(); onClose();
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className={`${card} my-8 w-full max-w-3xl`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-medium">{t('Change request type')}</h3>
          <button onClick={onClose} className="rounded p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label={t('Close')}>✕</button>
        </div>
        <p className="mt-1 text-xs text-neutral-500">{t('Pick the new type, then on the right choose where each piece of the previous content goes — it appears in the form on the left, which you can still fine-tune. Nothing is lost and the request is never left empty.')}</p>

        <label className="mt-3 block text-sm">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('New type')}</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="w-full max-w-md rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900">
            {REQUEST_KINDS.map((k) => <option key={k} value={k}>{t(REQUEST_KIND_LABEL[k])}{k === r.kind ? ` (${t('current')})` : ''}</option>)}
          </select>
        </label>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <section>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('New form')} — {t(REQUEST_KIND_LABEL[kind] ?? kind)}</p>
            <div className="space-y-3">
              {elements.length ? elements.map((el) => <DynamicField key={el.id} el={el} value={values[el.id] ?? emptyValue(el)} onChange={(v) => setVal(el.id, v)} />) : <p className="text-xs text-neutral-400">{t('This type has only the Title — nothing else to fill in.')}</p>}
              {dateEl ? <DynamicField el={dateEl} value={values[dateEl.id] ?? ''} onChange={(v) => setVal(dateEl.id, v)} /> : null}
            </div>
          </section>
          <section className="rounded-md border border-neutral-200 bg-neutral-50/60 p-3 dark:border-neutral-800 dark:bg-neutral-900/40">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Previous content')} — {t(REQUEST_KIND_LABEL[r.kind] ?? r.kind)}</p>
            <p className="mb-2 mt-0.5 text-[11px] text-neutral-500">{t('Choose where each piece goes.')}</p>
            <div className="space-y-2.5">
              {oldItems.length ? oldItems.map((o) => {
                const targets = elements.filter((el) => typesCompatible(el.type, o.type));
                return (
                  <div key={o.key} className="rounded-md border border-neutral-200 bg-white p-2 dark:border-neutral-800 dark:bg-neutral-900">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{o.label}</p>
                    <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-300">{typeof o.value === 'string' ? o.value : `${(o.value as LinkValue[]).length} ${t('link(s)')}`}</p>
                    <label className="mt-1.5 flex items-center gap-1 text-[11px] text-neutral-500">
                      {t('Move to')}:
                      <select
                        value={assignedTo[o.key] ?? ''}
                        onChange={(e) => moveOld(o.key, e.target.value)}
                        disabled={targets.length === 0}
                        className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-1.5 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                      >
                        <option value="">{t('— nowhere —')}</option>
                        {targets.map((el) => <option key={el.id} value={el.id}>{el.label}{el.required ? ' *' : ''}</option>)}
                      </select>
                    </label>
                    {targets.length === 0 ? <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">{t('No field of a matching type in the new form.')}</p> : null}
                  </div>
                );
              }) : <p className="text-xs text-neutral-400">{t('No previous content.')}</p>}
            </div>
          </section>
        </div>

        {err ? <p className="mt-3 text-xs text-rose-600">{err}</p> : null}
        <div className="mt-4 flex flex-col gap-2">
          {droppedPieces.length ? (
            <p className="text-xs text-rose-600 dark:text-rose-400">{t('This content is set to “nowhere” and would be lost:')} {droppedPieces.map((o) => o.label).join(', ')}. {t('Point each piece to a field. If the new type has no field that fits, add one to it first in the Request formatter.')}</p>
          ) : missingRequired ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">{t('Some required fields (*) are still empty — that is fine; they can be completed while the request is New.')}</p>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <button disabled={busy} onClick={onClose} className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800">{t('Cancel')}</button>
            <button disabled={busy || kind === r.kind || droppedPieces.length > 0} onClick={apply} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{busy ? t('Applying…') : t('Apply new type')}</button>
          </div>
        </div>
      </div>
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
  // Hydrate-from-loaded-request happens once; reset the latch whenever the edit target changes.
  const hydratedRef = useRef(false);
  useEffect(() => { hydratedRef.current = false; }, [editId]);
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
    // The first run after a request has loaded fully hydrates from its snapshot (ignoring the empty values
    // seeded before it arrived — the config/request load race that used to blank out already-saved fields).
    // Later runs (e.g. switching the request type) keep what the user has typed and only seed new elements.
    const firstHydrate = !!loadedReq && !hydratedRef.current;
    setValues((prev) => {
      const next: FieldVals = {};
      for (const el of elements) {
        const snap = loadedReq?.fields?.find((f) => f.key === el.id);
        if (!firstHydrate && prev[el.id] !== undefined) { next[el.id] = prev[el.id]; continue; }
        // Seed by the element's CURRENT type, not the snapshot's: if the board changed a field's type
        // (e.g. links → score), an old request's snapshot value is the wrong shape (an array where a
        // string is now expected), which would otherwise crash the input. A mismatch seeds empty.
        next[el.id] = snap ? coerceToType(el, snap.value) : emptyValue(el);
      }
      if (loadedReq && (!loadedReq.fields || loadedReq.fields.length === 0) && loadedReq.description) {
        const firstMd = elements.find((e) => e.type === 'markdown');
        if (firstMd && !isFilled(next[firstMd.id])) next[firstMd.id] = loadedReq.description;
      }
      // §R2 — a date element is driven by the request's expectedResponseAt column, not the snapshot.
      const dateEl = elements.find((e) => e.type === 'date');
      if (dateEl && loadedReq?.expectedResponseAt && (firstHydrate || !isFilled(next[dateEl.id]))) {
        next[dateEl.id] = new Date(loadedReq.expectedResponseAt).toISOString().slice(0, 16);
      }
      return next;
    });
    if (firstHydrate) hydratedRef.current = true;
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
