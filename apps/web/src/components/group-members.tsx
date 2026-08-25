'use client';

import { useCallback, useEffect, useState } from 'react';
import { groupsApi, type GroupMembersResult, type GroupMemberView } from '@/lib/api';
import { card } from '@/lib/ui';
import { useT } from '@/lib/prefs-context';
import { Markdown } from './markdown';
import { useSubcategories } from '@/lib/subcategories';

/** §29 — a group's member directory (left-nav "<Name> members"). The group's approver sees a
 *  pending-registrations queue with Approve/Reject and can remove admitted members. */
export function GroupMembers({ groupKey }: { groupKey: string }) {
  const t = useT();
  const [data, setData] = useState<GroupMembersResult | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { groupsApi.members(groupKey).then(setData).catch(() => setData(null)); }, [groupKey]);
  useEffect(load, [load]);

  const act = async (fn: () => Promise<GroupMembersResult>) => { setBusy(true); try { setData(await fn()); } finally { setBusy(false); } };

  if (!data) return <section className={card}><p className="text-sm text-neutral-500">{t('Loading…')}</p></section>;
  const fields = data.group.profileFields;

  return (
    <section className={card}>
      <h2 className="text-lg font-semibold">{data.group.name} · {t('members')}</h2>
      <p className="mt-1 text-sm text-neutral-500">{t('Members of this group submit and vote on its proposals.')}</p>

      {data.canManage && data.pending.length > 0 ? (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900 dark:bg-amber-950/20">
          <div className="text-sm font-medium text-amber-800 dark:text-amber-300">{t('Pending registrations')} ({data.pending.length})</div>
          <ul className="mt-2 space-y-2">
            {data.pending.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-medium">{m.displayName}</span>
                <span className="flex gap-2">
                  <button disabled={busy} onClick={() => act(() => groupsApi.approveMember(groupKey, m.id))} className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{t('Approve')}</button>
                  <button disabled={busy} onClick={() => act(() => groupsApi.rejectMember(groupKey, m.id))} className="rounded border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">{t('Reject')}</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {data.members.length === 0 ? <p className="text-sm text-neutral-400">{t('No members yet.')}</p> : null}
        {data.members.map((m) => (
          <MemberCard key={m.id} m={m} fields={fields} canManage={data.canManage} busy={busy} onKick={() => act(() => groupsApi.kickMember(groupKey, m.id))} t={t} />
        ))}
      </div>
    </section>
  );
}

function memberLinkHref(kind: string, v: string): string {
  const s = v.trim();
  if (kind === 'email') return `mailto:${s}`;
  if (/^https?:\/\//.test(s)) return s;
  if (kind === 'telegram') return `https://t.me/${s.replace(/^@/, '')}`;
  if (kind === 'x') return `https://x.com/${s.replace(/^@/, '')}`;
  if (kind === 'github') return `https://github.com/${s.replace(/^@/, '')}`;
  return `https://${s}`;
}

function MemberCard({ m, fields, canManage, busy, onKick, t }: {
  m: GroupMemberView; fields: string[]; canManage: boolean; busy: boolean; onKick: () => void; t: (s: string) => string;
}) {
  const { labelOf } = useSubcategories();
  return (
    <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="flex items-center gap-3">
        {fields.includes('photo') ? (
          m.photo
            ? <img src={m.photo} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" />
            : <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-sm font-semibold text-neutral-500 dark:bg-neutral-800">{m.displayName.slice(0, 1).toUpperCase()}</span>
        ) : null}
        <div className="min-w-0">
          <div className="truncate font-medium">{m.displayName}</div>
          {fields.includes('memberSince') && m.since ? <div className="text-xs text-neutral-500">{t('Member since')} {new Date(m.since).toLocaleDateString()}</div> : null}
        </div>
      </div>
      {fields.includes('bio') && m.bio ? <div className="prose prose-sm mt-2 max-w-none text-sm dark:prose-invert"><Markdown>{m.bio}</Markdown></div> : null}
      {fields.includes('country') && m.country ? <div className="mt-1 text-xs text-neutral-500">{t('Country')}: {m.country}</div> : null}
      {fields.includes('expertise') && m.subcategoryIds.length ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {m.subcategoryIds.map((id) => <span key={id} className="rounded-full border border-emerald-300 px-2 py-0.5 text-[11px] text-emerald-700 dark:border-emerald-800 dark:text-emerald-300">{labelOf(id)}</span>)}
        </div>
      ) : null}
      {fields.includes('conflictOfInterest') && m.conflictOfInterest ? <div className="mt-1 text-xs text-neutral-500"><span className="font-medium">{t('Conflict of interest')}:</span> {m.conflictOfInterest}</div> : null}
      {fields.includes('blockchainAddress') && m.address ? <div className="mt-1 break-all font-mono text-[11px] text-neutral-500">{m.address}</div> : null}
      {fields.includes('links') && m.socials && Object.keys(m.socials).length ? (
        <div className="mt-1 flex flex-wrap gap-2 text-xs">
          {Object.entries(m.socials).map(([k, v]) => <a key={k} href={memberLinkHref(k, v)} target="_blank" rel="noreferrer" className="text-emerald-700 hover:underline dark:text-emerald-400">{k === 'x' ? 'X' : k}</a>)}
        </div>
      ) : null}
      {canManage ? <button disabled={busy} onClick={onKick} className="mt-2 rounded border border-rose-300 px-2.5 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950">{t('Remove member')}</button> : null}
    </div>
  );
}

/** §29 — pending group-member registrations the viewer may approve (they are the group's
 *  approver DRep / board / etc.), surfaced in the My-area "Applications" hub alongside Expert
 *  and Submitter reviews. Renders nothing when there is nothing to approve. */
export function GroupApprovals() {
  const t = useT();
  const [items, setItems] = useState<{ group: GroupMembersResult['group']; pending: GroupMemberView[] }[]>([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const groups = await groupsApi.listActive().catch(() => []);
    const results = await Promise.all(
      groups.map(async (g) => {
        const m = await groupsApi.members(g.key).catch(() => null);
        return m && m.canManage && m.pending.length > 0 ? { group: m.group, pending: m.pending } : null;
      }),
    );
    setItems(results.filter((x): x is { group: GroupMembersResult['group']; pending: GroupMemberView[] } => !!x));
  }, []);
  useEffect(() => { void load(); }, [load]);
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); await load(); } finally { setBusy(false); } };

  if (items.length === 0) return null;
  return (
    <div className="space-y-4">
      {items.map(({ group, pending }) => (
        <section className={card} key={group.key}>
          <h3 className="text-base font-semibold">{group.name} — {t('member applications')} <span className="text-sm font-normal text-neutral-500">({pending.length} {t('pending')})</span></h3>
          <ul className="mt-2 space-y-2">
            {pending.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-medium">{m.displayName}</span>
                <span className="flex gap-2">
                  <button disabled={busy} onClick={() => act(() => groupsApi.approveMember(group.key, m.id))} className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{t('Approve')}</button>
                  <button disabled={busy} onClick={() => act(() => groupsApi.rejectMember(group.key, m.id))} className="rounded border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">{t('Reject')}</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
