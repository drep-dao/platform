'use client';

import { useCallback, useEffect, useState } from 'react';
import { requestsApi, submitterApi, type RequestTypeView, type RequestView, type RequestComment } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/prefs-context';
import { card } from '@/lib/ui';
import { CopyButton } from './copy-button';
import { Markdown, MarkdownEditor } from './markdown';

/**
 * §R — the Requests view. Approved submitters ask the DReps for something with a title + a rich
 * (markdown) description. A request starts as a private DRAFT the author edits; PUBLISH makes it
 * visible to the DReps (paid types wait for the on-chain fee first) and locks it. DReps comment on
 * a published request; the board moves it Active/Done/Rejected. The author may DELETE their request
 * at any time — it stays findable in History, marked Deleted.
 */

const STATUS_CLS: Record<string, string> = {
  DRAFT: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  ACTIVE: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  DONE: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300',
  REJECTED: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300',
  PENDING_FEE: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  DELETED: 'bg-neutral-200 text-neutral-500 line-through dark:bg-neutral-800 dark:text-neutral-400',
};
const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft', ACTIVE: 'Active', DONE: 'Done', REJECTED: 'Rejected', PENDING_FEE: 'Awaiting fee', DELETED: 'Deleted',
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
      : filter === 'open' ? r.status === 'ACTIVE' || r.status === 'PENDING_FEE'
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
          <div className="prose prose-sm max-w-none text-sm dark:prose-invert"><Markdown>{r.description}</Markdown></div>
          {r.expectedResponseAt ? <p className="text-xs text-neutral-500">{t('Response expected by:')} <span className={`font-medium ${new Date(r.expectedResponseAt).getTime() < Date.now() && r.status === 'ACTIVE' ? 'text-red-600 dark:text-red-400' : 'text-neutral-700 dark:text-neutral-300'}`}>{new Date(r.expectedResponseAt).toLocaleString()}</span></p> : null}

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

          {/* §R — DReps discuss a published request. */}
          {['ACTIVE', 'DONE', 'REJECTED'].includes(d.status) ? <RequestComments r={d} onChanged={() => { loadDetail(); onChanged(); }} /> : null}

          {/* §R — board moves a published request between Active / Done / Rejected. */}
          {isBoard && ['ACTIVE', 'DONE', 'REJECTED'].includes(r.status) ? (
            <div className="flex flex-wrap items-center gap-2">
              {r.status !== 'DONE' ? <button disabled={busy} onClick={() => act(() => requestsApi.setStatus(r.id, 'DONE'))} className="rounded-md bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50">{t('Mark done')}</button> : null}
              {r.status !== 'REJECTED' ? <button disabled={busy} onClick={() => act(() => requestsApi.setStatus(r.id, 'REJECTED'))} className="rounded-md bg-rose-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50">{t('Reject')}</button> : null}
              {r.status !== 'ACTIVE' ? <button disabled={busy} onClick={() => act(() => requestsApi.setStatus(r.id, 'ACTIVE'))} className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">{t('Re-activate')}</button> : null}
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
function RCard({ c, canModerate, onDelete, onReply }: { c: RequestComment; canModerate: boolean; onDelete: (id: string) => void; onReply?: (id: string) => void }) {
  const t = useT();
  return (
    <div className="rounded border border-neutral-200 p-2 text-sm dark:border-neutral-800">
      <div className="mb-0.5 flex items-center justify-between text-xs text-neutral-500">
        <span><span className="font-medium text-neutral-700 dark:text-neutral-300">{c.authorName}</span>{c.authorRole ? ` · ${c.authorRole}` : ''}</span>
        <span className="flex items-center gap-2">
          <span>{new Date(c.createdAt).toLocaleString()}</span>
          {!c.deleted && (c.isMine || canModerate) ? <button onClick={() => onDelete(c.id)} className="text-rose-600 hover:underline">{t('Delete')}</button> : null}
        </span>
      </div>
      {c.deleted ? <p className="text-sm italic text-neutral-400">[deleted]</p> : <div className="prose prose-sm max-w-none text-sm dark:prose-invert"><Markdown>{c.contentMd ?? ''}</Markdown></div>}
      {onReply && !c.deleted ? <button onClick={() => onReply(c.id)} className="mt-1 text-xs text-emerald-700 hover:underline dark:text-emerald-400">{t('Reply')}</button> : null}
    </div>
  );
}

function RequestComments({ r, onChanged }: { r: RequestView; onChanged: () => void }) {
  const t = useT();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const comments = r.comments ?? [];
  const count = comments.reduce((n, c) => n + 1 + (c.replies?.length ?? 0), 0);
  const post = async (contentMd: string, parentId?: string) => {
    if (!contentMd.trim()) return;
    setBusy(true);
    try {
      await requestsApi.comment(r.id, contentMd.trim(), parentId);
      if (parentId) { setReplyTo(null); setReplyText(''); } else setText('');
      onChanged();
    } finally { setBusy(false); }
  };
  const del = async (id: string) => { await requestsApi.deleteComment(id); onChanged(); };
  return (
    <div className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Discussion')} ({count})</div>
      <div className="space-y-2">
        {comments.length === 0 ? <p className="text-xs text-neutral-400">{t('No comments yet.')}</p> : null}
        {comments.map((c: RequestComment) => (
          <div key={c.id}>
            <RCard c={c} canModerate={!!r.canModerate} onDelete={del} onReply={r.canComment ? setReplyTo : undefined} />
            {(c.replies && c.replies.length > 0) || replyTo === c.id ? (
              <div className="mt-2 space-y-2 border-l-2 border-neutral-200 pl-3 dark:border-neutral-800">
                {c.replies?.map((rep) => <RCard key={rep.id} c={rep} canModerate={!!r.canModerate} onDelete={del} />)}
                {replyTo === c.id ? (
                  <div>
                    <textarea value={replyText} onChange={(e) => setReplyText(e.target.value)} rows={2} placeholder={t('Reply…')} className="w-full rounded-md border border-neutral-300 p-2 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
                    <div className="mt-1 flex gap-2">
                      <button disabled={busy || !replyText.trim()} onClick={() => post(replyText, c.id)} className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-40">{busy ? t('Posting…') : t('Reply')}</button>
                      <button onClick={() => { setReplyTo(null); setReplyText(''); }} className="rounded border border-neutral-300 px-3 py-1 text-xs dark:border-neutral-600">{t('Cancel')}</button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      {r.canComment ? (
        <div className="mt-2">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder={t('Add a comment…')} className="w-full rounded-md border border-neutral-300 p-2 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
          <button disabled={busy || !text.trim()} onClick={() => post(text)} className="mt-1 rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-40">{busy ? t('Posting…') : t('Comment')}</button>
        </div>
      ) : null}
    </div>
  );
}

/** §R — the paid-request fee flow (unchanged): show the fee address + price, take the tx hash,
 *  verify on-chain (the API also re-checks automatically). */
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

/** Create a new draft, or edit an existing one (editId set). Saving keeps it a DRAFT; the author
 *  publishes it from the list. Description is rich markdown (bold/italic/headings/lists/links). */
function SubmitRequestForm({ editId, onDone }: { editId: string | null; onDone: () => void }) {
  const t = useT();
  const [types, setTypes] = useState<RequestTypeView[] | null>(null);
  const [typeId, setTypeId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [expectedResponseAt, setExpectedResponseAt] = useState(''); // datetime-local
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { requestsApi.types().then(setTypes).catch(() => setTypes([])); }, []);
  useEffect(() => {
    if (!editId) return;
    requestsApi.get(editId).then((r) => {
      setTitle(r.title); setDescription(r.description); setTypeId(r.type?.id ?? '');
      setExpectedResponseAt(r.expectedResponseAt ? new Date(r.expectedResponseAt).toISOString().slice(0, 16) : '');
    }).catch(() => undefined);
  }, [editId]);

  const paid = types?.find((x) => x.id === typeId) ?? null;

  const save = async () => {
    setBusy(true); setErr(null);
    const iso = expectedResponseAt ? new Date(expectedResponseAt).toISOString() : undefined;
    try {
      if (editId) await requestsApi.update(editId, { title: title.trim(), description: description.trim(), typeId: typeId || undefined, expectedResponseAt: iso ?? null });
      else await requestsApi.submit({ title: title.trim(), description: description.trim(), typeId: typeId || undefined, expectedResponseAt: iso });
      onDone();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  return (
    <section className={card}>
      <h3 className="font-medium">{editId ? t('Edit draft') : t('New request')}</h3>
      <p className="mt-1 text-xs text-neutral-500">{t('Describe what you are asking the DReps for. It is saved as a draft you can keep editing until you publish it.')}</p>
      <div className="mt-3 space-y-3">
        {types && types.length > 0 ? (
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Request type')}</span>
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
        <div>
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Description')}</span>
          <MarkdownEditor value={description} onChange={setDescription} title="Description" minRows={6} placeholder={t('Describe your request… (supports **bold**, *italics*, ## headings, lists, [links](https://…))')} />
        </div>
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Expected response by')} <span className="font-normal text-neutral-400">({t('optional')})</span></span>
          <input type="datetime-local" value={expectedResponseAt} min={new Date().toISOString().slice(0, 16)} onChange={(e) => setExpectedResponseAt(e.target.value)} className="w-full max-w-xs rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
        </label>
        <div className="flex items-center gap-2">
          <button disabled={busy || title.trim().length < 4 || !description.trim()} onClick={save} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            {busy ? t('Saving…') : editId ? t('Save draft') : t('Create draft')}
          </button>
          {err ? <p className="text-xs text-rose-600">{err}</p> : null}
        </div>
      </div>
    </section>
  );
}
