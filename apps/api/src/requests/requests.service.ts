import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CardanoQueryService } from '../cardano/cardano-query.service';
import { TreasuryBucketsService } from '../treasury/treasury-buckets.service';

const LOVELACE = 1_000_000n;

/**
 * §R — Submitter Requests (DRep DAO edition).
 *
 * Submitters ask the DReps for something (assess a proposal, advise, …) with just a
 * title + description. The board defines PAID request types (name + price in ADA) in
 * Platform setup; when none are active, every request is free.
 *
 *  - FREE request → straight to the queue (ACTIVE).
 *  - PAID request → PENDING_FEE until the fee tx to the treasury's Request-fees
 *    address is VERIFIED ON-CHAIN (same verifyPayment logic as the old submission
 *    fee). Only then do DReps see it in the queue.
 *  - Only BOARD members change the status afterwards: DONE / REJECTED / re-ACTIVATE.
 */
@Injectable()
export class RequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cardano: CardanoQueryService,
    private readonly buckets: TreasuryBucketsService,
  ) {}

  private async isBoard(userId: string): Promise<boolean> {
    const u = await this.prisma.appUser.findUnique({ where: { id: userId }, select: { drepKeyHash: true } });
    if (!u?.drepKeyHash) return false;
    return !!(await this.prisma.boardSeat.findFirst({ where: { removedAt: null, drepKeyHash: u.drepKeyHash } }));
  }

  private async assertApprovedSubmitter(userId: string) {
    const app = await this.prisma.submitterApplication.findUnique({ where: { userId }, select: { status: true } });
    if (app?.status !== 'APPROVED') {
      throw new ForbiddenException('only approved submitters can submit requests — apply for the submitter role first');
    }
  }

  /** The address paid request fees go to: the Request-fees bucket, else the treasury itself. */
  async feeAddress(): Promise<string | null> {
    const bucket = await this.buckets.defaultBucketFor('SUBMISSION_FEES').catch(() => null);
    if (bucket?.bech32Address) return bucket.bech32Address;
    const active = await this.prisma.multisigConfig.findFirst({ where: { replacedAt: null }, orderBy: { assembledAt: 'desc' } });
    return active?.bech32Address ?? null;
  }

  // ── request types (board-managed price list) ────────────────────────────────

  /** Public: the active paid types (name + price). Empty ⇒ every request is free. */
  async listTypes(includeInactive = false) {
    const rows = await this.prisma.requestType.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((t) => ({ id: t.id, name: t.name, priceAda: Number(t.priceAda) / Number(LOVELACE), active: t.active }));
  }

  async createType(userId: string, dto: { name: string; priceAda: number }) {
    if (!(await this.isBoard(userId))) throw new ForbiddenException('board members only');
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('a name is required');
    if (!(dto.priceAda > 0)) throw new BadRequestException('the price must be a positive amount of ADA');
    const t = await this.prisma.requestType.create({
      data: { name, priceAda: BigInt(Math.round(dto.priceAda)) * LOVELACE },
    });
    return { id: t.id };
  }

  async updateType(userId: string, id: string, dto: { name?: string; priceAda?: number; active?: boolean }) {
    if (!(await this.isBoard(userId))) throw new ForbiddenException('board members only');
    const t = await this.prisma.requestType.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('request type not found');
    if (dto.priceAda !== undefined && !(dto.priceAda > 0)) throw new BadRequestException('the price must be positive');
    await this.prisma.requestType.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.priceAda !== undefined ? { priceAda: BigInt(Math.round(dto.priceAda)) * LOVELACE } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });
    return { ok: true };
  }

  /** Types with requests are deactivated (history keeps the price); unused ones are deleted. */
  async deleteType(userId: string, id: string) {
    if (!(await this.isBoard(userId))) throw new ForbiddenException('board members only');
    const used = await this.prisma.request.count({ where: { typeId: id } });
    if (used > 0) {
      await this.prisma.requestType.update({ where: { id }, data: { active: false } });
      return { ok: true, deactivated: true };
    }
    await this.prisma.requestType.delete({ where: { id } });
    return { ok: true, deleted: true };
  }

  // ── submitting ──────────────────────────────────────────────────────────────

  async submit(userId: string, dto: { title: string; description: string; typeId?: string | null; feeTxHash?: string | null; expectedResponseAt?: string | null }) {
    await this.assertApprovedSubmitter(userId);
    const title = dto.title?.trim() ?? '';
    const description = dto.description?.trim() ?? '';
    if (title.length < 4) throw new BadRequestException('the title must be at least 4 characters');
    if (!description) throw new BadRequestException('a description is required');
    let expectedResponseAt: Date | null = null;
    if (dto.expectedResponseAt) {
      const d = new Date(dto.expectedResponseAt);
      if (Number.isNaN(d.getTime())) throw new BadRequestException('invalid expected-response time');
      if (d.getTime() <= Date.now()) throw new BadRequestException('the expected-response time must be in the future');
      expectedResponseAt = d;
    }

    let type = null;
    if (dto.typeId) {
      type = await this.prisma.requestType.findUnique({ where: { id: dto.typeId } });
      if (!type || !type.active) throw new BadRequestException('unknown or inactive request type');
    }

    const paid = !!type && type.priceAda > 0n;
    const req = await this.prisma.request.create({
      data: {
        submitterUserId: userId,
        typeId: type?.id ?? null,
        title,
        description,
        expectedResponseAt,
        // Paid requests wait for the on-chain fee before DReps see them.
        status: paid ? 'PENDING_FEE' : 'ACTIVE',
        feeTxHash: dto.feeTxHash?.trim() || null,
      },
    });
    // If the fee tx was pasted at submit time, try to verify it right away.
    if (paid && req.feeTxHash) await this.tryVerifyFee(req.id).catch(() => undefined);
    return this.get(req.id, userId);
  }

  /** The submitter pastes (or corrects) the fee tx hash; verification runs immediately. */
  async submitFeeTx(userId: string, id: string, txHash: string) {
    const req = await this.prisma.request.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('request not found');
    if (req.submitterUserId !== userId) throw new ForbiddenException('not your request');
    if (req.status !== 'PENDING_FEE') throw new ConflictException('this request is not waiting for a fee');
    const hash = txHash.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new BadRequestException('a Cardano tx hash is 64 hex characters');
    await this.prisma.request.update({ where: { id }, data: { feeTxHash: hash } });
    await this.tryVerifyFee(id).catch(() => undefined);
    return this.get(id, userId);
  }

  /** §R — on-chain fee validation (same pattern as the old submission fee): the tx must pay at
   *  least the type's price to the Request-fees address. On success the request goes ACTIVE. */
  async tryVerifyFee(id: string): Promise<boolean> {
    const req = await this.prisma.request.findUnique({ where: { id }, include: { type: true } });
    if (!req || req.status !== 'PENDING_FEE' || !req.feeTxHash || !req.type) return false;
    const addr = await this.feeAddress();
    if (!addr) return false;
    const v = await this.cardano.verifyPayment(req.feeTxHash, addr, req.type.priceAda);
    if (v.found && v.paid) {
      await this.prisma.request.update({
        where: { id },
        data: { status: 'ACTIVE', feeSeenOnchainAt: new Date() },
      });
      return true;
    }
    return false;
  }

  /** Board / poll helper: re-check a pending fee on demand. */
  async recheckFee(userId: string, id: string) {
    const board = await this.isBoard(userId);
    const req = await this.prisma.request.findUnique({ where: { id }, select: { submitterUserId: true } });
    if (!req) throw new NotFoundException('request not found');
    if (!board && req.submitterUserId !== userId) throw new ForbiddenException('not your request');
    const okNow = await this.tryVerifyFee(id);
    return { verified: okNow };
  }

  // ── queue + history ─────────────────────────────────────────────────────────

  /**
   * The requests visible to the viewer. PENDING_FEE requests are private to their
   * submitter (+ the board) — DReps only see them once the fee is verified.
   */
  async list(userId: string | null, statusFilter?: string) {
    const board = userId ? await this.isBoard(userId) : false;
    const where: Record<string, unknown> = {};
    if (statusFilter) where.status = statusFilter;
    const rows = await this.prisma.request.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        type: true,
        submitter: { select: { id: true, displayName: true } },
      },
    });
    return rows
      .filter((r) => r.status !== 'PENDING_FEE' || board || r.submitterUserId === userId)
      .map((r) => this.view(r, board || r.submitterUserId === userId));
  }

  async get(id: string, userId: string | null) {
    const r = await this.prisma.request.findUnique({
      where: { id },
      include: { type: true, submitter: { select: { id: true, displayName: true } } },
    });
    if (!r) throw new NotFoundException('request not found');
    const board = userId ? await this.isBoard(userId) : false;
    if (r.status === 'PENDING_FEE' && !board && r.submitterUserId !== userId) {
      throw new ForbiddenException('this request is awaiting its fee');
    }
    return this.view(r, board || r.submitterUserId === userId);
  }

  private view(
    r: {
      id: string; title: string; description: string; expectedResponseAt: Date | null; status: string; createdAt: Date; decidedAt: Date | null;
      feeTxHash: string | null; feeSeenOnchainAt: Date | null; submitterUserId: string;
      type: { id: string; name: string; priceAda: bigint } | null;
      submitter: { id: string; displayName: string | null };
    },
    full: boolean,
  ) {
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      expectedResponseAt: r.expectedResponseAt ? r.expectedResponseAt.toISOString() : null,
      status: r.status,
      createdAt: r.createdAt,
      decidedAt: r.decidedAt,
      submitter: r.submitter.displayName ?? 'Submitter',
      submitterUserId: r.submitterUserId,
      type: r.type ? { id: r.type.id, name: r.type.name, priceAda: Number(r.type.priceAda) / Number(LOVELACE) } : null,
      free: !r.type,
      feeTxHash: full ? r.feeTxHash : r.feeTxHash ? `${r.feeTxHash.slice(0, 12)}…` : null,
      feeVerified: !!r.feeSeenOnchainAt,
    };
  }

  /** §R — only board members change a request's status (Done / Rejected / re-Activate). */
  async setStatus(userId: string, id: string, status: string) {
    if (!(await this.isBoard(userId))) throw new ForbiddenException('board members only');
    if (!['ACTIVE', 'DONE', 'REJECTED'].includes(status)) {
      throw new BadRequestException('status must be ACTIVE, DONE or REJECTED');
    }
    const r = await this.prisma.request.findUnique({ where: { id }, select: { status: true } });
    if (!r) throw new NotFoundException('request not found');
    if (r.status === 'PENDING_FEE') {
      throw new ConflictException('the fee has not been verified yet — the request is not in the queue');
    }
    await this.prisma.request.update({
      where: { id },
      data: { status, decidedAt: status === 'ACTIVE' ? null : new Date(), decidedByUserId: status === 'ACTIVE' ? null : userId },
    });
    return this.get(id, userId);
  }
}
