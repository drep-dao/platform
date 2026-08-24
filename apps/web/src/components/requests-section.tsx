'use client';

import { useCallback, useEffect, useState } from 'react';
import { requestsApi, submitterApi, type RequestTypeView, type RequestView } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/prefs-context';
import { card } from '@/lib/ui';
import { CopyButton } from './copy-button';

/**
 * §R — the Requests view (left menu): new + historical submitter requests.
 *
 * Approved submitters ask the DReps for something with a title + description only —
 * no funding, no rounds. The board defines PAID request types (price in ADA) in
 * Platform setup; a paid request stays PENDING_FEE (visible only to its submitter
 * and the board) until the fee transaction to the Request-fees address is verified
 * on-chain. Only board members change a request's status afterwards.
 */

const STATUS_CLS: Record<string, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  DONE: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300',
  REJECTED: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300',
  PENDING_FEE: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active',
  DONE: 'Done',
  REJECTED: 'Rejected',
  PENDING_FEE: 'Awaiting fee',
};

function StatusChip({ status }: { status: string }) {
  const t = useT();
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLS[status] ?? 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300'}`}>
      {t(STATUS_LABEL[status] ?? status)}
    </span>
  );
}

export function RequestsSection() {
  const t = useT();
  const { profile } = useAuth();
  const isBoard = !!profile?.roles.includes('BOARD');
  // §2.1 — approved submitter. Fall back to the application status so the form shows right after
  // approval even before the session's roles refresh.
  const [mineApproved, setMineApproved] = useState(false);
  useEffect(() => { submitterApi.mine().then((m) => setMineApproved(m?.status === 'APPROVED')).catch(() => undefined); }, []);
  const isSubmitter = !!profile?.roles.includes('SUBMITTER') || mineApproved;
  const [rows, setRows] = useState<RequestView[] | null>(null);
  const [filter, setFilter] = useState<'open' | 'history' | 'all'>('open');
  const [showSubmit, setShowSubmit] = useState(false);

  const reload = useCallback(() => {
    requestsApi.list().then(setRows).catch(() => setRows([]));
  }, []);
  useEffect(reload, [reload]);

  const visible = (rows ?? []).filter((r) =>
    filter === 'all' ? true
      : filter === 'open' ? r.status === 'ACTIVE' || r.status === 'PENDING_FEE'
      : r.status === 'DONE' || r.status === 'REJECTED');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{t('Requests')}</h2>
          <p className="text-sm text-neutral-500">
            {t('Requests from submitters to the DReps. Paid request types (set by the board) enter the queue only after the fee is verified on-chain. Only board members change a request’s status.')}
          </p>
        </div>
        {isSubmitter ? (
          <button
            onClick={() => setShowSubmit((v) => !v)}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
          >
            {showSubmit ? t('Close form') : t('New request')}
          </button>
        ) : null}
      </div>

      {showSubmit ? <SubmitRequestForm onDone={() => { setShowSubmit(false); reload(); }} /> : null}

      <div className="inline-flex overflow-hidden rounded-md border border-neutral-300 text-xs dark:border-neutral-700">
        {([['open', 'New'], ['history', 'History'], ['all', 'All']] as const).map(([k, label]) => (
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
        <p className="text-sm text-neutral-500">{filter === 'history' ? t('No decided requests yet.') : t('No requests yet.')}</p>
      ) : null}

      <div className="space-y-3">
        {visible.map((r) => (
          <RequestCard key={r.id} r={r} isBoard={isBoard} mine={r.submitterUserId === profile?.user.id} onChanged={reload} />
        ))}
      </div>
    </div>
  );
}

