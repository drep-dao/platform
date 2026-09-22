import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { GovSubject } from '@drep-dao/cardano';
import { PrismaService } from '../prisma/prisma.service';
import { CardanoQueryService } from '../cardano/cardano-query.service';
import { AnchorService } from '../cardano/anchor.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RequestsService } from '../requests/requests.service';
import { GroupsService } from '../groups/groups.service';

const FAST_MS = 30_000; // request-fee poller
const MID_MS = 5 * 60_000; // multisig-key reminders + anchor sweep
const DAILY_MS = 10 * 60_000; // daily jobs gate themselves by date, ticked every 10 min

/**
 * §27 — background jobs, DRep DAO (governance) edition. The funding-round jobs
 * (submission-fee / pledge pollers, quick-poll resolution, stage-overdue checks,
 * milestone reminders) left with the funding modules; what remains:
 *   - request-fee poller: PENDING_FEE requests with a pasted tx are auto-verified
 *     on-chain every 30 s, so a paid request enters the DRep queue without anyone
 *     clicking "re-check";
 *   - multisig-key reminders (§15.2) — board seats still awaiting a signing key;
 *   - anchor sweep (§24) — recorded-but-unsubmitted anchors are submitted;
 *   - daily digests (§24.1) — vote-tally + merit-ledger digests anchored.
 */
