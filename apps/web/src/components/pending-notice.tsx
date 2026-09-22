'use client';

import { useT } from '@/lib/prefs-context';
import { card } from '@/lib/ui';

/** §2 — one consistent "awaiting approval" notice for every application (Council DRep, Expert,
 *  Submitter, group/OG member), so a pending applicant always sees the same clear card. */
export function PendingNotice({ title, canUpdate = true }: { title: string; canUpdate?: boolean }) {
  const t = useT();
  return (
    <section className={`${card} border-amber-300 dark:border-amber-800`}>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
        {t('Your registration is awaiting approval.')}{canUpdate ? ' ' + t('You can still update it below.') : ''}
      </p>
    </section>
  );
}
