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

    const req = await this.prisma.request.create({
      data: {
        submitterUserId: userId,
        typeId: type?.id ?? null,
        title,
        description,
        expectedResponseAt,
        status: 'DRAFT', // §R — starts as an editable draft; the author publishes it when ready
        feeTxHash: dto.feeTxHash?.trim() || null,
      },
    });
    return this.get(req.id, userId);
  }

  /** §R — edit a draft (owner only; locked once published). */
  async update(userId: string, id: string, dto: { title?: string; description?: string; typeId?: string | null; expectedResponseAt?: string | null }) {
    const r = await this.prisma.request.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('request not found');
    if (r.submitterUserId !== userId) throw new ForbiddenException('not your request');
    if (r.status !== 'DRAFT') throw new BadRequestException('a published request can no longer be edited');
    const data: Record<string, unknown> = {};
    if (dto.title !== undefined) {
      const title = dto.title.trim();
      if (title.length < 4) throw new BadRequestException('the title must be at least 4 characters');
      data.title = title;
    }
    if (dto.description !== undefined) {
      const description = dto.description.trim();
      if (!description) throw new BadRequestException('a description is required');
      data.description = description;
    }
    if (dto.typeId !== undefined) {
      if (dto.typeId) {
        const type = await this.prisma.requestType.findUnique({ where: { id: dto.typeId } });
        if (!type || !type.active) throw new BadRequestException('unknown or inactive request type');
      }
      data.typeId = dto.typeId || null;
    }
    if (dto.expectedResponseAt !== undefined) {
      if (dto.expectedResponseAt) {
        const d = new Date(dto.expectedResponseAt);
        if (Number.isNaN(d.getTime())) throw new BadRequestException('invalid expected-response time');
        if (d.getTime() <= Date.now()) throw new BadRequestException('the expected-response time must be in the future');
        data.expectedResponseAt = d;
      } else data.expectedResponseAt = null;
    }
    await this.prisma.request.update({ where: { id }, data });
    return this.get(id, userId);
  }

  /** §R — publish a draft: it becomes visible to the DReps and can no longer be edited. Paid types
   *  go to PENDING_FEE (queued only once the fee verifies on-chain); free ones go straight to ACTIVE. */
  async publish(userId: string, id: string, feeTxHash?: string | null) {
    const r = await this.prisma.request.findUnique({ where: { id }, include: { type: true } });
    if (!r) throw new NotFoundException('request not found');
    if (r.submitterUserId !== userId) throw new ForbiddenException('not your request');
    if (r.status !== 'DRAFT') throw new BadRequestException('only a draft can be published');
    const paid = !!r.type && r.type.priceAda > 0n;
    await this.prisma.request.update({
      where: { id },
      data: { status: paid ? 'PENDING_FEE' : 'ACTIVE', publishedAt: new Date(), feeTxHash: feeTxHash?.trim() || r.feeTxHash },
    });
    if (paid) await this.tryVerifyFee(id).catch(() => undefined);
    return this.get(id, userId);
  }

  /** §R — the author (or board) removes a request. Soft delete: it stays findable in history,
   *  marked DELETED, no longer active. */
  async remove(userId: string, id: string) {
    const r = await this.prisma.request.findUnique({ where: { id }, select: { status: true, submitterUserId: true } });
    if (!r) throw new NotFoundException('request not found');
    if (r.submitterUserId !== userId && !(await this.isBoard(userId))) {
      throw new ForbiddenException('only the author or a board member can delete a request');
    }
    if (r.status !== 'DELETED') {
      await this.prisma.request.update({ where: { id }, data: { status: 'DELETED', decidedAt: new Date(), decidedByUserId: userId } });
    }
    return this.get(id, userId);
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
      .filter((r) => {
        if (r.status === 'DRAFT') return r.submitterUserId === userId; // drafts are private to the author
        if (r.status === 'PENDING_FEE') return board || r.submitterUserId === userId;
        return true; // ACTIVE / DONE / REJECTED / DELETED (deleted stays findable in history)
      })
      .map((r) => this.view(r, board || r.submitterUserId === userId, userId));
  }

  async get(id: string, userId: string | null) {
    const r = await this.prisma.request.findUnique({
      where: { id },
      include: { type: true, submitter: { select: { id: true, displayName: true } } },
    });
    if (!r) throw new NotFoundException('request not found');
    const board = userId ? await this.isBoard(userId) : false;
    const isOwner = !!userId && r.submitterUserId === userId;
    if (r.status === 'DRAFT' && !isOwner) throw new ForbiddenException('this request is a private draft');
    if (r.status === 'PENDING_FEE' && !board && !isOwner) {
      throw new ForbiddenException('this request is awaiting its fee');
    }
    const canComment = await this.canDiscuss(userId, r);
    return { ...this.view(r, board || isOwner, userId), canComment, canModerate: board, comments: await this.loadComments(id, userId) };
  }

  private view(
    r: {
      id: string; title: string; description: string; expectedResponseAt: Date | null; status: string; createdAt: Date; decidedAt: Date | null;
      publishedAt: Date | null; feeTxHash: string | null; feeSeenOnchainAt: Date | null; submitterUserId: string;
      type: { id: string; name: string; priceAda: bigint } | null;
      submitter: { id: string; displayName: string | null };
    },
    full: boolean,
    viewerId?: string | null,
  ) {
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      expectedResponseAt: r.expectedResponseAt ? r.expectedResponseAt.toISOString() : null,
      status: r.status,
      publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
      isOwner: !!viewerId && r.submitterUserId === viewerId,
      editable: !!viewerId && r.submitterUserId === viewerId && r.status === 'DRAFT',
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

  // ── comments (DReps discuss a published request) ─────────────────────────────
  private async admittedDrep(userId: string): Promise<boolean> {
    const drep = await this.prisma.drep.findUnique({ where: { userId }, select: { status: true } });
    return drep?.status === 'ADMITTED';
  }

  private async approvedExpert(userId: string): Promise<boolean> {
    const e = await this.prisma.expert.findFirst({ where: { userId, approvedByBoard: true, leftAt: null }, select: { id: true } });
    return !!e;
  }

  /** Who may discuss a published request: the author (submitter), Council members, or experts. */
  private async canDiscuss(userId: string | null | undefined, r: { status: string; submitterUserId: string }): Promise<boolean> {
    if (!userId) return false;
    if (['DRAFT', 'DELETED', 'PENDING_FEE'].includes(r.status)) return false;
    if (r.submitterUserId === userId) return true;
    return (await this.admittedDrep(userId)) || (await this.approvedExpert(userId));
  }

  async addComment(userId: string, id: string, dto: { contentMd: string; parentId?: string }) {
    const r = await this.prisma.request.findUnique({ where: { id }, select: { status: true, submitterUserId: true } });
    if (!r) throw new NotFoundException('request not found');
    if (['DRAFT', 'DELETED', 'PENDING_FEE'].includes(r.status)) throw new BadRequestException('this request is not open for comments');
    if (!(await this.canDiscuss(userId, r))) throw new ForbiddenException('only Council members, registered experts, or the request author can comment');
    const text = (dto.contentMd ?? '').trim();
    if (!text) throw new BadRequestException('a comment is required');
    let parentId: string | null = null;
    if (dto.parentId) {
      const parent = await this.prisma.requestComment.findUnique({ where: { id: dto.parentId }, select: { requestId: true, parentId: true } });
      if (!parent || parent.requestId !== id) throw new BadRequestException('invalid parent comment');
      // One level only: a reply to a reply attaches to its top-level comment.
      parentId = parent.parentId ?? dto.parentId;
    }
    await this.prisma.requestComment.create({ data: { requestId: id, authorUserId: userId, contentMd: text, parentId } });
    return this.get(id, userId);
  }

  async deleteComment(userId: string, commentId: string) {
    const c = await this.prisma.requestComment.findUnique({ where: { id: commentId } });
    if (!c) throw new NotFoundException('comment not found');
    const canDelete = c.authorUserId === userId || (await this.isBoard(userId));
    if (!canDelete) throw new ForbiddenException('only the comment author or a board member can delete a comment');
    if (!c.deletedAt) await this.prisma.requestComment.update({ where: { id: commentId }, data: { deletedAt: new Date() } });
    return { ok: true };
  }

  private async loadComments(requestId: string, userId?: string | null) {
    const [rows, boardSeats, admitted, experts] = await Promise.all([
      this.prisma.requestComment.findMany({ where: { requestId }, orderBy: { createdAt: 'asc' }, include: { author: { select: { displayName: true, drepKeyHash: true } } } }),
      this.prisma.boardSeat.findMany({ where: { removedAt: null }, select: { drepKeyHash: true } }),
      this.prisma.drep.findMany({ where: { status: 'ADMITTED' }, select: { userId: true } }),
      this.prisma.expert.findMany({ where: { approvedByBoard: true, leftAt: null }, select: { userId: true } }),
    ]);
    const boardHashes = new Set(boardSeats.map((b) => b.drepKeyHash));
    const admittedIds = new Set(admitted.map((d) => d.userId));
    const expertIds = new Set(experts.map((e) => e.userId));
    type Row = (typeof rows)[number];
    const shape = (c: Row) => ({
      id: c.id,
      authorName: c.author.displayName ?? 'DRep',
      authorRole: c.author.drepKeyHash && boardHashes.has(c.author.drepKeyHash) ? 'Board member' : admittedIds.has(c.authorUserId) ? 'Council member' : expertIds.has(c.authorUserId) ? 'Expert' : null,
      isMine: c.authorUserId === userId,
      contentMd: c.deletedAt ? null : c.contentMd,
      deleted: !!c.deletedAt,
      createdAt: c.createdAt.toISOString(),
    });
    // §R — top-level comments each with one level of replies; a deleted top-level is kept as a
    // tombstone only while it still has replies underneath (so the thread stays coherent).
    return rows
      .filter((c) => !c.parentId)
      .map((t) => ({ ...shape(t), replies: rows.filter((c) => c.parentId === t.id).map(shape) }))
      .filter((t) => !t.deleted || t.replies.length > 0);
  }
}