@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private readonly timers: NodeJS.Timeout[] = [];
  private anchorSweepRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cardano: CardanoQueryService,
    private readonly anchor: AnchorService,
    private readonly notify: NotificationsService,
    private readonly requests: RequestsService,
    private readonly groups: GroupsService,
  ) {}

  onModuleInit() {
    if (process.env.JOBS_DISABLED === '1') return;
    const mk = (fn: () => Promise<void>, ms: number, name: string) => {
      const t = setInterval(() => fn().catch((e) => this.logger.warn(`${name} tick failed: ${e instanceof Error ? e.message : e}`)), ms);
      t.unref?.();
      this.timers.push(t);
    };
    mk(() => this.requestFeePoller(), FAST_MS, 'request-fee-poller');
    mk(() => this.midTick(), MID_MS, 'mid');
    mk(() => this.dailyTick(), DAILY_MS, 'daily');
  }

  onModuleDestroy() {
    for (const t of this.timers) clearInterval(t);
  }

  // ── §R request-fee poller (30 s) ──────────────────────────────────────────────
  /** Auto-verify pending request fees: once the tx pays the type's price to the
   *  Request-fees address, the request goes ACTIVE and DReps see it in the queue. */
  async requestFeePoller() {
    const pending = await this.prisma.request.findMany({
      where: { status: 'PENDING_FEE', feeTxHash: { not: null } },
      select: { id: true, title: true, submitterUserId: true },
      take: 20,
    });
    for (const r of pending) {
      const verified = await this.requests.tryVerifyFee(r.id).catch(() => false);
      if (verified) {
        await this.notify.notifyBoard('REQUEST_FEE_SEEN', r.id, {
          title: `Request fee verified on-chain — "${r.title}" is now in the queue`,
        });
        await this.notify.notifyUsers([r.submitterUserId], 'REQUEST_FEE_SEEN', r.id, {
          title: `Your request "${r.title}" is paid and now visible to the DReps.`,
        });
      }
    }
  }

  // ── 5-minute tick ─────────────────────────────────────────────────────────────
  async midTick() {
    await this.remindMultisigKeys().catch((e) => this.logger.warn(`multisig-key reminder: ${e instanceof Error ? e.message : e}`));
    // §29 — finalize + anchor group (OG) proposals whose voting has ended, even if nobody opened them.
    await this.groups.finalizeDueProposals().catch((e) => this.logger.warn(`group finalize: ${e instanceof Error ? e.message : e}`));
    await this.anchorSweepIfDue().catch((e) => this.logger.warn(`anchor sweep: ${e instanceof Error ? e.message : e}`));
  }

  /**
   * §15.2 — notify each board member whose active seat is still awaiting their multisig signing
   * key (initial setup OR after a board rotation). A member "owes" a key when their seat has no
   * own key AND they have no prior key that carries over. Deduped per seat (refId = seat id).
   */
  private async remindMultisigKeys() {
    const seats = await this.prisma.boardSeat.findMany({ where: { removedAt: null }, include: { multisigKey: true } });
    if (seats.length === 0) return;
    const keyedUsers = new Set(
      (await this.prisma.boardMultisigKey.findMany({ select: { userId: true } })).map((k) => k.userId),
    );
    for (const s of seats) {
      if (s.multisigKey) continue;
      const member = await this.prisma.appUser.findFirst({ where: { drepKeyHash: s.drepKeyHash }, select: { id: true } });
      if (!member || keyedUsers.has(member.id)) continue;
      await this.notify.notifyUsers([member.id], 'MULTISIG_KEY_NEEDED', s.id, {
        title: 'Action needed: submit your treasury multisig signing key — open Treasury → Multisig setup so the new multisig can be assembled.',
        body: 'You are on the board but haven\'t submitted your hardware signing key yet. The platform can\'t assemble the treasury multisig until every seat has a key.',
      });
    }
  }

  /**
   * §24 — auto-submit anchors that were recorded but never made it on-chain (txHash null),
   * chaining each tx's change into the next so racing decisions all get anchored.
   */
  /** §24 — run the on-chain anchor sweep only when the admin-configured interval (default 24h) has
   *  elapsed since the last run. Admin can still force it immediately via the wallet panel. */
  private async anchorSweepIfDue() {
    const hours = await this.anchor.getSweepHours();
    const key = 'JOB_LAST_RUN:anchor_sweep';
    const row = await this.prisma.platformConfig.findUnique({ where: { key } });
    const last = row ? Number(row.value) : 0;
    if (Number.isFinite(last) && last > 0 && Date.now() - last < hours * 3_600_000) return;
    await this.retryPendingAnchors();
    const now = String(Date.now());
    await this.prisma.platformConfig.upsert({ where: { key }, update: { value: now }, create: { key, value: now } });
  }

  async retryPendingAnchors() {
    if (this.anchorSweepRunning) return;
    if (!this.anchor.walletConfigured()) return;
    const pending = await this.prisma.anchor.count({ where: { txHash: null } });
    if (pending === 0) return;
    this.anchorSweepRunning = true;
    try {
      const r = await this.anchor.submitAllPending();
      if (r.submitted || r.failed) {
        this.logger.log(`auto-anchor sweep: submitted ${r.submitted}/${r.total}${r.failed ? `, ${r.failed} still pending` : ''}`);
      }
    } finally {
      this.anchorSweepRunning = false;
    }
  }

  // ── daily jobs (gated by date via platform_config JOB_LAST_RUN keys) ──────────
  private async ranToday(name: string): Promise<boolean> {
    const key = `JOB_LAST_RUN:${name}`;
    const today = new Date().toISOString().slice(0, 10);
    const row = await this.prisma.platformConfig.findUnique({ where: { key } });
    if (row?.value === today) return true;
    await this.prisma.platformConfig.upsert({ where: { key }, update: { value: today }, create: { key, value: today } });
    return false;
  }

  async dailyTick() {
    if (!(await this.ranToday('daily'))) {
      await this.dailyAnchors().catch((e) => this.logger.warn(`daily anchors: ${e instanceof Error ? e.message : e}`));
    }
  }

  /** §24.1 — daily digests: yesterday's votes + merit deltas, hashed + anchored. */
  async dailyAnchors() {
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    const prevStart = new Date(dayStart.getTime() - 86_400_000);
    const day = prevStart.toISOString().slice(0, 10);
    const votes = await this.prisma.vote.findMany({
      where: { castAt: { gte: prevStart, lt: dayStart } },
      select: { proposalId: true, drepId: true, choice: true, castAt: true },
    });
    if (votes.length) {
      await this.anchor.anchorDigest({ kind: GovSubject.DAILY_VOTES, day, rows: votes.map((v) => ({ ...v, castAt: v.castAt.toISOString() })) });
    }
    const merit = await this.prisma.meritLedger.findMany({
      where: { occurredAt: { gte: prevStart, lt: dayStart } },
      select: { drepId: true, delta: true, reasonCode: true, occurredAt: true },
    });
    if (merit.length) {
      await this.anchor.anchorDigest({ kind: GovSubject.DAILY_MERIT, day, rows: merit.map((m) => ({ drepId: m.drepId, delta: Number(m.delta), reasonCode: m.reasonCode, occurredAt: m.occurredAt.toISOString() })) });
    }
  }
}
