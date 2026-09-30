'use client';

import { useT } from '@/lib/prefs-context';

/**
 * §29 OG — voting quorum notice. A group with an EXACT/MINIMUM member-count quorum can only vote
 * (and submit proposals) once the required number of members is registered. The required count comes
 * from the group config (quorumCount) — never hard-coded. Shown to everyone on the members + proposals
 * pages so it's clear how many more members are needed before voting opens.
 */
export function GroupQuorumNotice({ quorumMode, quorumCount, memberCount }: { quorumMode: string; quorumCount: number | null; memberCount: number }) {
  const t = useT();
  if (!quorumCount || (quorumMode !== 'EXACT' && quorumMode !== 'MINIMUM')) return null;
  const met = quorumMode === 'EXACT' ? memberCount === quorumCount : memberCount >= quorumCount;
  const reqWord = quorumMode === 'EXACT' ? t('exactly') : t('at least');

  if (met) {
    return (
      <div className="mt-3 rounded-md border border-emerald-300 bg-emerald-50/60 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
        ✓ {t('Voting is open')} — {memberCount} {t('of')} {quorumCount} {t('members registered.')}
      </div>
    );
  }
  return (
    <div className="mt-3 rounded-md border border-amber-300 bg-amber-50/60 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
      {t('Voting opens once')} {reqWord} {quorumCount} {t('members are registered.')} <strong>{memberCount} {t('of')} {quorumCount}</strong> {t('registered so far.')}
    </div>
  );
}