function RequestCard({ r, isBoard, mine, onChanged }: { r: RequestView; isBoard: boolean; mine: boolean; onChanged: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const setStatus = async (status: 'ACTIVE' | 'DONE' | 'REJECTED') => {
    setBusy(true); setErr(null);
    try { await requestsApi.setStatus(r.id, status); onChanged(); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  return (
    <section className={card}>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full flex-wrap items-center justify-between gap-2 text-left">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{r.title}</span>
          {r.type ? (
            <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
              {r.type.name} · {r.type.priceAda.toLocaleString()} ₳
            </span>
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
          <p className="whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-300">{r.description}</p>
          {r.expectedResponseAt ? <p className="text-xs text-neutral-500">{t('Response expected by:')} <span className={`font-medium ${new Date(r.expectedResponseAt).getTime() < Date.now() && r.status === 'ACTIVE' ? 'text-red-600 dark:text-red-400' : 'text-neutral-700 dark:text-neutral-300'}`}>{new Date(r.expectedResponseAt).toLocaleString()}</span></p> : null}
          {r.status === 'PENDING_FEE' && mine ? <FeePanel r={r} onChanged={onChanged} /> : null}
          {r.status === 'PENDING_FEE' && !mine && isBoard ? (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {t('Awaiting the on-chain fee — the request enters the queue automatically once the fee transaction is verified.')}
              {r.feeTxHash ? <> {t('Submitted tx:')} <span className="font-mono">{r.feeTxHash}</span></> : <> {t('No fee transaction submitted yet.')}</>}
            </p>
          ) : null}
          {r.decidedAt ? (
            <p className="text-xs text-neutral-500">{t('Decided on')} {new Date(r.decidedAt).toLocaleDateString()}</p>
          ) : null}
          {/* §R — only the board moves a request between Active / Done / Rejected. */}
          {isBoard && r.status !== 'PENDING_FEE' ? (
            <div className="flex flex-wrap items-center gap-2">
              {r.status !== 'DONE' ? (
                <button disabled={busy} onClick={() => setStatus('DONE')} className="rounded-md bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50">
                  {t('Mark done')}
                </button>
              ) : null}
              {r.status !== 'REJECTED' ? (
                <button disabled={busy} onClick={() => setStatus('REJECTED')} className="rounded-md bg-rose-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50">
                  {t('Reject')}
                </button>
              ) : null}
              {r.status !== 'ACTIVE' ? (
                <button disabled={busy} onClick={() => setStatus('ACTIVE')} className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
                  {t('Re-activate')}
                </button>
              ) : null}
            </div>
          ) : null}
          {err ? <p className="text-xs text-rose-600">{err}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

/** §R — the paid-request fee flow: show the Request-fees address + price, take the tx hash,
 *  verify on-chain (the API also re-checks automatically every 30 s). */
function FeePanel({ r, onChanged }: { r: RequestView; onChanged: () => void }) {
  const t = useT();
  const [addr, setAddr] = useState<string | null>(null);
  const [tx, setTx] = useState(r.feeTxHash ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    requestsApi.feeAddress().then((a) => setAddr(a.address)).catch(() => setAddr(null));
  }, []);

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
      <p className="font-medium text-amber-800 dark:text-amber-300">
        {t('This request enters the queue once the fee is paid and verified on-chain.')}
      </p>
      {r.type ? (
        <p className="text-xs text-neutral-700 dark:text-neutral-300">
          {t('Send')} <strong>{r.type.priceAda.toLocaleString()} ₳</strong> {t('to the Request-fees address:')}
        </p>
      ) : null}
      {addr ? (
        <p className="flex items-center gap-2 break-all font-mono text-xs">{addr} <CopyButton text={addr} /></p>
      ) : (
        <p className="text-xs text-neutral-500">{t('The fee address is not configured yet — please contact the board.')}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={tx}
          onChange={(e) => setTx(e.target.value)}
          placeholder={t('Fee transaction hash (64 hex characters)')}
          className="w-full max-w-md rounded-md border border-neutral-300 bg-white px-2 py-1 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button disabled={busy || tx.trim().length !== 64} onClick={send} className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
          {t('Submit fee tx')}
        </button>
        {r.feeTxHash ? (
          <button disabled={busy} onClick={recheck} className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
            {t('Re-check')}
          </button>
        ) : null}
      </div>
      {msg ? <p className="text-xs text-neutral-600 dark:text-neutral-400">{msg}</p> : null}
    </div>
  );
}

function SubmitRequestForm({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [types, setTypes] = useState<RequestTypeView[] | null>(null);
  const [typeId, setTypeId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [expectedResponseAt, setExpectedResponseAt] = useState(''); // §R datetime-local
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    requestsApi.types().then(setTypes).catch(() => setTypes([]));
  }, []);

  const paid = types?.find((x) => x.id === typeId) ?? null;

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      await requestsApi.submit({ title: title.trim(), description: description.trim(), typeId: typeId || undefined, expectedResponseAt: expectedResponseAt ? new Date(expectedResponseAt).toISOString() : undefined });
      onDone();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  return (
    <section className={card}>
      <h3 className="font-medium">{t('New request')}</h3>
      <p className="mt-1 text-xs text-neutral-500">
        {t('Describe what you are asking the DReps for — a title and a description is all that is needed.')}
      </p>
      <div className="mt-3 space-y-3">
        {types && types.length > 0 ? (
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Request type')}</span>
            <select
              value={typeId}
              onChange={(e) => setTypeId(e.target.value)}
              className="w-full max-w-md rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            >
              <option value="">{t('Free request')}</option>
              {types.map((x) => (
                <option key={x.id} value={x.id}>{x.name} — {x.priceAda.toLocaleString()} ₳</option>
              ))}
            </select>
          </label>
        ) : null}
        {paid ? (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {t('This is a paid request: it enters the queue only after the fee of')} <strong>{paid.priceAda.toLocaleString()} ₳</strong> {t('is verified on-chain. The payment instructions appear after submitting.')}
          </p>
        ) : null}
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Title')}</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full max-w-md rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Description')}</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Expected response by')} <span className="font-normal text-neutral-400">({t('optional')})</span></span>
          <input
            type="datetime-local"
            value={expectedResponseAt}
            min={new Date().toISOString().slice(0, 16)}
            onChange={(e) => setExpectedResponseAt(e.target.value)}
            className="w-full max-w-xs rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>
        <div className="flex items-center gap-2">
          <button
            disabled={busy || title.trim().length < 4 || !description.trim()}
            onClick={submit}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {t('Submit request')}
          </button>
        </div>
        {err ? <p className="text-xs text-rose-600">{err}</p> : null}
      </div>
    </section>
  );
}
