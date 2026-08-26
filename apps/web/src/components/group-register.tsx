'use client';

import { useCallback, useEffect, useState } from 'react';
import { groupsApi, type GroupConfig, type GroupMembership, type GroupMembershipMine, type GroupMembershipResult } from '@/lib/api';
import { card } from '@/lib/ui';
import { useT } from '@/lib/prefs-context';
import { MarkdownEditor } from './markdown';
import { PhotoUpload } from './photo-upload';
import { useSubcategories } from '@/lib/subcategories';
import { ConfirmDialog } from './confirm-dialog';
import { COUNTRIES } from '@/lib/countries';

const field = 'w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900';

/** §29 — the group registration form, shown when a user picks "Apply as <Name> member" in the
 *  My-area participation chooser. Fields follow the group's configured profileFields; the user is
 *  already wallet-authenticated (Cardano login), so no on-chain DRep is required. */
export function GroupRegisterForm({ group, onDone, initial }: { group: GroupConfig; onDone: () => void; initial?: GroupMembership }) {
  const t = useT();
  const { subs } = useSubcategories();
  const has = (f: string) => group.profileFields.includes(f);
  const editing = !!initial;
  const so = initial?.socials ?? {};
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '');
  const [bio, setBio] = useState(initial?.bio ?? '');
  const [photo, setPhoto] = useState<string | null>(initial?.photo ?? null);
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  const [country, setCountry] = useState(initial?.country ?? '');
  const [conflict, setConflict] = useState(initial?.conflictOfInterest ?? '');
  const [noSelfVote, setNoSelfVote] = useState(!!initial?.noSelfVote);
  const [address, setAddress] = useState(initial?.address ?? '');
  const [expertise, setExpertise] = useState<string[]>(initial?.subcategoryIds ?? []);
  const [links, setLinks] = useState<{ x: string; telegram: string; github: string; email: string }>({ x: so.x ?? '', telegram: so.telegram ?? '', github: so.github ?? '', email: so.email ?? '' });
  const [prefs, setPrefs] = useState<{ contact: boolean; notifications: boolean }>({ contact: !!initial?.preferences?.contact, notifications: !!initial?.preferences?.notifications });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleExpertise = (id: string) => setExpertise((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const register = async () => {
    setError(null);
    setBusy(true);
    try {
      const socials = Object.fromEntries(Object.entries(links).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
      await (editing ? groupsApi.updateProfile : groupsApi.register)(group.key, {
        ...(has('displayName') ? { displayName: displayName.trim() } : {}),
        ...(has('bio') ? { bio } : {}),
        ...(has('photo') && photo ? { photo } : {}),
        ...(has('country') ? { country: country.trim() } : {}),
        ...(has('conflictOfInterest') ? { conflictOfInterest: conflict.trim(), noSelfVote } : {}),
        ...(has('blockchainAddress') ? { address: address.trim() } : {}),
        ...(has('expertise') ? { subcategoryIds: expertise } : {}),
        ...(has('links') ? { socials } : {}),
        ...(has('preferences') ? { preferences: prefs } : {}),
      });
      onDone();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-base font-semibold">{editing ? `${t('Your')} ${group.name} ${t('profile')}` : `${t('Register as')} ${group.name} ${t('member')}`}</h3>
        {!editing ? (
          <p className="mt-1 text-sm text-neutral-500">
            {t('Join with your Cardano wallet.')}{' '}
            {group.admissionType === 'SINGLE_DREP' ? t('A DRep approves new members.') : group.admissionType === 'FREE' ? t('Admission is open.') : t('A reviewer approves new members.')}
          </p>
        ) : null}
      </div>
      {has('displayName') ? (
        <label className="block text-sm">{t('Display name')}
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={field} placeholder={t('How you appear to the group')} />
        </label>
      ) : null}
      {has('photo') ? (
        <div>
          <div className="mb-1 text-sm">{t('Photo')}</div>
          <PhotoUpload photo={photo} onChange={(next, err) => { setPhoto(next); setPhotoErr(err ?? null); }} error={photoErr} />
        </div>
      ) : null}
      {has('bio') ? (
        <MarkdownEditor value={bio} onChange={setBio} title={t('Bio')} minRows={3} placeholder={t('Tell the group about yourself…')} />
      ) : null}
      {has('country') ? (
        <label className="block text-sm">{t('Country')}
          <select value={country} onChange={(e) => setCountry(e.target.value)} className={field}>
            <option value="">{t('— select a country —')}</option>
            {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      ) : null}
      {has('blockchainAddress') ? (
        <label className="block text-sm">{t('Blockchain address')}
          <input value={address} onChange={(e) => setAddress(e.target.value)} className={field} placeholder="addr1…" />
        </label>
      ) : null}
      {has('conflictOfInterest') ? (
        <div className="space-y-2">
          <label className="block text-sm">{t('Conflict of interest')}
            <textarea value={conflict} onChange={(e) => setConflict(e.target.value)} rows={2} className={field} placeholder={t('Any conflicts to disclose…')} />
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={noSelfVote} onChange={(e) => setNoSelfVote(e.target.checked)} className="mt-0.5" />
            <span>{t('I will not vote for my own proposal')} <span className="text-xs text-neutral-500">{t('(informative — optional)')}</span></span>
          </label>
        </div>
      ) : null}
      {has('expertise') ? (
        <div>
          <div className="text-sm">{t('Expertise')}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {subs.map((sc) => (
              <button key={sc.id} type="button" onClick={() => toggleExpertise(sc.id)} className={`rounded-full border px-2 py-0.5 text-xs ${expertise.includes(sc.id) ? 'border-emerald-400 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-400'}`}>{sc.label}</button>
            ))}
          </div>
        </div>
      ) : null}
      {has('links') ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {(['x', 'telegram', 'github', 'email'] as const).map((k) => (
            <label key={k} className="block text-sm capitalize">{k === 'x' ? 'X' : k}
              <input value={links[k]} onChange={(e) => setLinks((l) => ({ ...l, [k]: e.target.value }))} className={field} placeholder={k === 'email' ? 'you@example.com' : `@handle / url`} />
            </label>
          ))}
        </div>
      ) : null}
      {has('preferences') ? (
        <div className="space-y-1">
          <div className="text-sm">{t('Preferences')}</div>
          <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300"><input type="checkbox" checked={prefs.contact} onChange={(e) => setPrefs((p) => ({ ...p, contact: e.target.checked }))} /> {t('Open to being contacted by the group')}</label>
          <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300"><input type="checkbox" checked={prefs.notifications} onChange={(e) => setPrefs((p) => ({ ...p, notifications: e.target.checked }))} /> {t('Receive group notifications')}</label>
        </div>
      ) : null}
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      <button disabled={busy} onClick={register} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
        {busy ? t('Saving…') : editing ? t('Save profile') : `${t('Register as')} ${group.name} ${t('member')}`}
      </button>
    </div>
  );
}

/** §29 — "Apply as <Name> member" cards for DReps / experts / anyone already holding a role, so
 *  they too can join a group. One card per active group the user isn't yet a member of; the button
 *  reveals the registration form inline. Renders nothing when no group is active. */
export function GroupApply() {
  const [groups, setGroups] = useState<GroupConfig[]>([]);
  const [mine, setMine] = useState<GroupMembershipMine[]>([]);
  const load = useCallback(() => {
    groupsApi.listActive().then(setGroups).catch(() => setGroups([]));
    groupsApi.mine().then(setMine).catch(() => setMine([]));
  }, []);
  useEffect(load, [load]);
  const opts = groups.map((g) => ({ g, status: mine.find((m) => m.groupKey === g.key)?.status ?? null })).filter((o) => o.status !== 'ADMITTED');
  if (opts.length === 0) return null;
  return (
    <>
      {opts.map(({ g, status }) => <GroupApplyCard key={g.key} g={g} pending={status === 'PENDING'} onChanged={load} />)}
    </>
  );
}

function GroupApplyCard({ g, pending, onChanged }: { g: GroupConfig; pending: boolean; onChanged: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <section className={card}>
      <h3 className="text-base font-semibold">{pending ? `${g.name} ${t('member')}` : `${t('Apply as')} ${g.name} ${t('member')}`}</h3>
      {pending ? (
        <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">{t('Your registration is awaiting approval.')}</p>
      ) : !open ? (
        <>
          <p className="mt-1 text-sm text-neutral-500">{t('Submit and vote on')} {g.name} {t('proposals. Register with your Cardano wallet; the group’s reviewer approves you.')}</p>
          <button onClick={() => setOpen(true)} className="mt-2 rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">{t('Apply as')} {g.name} {t('member')}</button>
        </>
      ) : (
        <div className="mt-2"><GroupRegisterForm group={g} onDone={() => { setOpen(false); onChanged(); }} /></div>
      )}
    </section>
  );
}


/** §29 — an admitted member's My-area home for a group: edit their profile + submit and track the
 *  group's proposals (history). Consistent with how a DRep manages their profile + internal proposals. */
export function GroupMemberArea({ groupKey }: { groupKey: string }) {
  const t = useT();
  const [data, setData] = useState<GroupMembershipResult | null>(null);
  const load = useCallback(() => { groupsApi.membership(groupKey).then(setData).catch(() => setData(null)); }, [groupKey]);
  useEffect(load, [load]);
  if (!data || !data.membership) return null;
  const admitted = data.membership.status === 'ADMITTED';
  return (
    <div className="space-y-4">
      <section className={card}>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Your')} {data.group.name} {t('membership')}</div>
        <GroupRegisterForm group={data.group} initial={data.membership} onDone={load} />
        {admitted ? <GroupLeaveButton groupKey={groupKey} groupName={data.group.name} /> : null}
      </section>
      {/* §29 OG — self-governed voting quorum; any admitted member may set it (applies to everyone). */}
      {admitted ? <GroupVotingSettings group={data.group} onSaved={load} /> : null}
      {/* §29 OG — when the group self-governs, admitted members approve new applicants here. */}
      {data.canManage ? <GroupPendingApprovals groupKey={groupKey} groupName={data.group.name} /> : null}
    </div>
  );
}

/** §29 OG — leave the group (confirmed). Reloads so the My-area tab + nav reflect the departure. */
function GroupLeaveButton({ groupKey, groupName }: { groupKey: string; groupName: string }) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-3 border-t border-neutral-200 pt-3 dark:border-neutral-800">
      <button
        onClick={() => setConfirming(true)}
        className="rounded border border-rose-300 px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950"
      >
        {t('Leave')} {groupName}
      </button>
      <ConfirmDialog
        open={confirming}
        title={`${t('Leave')} ${groupName}?`}
        message={t('You will no longer be a member and cannot submit or vote on its proposals. You can re-apply later.')}
        confirmLabel={t('Leave')}
        cancelLabel={t('Cancel')}
        tone="danger"
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await groupsApi.leave(groupKey);
            if (typeof window !== 'undefined') window.location.reload();
          } finally {
            setBusy(false);
            setConfirming(false);
          }
        }}
      />
      {busy ? <span className="ml-2 text-xs text-neutral-500">{t('Leaving…')}</span> : null}
    </div>
  );
}

