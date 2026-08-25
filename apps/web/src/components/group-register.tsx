'use client';

import { useCallback, useEffect, useState } from 'react';
import { groupsApi, type GroupConfig, type GroupMembership, type GroupMembershipMine, type GroupMembershipResult } from '@/lib/api';
import { GroupProposals } from './group-proposals';
import { card } from '@/lib/ui';
import { useT } from '@/lib/prefs-context';
import { MarkdownEditor } from './markdown';
import { PhotoUpload } from './photo-upload';
import { useSubcategories } from '@/lib/subcategories';

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
        ...(has('conflictOfInterest') ? { conflictOfInterest: conflict.trim() } : {}),
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
          <input value={country} onChange={(e) => setCountry(e.target.value)} className={field} placeholder={t('Country')} />
        </label>
      ) : null}
      {has('blockchainAddress') ? (
        <label className="block text-sm">{t('Blockchain address')}
          <input value={address} onChange={(e) => setAddress(e.target.value)} className={field} placeholder="addr1…" />
        </label>
      ) : null}
      {has('conflictOfInterest') ? (
        <label className="block text-sm">{t('Conflict of interest')}
          <textarea value={conflict} onChange={(e) => setConflict(e.target.value)} rows={2} className={field} placeholder={t('Any conflicts to disclose…')} />
        </label>
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
  return (
    <div className="space-y-4">
      <section className={card}>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Your')} {data.group.name} {t('membership')}</div>
        <GroupRegisterForm group={data.group} initial={data.membership} onDone={load} />
      </section>
      <GroupProposals groupKey={groupKey} />
    </div>
  );
}
