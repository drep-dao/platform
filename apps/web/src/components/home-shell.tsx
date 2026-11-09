'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { usePrefs } from '@/lib/prefs-context';
import { useUrlNav } from '@/lib/use-url-nav';
import { NavIcon } from './nav-icons';
import { ConnectWallet } from './connect-wallet';
import { LangThemeControls } from './language-theme-switcher';
import { DrepVerifyPrompt } from './drep-verify-prompt';
import { PublicLanding } from './public-landing';
import { PublicScanTool, PublicScanPage } from './public-scan-tool';
import { brand } from '@/lib/brand';
import { MemberArea } from './member-area';
import { DaoOverview } from './dao-overview';
import { DaoMembersDirectory } from './dao-members-directory';
import { GovernanceSetup } from './governance-setup';
import { ScheduleEvent } from './schedule-event';
import { OnchainSourcePanel } from './onchain-source-panel';
import { OnChainProofs } from './on-chain-proofs';
import { TreasuryOverview } from './treasury-overview';
import { InternalProposals } from './internal-proposals';
import { RuleDocuments } from './rule-documents';
import { Decisions } from './decisions';
import { ProposalChecker, ProposalScoreSetup } from './proposal-checker';
import { RequestsSection } from './requests-section';
import { GroupMembers } from './group-members';
import { GroupProposals } from './group-proposals';
import { groupsApi, proposalCheckerApi, type GroupConfig } from '@/lib/api';
import { GROUPS_ENABLED } from '@/lib/features';
import { JoinDaoButton } from './join-dao-button';
import { NotificationBadge } from './notification-badge';
import { NotificationBell } from './notification-bell';
import { SubmittersDirectory } from './submitters-directory';
import { ExpertsDirectory } from './experts-directory';
import { WalletStatusBanner } from './wallet-status-banner';
import { useTodoCounts, todoTotal } from '@/lib/use-todo-counts';
import { HealthBadge } from '@/app/health-badge';

type View = 'overview' | 'members' | 'votingpower' | 'submitters' | 'experts' | 'me' | 'requests' | 'internal' | 'rules' | 'decisions' | 'proposalchecker' | 'scantool' | 'scoresetup' | 'proofs' | 'treasury' | 'setup' | 'events' | 'landing';
const NAV: { key: View; label: string; icon: string; boardOnly?: boolean; publicOnly?: boolean; governanceOnly?: boolean; experimental?: boolean; afterGroups?: boolean }[] = [
  // §2 — "My area" first: it is the member's home (to-dos, profile, proposals).
  { key: 'me', label: 'My area', icon: 'user' },
  { key: 'overview', label: 'Council Member overview', icon: 'dashboard' },
  { key: 'members', label: 'Council members', icon: 'users' },
  // Public-only: the voting-power table (DaoOverview) lives under "Council Member
  // overview" for members, but logged-out visitors reach it via "Voting power".
  { key: 'votingpower', label: 'Voting power', icon: 'dashboard', publicOnly: true },
  { key: 'submitters', label: 'Submitters', icon: 'send' },
  { key: 'experts', label: 'Experts', icon: 'award' },
  { key: 'requests', label: 'Requests', icon: 'message' },
  { key: 'internal', label: 'Internal proposals', icon: 'files' },
  { key: 'rules', label: 'Rule Documents', icon: 'file-text' },
  { key: 'decisions', label: 'Decisions', icon: 'award' },
  // Proposal-score belongs to the DRep Council (governance) platform only — not the Innovation &
  // Growth (funding) edition — so it is gated on brand.kind === 'governance'.
  { key: 'proposalchecker', label: 'On-chain Proposal Score', icon: 'clipboard', governanceOnly: true, experimental: true },
  { key: 'proofs', label: 'On-chain proofs', icon: 'shield' },
  { key: 'treasury', label: 'Treasury', icon: 'landmark' },
  { key: 'setup', label: 'Platform setup', icon: 'settings', boardOnly: true },
  { key: 'events', label: 'Schedule Event', icon: 'calendar', boardOnly: true },
  { key: 'scoresetup', label: 'Proposal Score Setup', icon: 'clipboard', boardOnly: true, governanceOnly: true, experimental: true },
  // Public pay-to-scan tool — full-screen in the main window. Rendered separately below the groups
  // block (afterGroups), gated on the board having the tool switched on (scanToolOn).
  { key: 'scantool', label: 'Score a draft', icon: 'clipboard', governanceOnly: true, experimental: true, afterGroups: true },
];
const SCORE_ENABLED = brand.kind === 'governance';
// Views a logged-out visitor may browse read-only. Internal proposals are public (their read
// endpoints filter out PRIVATE/DRAFT), so the list is reachable from the nav and any proposal's
// share link opens for anyone; published Requests are public too so visitors can browse them.
const PUBLIC_VIEWS: View[] = ['overview', 'members', 'votingpower', 'requests', 'internal', 'proofs', 'treasury', 'rules', 'decisions', 'proposalchecker', 'scantool'];

