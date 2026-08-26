import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { isProvenDrepRequired } from './drep-link.service';

/**
 * Single source of truth for "is this user an active board member?" (§17/§25.5):
 * the user's CIP-95 DRep key hash holds a non-removed board seat. Used by BoardGuard
 * and by services that need a boolean instead of a thrown 403.
 */
@Injectable()
export class BoardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async isBoardMember(userId: string): Promise<boolean> {
    const user = await this.prisma.appUser.findUnique({
      where: { id: userId },
      select: { drepKeyHash: true, drepKeyProvenAt: true },
    });
    if (!user?.drepKeyHash) return false;
    // SEC-01 — when enabled, only a cryptographically proven DRep binding grants board authority.
    if (isProvenDrepRequired(this.config) && !user.drepKeyProvenAt) return false;
    const seat = await this.prisma.boardSeat.findFirst({ where: { removedAt: null, drepKeyHash: user.drepKeyHash } });
    return !!seat;
  }

  /** Is any board seat currently filled? (§14 — while none is, admission is "open".) */
  async isBoardSeated(): Promise<boolean> {
    const seat = await this.prisma.boardSeat.findFirst({ where: { removedAt: null }, select: { id: true } });
    return !!seat;
  }

  /**
   * Who may review Expert / Submitter applications: normally the board. But those roles ALWAYS
   * need a human approval (open admission only auto-admits DReps, never experts/submitters), so
   * while NO board is seated an admitted Council member (DRep) can review them — otherwise the
   * applications would queue with nobody able to act on them.
   */
  async canReviewApplications(userId: string): Promise<boolean> {
    if (await this.isBoardMember(userId)) return true;
    if (await this.isBoardSeated()) return false; // a board exists → it handles applications
    const drep = await this.prisma.drep.findUnique({ where: { userId }, select: { status: true } });
    return drep?.status === 'ADMITTED';
  }
}
