'use client';

import { useEffect, useState } from 'react';
import {
  boardApi, boardExpertsApi, boardSubmittersApi, expertApi, groupsApi, internalProposalsApi,
  removalApi, rewardAddressApi, treasuryApi,
  type BoardAction,
} from './api';
import { GROUPS_ENABLED } from './features';

/**
 * §20 — the SINGLE source of truth for "items awaiting this member", split by My-area tab.
 * Every to-do surface reads from here so the counts can't diverge: the in-area tab badges,
 * the My-area left-nav badge, and the login-box notification badge. Polls every 30 s.
 *
 * Buckets map 1:1 to the My-area tabs:
 *  - actions    → Actions tab (reward payouts to review & sign)
 *  - treasury   → Treasury tab (non-reward multisig actions awaiting THIS member)
 *  - applications→ Applications tab (DRep/Expert/Submitter applications + removals not yet voted)
 *  - internal   → Internal proposals awaiting this DRep's vote
 *  - profile    → Profile (reward-payment address not set yet, for reward earners)
 */
export interface TodoCounts {
  treasury: number;
  actions: number;
  applications: number;
  groupApplications: number; // §29 — pending applicants across groups this member may approve
  groupProposals: number; // §29 — active group proposals this member still has to vote on
  internal: number;
  profile: number;
}

export const EMPTY_TODO_COUNTS: TodoCounts = {
  treasury: 0, actions: 0, applications: 0, groupApplications: 0, groupProposals: 0, internal: 0, profile: 0,
};

/** Total to-dos awaiting the member across every tab — used for the left-nav + login-box badges. */
export function todoTotal(c: TodoCounts): number {
  return c.treasury + c.actions + c.applications + c.groupApplications + c.groupProposals + c.internal + c.profile;
}

/** Fire after an action that may change the to-do counts (e.g. signing/clearing a board action)
 *  so every to-do badge re-checks immediately instead of waiting for the next 30 s poll. */
export const TODO_CHANGED_EVENT = 'drepdao:todo-changed';
export function notifyTodoChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(TODO_CHANGED_EVENT));
}

/**
 * @param refreshKey bump this (e.g. from a "refresh" button) to force an immediate re-poll;
 *   the counts also refresh every 30 s and whenever the tab regains focus.
 */
export function useTodoCounts(isBoard: boolean, canVote: boolean, enabled = true, refreshKey = 0): TodoCounts {
  const [counts, setCounts] = useState<TodoCounts>(EMPTY_TODO_COUNTS);
  useEffect(() => {
    // Logged-out / role-less viewers have nothing to do and every call would 401.
    if (!enabled) { setCounts(EMPTY_TODO_COUNTS); return; }
    let alive = true;
    const poll = async () => {
      const next: TodoCounts = { ...EMPTY_TODO_COUNTS };
      if (isBoard) {
        const [a, dapps, eapps, rem, subs] = await Promise.allSettled([
          treasuryApi.boardActions(),
          boardApi.listApplications(),
          boardExpertsApi.applications(),
          removalApi.list(),
          boardSubmittersApi.applications(), // §2.1 — submitter applications to review
        ]);
        const acts = a.status === 'fulfilled' ? a.value.actions : [];
        // Only badge an action the current board member still has to act on — once they've
        // authorized (phase 1) or signed (phase 2), it's waiting on others, not their to-do.
        const needsMe = (x: BoardAction) => (x.phase === 'AUTHORIZE' ? !x.mineCommitted : !x.mineApproved);
        next.treasury = acts.filter((x) => x.kind !== 'REWARD_PAYOUT' && needsMe(x)).length;
        next.actions = acts.filter((x) => x.kind === 'REWARD_PAYOUT' && needsMe(x)).length;
        next.applications =
          (dapps.status === 'fulfilled' ? dapps.value.filter((x) => !x.myVote).length : 0) +
          (eapps.status === 'fulfilled' ? eapps.value.length : 0) +
          (rem.status === 'fulfilled' ? rem.value.filter((x) => !x.myVote).length : 0) +
          (subs.status === 'fulfilled' ? subs.value.length : 0);
      }
      if (canVote) {
        try { next.internal = (await internalProposalsApi.pendingCount()).count; } catch { /* 0 */ }
      }
      // §15.4 — reward earners (DReps/board/Council members + approved experts) need a reward payment
      // address; nag on the Profile tab until one is set. We resolve "approved expert" here so every
      // to-do surface agrees (the left-nav + login box don't otherwise know the expert status).
      let isApprovedExpert = false;
      if (!canVote) {
        try { isApprovedExpert = !!(await expertApi.mine())?.approvedByBoard; } catch { /* 0 */ }
      }
      if (canVote || isApprovedExpert) {
        try { const r = await rewardAddressApi.get(); if (!r.rewardPaymentAddress) next.profile += 1; } catch { /* 0 */ }
      }
      // §29 — pending applicants across self-governing groups this member approves (e.g. an OG member).
      if (GROUPS_ENABLED) {
        try { next.groupApplications = (await groupsApi.pendingApprovalsCount()).count; } catch { /* 0 */ }
        try { next.groupProposals = (await groupsApi.pendingVotesCount()).count; } catch { /* 0 */ }
      }
      if (alive) setCounts(next);
    };
    poll();
    const id = setInterval(poll, 30_000);
    // Re-check when the user returns to the tab, or when something signals a to-do change
    // (e.g. a board action was just signed/cleared) — so the badges update without a 30 s wait.
    const onFocus = () => { void poll(); };
    window.addEventListener('focus', onFocus);
    window.addEventListener(TODO_CHANGED_EVENT, onFocus);
    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(TODO_CHANGED_EVENT, onFocus);
    };
  }, [isBoard, canVote, enabled, refreshKey]);
  return counts;
}

/** The My-area tab a to-do badge should jump to: the first tab (in priority order) with work. */
export function firstTodoTab(c: TodoCounts): { tab: string; label: string } | null {
  const order: { key: keyof TodoCounts; tab: string; label: string }[] = [
    { key: 'actions', tab: 'sign', label: 'Actions' },
    { key: 'treasury', tab: 'treasury', label: 'Treasury' },
    { key: 'applications', tab: 'apps', label: 'Applications' },
    { key: 'groupApplications', tab: 'group-apps', label: 'Applications' },
    { key: 'groupProposals', tab: 'group-proposals', label: 'Proposals' },
    { key: 'internal', tab: 'internal', label: 'Internal proposals' },
    { key: 'profile', tab: 'profile', label: 'Profile' },
  ];
  for (const o of order) if (c[o.key] > 0) return { tab: o.tab, label: o.label };
  return null;
}
