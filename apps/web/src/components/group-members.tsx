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

  const [openId, setOpenId] = useState<string | null>(null);
  const act = async (fn: () => Promise<GroupMembersResult>) => { setBusy(true); try { setData(await fn()); } finally { setBusy(false); } };

  if (!data) return <section className={card}><p className="text-sm text-neutral-500">{t('Loading…')}</p></section>;
  const fields = data.group.profileFields;

  // Detail view — a single member's full profile with a back link (mirrors the Council directory).
  const open = openId ? data.members.find((m) => m.id === openId) : null;
  if (open) {
    return (
      <section className={card}>
        <button onClick={() => setOpenId(null)} className="text-sm text-emerald-700 hover:underline dark:text-emerald-400">← {data.group.name} {t('members')}</button>
        <div className="mt-4">
          <MemberFields m={open} fields={fields} t={t} />
          {data.canManage ? (
            <button disabled={busy} onClick={() => { void act(() => groupsApi.kickMember(groupKey, open.id)); setOpenId(null); }} className="mt-3 rounded border border-rose-300 px-2.5 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950">{t('Remove member')}</button>
          ) : null}
        </div>
      </section>
    );
  }

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

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {data.members.length === 0 ? <p className="text-sm text-neutral-400">{t('No members yet.')}</p> : null}
        {data.members.map((m) => (
          <MemberCardCompact key={m.id} m={m} fields={fields} onOpen={() => setOpenId(m.id)} t={t} />
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

function MemberFields({ m, fields, t }: { m: GroupMemberView; fields: string[]; t: (s: string) => string }) {
  const { labelOf } = useSubcategories();
  return (
    <>
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
      {fields.includes('bio') && m.bio ? (
        <div className="mt-2">
          <div className="text-xs font-medium text-neutral-500">{t('Bio')}</div>
          <div className="prose prose-sm mt-0.5 max-w-none text-sm dark:prose-invert"><Markdown>{m.bio}</Markdown></div>
        </div>
      ) : null}
      {fields.includes('country') && m.country ? <div className="mt-2 text-xs text-neutral-500"><span className="font-medium">{t('Country')}:</span> {m.country}</div> : null}
      {fields.includes('expertise') && m.subcategoryIds.length ? (
        <div className="mt-2">
          <div className="text-xs font-medium text-neutral-500">{t('Expertise')}</div>
          <div className="mt-0.5 flex flex-wrap gap-1">
            {m.subcategoryIds.map((id) => <span key={id} className="rounded-full border border-emerald-300 px-2 py-0.5 text-[11px] text-emerald-700 dark:border-emerald-800 dark:text-emerald-300">{labelOf(id)}</span>)}
          </div>
        </div>
      ) : null}
      {fields.includes('conflictOfInterest') && m.conflictOfInterest ? <div className="mt-1 text-xs text-neutral-500"><span className="font-medium">{t('Conflict of interest')}:</span> {m.conflictOfInterest}</div> : null}
      {fields.includes('conflictOfInterest') ? (
        <div className={`mt-1 text-xs ${m.noSelfVote ? 'text-emerald-700 dark:text-emerald-400' : 'text-neutral-500'}`}>
          {m.noSelfVote ? t('✓ Pledged not to vote on own proposals') : t('Has not pledged to abstain from own proposals')}
        </div>
      ) : null}
      {fields.includes('blockchainAddress') && m.address ? (
        <div className="mt-2">
          <div className="text-xs font-medium text-neutral-500">{t('Blockchain address')}</div>
          <div className="mt-0.5 break-all font-mono text-[11px] text-neutral-500">{m.address}</div>
        </div>
      ) : null}
      {fields.includes('links') && m.socials && Object.keys(m.socials).length ? (
        <div className="mt-2">
          <div className="text-xs font-medium text-neutral-500">{t('Links')}</div>
          <div className="mt-0.5 flex flex-wrap gap-2 text-xs">
            {Object.entries(m.socials).map(([k, v]) => <a key={k} href={memberLinkHref(k, v)} target="_blank" rel="noreferrer" className="text-emerald-700 hover:underline dark:text-emerald-400">{k === 'x' ? 'X' : k}</a>)}
          </div>
        </div>
      ) : null}
      {fields.includes('preferences') && m.preferences && (m.preferences.contact || m.preferences.notifications) ? (
        <div className="mt-1 text-xs text-neutral-500">{t('Preferences')}: {[m.preferences.contact ? t('open to contact') : null, m.preferences.notifications ? t('notifications') : null].filter(Boolean).join(', ')}</div>
      ) : null}
    </>
  );
}

/** Compact, clickable directory card (photo + name + since + bio preview) — opens the full detail. */
function MemberCardCompact({ m, fields, onOpen, t }: {
  m: GroupMemberView; fields: string[]; onOpen: () => void; t: (s: string) => string;
}) {
  const bioPreview = m.bio ? m.bio.replace(/[#*_`>[\]]/g, '').trim().slice(0, 140) : '';
  return (
    <button onClick={onOpen} className="flex flex-col rounded-lg border border-neutral-200 p-3 text-left transition hover:border-emerald-300 hover:shadow-sm dark:border-neutral-800 dark:hover:border-emerald-800">
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
      {fields.includes('bio') && bioPreview ? (
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{bioPreview}{m.bio && m.bio.length > 140 ? '…' : ''}</p>
      ) : null}
      <span className="mt-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">{t('View profile')} →</span>
    </button>
  );
}

/** §29 — pending group-member registrations the viewer may approve (they are the group's
 *  approver DRep / board / etc.), surfaced in the My-area "Applications" hub alongside Expert
 *  and Submitter reviews. Renders nothing when there is nothing to approve. */
export function GroupApprovals({ showWhenEmpty = false }: { showWhenEmpty?: boolean }) {
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

  if (items.length === 0) return showWhenEmpty ? <section className={card}><p className="text-sm text-neutral-500">{t('No pending applications right now.')}</p></section> : null;
  return (
    <div className="space-y-4">
      {items.map(({ group, pending }) => (
        <section className={card} key={group.key}>
          <h3 className="text-base font-semibold">{group.name} — {t('member applications')} <span className="text-sm font-normal text-neutral-500">({pending.length} {t('pending')})</span></h3>
          <div className="mt-2 space-y-3">
            {pending.map((m) => (
              <div key={m.id} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
                <MemberFields m={m} fields={group.profileFields} t={t} />
                <div className="mt-3 flex gap-2">
                  <button disabled={busy} onClick={() => act(() => groupsApi.approveMember(group.key, m.id))} className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{t('Approve')}</button>
                  <button disabled={busy} onClick={() => act(() => groupsApi.rejectMember(group.key, m.id))} className="rounded border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">{t('Reject')}</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