/** §29 OG — the group's member-count voting quorum. OPEN = no limit; EXACT = only when the member
 *  count equals N; MINIMUM = only when it is at least N. Gates whether proposals can be submitted. */
function GroupVotingSettings({ group, onSaved }: { group: GroupConfig; onSaved: () => void }) {
  const t = useT();
  const [mode, setMode] = useState(group.quorumMode || 'OPEN');
  const [count, setCount] = useState<number>(group.quorumCount ?? 1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const save = async () => {
    setMsg(null);
    setBusy(true);
    try {
      await groupsApi.updateVoting(group.key, { quorumMode: mode, quorumCount: mode === 'OPEN' ? null : count });
      setMsg(t('Saved'));
      onSaved();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('Could not save.'));
    } finally {
      setBusy(false);
    }
  };
  const modes: { key: string; label: string; hint: string }[] = [
    { key: 'OPEN', label: t('Open'), hint: t('No limit — the group can vote with any number of members.') },
    { key: 'EXACT', label: t('Exact number of members'), hint: t('The group can vote only when it has exactly this many members.') },
    { key: 'MINIMUM', label: t('Minimum'), hint: t('The group can vote only with at least this many members.') },
  ];
  return (
    <section className={card}>
      <h3 className="text-base font-semibold">{group.name} · {t('voting settings')}</h3>
      <p className="mt-1 text-sm text-neutral-500">{t('Applies to the whole group. Set the member count required to submit and vote on proposals.')}</p>
      <div className="mt-3 space-y-2">
        {modes.map((m) => (
          <label key={m.key} className="flex items-start gap-2 text-sm">
            <input type="radio" name="quorum" className="mt-1" checked={mode === m.key} onChange={() => setMode(m.key)} />
            <span>
              <span className="font-medium">{m.label}</span>
              <span className="block text-xs text-neutral-500">{m.hint}</span>
            </span>
          </label>
        ))}
        {mode !== 'OPEN' ? (
          <div className="flex items-center gap-2 pl-6 text-sm">
            <span className="text-neutral-500">{t('Number of members')}:</span>
            <input
              type="number"
              min={1}
              value={count}
              onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))}
              className="w-24 rounded-md border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
            />
          </div>
        ) : null}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button onClick={save} disabled={busy} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
          {busy ? t('Saving…') : t('Save voting settings')}
        </button>
        {msg ? <span className="text-xs text-neutral-500">{msg}</span> : null}
      </div>
    </section>
  );
}

/** §29 OG — pending applicants an admitted member may approve/reject (self-governance). */
function GroupPendingApprovals({ groupKey, groupName }: { groupKey: string; groupName: string }) {
  const t = useT();
  const [data, setData] = useState<import('@/lib/api').GroupMembersResult | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { groupsApi.members(groupKey).then(setData).catch(() => setData(null)); }, [groupKey]);
  useEffect(load, [load]);
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); await load(); } finally { setBusy(false); } };
  if (!data || !data.canManage || data.pending.length === 0) return null;
  return (
    <section className={card}>
      <h3 className="text-base font-semibold">{groupName} · {t('applications')} <span className="text-sm font-normal text-neutral-500">({data.pending.length} {t('pending')})</span></h3>
      <ul className="mt-2 space-y-2">
        {data.pending.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-neutral-200 p-2 text-sm dark:border-neutral-800">
            <span className="font-medium">{m.displayName}</span>
            <span className="flex gap-2">
              <button disabled={busy} onClick={() => act(() => groupsApi.approveMember(groupKey, m.id))} className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{t('Approve')}</button>
              <button disabled={busy} onClick={() => act(() => groupsApi.rejectMember(groupKey, m.id))} className="rounded border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">{t('Reject')}</button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
