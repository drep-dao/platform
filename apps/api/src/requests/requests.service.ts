import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@drep-dao/db';
import { PrismaService } from '../prisma/prisma.service';
import { CardanoQueryService } from '../cardano/cardano-query.service';
import { TreasuryBucketsService } from '../treasury/treasury-buckets.service';
import { NotificationsService } from '../notifications/notifications.service';

const LOVELACE = 1_000_000n;

// §R — unified queue labels. DB values stay ACTIVE/DONE for history; these are what people see.
const REQUEST_STATUS_LABEL: Record<string, string> = { ACTIVE: 'New', ACCEPTED: 'Accepted', DONE: 'Complete', REJECTED: 'Rejected' };

// §R2 — request form configuration. The board shapes each kind's form in the Request formatter; the
// shape is stored as one PlatformConfig row keyed per kind. A kind never configured falls back to a
// single markdown "Description" element (the original Title + Description form).
const REQUEST_KINDS = ['NOTIFICATION', 'CALL', 'PROPOSAL_REVIEW', 'ANSWER'] as const;
type RequestKind = (typeof REQUEST_KINDS)[number];
const FORM_CONFIG_KEY = 'REQUEST_FORM_CONFIG';
type FormElementType = 'text' | 'markdown' | 'select' | 'links' | 'date';
type FormElement = { id: string; label: string; type: FormElementType; size?: 'small' | 'large'; options?: string[]; required?: boolean };
const DEFAULT_ELEMENTS: FormElement[] = [{ id: 'description', label: 'Description', type: 'markdown', size: 'large' }];
// A submitted links element value.
type LinkValue = { url: string; title?: string };
// The per-request snapshot entry stored in Request.fields.
type FieldSnapshot = { key: string; label: string; type: FormElementType; value: string | LinkValue[] };

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
    private readonly notifications: NotificationsService,
  ) {}

  /** §R/§20.3 — tell the board a request has entered their queue (fired once, on the ACTIVE transition). */
  private async notifyBoardOfNewRequest(id: string, title: string) {
    await this.notifications
      .notifyBoard('request_new', id, { title: 'New request', body: title, requestId: id })
      .catch(() => undefined);
  }

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

  // ── form configuration (board shapes each kind's form) ──────────────────────

  /** §R2 — the element list for every kind. A kind never configured falls back to the default form.
   *  An explicitly-saved empty list (only Title) is respected. */
  async getFormConfig(): Promise<Record<string, FormElement[]>> {
    const row = await this.prisma.platformConfig.findUnique({ where: { key: FORM_CONFIG_KEY } });
    const stored = (row?.value as Record<string, FormElement[]> | null) ?? {};
    const out: Record<string, FormElement[]> = {};
    // Never-configured kinds start with only the Title; NOTIFICATION keeps a Description element so the
    // original flow is unchanged. An explicitly-saved list (even empty) is always respected.
    for (const k of REQUEST_KINDS) out[k] = Array.isArray(stored[k]) ? stored[k] : (k === 'NOTIFICATION' ? DEFAULT_ELEMENTS : []);
    return out;
  }

  /** §R2 — board replaces the element list for one kind. */
  async saveFormConfig(userId: string, kind: string, elements: unknown[]) {
    if (!(await this.isBoard(userId))) throw new ForbiddenException('board members only');
    if (!REQUEST_KINDS.includes(kind as RequestKind)) throw new BadRequestException('unknown request kind');
    const clean = this.sanitizeElements(elements);
    const row = await this.prisma.platformConfig.findUnique({ where: { key: FORM_CONFIG_KEY } });
    const current = (row?.value as Record<string, FormElement[]> | null) ?? {};
    current[kind] = clean;
    await this.prisma.platformConfig.upsert({
      where: { key: FORM_CONFIG_KEY },
      update: { value: current as unknown as Prisma.InputJsonValue, updatedBy: userId },
      create: { key: FORM_CONFIG_KEY, value: current as unknown as Prisma.InputJsonValue, updatedBy: userId },
    });
    return this.getFormConfig();
  }

  /** §R2 — normalise a board-submitted element list: unique ids, valid types, trimmed labels. */
  private sanitizeElements(elements: unknown[]): FormElement[] {
    const seen = new Set<string>();
    const out: FormElement[] = [];
    for (const raw of (Array.isArray(elements) ? elements : []).slice(0, 30)) {
      const e = (raw ?? {}) as Partial<FormElement>;
      const type: FormElementType = (['text', 'markdown', 'select', 'links', 'date'] as const).includes(e.type as FormElementType) ? (e.type as FormElementType) : 'text';
      let id = String(e.id ?? '').trim().slice(0, 64);
      if (!id || seen.has(id)) id = `el_${Math.random().toString(36).slice(2, 9)}`;
      const label = String(e.label ?? '').trim().slice(0, 120) || 'Field';
      const el: FormElement = { id, label, type };
      if ((type === 'text' || type === 'markdown') && (e.size === 'small' || e.size === 'large')) el.size = e.size;
      if (type === 'select') el.options = (Array.isArray(e.options) ? e.options : []).map((o) => String(o).trim().slice(0, 120)).filter(Boolean).slice(0, 50);
      if (e.required) el.required = true;
      seen.add(id);
      out.push(el);
    }
    return out;
  }

  /** §R2 — validate the submitted values against the kind's current form and build the stored snapshot.
   *  Derives the markdown `description` (first markdown element) for notifications/history. */
  private async buildFields(kind: string, submitted: unknown): Promise<{ fields: FieldSnapshot[]; description: string }> {
    const cfg = await this.getFormConfig();
    const elements = cfg[kind] ?? DEFAULT_ELEMENTS;
    const byId = new Map<string, unknown>();
    for (const f of Array.isArray(submitted) ? submitted : []) {
      if (f && typeof f === 'object' && 'key' in (f as object)) byId.set(String((f as { key: unknown }).key), (f as { value: unknown }).value);
    }
    const fields: FieldSnapshot[] = [];
    let description = '';
    for (const el of elements) {
      // §R2 — a date element maps to the request's expectedResponseAt column (handled by the caller),
      // not to the fields snapshot.
      if (el.type === 'date') continue;
      if (el.type === 'links') {
        const links: LinkValue[] = (Array.isArray(byId.get(el.id)) ? (byId.get(el.id) as unknown[]) : [])
          .map((l) => ({ url: String((l as LinkValue)?.url ?? '').trim(), title: String((l as LinkValue)?.title ?? '').trim() }))
          .filter((l) => /^https?:\/\//i.test(l.url))
          .slice(0, 30)
          .map((l) => ({ url: l.url.slice(0, 2000), ...(l.title ? { title: l.title.slice(0, 300) } : {}) }));
        if (el.required && links.length === 0) throw new BadRequestException(`${el.label} is required`);
        fields.push({ key: el.id, label: el.label, type: el.type, value: links });
      } else {
        let val = String(byId.get(el.id) ?? '').trim().slice(0, 20000);
        if (el.type === 'select' && val && el.options && !el.options.includes(val)) val = ''; // ignore an option not on the list
        if (el.required && !val) throw new BadRequestException(`${el.label} is required`);
        fields.push({ key: el.id, label: el.label, type: el.type, value: val });
        if (el.type === 'markdown' && !description) description = val;
      }
    }
    return { fields, description };
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

  async submit(userId: string, dto: { title: string; description?: string; kind?: string; fields?: unknown[]; typeId?: string | null; feeTxHash?: string | null; expectedResponseAt?: string | null }) {
    await this.assertApprovedSubmitter(userId);
    const title = dto.title?.trim() ?? '';
    if (title.length < 4) throw new BadRequestException('the title must be at least 4 characters');
    const kind = REQUEST_KINDS.includes(dto.kind as RequestKind) ? (dto.kind as RequestKind) : 'NOTIFICATION';
    // buildFields enforces each element's `required` flag; a Title-only form (no elements) is valid.
    const { fields, description: derived } = await this.buildFields(kind, dto.fields ?? []);
    // §R2 — description mirrors the first markdown element; fall back to a plain `description` for the
    // legacy form / API callers that don't send structured fields.
    const description = derived || (dto.description?.trim() ?? '');
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
        kind,
        fields: fields.length ? (fields as unknown as Prisma.InputJsonValue) : undefined,
        expectedResponseAt,
        status: 'DRAFT', // §R — starts as an editable draft; the author publishes it when ready
        feeTxHash: dto.feeTxHash?.trim() || null,
      },
    });
    return this.get(req.id, userId);
  }

  /** §R — edit a draft (owner only; locked once published). */
  async update(userId: string, id: string, dto: { title?: string; description?: string; kind?: string; fields?: unknown[]; typeId?: string | null; expectedResponseAt?: string | null }) {
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
    // §R2 — structured form path: rebuild the snapshot + derived description from the submitted values.
    if (dto.fields !== undefined || dto.kind !== undefined) {
      const kind = REQUEST_KINDS.includes(dto.kind as RequestKind) ? (dto.kind as RequestKind) : (REQUEST_KINDS.includes(r.kind as RequestKind) ? (r.kind as RequestKind) : 'NOTIFICATION');
      const { fields, description } = await this.buildFields(kind, dto.fields ?? []);
      const descFinal = description || (dto.description?.trim() ?? '');
      data.kind = kind;
      data.fields = fields.length ? (fields as unknown as Prisma.InputJsonValue) : Prisma.JsonNull;
      data.description = descFinal;
    } else if (dto.description !== undefined) {
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
    else await this.notifyBoardOfNewRequest(id, r.title); // free requests enter the queue immediately
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
    // SEC — a fee tx funds at most ONE request (mirrors PublicScanPayment.txHash @unique). Without this
    // an approved submitter could pay once and reuse the same tx hash to activate unlimited paid
    // requests. The partial-unique index on request(fee_tx_hash) WHERE fee_seen_onchain_at IS NOT NULL
    // is the race-safe backstop; this check gives a clean early-out.
    const alreadyCredited = await this.prisma.request.findFirst({
      where: { feeTxHash: req.feeTxHash, feeSeenOnchainAt: { not: null }, id: { not: req.id } },
      select: { id: true },
    });
    if (alreadyCredited) return false; // this payment already funded another request
    const addr = await this.feeAddress();
    if (!addr) return false;
    const v = await this.cardano.verifyPayment(req.feeTxHash, addr, req.type.priceAda);
    if (v.found && v.paid) {
      try {
        // Race-safe: credit only if still pending + uncredited; the partial-unique index rejects a
        // concurrent credit of the same tx hash.
        const res = await this.prisma.request.updateMany({
          where: { id, status: 'PENDING_FEE', feeSeenOnchainAt: null },
          data: { status: 'ACTIVE', feeSeenOnchainAt: new Date() },
        });
        if (res.count === 0) return false;
      } catch {
        return false; // unique-index violation: the same tx was credited concurrently
      }
      await this.notifyBoardOfNewRequest(id, req.title); // paid request enters the queue once the fee verifies
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
        submitter: { select: { id: true, displayName: true, submitterApplication: { select: { logoDataUrl: true, email: true, telegram: true, socialLinks: true } } } },
        linkedProposal: { select: { id: true, publicId: true, title: true, status: true } },
      },
    });
    return rows
      .filter((r) => {
        if (r.status === 'DRAFT') return r.submitterUserId === userId; // drafts are private to the author
        if (r.status === 'PENDING_FEE') return board || r.submitterUserId === userId;
        return true; // ACTIVE / ACCEPTED / DONE / REJECTED / DELETED (deleted stays findable in history)
      })
      .map((r) => this.view(r, board || r.submitterUserId === userId, userId));
  }

  async get(id: string, userId: string | null) {
    const r = await this.prisma.request.findUnique({
      where: { id },
      include: { type: true, submitter: { select: { id: true, displayName: true, submitterApplication: { select: { logoDataUrl: true, email: true, telegram: true, socialLinks: true } } } }, linkedProposal: { select: { id: true, publicId: true, title: true, status: true } } },
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
      id: string; title: string; description: string; kind: string; fields: Prisma.JsonValue; expectedResponseAt: Date | null; status: string; createdAt: Date; decidedAt: Date | null;
      result: string | null; resultAt: Date | null;
      publishedAt: Date | null; feeTxHash: string | null; feeSeenOnchainAt: Date | null; submitterUserId: string;
      type: { id: string; name: string; priceAda: bigint } | null;
      submitter: { id: string; displayName: string | null; submitterApplication?: { logoDataUrl: string | null; email: string; telegram: string; socialLinks: string[] } | null };
      linkedProposal?: { id: string; publicId: string | null; title: string; status: string } | null;
    },
    full: boolean,
    viewerId?: string | null,
  ) {
    const app = r.submitter.submitterApplication ?? null;
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      kind: REQUEST_KINDS.includes(r.kind as RequestKind) ? r.kind : 'NOTIFICATION',
      // §R2 — the configured-element snapshot (null on legacy requests, which render from `description`).
      fields: Array.isArray(r.fields) ? (r.fields as unknown as FieldSnapshot[]) : null,
      // §R2 — the board's attached result (markdown), visible to everyone once set.
      result: r.result ?? null,
      resultAt: r.resultAt ? r.resultAt.toISOString() : null,
      expectedResponseAt: r.expectedResponseAt ? r.expectedResponseAt.toISOString() : null,
      status: r.status,
      publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
      isOwner: !!viewerId && r.submitterUserId === viewerId,
      editable: !!viewerId && r.submitterUserId === viewerId && r.status === 'DRAFT',
      createdAt: r.createdAt,
      decidedAt: r.decidedAt,
      submitter: r.submitter.displayName ?? 'Submitter',
      submitterUserId: r.submitterUserId,
      // §R — submitter identity + contact. Contact details (email/Telegram/socials) are shown only to
      // AUTHENTICATED viewers, matching the login-gated submitter directory (GET /dao/submitters is
      // behind JwtAuthGuard); anonymous callers get name + avatar only, never contact PII.
      submitterAvatar: app?.logoDataUrl ?? null,
      submitterEmail: viewerId ? app?.email || null : null,
      submitterTelegram: viewerId ? app?.telegram || null : null,
      submitterSocialLinks: viewerId ? app?.socialLinks ?? [] : [],
      type: r.type ? { id: r.type.id, name: r.type.name, priceAda: Number(r.type.priceAda) / Number(LOVELACE) } : null,
      free: !r.type,
      feeTxHash: full ? r.feeTxHash : r.feeTxHash ? `${r.feeTxHash.slice(0, 12)}…` : null,
      feeVerified: !!r.feeSeenOnchainAt,
      linkedProposal: r.linkedProposal
        ? { id: r.linkedProposal.id, publicId: r.linkedProposal.publicId, title: r.linkedProposal.title, status: r.linkedProposal.status }
        : null,
    };
  }

  /**
   * §R — only board members change a request's status. The queue lifecycle is
   * New (ACTIVE) → Accepted (ACCEPTED) → Complete (DONE), or Rejected (REJECTED) at any point;
   * the board can also move it back to New/Accepted. ACCEPTED is an intermediate "we've taken this
   * on" state — the request is not decided yet, so it stays in the open queue.
   */
  async setStatus(userId: string, id: string, status: string) {
    if (!(await this.isBoard(userId))) throw new ForbiddenException('board members only');
    if (!['ACTIVE', 'ACCEPTED', 'DONE', 'REJECTED'].includes(status)) {
      throw new BadRequestException('status must be ACTIVE, ACCEPTED, DONE or REJECTED');
    }
    const r = await this.prisma.request.findUnique({ where: { id }, select: { status: true, title: true, submitterUserId: true } });
    if (!r) throw new NotFoundException('request not found');
    if (r.status === 'PENDING_FEE') {
      throw new ConflictException('the fee has not been verified yet — the request is not in the queue');
    }
    const open = status === 'ACTIVE' || status === 'ACCEPTED'; // still in the queue, not decided
    await this.prisma.request.update({
      where: { id },
      data: { status, decidedAt: open ? null : new Date(), decidedByUserId: open ? null : userId },
    });
    // §20.3 — tell the submitter their request moved (once per distinct status via the kind).
    if (status !== r.status) {
      const label = REQUEST_STATUS_LABEL[status] ?? status;
      await this.notifications
        .notifyUsers([r.submitterUserId], `request_status_${status}`, id, { title: `Request ${label.toLowerCase()}`, body: r.title, requestId: id })
        .catch(() => undefined);
    }
    return this.get(id, userId);
  }

  /**
   * §R — board escalates a request to a vote by linking it to an INTERNAL proposal (optional).
   * The default request flow is notification + status only; linking is what carries it to voting.
   * Pass proposalId=null to unlink. Only published (non-draft) requests can be linked.
   */
  async setLinkedProposal(userId: string, id: string, proposalId: string | null) {
    if (!(await this.isBoard(userId))) throw new ForbiddenException('board members only');
    const r = await this.prisma.request.findUnique({ where: { id }, select: { status: true } });
    if (!r) throw new NotFoundException('request not found');
    if (['DRAFT', 'PENDING_FEE'].includes(r.status)) throw new BadRequestException('publish the request before linking a proposal');
    if (proposalId) {
      const p = await this.prisma.proposal.findUnique({ where: { id: proposalId }, select: { type: true } });
      if (!p) throw new NotFoundException('proposal not found');
      if (p.type !== 'INTERNAL') throw new BadRequestException('only an internal proposal can be linked to a request');
    }
    await this.prisma.request.update({ where: { id }, data: { linkedProposalId: proposalId } });
    return this.get(id, userId);
  }

  /**
   * §R2 — the board attaches or edits the request's result (markdown). Editable at any time and
   * independent of the status. An empty string clears it. The submitter is notified when a result is
   * first added (not on every edit).
   */
  async setResult(userId: string, id: string, md: string) {
    if (!(await this.isBoard(userId))) throw new ForbiddenException('board members only');
    const r = await this.prisma.request.findUnique({ where: { id }, select: { status: true, submitterUserId: true, title: true, result: true } });
    if (!r) throw new NotFoundException('request not found');
    if (['DRAFT', 'PENDING_FEE'].includes(r.status)) throw new BadRequestException('publish the request before adding a result');
    const text = (md ?? '').trim();
    const hadResult = !!r.result;
    await this.prisma.request.update({
      where: { id },
      data: { result: text || null, resultAt: text ? new Date() : null, resultByUserId: text ? userId : null },
    });
    if (text && !hadResult) {
      await this.notifications
        .notifyUsers([r.submitterUserId], 'request_result', id, { title: 'Request answered', body: r.title, requestId: id })
        .catch(() => undefined);
    }
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
      const parent = await this.prisma.requestComment.findUnique({ where: { id: dto.parentId }, select: { requestId: true } });
      if (!parent || parent.requestId !== id) throw new BadRequestException('invalid parent comment');
      parentId = dto.parentId; // §R — arbitrary nesting: a reply can reply to a reply.
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
    const [rows, boardSeats, admitted, experts, req] = await Promise.all([
      this.prisma.requestComment.findMany({ where: { requestId }, orderBy: { createdAt: 'asc' }, include: { author: { select: { displayName: true, drepKeyHash: true } } } }),
      this.prisma.boardSeat.findMany({ where: { removedAt: null }, select: { drepKeyHash: true } }),
      this.prisma.drep.findMany({ where: { status: 'ADMITTED' }, select: { userId: true } }),
      this.prisma.expert.findMany({ where: { approvedByBoard: true, leftAt: null }, select: { userId: true } }),
      this.prisma.request.findUnique({ where: { id: requestId }, select: { submitterUserId: true } }),
    ]);
    const boardHashes = new Set(boardSeats.map((b) => b.drepKeyHash));
    const admittedIds = new Set(admitted.map((d) => d.userId));
    const expertIds = new Set(experts.map((e) => e.userId));
    const submitterId = req?.submitterUserId;
    type Row = (typeof rows)[number];
    // Board member > Council member (admitted DRep) > Expert > Submitter (the request's author).
    const role = (c: Row) =>
      c.author.drepKeyHash && boardHashes.has(c.author.drepKeyHash) ? 'Board member'
      : admittedIds.has(c.authorUserId) ? 'Council member'
      : expertIds.has(c.authorUserId) ? 'Expert'
      : c.authorUserId === submitterId ? 'Submitter'
      : null;
    // §R — recursive thread: every comment carries its own replies, so a reply can reply to a reply.
    const shape = (c: Row): Record<string, unknown> => ({
      id: c.id,
      authorName: c.author.displayName ?? 'DRep',
      authorRole: role(c),
      isMine: c.authorUserId === userId,
      contentMd: c.deletedAt ? null : c.contentMd,
      deleted: !!c.deletedAt,
      createdAt: c.createdAt.toISOString(),
      replies: rows.filter((x) => x.parentId === c.id).map(shape),
    });
    return rows
      .filter((c) => !c.parentId)
      .map(shape)
      .filter((t) => !t.deleted || (t.replies as unknown[]).length > 0);
  }
}
