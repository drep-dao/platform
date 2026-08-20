import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { InternalProposalsService } from '../internal-proposals/internal-proposals.service';

const sha256hex = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
const PUBLIC_STATUSES = ['DRAFT', 'ACTIVE', 'DELETED'];

/**
 * §27 — Rule Documents. A DRep authors a document (PRIVATE, owner-only), publishes it (DRAFT,
 * public + open to feedback while the owner keeps editing), and any DRep opens a RULE_APPROVAL
 * internal vote (handled by InternalProposalsService, which freezes + anchors the content hash on
 * submit and flips the status on the outcome). This service owns the document CRUD + feedback.
 */
@Injectable()
export class RuleDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly internal: InternalProposalsService,
  ) {}

  private async admittedDrep(userId: string): Promise<boolean> {
    const drep = await this.prisma.drep.findUnique({ where: { userId }, select: { status: true } });
    return drep?.status === 'ADMITTED';
  }

  /** Is there a rule-approval vote currently in progress for this document? (→ content is locked). */
  private async hasLiveVote(documentId: string): Promise<boolean> {
    const p = await this.prisma.proposal.findFirst({
      where: { ruleDocumentId: documentId, internalType: 'RULE_APPROVAL', status: 'ACTIVE' },
      select: { id: true },
    });
    return !!p;
  }

  /** The latest rule-approval vote's compact score, or null if the document was never voted. */
  private async lastVote(documentId: string) {
    const p = await this.prisma.proposal.findFirst({
      where: { ruleDocumentId: documentId, internalType: 'RULE_APPROVAL' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    return p ? this.internal.ruleVoteScore(p.id) : null;
  }

  private summary(doc: { id: string; title: string; status: string; publishedAt: Date | null; updatedAt: Date; owner: { displayName: string | null } }) {
    return {
      id: doc.id,
      title: doc.title,
      status: doc.status,
      ownerName: doc.owner.displayName ?? 'DRep',
      publishedAt: doc.publishedAt ? doc.publishedAt.toISOString() : null,
      updatedAt: doc.updatedAt.toISOString(),
    };
  }

  /** Public list (never PRIVATE), filtered by status. filter: all | active | draft | deleted. */
  async list(filter?: string) {
    const f = (filter ?? 'all').toLowerCase();
    const statuses =
      f === 'active' ? ['ACTIVE'] : f === 'draft' ? ['DRAFT'] : f === 'deleted' ? ['DELETED'] : PUBLIC_STATUSES;
    const docs = await this.prisma.ruleDocument.findMany({
      where: { status: { in: statuses } },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      include: { owner: { select: { displayName: true } } },
    });
    return Promise.all(docs.map(async (d) => ({ ...this.summary(d), lastVote: await this.lastVote(d.id) })));
  }

  /** The caller's own documents (every status, including PRIVATE) with an `editable` flag. */
  async listMine(userId: string) {
    const docs = await this.prisma.ruleDocument.findMany({
      where: { ownerUserId: userId },
      orderBy: { updatedAt: 'desc' },
      include: { owner: { select: { displayName: true } } },
    });
    return Promise.all(
      docs.map(async (d) => ({
        ...this.summary(d),
        editable: d.status === 'PRIVATE' || (d.status === 'DRAFT' && !(await this.hasLiveVote(d.id))),
        lastVote: await this.lastVote(d.id),
      })),
    );
  }

  async getOne(id: string, userId?: string) {
    const doc = await this.prisma.ruleDocument.findUnique({
      where: { id },
      include: { owner: { select: { displayName: true } } },
    });
    if (!doc) throw new NotFoundException('rule document not found');
    const isOwner = !!userId && doc.ownerUserId === userId;
    if (doc.status === 'PRIVATE' && !isOwner) throw new ForbiddenException('this document is private');

    const isDrep = !!userId && (await this.admittedDrep(userId));
    const live = await this.hasLiveVote(doc.id);
    const editable = isOwner && (doc.status === 'PRIVATE' || (doc.status === 'DRAFT' && !live));
    const comments =
      doc.status === 'PRIVATE'
        ? []
        : (
            await this.prisma.ruleDocumentComment.findMany({
              where: { documentId: doc.id, deletedAt: null },
              orderBy: { createdAt: 'asc' },
              include: { author: { select: { displayName: true } } },
            })
          ).map((c) => ({
            id: c.id,
            authorName: c.author.displayName ?? 'DRep',
            isMine: c.authorUserId === userId,
            contentMd: c.contentMd,
            createdAt: c.createdAt.toISOString(),
          }));

    return {
      ...this.summary(doc),
      contentMd: doc.contentMd,
      // sha256 of the raw content (UTF-8), hex — the exact value a user can reproduce from the
      // downloaded text. For an ACTIVE document this equals the frozen, on-chain-anchored hash.
      contentHash: sha256hex(doc.contentMd),
      isOwner,
      editable,
      // A document with a live vote is locked; a DRAFT with no live vote can be voted; ACTIVE can
      // only be deleted (via a delete vote); PRIVATE/DELETED can't be voted.
      canPropose: isDrep && !live && (doc.status === 'DRAFT' || doc.status === 'ACTIVE'),
      canComment: isDrep && doc.status !== 'PRIVATE' && doc.status !== 'DELETED',
      comments,
      lastVote: await this.lastVote(doc.id),
    };
  }

  async create(userId: string, dto: { title: string; contentMd: string }) {
    if (!(await this.admittedDrep(userId))) throw new ForbiddenException('you must be a Council member to author rule documents — join the Council first (it is free)');
    const doc = await this.prisma.ruleDocument.create({
      data: { title: dto.title.trim(), contentMd: dto.contentMd, ownerUserId: userId, status: 'PRIVATE' },
    });
    return this.getOne(doc.id, userId);
  }

  private async ownEditable(id: string, userId: string) {
    const doc = await this.prisma.ruleDocument.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('rule document not found');
    if (doc.ownerUserId !== userId) throw new ForbiddenException('not your document');
    return doc;
  }

  async update(userId: string, id: string, dto: { title?: string; contentMd?: string }) {
    const doc = await this.ownEditable(id, userId);
    if (doc.status !== 'PRIVATE' && doc.status !== 'DRAFT') throw new BadRequestException('this document can no longer be edited');
    if (doc.status === 'DRAFT' && (await this.hasLiveVote(id))) throw new BadRequestException('a vote is in progress — the document is locked');
    await this.prisma.ruleDocument.update({
      where: { id },
      data: { title: dto.title?.trim() ?? doc.title, contentMd: dto.contentMd ?? doc.contentMd },
    });
    return this.getOne(id, userId);
  }

  /** PRIVATE → DRAFT: publish so other DReps can read + give feedback (still editable by the owner). */
  async publish(userId: string, id: string) {
    const doc = await this.ownEditable(id, userId);
    if (doc.status !== 'PRIVATE') throw new BadRequestException('only a private document can be published');
    await this.prisma.ruleDocument.update({ where: { id }, data: { status: 'DRAFT', publishedAt: new Date() } });
    return this.getOne(id, userId);
  }

  /** Discard an unpublished (PRIVATE) draft. Published documents are removed only by a delete vote. */
  async remove(userId: string, id: string) {
    const doc = await this.ownEditable(id, userId);
    if (doc.status !== 'PRIVATE') throw new BadRequestException('a published document can only be removed by a delete vote');
    await this.prisma.ruleDocument.delete({ where: { id } });
    return { ok: true };
  }

  async addComment(userId: string, id: string, dto: { contentMd: string }) {
    if (!(await this.admittedDrep(userId))) throw new ForbiddenException('you must be a Council member to comment — join the Council first (it is free)');
    const doc = await this.prisma.ruleDocument.findUnique({ where: { id }, select: { status: true } });
    if (!doc) throw new NotFoundException('rule document not found');
    if (doc.status === 'PRIVATE' || doc.status === 'DELETED') throw new BadRequestException('this document is not open for feedback');
    await this.prisma.ruleDocumentComment.create({ data: { documentId: id, authorUserId: userId, contentMd: dto.contentMd } });
    return this.getOne(id, userId);
  }

  async deleteComment(userId: string, commentId: string) {
    const c = await this.prisma.ruleDocumentComment.findUnique({
      where: { id: commentId },
      include: { document: { select: { ownerUserId: true } } },
    });
    if (!c) throw new NotFoundException('comment not found');
    if (c.authorUserId !== userId && c.document.ownerUserId !== userId) throw new ForbiddenException('not your comment');
    await this.prisma.ruleDocumentComment.update({ where: { id: commentId }, data: { deletedAt: new Date() } });
    return { ok: true };
  }
}
