'use client';

import { useCallback, useEffect, useState } from 'react';
import { groupsApi, type GroupConfig, type GroupMembershipMine } from '@/lib/api';
import { card } from '@/lib/ui';
import { useT } from '@/lib/prefs-context';
import { MarkdownEditor } from './markdown';
import { PhotoUpload } from './photo-upload';

const field = 'w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900';

/** §29 — the group registration form, shown when a user picks "Apply as <Name> member" in the
 *  My-area participation chooser. Fields follow the group's configured profileFields; the user is
 *  already wallet-authenticated (Cardano login), so no on-chain DRep is required. */
export function GroupRegisterForm({ group, onDone }: { group: GroupConfig; onDone: () => void }) {
  const t = useT();
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const register = async () => {
    setError(null);
    setBusy(true);
    try {
      await groupsApi.register(group.key, {
        ...(group.profileFields.includes('displayName') ? { displayName: displayName.trim() } : {}),
        ...(group.profileFields.includes('bio') ? { bio } : {}),
        ...(group.profileFields.includes('photo') && photo ? { photo } : {}),
      });
      onDone();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-base font-semibold">{t('Register as')} {group.name} {t('member')}</h3>
        <p className="mt-1 text-sm text-neutral-500">
          {t('Join with your Cardano wallet.')}{' '}
          {group.admissionType === 'SINGLE_DREP' ? t('A DRep approves new members.') : group.admissionType === 'FREE' ? t('Admission is open.') : t('A reviewer approves new members.')}
        </p>
      </div>
      {group.profileFields.includes('displayName') ? (
        <label className="block text-sm">{t('Display name')}
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={field} placeholder={t('How you appear to the group')} />
        </label>
      ) : null}
      {group.profileFields.includes('photo') ? (
        <div>
          <div className="mb-1 text-sm">{t('Photo')}</div>
          <PhotoUpload photo={photo} onChange={(next, err) => { setPhoto(next); setPhotoErr(err ?? null); }} error={photoErr} />
        </div>
      ) : null}
      {group.profileFields.includes('bio') ? (
        <MarkdownEditor value={bio} onChange={setBio} title={t('Bio')} minRows={3} placeholder={t('Tell the group about yourself…')} />
      ) : null}
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      <button disabled={busy} onClick={register} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
        {busy ? t('Registering…') : `${t('Register as')} ${group.name} ${t('member')}`}
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