export function HomeShell() {
  const { profile, loading } = useAuth();
  const { t } = usePrefs();
  const { get, setParams } = useUrlNav();
  // The active menu view + an optionally-open proposal come from the URL, so every screen
  // (and any open proposal) has its own shareable link. Switching the menu clears submenu state.
  // 'landing' is a valid view (the public front page, reachable while logged in) even though it is
  // not a left-nav item, so accept it explicitly alongside the NAV keys.
  const view = (NAV.some((n) => n.key === get('view')) || get('view') === 'landing' ? get('view') : 'overview') as View;
  // §29 — configurable groups add dynamic left-nav items ("<Name> members" / "<Name> proposals").
  const [groups, setGroups] = useState<GroupConfig[]>([]);
  useEffect(() => { if (GROUPS_ENABLED) groupsApi.listActive().then(setGroups).catch(() => setGroups([])); }, []);
  // Whether the board has switched the public pay-to-scan tool on — gates its left-nav item (the
  // teaser box self-hides on the same flag). Fetched once; the nav item appears below the groups.
  const [scanToolOn, setScanToolOn] = useState(false);
  useEffect(() => { if (SCORE_ENABLED) proposalCheckerApi.scanTool().then((s) => setScanToolOn(!!s.enabled)).catch(() => setScanToolOn(false)); }, []);
  const rawView = get('view') ?? 'overview';
  const groupMatch = /^g:([a-z0-9-]+):(members|proposals)$/.exec(rawView);
  const openGroupView = (key: string) => setParams({ view: key, tab: null, round: null, proposal: null, ip: null, expert: null, doc: null, gp: null });
  // Switching the menu (or signing in as a different user) clears all sub-navigation —
  // tab inside My-area, opened round / funding proposal, opened internal proposal (`ip`).
  const [viewNonce, setViewNonce] = useState(0);
  const setView = (v: View) => {
    if (v === view) setViewNonce((n) => n + 1); // same item → reset to its overview
    setParams({ view: v, tab: null, round: null, proposal: null, ip: null, expert: null, doc: null, gp: null });
  };

  // Reset sub-navigation whenever the signed-in user changes (login / logout / switch wallet) so
  // a fresh login never inherits the previous user's open detail page (e.g. an ?ip= internal
  // proposal). Top-level view is kept — the user lands on the same menu item, just clean.
  const prevUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    const id = profile?.user?.id ?? null;
    const prev = prevUserIdRef.current;
    // Clear only on a real switch/logout (prev was a signed-in user); NOT on the first anonymous→login
    // transition — otherwise a shared ?proposal=/?ip=/?gp= link would be dropped the moment the
    // visitor logs in to view or vote.
    if (prev !== null && prev !== id) {
      setParams({ tab: null, round: null, proposal: null, ip: null, gp: null });
    }
    prevUserIdRef.current = id;
  }, [profile, setParams]);

  // §20 — left-nav My-area to-do badge. Computed for every render (even
  // logged-out / loading) so the hook ordering matches the post-login render
  // — Rules of Hooks forbid calling a hook only after an early return. The
  // hook itself returns 0 when there's no role/auth, so the badge is hidden.
  const isBoard = profile?.roles.includes('BOARD') ?? false;
  // Match member-area's definition (EXPERT handled inside the hook via the reward-address nag)
  // so the left-nav badge, the login-box badge, and the in-area tab badges all agree.
  // §20 — council voters only (see member-area): registered-but-not-joined DReps aren't nagged.
  const canVote = (profile?.roles.includes('DAO_MEMBER') || profile?.roles.includes('BOARD')) ?? false;
  // Bumped by the login-box "refresh" button to force an immediate re-check of the to-dos.
  // Top-right "Connect wallet" dropdown on the logged-out public shell. Declared before the
  // logged-out early return so hook order stays stable across both renders.
  const [walletOpen, setWalletOpen] = useState(false);
  const [todoRefresh, setTodoRefresh] = useState(0);
  const todoCounts = useTodoCounts(isBoard, canVote, !!profile, todoRefresh);
  const myAreaTodo = todoTotal(todoCounts);

  // Both shells render their OWN language/theme controls (so they scroll with the page instead of
  // hovering): the public shell in its top-right cluster (all sizes), the member shell in its right
  // column (desktop only — mobile keeps the global fixed switcher). Flag the body so globals.css hides
  // the global switcher accordingly and it's never duplicated.
  const isPublicShell = loading || !profile;
  useEffect(() => {
    document.body.classList.toggle('shell-public', isPublicShell);
    document.body.classList.toggle('shell-member', !isPublicShell);
    return () => document.body.classList.remove('shell-public', 'shell-member');
  }, [isPublicShell]);

  // Left-nav entry for the public pay-to-scan tool: a separator then the item, placed at the very
  // bottom (below the OG groups). `display:contents` lets both take part in the nav's spacing, same
  // trick the groups block uses. Shown only when governance + the board switched the tool on.
  const scanNav = (active: boolean) =>
    SCORE_ENABLED && scanToolOn ? (
      <div className="contents">
        <div className="mt-2 hidden border-t border-neutral-200 pt-2 lg:block dark:border-neutral-800" />
        <button
          onClick={() => setView('scantool')}
          className={`flex w-auto shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm lg:w-full ${
            active ? 'bg-emerald-600 font-medium text-white' : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
          }`}
        >
          <NavIcon name="clipboard" className="h-4 w-4 opacity-80" />
          {t('Score a draft')}
          <span title={t('Experimental')} className="rounded bg-amber-100 px-1 text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">{t('exp')}</span>
        </button>
      </div>
    ) : null;

  // Logged out (or restoring): the public, read-only shell — a top bar with the brand,
  // a read-only nav, and "Connect wallet" top-right. Everyone sees live public governance
  // data; only signing in unlocks "My area" and anything actionable.
  if (loading || !profile) {
    const pubView: View = (PUBLIC_VIEWS.includes(view) ? view : 'overview') as View;
    return (
      <div className="relative flex min-h-screen flex-col gap-6 px-4 pb-6 pt-16 sm:px-6 lg:flex-row">
        {/* Top-right cluster: language · theme · Connect wallet (in that order), the place people look
            for sign-in. Absolute (not fixed) so it scrolls away with the page instead of hovering over
            the content; the reserved room above (pt-16) keeps the hero from sitting under it. */}
        <div className="absolute right-4 top-3 z-50 flex items-center gap-2 sm:right-6">
          <LangThemeControls />
          <div className="relative">
            <button onClick={() => setWalletOpen((o) => !o)}
              className="whitespace-nowrap rounded-md bg-emerald-600 px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700">
              {t('Connect wallet')}
            </button>
            {walletOpen ? (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setWalletOpen(false)} />
                <div className="absolute right-0 top-full z-20 mt-1 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-neutral-200 bg-white p-4 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
                  <ConnectWallet />
                </div>
              </>
            ) : null}
          </div>
        </div>
        {/* Left sidebar (same as the logged-in shell): brand + the public nav. On mobile it's a
            horizontal scroll strip above the content; on lg a vertical sidebar. */}
        <aside className="lg:w-56 lg:shrink-0">
          <button onClick={() => setView('overview')} title={t('Landing page')}
            className="mb-3 flex items-center gap-2 text-xl font-bold tracking-tight hover:opacity-80 lg:mb-4">
            <img src={brand.icon} alt="" className="h-6 w-6" />
            {brand.name}
          </button>
          <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:gap-0 lg:space-y-1 lg:overflow-visible lg:px-0 lg:pb-0">
            {NAV.filter((n) => PUBLIC_VIEWS.includes(n.key) && !n.afterGroups && (!n.governanceOnly || SCORE_ENABLED)).map((n) => (
              <button key={n.key} onClick={() => setView(n.key)}
                className={`flex w-auto shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm lg:w-full ${
                  pubView === n.key
                    ? 'bg-emerald-600 font-medium text-white'
                    : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
                }`}>
                <NavIcon name={n.icon} className="h-4 w-4 opacity-80" />
                {t(n.label === 'Council Member overview' ? 'Overview' : n.label)}
                {n.experimental ? <span title={t('Experimental')} className="rounded bg-amber-100 px-1 text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">{t('exp')}</span> : null}
              </button>
            ))}
            {/* §29 — the configurable-group nav (e.g. OG) is shown to logged-out visitors too: the group
                pages + proposals are public (on-chain anchored), so visitors can discover them here, not
                only via a shared deep link. Mirrors the logged-in shell's groups block. */}
            {groups.length > 0 ? (
              <div className="mt-2 hidden border-t border-neutral-200 pt-2 lg:block dark:border-neutral-800" />
            ) : null}
            {groups.length > 0 ? (
              <div className="px-3 pt-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{t('GROUPS')}</div>
            ) : null}
            {groups.map((g) => (
              <div key={g.key} className="contents">
                {(['members', 'proposals'] as const).map((kind) => {
                  const key = `g:${g.key}:${kind}`;
                  return (
                    <button
                      key={key}
                      onClick={() => openGroupView(key)}
                      className={`flex w-auto shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm lg:w-full ${
                        rawView === key ? 'bg-emerald-600 font-medium text-white' : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
                      }`}
                    >
                      <NavIcon name={kind === 'members' ? 'circle-user' : 'clipboard'} className="h-4 w-4 opacity-80" />
                      {g.name} {kind === 'members' ? t('members') : t('proposals')}
                    </button>
                  );
                })}
              </div>
            ))}
            {scanNav(pubView === 'scantool')}
          </nav>
          <div className="mt-6 border-t border-neutral-200 pt-3 text-xs text-neutral-400 dark:border-neutral-800">
            <HealthBadge />
          </div>
        </aside>

        <main className="order-last min-w-0 flex-1 lg:order-none">
          {/* A shared group-proposal deep link (?view=g:<key>:proposals&gp=<id>) must open for anyone,
              logged in or not — group proposals/results are public (on-chain anchored), read-only here. */}
          {groupMatch ? (
            groupMatch[2] === 'members' ? <GroupMembers groupKey={groupMatch[1]} /> : <GroupProposals groupKey={groupMatch[1]} />
          ) : rawView === 'internal' ? (
            /* A shared internal-proposal link (?view=internal&ip=<id>) opens for anyone — public read-only. */
            <InternalProposals />
          ) : pubView === 'members' ? (
            <DaoMembersDirectory />
          ) : pubView === 'treasury' ? (
            <TreasuryOverview />
          ) : pubView === 'proofs' ? (
            <OnChainProofs />
          ) : pubView === 'rules' ? (
            <RuleDocuments />
          ) : pubView === 'decisions' ? (
            <Decisions />
          ) : pubView === 'proposalchecker' && SCORE_ENABLED ? (
            <ProposalChecker />
          ) : pubView === 'scantool' && SCORE_ENABLED ? (
            <PublicScanPage />
          ) : pubView === 'votingpower' ? (
            <DaoOverview />
          ) : pubView === 'requests' ? (
            <RequestsSection />
          ) : (
            <PublicLanding onConnect={() => setWalletOpen(true)} onExplore={() => setView('members')} onOpenScore={SCORE_ENABLED ? () => setView("proposalchecker") : undefined} onOpenVote={(id) => setParams({ view: 'internal', ip: id, tab: null, round: null, proposal: null, expert: null, doc: null, gp: null })} onOpenGroupVote={(key, id) => setParams({ view: `g:${key}:proposals`, gp: id, tab: null, round: null, proposal: null, expert: null, doc: null, ip: null })} />
          )}
        </main>

        {/* Right column: the public pay-to-scan tool teaser, below the sign-in cluster above. Visible
            to anyone (logged out); self-hides when the board keeps the tool off. Opens full-screen. */}
        {SCORE_ENABLED ? (
          <aside className="lg:w-72 lg:shrink-0">
            <PublicScanTool onOpen={() => setView('scantool')} />
          </aside>
        ) : null}
      </div>
    );
  }

  const nav = NAV.filter((n) => !n.publicOnly && !n.afterGroups && (!n.boardOnly || isBoard) && (!n.governanceOnly || SCORE_ENABLED));
  const canJoin =
    profile.onchainDrep.registered &&
    !isBoard &&
    !profile.roles.includes('DAO_MEMBER') &&
    profile.daoMembership?.status !== 'PENDING_ADMISSION';

  return (
    <div className="flex flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row">
      <DrepVerifyPrompt />
      {/* Left: title + menu only. On mobile the menu is a horizontal scroll strip so content
          isn't pushed below a tall vertical list; on lg it's the usual vertical sidebar. */}
      <aside className="lg:w-56 lg:shrink-0">
        {/* Brand → the public landing page (a way back to the front page once logged in). */}
        <button
          onClick={() => setView('landing')}
          title={t('Landing page')}
          className="mb-3 flex items-center gap-2 text-xl font-bold tracking-tight hover:opacity-80 lg:mb-4"
        >
          <img src={brand.icon} alt="" className="h-6 w-6" />
          {brand.name}
        </button>
        <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:gap-0 lg:space-y-1 lg:overflow-visible lg:px-0 lg:pb-0">
          {nav.map((n) => {
            // §20 — mirror the in-area to-do count next to "My area" so users
            // see how much is awaiting them without opening the menu.
            const badge = n.key === 'me' && myAreaTodo > 0 ? myAreaTodo : 0;
            return (
              <button
                key={n.key}
                onClick={() => setView(n.key)}
                className={`flex w-auto shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm lg:w-full lg:justify-between lg:gap-0 ${
                  !groupMatch && view === n.key
                    ? 'bg-emerald-600 font-medium text-white'
                    : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
                }`}
              >
                <span className="flex items-center gap-2">
                  <NavIcon name={n.icon} className="h-4 w-4 opacity-80" />
                  {t(n.label)}
                  {n.experimental ? <span title={t('Experimental')} className="rounded bg-amber-100 px-1 text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">{t('exp')}</span> : null}
                </span>
                {badge ? (
                  <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[11px] font-bold text-white tabular-nums">
                    {badge}
                  </span>
                ) : null}
              </button>
            );
          })}
          {groups.length > 0 ? (
            <div className="mt-2 hidden border-t border-neutral-200 pt-2 lg:block dark:border-neutral-800" />
          ) : null}
          {groups.length > 0 ? (
            <div className="px-3 pt-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{t('GROUPS')}</div>
          ) : null}
          {groups.map((g) => (
            <div key={g.key} className="contents">
              {(['members', 'proposals'] as const).map((kind) => {
                const key = `g:${g.key}:${kind}`;
                return (
                  <button
                    key={key}
                    onClick={() => openGroupView(key)}
                    className={`flex w-auto shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm lg:w-full ${
                      rawView === key ? 'bg-emerald-600 font-medium text-white' : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
                    }`}
                  >
                    <NavIcon name={kind === 'members' ? 'circle-user' : 'clipboard'} className="h-4 w-4 opacity-80" />
                    {g.name} {kind === 'members' ? t('members') : t('proposals')}
                  </button>
                );
              })}
            </div>
          ))}
          {scanNav(!groupMatch && view === 'scantool')}
        </nav>
        <div className="mt-6 border-t border-neutral-200 pt-3 text-xs text-neutral-400 dark:border-neutral-800">
          <HealthBadge />
        </div>
      </aside>

      {/* Center: content starts at the top. A ?proposal=<id> link shows that proposal on
          top of whatever view is selected, so proposal URLs are shareable from anywhere. */}
      <main key={`${rawView}-${viewNonce}`} className="order-last min-w-0 flex-1 lg:order-none">
        {groupMatch ? (
          groupMatch[2] === 'members' ? <GroupMembers groupKey={groupMatch[1]} /> : <GroupProposals groupKey={groupMatch[1]} />
        ) : view === 'landing' ? (
          <PublicLanding onConnect={() => setView('me')} onExplore={() => setView('members')} onOpenScore={SCORE_ENABLED ? () => setView("proposalchecker") : undefined} onOpenVote={(id) => setParams({ view: 'internal', ip: id, tab: null, round: null, proposal: null, expert: null, doc: null, gp: null })} onOpenGroupVote={(key, id) => setParams({ view: `g:${key}:proposals`, gp: id, tab: null, round: null, proposal: null, expert: null, doc: null, ip: null })} />
        ) : view === 'overview' ? (
          <DaoOverview />
        ) : view === 'submitters' ? (
          <SubmittersDirectory />
        ) : view === 'experts' ? (
          <ExpertsDirectory />
        ) : view === 'members' ? (
          <DaoMembersDirectory />
        ) : view === 'me' ? (
          <MemberArea />
        ) : view === 'requests' ? (
          <RequestsSection />
        ) : view === 'internal' ? (
          <InternalProposals />
        ) : view === 'rules' ? (
          <RuleDocuments />
        ) : view === 'decisions' ? (
          <Decisions />
        ) : view === 'proposalchecker' && SCORE_ENABLED ? (
          <ProposalChecker />
        ) : view === 'scantool' && SCORE_ENABLED ? (
          <PublicScanPage />
        ) : view === 'proofs' ? (
          <OnChainProofs />
        ) : view === 'treasury' ? (
          <TreasuryOverview />
        ) : view === 'setup' && isBoard ? (
          <div className="space-y-4">
            <OnchainSourcePanel />
            <GovernanceSetup />
          </div>
        ) : view === 'scoresetup' && isBoard && SCORE_ENABLED ? (
          <ProposalScoreSetup />
        ) : view === 'events' && isBoard ? (
          <ScheduleEvent />
        ) : null}
      </main>

      {/* Right: login box (+ JOIN COUNCIL). On desktop the language/theme controls sit above it and
          scroll with the page (the global fixed switcher is hidden on lg); on mobile the global
          switcher is used instead, so these are hidden there. */}
      <div className="space-y-2 lg:w-72 lg:shrink-0">
        <div className="hidden items-center justify-end gap-1.5 lg:flex">
          <LangThemeControls />
        </div>
        <div className="space-y-2 rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
          <ConnectWallet />
          {/* Jump straight to My area → the tab that has work (Actions, then Applications, then Voting). */}
          <div className="flex items-center gap-2">
            <NotificationBadge counts={todoCounts} onNavigate={(tab) => setParams({ view: 'me', tab, round: null, proposal: null, ip: null })} />
            {/* §20.3 — the jobs feed (payments seen, grace expiry, overdue stages, reminders). */}
            <NotificationBell />
            {/* §20 — re-check the to-do counts now (e.g. right after clearing an action). */}
            <button
              type="button"
              onClick={() => setTodoRefresh((n) => n + 1)}
              title={t('Refresh notifications / to-do counts')}
              aria-label={t('Refresh notifications')}
              className="rounded border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              ↻
            </button>
          </div>
          <button
            onClick={() => setView('me')}
            className="text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
          >
            {t('View profile')} →
          </button>
        </div>
        {/* Public pay-to-scan tool teaser, below the login box; self-hides when the board keeps it
            off. Opens the full-screen tool in the main window. */}
        {SCORE_ENABLED ? <PublicScanTool onOpen={() => setView('scantool')} /> : null}
        {/* §20 — persistent warning when the user is logged in but the wallet
            extension is no longer injected (disabled / different browser
            profile / restart). Polls every 5s so re-enabling clears it. */}
        <WalletStatusBanner />
        {canJoin ? <JoinDaoButton onJoin={() => setView('me')} /> : null}
      </div>
    </div>
  );
}
