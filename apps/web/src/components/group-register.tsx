'use client';

import { useCallback, useEffect, useState } from 'react';
import { groupsApi, type GroupConfig, type GroupMembershipMine } from '@/lib/api';
import { card } from '@/lib/ui';
import { useT } from '@/lib/prefs-context';
import { MarkdownEditor } from './markdown';
import { PhotoUpload } from './photo-upload';

const field = 'w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900';

/** §29 — the My-area "Register as <Name> member" section for every active group. Members log in
 *  with their Cardano wallet (this area is wallet-authenticated) and register per the group's
 *  configured profile fields; admission follows the group's admission type. */
export function GroupMemberships() {
  const t = useT();
  const [groups, setGroups] = useState<GroupConfig[]>([]);
  const [mine, setMine] = useState<GroupMembershipMine[]>([]);
  const reload = useCallback(() => {
    groupsApi.listActive().then(setGroups).catch(() => setGroups([]));
    groupsApi.mine().then(setMine).catch(() => setMine([]));
  }, []);
  useEffect(reload, [reload]);

  if (groups.length === 0) return <section className={card}><p className="text-sm text-neutral-500">{t('No groups are active yet.')}</p></section>;

  return (
    <div className="space-y-4">
      {groups.map((g) => <GroupCard key={g.key} g={g} membership={mine.find((m) => m.groupKey === g.key) ?? null} onChanged={reload} />)}
    </div>
  );
}

function GroupCard({ g, membership, onChanged }: { g: GroupConfig; membership: GroupMembershipMine | null; onChanged: () => void }) {
  const t = useT();
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = membership?.status ?? null;

  const register = async () => {
    setError(null);
    setBusy(true);
    try {
      await groupsApi.register(g.key, {
        ...(g.profileFields.includes('displayName') ? { displayName: displayName.trim() } : {}),
        ...(g.profileFields.includes('bio') ? { bio } : {}),
        ...(g.profileFields.includes('photo') && photo ? { photo } : {}),
      });
      onChanged();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <section className={card}>
      <h3 className="text-base font-semibold">{g.name}</h3>

      {status === 'ADMITTED' ? (
        <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-400">
          {t('You are a')} {g.name} {t('member ✅')} — {t('submit and vote from the')} <strong>{g.name} {t('proposals')}</strong> {t('menu.')}
        </p>
      ) : status === 'PENDING' ? (
        <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
          {t('Your registration is awaiting approval.')}
          {g.admissionType === 'SINGLE_DREP' && !g.approverUserId ? ' ' + t('(no approver has been assigned yet)') : ''}
        </p>
      ) : (
        <div className="mt-2 space-y-3">
          <p className="text-sm text-neutral-500">{t('Register as a')} {g.name} {t('member with your Cardano wallet.')}</p>
          {g.profileFields.includes('displayName') ? (
            <label className="block text-sm">{t('Display name')}
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={field} placeholder={t('How you appear to the group')} />
            </label>
          ) : null}
          {g.profileFields.includes('photo') ? (
            <div>
              <div className="mb-1 text-sm">{t('Photo')}</div>
              <PhotoUpload photo={photo} onChange={(next, err) => { setPhoto(next); setPhotoErr(err ?? null); }} error={photoErr} />
            </div>
          ) : null}
          {g.profileFields.includes('bio') ? (
            <MarkdownEditor value={bio} onChange={setBio} title={t('Bio')} minRows={3} placeholder={t('Tell the group about yourself…')} />
          ) : null}
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <button disabled={busy} onClick={register} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            {busy ? t('Registering…') : `${t('Register as')} ${g.name} ${t('member')}`}
          </button>
        </div>
      )}
    </section>
  );
}
