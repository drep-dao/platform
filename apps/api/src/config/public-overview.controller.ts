import { Controller, Get, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RoundsService } from '../rounds/rounds.service';
import { TreasuryService } from '../treasury/treasury.service';
import { InternalProposalsService } from '../internal-proposals/internal-proposals.service';

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export type MeetingTime = { weekday: number; start: string; end: string; tz: string };

/**
 * Parse the MEETING_TIME config ("Tuesday 15:00-15:30 Europe/Prague") into structured parts the
 * landing page can build a live countdown from. Returns null if empty or malformed (→ no countdown).
 */
function parseMeetingTime(raw: string): MeetingTime | null {
  if (!raw) return null;
  const m = raw.match(/^([A-Za-z]+)\s+(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})\s+(\S+)$/);
  if (!m) return null;
  const weekday = WEEKDAY_NAMES.findIndex((n) => n.toLowerCase() === m[1].toLowerCase());
  if (weekday < 0) return null;
  try {
    // Reject an unknown IANA zone up front so the client never has to guess.
    new Intl.DateTimeFormat('en-US', { timeZone: m[4] });
  } catch {
    return null;
  }
  return { weekday, start: m[2], end: m[3], tz: m[4] };
}

/**
 * Public, unauthenticated snapshot for the logged-out landing page. Only aggregate,
 * non-sensitive numbers (all derivable from on-chain data or public directories) —
 * no per-member private fields. Cached briefly so an anonymous visitor can't drive
 * repeated treasury/chain lookups.
 */
@Controller('public')
export class PublicOverviewController {
  private readonly logger = new Logger(PublicOverviewController.name);
  private cache: { value: unknown; expiresAt: number } | null = null;
  private readonly TTL_MS = 30_000;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly rounds: RoundsService,
    private readonly treasury: TreasuryService,
    private readonly internal: InternalProposalsService,
  ) {}

  @Get('overview')
  async overview() {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.value;
    const value = await this.build();
    this.cache = { value, expiresAt: Date.now() + this.TTL_MS };
    return value;
  }

  private async build() {
    const network = this.config.get<string>('CARDANO_NETWORK') ?? 'Preprod';
    const [votingDReps, experts, propGroups, internalGroups, boardSeats, activeRound, admissionRow, requestGroups, telegramRow, meetingRow, meetingTimeRow] = await Promise.all([
      this.prisma.drep.count({ where: { status: 'ADMITTED' } }),
      this.prisma.expert.count({ where: { approvedByBoard: true } }),
      this.prisma.proposal.groupBy({ by: ['status'], where: { type: 'FUNDING' }, _count: { _all: true } }),
      this.prisma.proposal.groupBy({ by: ['status'], where: { type: 'INTERNAL' }, _count: { _all: true } }),
      this.prisma.boardSeat.count({ where: { removedAt: null } }),
      this.rounds.activeRound().catch(() => null),
      this.prisma.platformConfig.findUnique({ where: { key: 'DREP_OPEN_ADMISSION' } }),
      // §R — published requests from submitters to the DReps (drafts/pending stay private).
      this.prisma.request.groupBy({ by: ['status'], _count: { _all: true } }),
      // Optional community Telegram invite (empty/unset → not shown on the landing).
      this.prisma.platformConfig.findUnique({ where: { key: 'TELEGRAM_GROUP_URL' } }),
      // Optional recurring-meeting join link — Google Meet preferred (empty/unset → not shown).
      this.prisma.platformConfig.findUnique({ where: { key: 'MEETING_CALENDAR_URL' } }),
      // Optional recurring-meeting time ("Tuesday 15:00-15:30 Europe/Prague") → countdown + label.
      this.prisma.platformConfig.findUnique({ where: { key: 'MEETING_TIME' } }),
    ]);
    const telegramUrl = typeof telegramRow?.value === 'string' && telegramRow.value.trim() ? telegramRow.value.trim() : null;
    const meetingUrl = typeof meetingRow?.value === 'string' && meetingRow.value.trim() ? meetingRow.value.trim() : null;
    const meetingRaw = typeof meetingTimeRow?.value === 'string' ? meetingTimeRow.value.trim() : '';
    const meetingTime = parseMeetingTime(meetingRaw);
    const meetingSchedule = meetingTime
      ? `Every ${WEEKDAY_NAMES[meetingTime.weekday]} · ${meetingTime.start}–${meetingTime.end} (${meetingTime.tz})`
      : null;

    const count = (s: string) => propGroups.find((g) => g.status === s)?._count._all ?? 0;
    const approved = count('APPROVED') + count('COMPLETE');
    const inReview = count('PENDING') + count('ACTIVE');
    const rejected = count('REJECTED') + count('FAILED');

    // §governance — internal (governance) proposals, for the DRep-DAO edition's tiles.
    const iCount = (s: string) => internalGroups.find((g) => g.status === s)?._count._all ?? 0;
    const internalActive = iCount('ACTIVE') + iCount('PENDING');
    const internalPassed = iCount('APPROVED') + iCount('COMPLETE');
    const internalTotal = internalGroups.reduce((sum, g) => sum + g._count._all, 0);
    // §governance — the live votes themselves (end date + tally) for the landing dashboard.
    const activeVotes = await this.internal.activeVoteSummaries().catch(() => []);

    // Treasury balance is on-chain (public), but best-effort — a chain hiccup must not 500 the landing.
    let treasuryBalanceAda: number | null = null;
    try {
      treasuryBalanceAda = (await this.treasury.overview()).treasury.balanceAda;
    } catch (e) {
      this.logger.warn(`public overview treasury balance: ${e instanceof Error ? e.message : e}`);
    }

    const rqCount = (st: string) => requestGroups.find((g) => g.status === st)?._count._all ?? 0;
    const requestsActive = rqCount('ACTIVE');
    const requestsTotal = requestsActive + rqCount('DONE') + rqCount('REJECTED');

    // DREP_OPEN_ADMISSION defaults ON when unset (matches the admission logic).
    const admissionOpen = admissionRow ? admissionRow.value === true : true;

    const r = activeRound as
      | { number: number; name: string; status: string; budgetAda: number; rewardsPoolAda: number; eligibleCount: number; proposalCount: number }
      | null;

    return {
      network,
      admissionOpen,
      telegramUrl,
      meetingUrl,
      meetingSchedule,
      meetingTime,
      treasuryBalanceAda,
      members: { votingDReps, experts },
      board: { seats: boardSeats, elected: boardSeats > 0 },
      proposals: { approved, inReview, rejected, total: approved + inReview + rejected },
      internalProposals: { active: internalActive, passed: internalPassed, total: internalTotal },
      requests: { active: requestsActive, total: requestsTotal },
      activeVotes,
      activeRound: r
        ? {
            number: r.number,
            name: r.name,
            status: r.status,
            budgetAda: r.budgetAda,
            rewardsPoolAda: r.rewardsPoolAda,
            eligibleCount: r.eligibleCount,
            proposalCount: r.proposalCount,
          }
        : null,
    };
  }
}
