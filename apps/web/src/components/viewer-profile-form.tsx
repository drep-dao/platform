'use client';

import { useState } from 'react';
import { profileApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/prefs-context';
import { PhotoUpload } from './photo-upload';

/**
 * §2.1 — the "Viewer" profile: any signed-in wallet sets a public display name + photo. It's the
 * lightest profile on the platform (no registration, no approval). Once a name is set, the user stops
 * showing as "Anonymous" on comments/votes everywhere (names resolve live), and the photo appears
 * beside them. Prefilled from the current profile; saving refreshes auth so the whole UI updates.
 */
export function ViewerProfileForm({ onDone }: { onDone?: () => void }) {
  const t = useT();
  const { profile, refresh } = useAuth();
  const [name, setName] = useState(profile?.user.displayName ?? '');
  const [photo, setPhoto] = useState<string | null>(profile?.user.avatarUrl ?? null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await profileApi.update({ displayName: name.trim() || null, avatarDataUrl: photo });
      await refresh();
      setSaved(true);
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Could not save your profile.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-base font-semibold">{t('Viewer profile')}</h3>
        <p className="mt-1 text-sm text-neutral-500">{t('Set a display name and photo so your comments and votes show who you are. No registration needed — this is just your public name on the platform.')}</p>
      </div>

      <label className="block">
        <span className="text-sm font-medium">{t('Display name')}</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          className="mt-1 w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          placeholder={t('The name shown next to your comments')}
        />
      </label>

      <PhotoUpload photo={photo} onChange={(next, err) => { setPhoto(next); setPhotoError(err ?? null); }} error={photoError} />

      {error ? <div className="text-xs text-red-600">{error}</div> : null}
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={busy} className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
          {busy ? t('Saving…') : t('Save profile')}
        </button>
        {saved ? <span className="text-xs font-medium text-emerald-600">✓ {t('Saved')}</span> : null}
      </div>
    </div>
  );
}
