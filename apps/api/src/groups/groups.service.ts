import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BoardService } from '../auth/board.service';
import type { AdminCreateGroupDto, AdminUpdateGroupDto, GroupCommentDto, GroupVoteDto, RegisterGroupDto, SubmitGroupProposalDto } from './dto';

type GroupRow = {
  id: string; key: string; name: string; status: string;
  profileFields: string[]; proposalTypes: string[]; admissionType: string;
  approverUserId: string | null; commenters: string[]; votingType: string; thresholdPct: number; sortIdx: number;
  membersCanApprove: boolean; quorumMode: string; quorumCount: number | null;
};

@Injectable()
export class GroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly board: BoardService,
  ) {}

  // ── config JSON (always carries the group name) ─────────────────────────────
  private config(g: GroupRow & { approver?: { displayName: string | null } | null }) {
    return {
      id: g.id,
      key: g.key,
      name: g.name, // §29 — the JSON config always contains the group name
      status: g.status,
      profileFields: g.profileFields,
      proposalTypes: g.proposalTypes,
      admissionType: g.admissionType,
      approverUserId: g.approverUserId,
      approverName: g.approver?.displayName ?? null,
      commenters: g.commenters,
      // Voters are always the group's members; votingType + thresholdPct are configurable.
      voting: { voters: 'members', votingType: g.votingType, thresholdPct: g.thresholdPct },
      // §29 OG — self-governance + member-count quorum for submitting proposals.
      membersCanApprove: g.membersCanApprove,
      quorumMode: g.quorumMode, // OPEN | EXACT | MINIMUM
      quorumCount: g.quorumCount ?? null,
    };
  }

  // ── sysadmin CRUD ───────────────────────────────────────────────────────────
  async adminList() {
    const groups = await this.prisma.group.findMany({ orderBy: { sortIdx: 'asc' }, include: { approver: { select: { displayName: true } } } });
    const counts = await this.prisma.groupMember.groupBy({ by: ['groupId', 'status'], _count: { _all: true } });
    return groups.map((g) => ({
      ...this.config(g),
      members: counts.filter((c) => c.groupId === g.id && c.status === 'ADMITTED').reduce((n, c) => n + c._count._all, 0),
      pending: counts.filter((c) => c.groupId === g.id && c.status === 'PENDING').reduce((n, c) => n + c._count._all, 0),
    }));
  }

  async adminCreate(dto: AdminCreateGroupDto) {
    const key = dto.key.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (key.length < 2) throw new BadRequestException('key must be a slug (a-z, 0-9, -)');
    if (['mine', 'proposal', 'comment', 'members', 'membership', 'register', 'proposals'].includes(key)) throw new BadRequestException('that key is reserved');
    if (await this.prisma.group.findUnique({ where: { key } })) throw new ConflictException('a group with this key already exists');
    const max = await this.prisma.group.aggregate({ _max: { sortIdx: true } });
    const g = await this.prisma.group.create({
      data: {
        key, name: dto.name.trim(), status: 'HIDDEN',
        profileFields: ['memberSince', 'displayName', 'photo', 'bio'],
        proposalTypes: ['INFORMATIVE', 'POLL'],
        admissionType: 'SINGLE_DREP', approverUserId: null,
        commenters: ['members'], sortIdx: (max._max.sortIdx ?? 0) + 1,
      },
    });
    return this.adminList().then((l) => l.find((x) => x.id === g.id));
  }

  async adminUpdate(id: string, dto: AdminUpdateGroupDto) {
    const g = await this.prisma.group.findUnique({ where: { id } });
    if (!g) throw new NotFoundException('group not found');
    if (dto.admissionType === 'SINGLE_DREP' && dto.approverUserId) {
      const drep = await this.prisma.drep.findUnique({ where: { userId: dto.approverUserId }, select: { status: true } });
      if (drep?.status !== 'ADMITTED') throw new BadRequestException('the approver must be an admitted DRep');
    }
    await this.prisma.group.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.profileFields !== undefined ? { profileFields: dto.profileFields } : {}),
        ...(dto.proposalTypes !== undefined ? { proposalTypes: dto.proposalTypes } : {}),
        ...(dto.admissionType !== undefined ? { admissionType: dto.admissionType } : {}),
        ...(dto.approverUserId !== undefined ? { approverUserId: dto.approverUserId || null } : {}),
        ...(dto.commenters !== undefined ? { commenters: dto.commenters } : {}),
        ...(dto.votingType !== undefined ? { votingType: dto.votingType } : {}),
        ...(dto.thresholdPct !== undefined ? { thresholdPct: dto.thresholdPct } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.membersCanApprove !== undefined ? { membersCanApprove: dto.membersCanApprove } : {}),
      },
    });
    return this.adminList().then((l) => l.find((x) => x.id === id));
  }

  /** Admitted DReps, for the "single DRep approver" picker in the admin GROUPS tab. */
  async adminDrepOptions() {
    const dreps = await this.prisma.drep.findMany({ where: { status: 'ADMITTED' }, select: { userId: true, user: { select: { displayName: true } } }, orderBy: { admittedAt: 'asc' } });
    return dreps.map((d) => ({ userId: d.userId, name: d.user?.displayName ?? 'DRep' }));
  }

  // ── role helpers ────────────────────────────────────────────────────────────
  private async admittedDrep(userId: string) {
    const d = await this.prisma.drep.findUnique({ where: { userId }, select: { status: true } });
    return d?.status === 'ADMITTED';
  }
  private async approvedExpert(userId: string) {
    return !!(await this.prisma.expert.findFirst({ where: { userId, approvedByBoard: true, leftAt: null }, select: { id: true } }));
  }
  private async approvedSubmitter(userId: string) {
    return !!(await this.prisma.submitterApplication.findFirst({ where: { userId, status: 'APPROVED', leftAt: null }, select: { id: true } }));
  }
  private async admittedMember(groupId: string, userId: string) {
    const m = await this.prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } }, select: { status: true } });
    return m?.status === 'ADMITTED';
  }

  /** Who may admit/kick members, per the group's admission type. */
  private async canManageMembers(userId: string | null | undefined, g: GroupRow): Promise<boolean> {
    if (!userId) return false;
    // §29 OG self-governance — once seeded, any admitted member may approve/reject applicants.
    if (g.membersCanApprove && (await this.admittedMember(g.id, userId))) return true;
    switch (g.admissionType) {
      case 'BOARD': return this.board.isBoardMember(userId);
      case 'DREPS': return this.admittedDrep(userId);
      case 'SINGLE_DREP': return !!g.approverUserId && g.approverUserId === userId;
      case 'ADMIN': return false; // handled in the sysadmin panel
      case 'FREE': default: return false; // FREE auto-admits, nothing to manage
    }
  }

  /** Who may comment on this group's proposals, per the group's commenter checkboxes. */
  private async canComment(userId: string | null | undefined, g: GroupRow): Promise<boolean> {
    if (!userId || g.commenters.length === 0) return false;
    if (g.commenters.includes('viewers')) return true;
    if (g.commenters.includes('members') && (await this.admittedMember(g.id, userId))) return true;
    if (g.commenters.includes('dreps') && (await this.admittedDrep(userId))) return true;
    if (g.commenters.includes('experts') && (await this.approvedExpert(userId))) return true;
    if (g.commenters.includes('submitters') && (await this.approvedSubmitter(userId))) return true;
    return false;
  }

  private async activeGroupByKey(key: string): Promise<GroupRow> {
    const g = await this.prisma.group.findUnique({ where: { key } });
    if (!g || g.status !== 'ACTIVE') throw new NotFoundException('group not found');
    return g;
  }

  // ── app: nav + membership ───────────────────────────────────────────────────
  async listActive() {
    const groups = await this.prisma.group.findMany({ where: { status: 'ACTIVE' }, orderBy: { sortIdx: 'asc' }, include: { approver: { select: { displayName: true } } } });
    return groups.map((g) => this.config(g));
  }

  async myMemberships(userId: string) {
    const rows = await this.prisma.groupMember.findMany({
      where: { userId, status: { in: ['PENDING', 'ADMITTED'] }, group: { status: 'ACTIVE' } },
      include: { group: true },
    });
    // canManage tells the app whether to surface an "Applications" tab for this member (self-governance).
    return Promise.all(rows.map(async (m) => ({
      groupKey: m.group.key,
      groupName: m.group.name,
      status: m.status,
      displayName: m.displayName ?? null,
      canManage: m.status === 'ADMITTED' ? await this.canManageMembers(userId, m.group) : false,
    })));
  }

  async register(userId: string, key: string, dto: RegisterGroupDto) {
    const g = await this.activeGroupByKey(key);
    const existing = await this.prisma.groupMember.findUnique({ where: { groupId_userId: { groupId: g.id, userId } } });
    if (existing && existing.status !== 'REMOVED') throw new ConflictException('you already have a membership for this group');
    const free = g.admissionType === 'FREE';
    const has = (f: string) => g.profileFields.includes(f);
    const data = {
      status: free ? 'ADMITTED' : 'PENDING',
      admittedAt: free ? new Date() : null,
      displayName: has('displayName') ? (dto.displayName?.trim() || null) : null,
      bio: has('bio') ? (dto.bio?.trim() || null) : null,
      photo: has('photo') ? (dto.photo || null) : null,
      country: has('country') ? (dto.country?.trim() || null) : null,
      conflictOfInterest: has('conflictOfInterest') ? (dto.conflictOfInterest?.trim() || null) : null,
      noSelfVotePledge: has('conflictOfInterest') ? !!dto.noSelfVote : false,
      address: has('blockchainAddress') ? (dto.address?.trim() || null) : null,
      subcategoryIds: has('expertise') ? (dto.subcategoryIds ?? []) : [],
      socials: has('links') && dto.socials ? (dto.socials as object) : undefined,
      preferences: has('preferences') && dto.preferences ? (dto.preferences as object) : undefined,
    };
    if (existing) {
      await this.prisma.groupMember.update({ where: { id: existing.id }, data: { ...data, removedAt: null } });
    } else {
      await this.prisma.groupMember.create({ data: { groupId: g.id, userId, ...data } });
    }
    return this.myMembership(userId, key);
  }

  /** An admitted member edits their own group profile (fields per the group's profileFields). */
  async updateProfile(userId: string, key: string, dto: RegisterGroupDto) {
    const g = await this.activeGroupByKey(key);
    const m = await this.prisma.groupMember.findUnique({ where: { groupId_userId: { groupId: g.id, userId } } });
    if (!m || m.status !== 'ADMITTED') throw new ForbiddenException('only admitted members can edit their profile');
    const has = (f: string) => g.profileFields.includes(f);
    await this.prisma.groupMember.update({
      where: { id: m.id },
      data: {
        displayName: has('displayName') ? (dto.displayName?.trim() || null) : m.displayName,
        bio: has('bio') ? (dto.bio?.trim() || null) : m.bio,
        photo: has('photo') ? (dto.photo ?? m.photo) : m.photo,
        country: has('country') ? (dto.country?.trim() || null) : m.country,
        conflictOfInterest: has('conflictOfInterest') ? (dto.conflictOfInterest?.trim() || null) : m.conflictOfInterest,
        noSelfVotePledge: has('conflictOfInterest') ? !!dto.noSelfVote : m.noSelfVotePledge,
        address: has('blockchainAddress') ? (dto.address?.trim() || null) : m.address,
        subcategoryIds: has('expertise') ? (dto.subcategoryIds ?? []) : m.subcategoryIds,
        socials: has('links') && dto.socials ? (dto.socials as object) : (m.socials ?? undefined),
        preferences: has('preferences') && dto.preferences ? (dto.preferences as object) : (m.preferences ?? undefined),
      },
    });
    return this.myMembership(userId, key);
  }

  /** §29 OG — a member leaves the group (their membership is marked REMOVED; they can re-apply later). */
  async leaveGroup(userId: string, key: string) {
    const g = await this.activeGroupByKey(key);
    const m = await this.prisma.groupMember.findUnique({ where: { groupId_userId: { groupId: g.id, userId } } });
    if (!m || m.status === 'REMOVED') throw new NotFoundException('you are not a member of this group');
    await this.prisma.groupMember.update({ where: { id: m.id }, data: { status: 'REMOVED', removedAt: new Date() } });
    return { left: true };
  }

  /** §29 OG — an admitted member sets the group's voting quorum (self-governed; applies to everyone). */
  async updateVotingSettings(userId: string, key: string, dto: { quorumMode: string; quorumCount?: number | null }) {
    const g = await this.activeGroupByKey(key);
    if (!(await this.admittedMember(g.id, userId))) throw new ForbiddenException('only admitted members can change the voting settings');
    const mode = dto.quorumMode;
    if (!['OPEN', 'EXACT', 'MINIMUM'].includes(mode)) throw new BadRequestException('invalid quorum mode');
    let count: number | null = null;
    if (mode !== 'OPEN') {
      count = Number(dto.quorumCount);
      if (!Number.isInteger(count) || count < 1) throw new BadRequestException('a member count of at least 1 is required');
    }
    await this.prisma.group.update({ where: { id: g.id }, data: { quorumMode: mode, quorumCount: count } });
    return this.myMembership(userId, key);
  }

  async myMembership(userId: string, key: string) {
    const g = await this.activeGroupByKey(key);
    const m = await this.prisma.groupMember.findUnique({ where: { groupId_userId: { groupId: g.id, userId } } });
    return {
      group: this.config(g),
      membership: m && m.status !== 'REMOVED'
        ? { status: m.status, displayName: m.displayName, bio: m.bio, photo: m.photo, country: m.country, conflictOfInterest: m.conflictOfInterest, noSelfVote: m.noSelfVotePledge, address: m.address, subcategoryIds: m.subcategoryIds, socials: m.socials, preferences: m.preferences, since: m.admittedAt?.toISOString() ?? null }
        : null,
      canManage: await this.canManageMembers(userId, g),
    };
  }

  async listMembers(userId: string | null | undefined, key: string) {
    const g = await this.activeGroupByKey(key);
    const canManage = await this.canManageMembers(userId, g);
    const rows = await this.prisma.groupMember.findMany({
      where: { groupId: g.id, status: canManage ? { in: ['ADMITTED', 'PENDING'] } : 'ADMITTED' },
      include: { user: { select: { displayName: true } } },
      orderBy: [{ status: 'asc' }, { admittedAt: 'asc' }, { createdAt: 'asc' }],
    });
    const has = (f: string) => g.profileFields.includes(f);
    const view = (m: (typeof rows)[number]) => ({
      id: m.id,
      status: m.status,
      displayName: has('displayName') ? (m.displayName ?? m.user.displayName ?? 'Member') : (m.user.displayName ?? 'Member'),
      bio: has('bio') ? m.bio : null,
      photo: has('photo') ? m.photo : null,
      country: has('country') ? m.country : null,
      conflictOfInterest: has('conflictOfInterest') ? m.conflictOfInterest : null,
      noSelfVote: has('conflictOfInterest') ? m.noSelfVotePledge : null,
      address: has('blockchainAddress') ? m.address : null,
      subcategoryIds: has('expertise') ? m.subcategoryIds : [],
      socials: has('links') ? (m.socials ?? null) : null,
      preferences: has('preferences') ? (m.preferences ?? null) : null,
      since: has('memberSince') ? (m.admittedAt?.toISOString() ?? null) : null,
    });
    return {
      group: this.config(g),
      canManage,
      members: rows.filter((m) => m.status === 'ADMITTED').map(view),
      pending: canManage ? rows.filter((m) => m.status === 'PENDING').map(view) : [],
    };
  }

  async setMemberStatus(userId: string, memberId: string, action: 'approve' | 'reject' | 'kick') {
    const m = await this.prisma.groupMember.findUnique({ where: { id: memberId }, include: { group: true } });
    if (!m) throw new NotFoundException('membership not found');
    if (!(await this.canManageMembers(userId, m.group))) throw new ForbiddenException('you are not allowed to manage this group’s members');
    if (action === 'approve') {
      if (m.status !== 'PENDING') throw new BadRequestException('only pending registrations can be approved');
      // §29 OG — EXACT quorum caps the group size: don't admit beyond the exact count; a member must leave first.
      if (m.group.quorumMode === 'EXACT') {
        const admitted = await this.prisma.groupMember.count({ where: { groupId: m.group.id, status: 'ADMITTED' } });
        if (admitted >= (m.group.quorumCount ?? 0)) {
          throw new BadRequestException(`this group is limited to exactly ${m.group.quorumCount ?? 0} member(s); a member must leave before admitting another`);
        }
      }
      await this.prisma.groupMember.update({ where: { id: memberId }, data: { status: 'ADMITTED', admittedAt: new Date(), approvedByUserId: userId } });
    } else {
      await this.prisma.groupMember.update({ where: { id: memberId }, data: { status: 'REMOVED', removedAt: new Date() } });
    }
    return this.listMembers(userId, m.group.key);
  }

  // ── app: proposals ──────────────────────────────────────────────────────────
  async listProposals(userId: string | null | undefined, key: string) {
    const g = await this.activeGroupByKey(key);
    const rows = await this.prisma.groupProposal.findMany({ where: { groupId: g.id }, orderBy: { createdAt: 'desc' }, include: { author: { select: { displayName: true } } } });
    for (const p of rows) await this.maybeFinalize(p);
    const isMember = !!userId && (await this.admittedMember(g.id, userId));
    const memberCount = await this.prisma.groupMember.count({ where: { groupId: g.id, status: 'ADMITTED' } });
    const submitBlockedReason = isMember ? this.quorumBlockReason(g, memberCount) : null;
    const canSubmit = isMember && !submitBlockedReason;
    const fresh = await this.prisma.groupProposal.findMany({ where: { groupId: g.id }, orderBy: { createdAt: 'desc' }, include: { author: { select: { displayName: true } } } });
    return {
      group: this.config(g),
      canSubmit,
      submitBlockedReason,
      proposals: fresh.map((p) => ({
        id: p.id, title: p.title, type: p.type, status: p.status,
        author: p.author.displayName ?? 'Member',
        votingEndAt: p.votingEndAt.toISOString(), createdAt: p.createdAt.toISOString(),
      })),
    };
  }

  async getProposal(userId: string | null | undefined, id: string) {
    const p = await this.prisma.groupProposal.findUnique({ where: { id }, include: { group: true, author: { select: { displayName: true } } } });
    if (!p || p.group.status !== 'ACTIVE') throw new NotFoundException('proposal not found');
    await this.maybeFinalize(p);
    const fresh = await this.prisma.groupProposal.findUnique({ where: { id }, include: { group: true, author: { select: { displayName: true } } } });
    if (!fresh) throw new NotFoundException('proposal not found');
    const g = fresh.group as unknown as GroupRow;
    const isMember = !!userId && (await this.admittedMember(g.id, userId));
    const tally = await this.tally(fresh);
    const myVotes = userId
      ? (await this.prisma.groupVote.findMany({ where: { proposalId: id, voterUserId: userId }, select: { choice: true } })).map((v) => v.choice)
      : [];
    const poll = fresh.pollOptions as { multiple?: boolean; options?: string[] } | null;
    // §29 — voters' rationales (one per voter) + this member's own, so the UI can list them + prefill.
    const rationaleRows = await this.prisma.groupVote.findMany({
      where: { proposalId: id, NOT: { rationale: null } },
      select: { voterUserId: true, choice: true, rationale: true, voter: { select: { displayName: true } } },
      distinct: ['voterUserId'],
      orderBy: { createdAt: 'asc' },
    });
    const rationales = rationaleRows
      .filter((r) => r.rationale?.trim())
      .map((r) => ({ voter: r.voter.displayName ?? 'Member', choice: r.choice, rationale: r.rationale as string }));
    const myRationale = userId
      ? (await this.prisma.groupVote.findFirst({ where: { proposalId: id, voterUserId: userId }, select: { rationale: true } }))?.rationale ?? null
      : null;
    return {
      id: fresh.id,
      groupKey: g.key,
      groupName: g.name,
      title: fresh.title,
      contentMd: fresh.contentMd,
      type: fresh.type,
      status: fresh.status,
      author: fresh.author.displayName ?? 'Member',
      votingEndAt: fresh.votingEndAt.toISOString(),
      decidedAt: fresh.decidedAt?.toISOString() ?? null,
      createdAt: fresh.createdAt.toISOString(),
      poll: fresh.type === 'POLL' ? { multiple: !!poll?.multiple, options: poll?.options ?? [] } : null,
      actors: (fresh.actors as string[] | null) ?? null,
      deliveryDate: fresh.deliveryDate?.toISOString() ?? null,
      canVote: isMember && fresh.status === 'ACTIVE',
      myVotes,
      myRationale,
      rationales,
      canComment: await this.canComment(userId, g),
      canModerate: await this.canManageMembers(userId, g),
      comments: await this.loadComments(id, userId, g),
      tally,
    };
  }

  /** §29 OG — why (if at all) the member-count quorum currently blocks voting/submitting. Null = ok. */
  private quorumBlockReason(g: GroupRow, memberCount: number): string | null {
    if (!g.quorumMode || g.quorumMode === 'OPEN') return null;
    const need = g.quorumCount ?? 0;
    if (g.quorumMode === 'EXACT' && memberCount !== need) {
      return `this group can submit proposals only with exactly ${need} member(s); it currently has ${memberCount}`;
    }
    if (g.quorumMode === 'MINIMUM' && memberCount < need) {
      return `this group needs at least ${need} member(s) to submit proposals; it currently has ${memberCount}`;
    }
    return null;
  }

  async submitProposal(userId: string, key: string, dto: SubmitGroupProposalDto) {
    const g = await this.activeGroupByKey(key);
    if (!(await this.admittedMember(g.id, userId))) throw new ForbiddenException('only admitted members can submit proposals');
    // §29 OG — member-count quorum gate.
    const memberCount = await this.prisma.groupMember.count({ where: { groupId: g.id, status: 'ADMITTED' } });
    const blocked = this.quorumBlockReason(g, memberCount);
    if (blocked) throw new BadRequestException(blocked);
    if (!g.proposalTypes.includes(dto.type)) throw new BadRequestException('this group does not allow that proposal type');
    const end = new Date(dto.votingEndAt);
    if (Number.isNaN(end.getTime()) || end.getTime() <= Date.now()) throw new BadRequestException('the voting end must be a date in the future');
    let pollOptions: { multiple: boolean; options: string[] } | undefined;
    if (dto.type === 'POLL') {
      const options = (dto.pollOptions ?? []).map((o) => o.trim()).filter(Boolean);
      if (options.length < 2) throw new BadRequestException('a poll needs at least two options');
      pollOptions = { multiple: !!dto.pollMultiple, options };
    }
    const instructive = dto.type === 'INSTRUCTIVE';
    const p = await this.prisma.groupProposal.create({
      data: {
        groupId: g.id, authorUserId: userId, title: dto.title.trim(), contentMd: dto.contentMd,
        type: dto.type, pollOptions: pollOptions ?? undefined, status: 'ACTIVE', votingEndAt: end,
        actors: instructive && dto.actors?.length ? dto.actors : undefined,
        deliveryDate: instructive && dto.deliveryDate ? new Date(dto.deliveryDate) : undefined,
      },
    });
    return this.getProposal(userId, p.id);
  }

  async vote(userId: string, proposalId: string, dto: GroupVoteDto) {
    const p = await this.prisma.groupProposal.findUnique({ where: { id: proposalId }, include: { group: true } });
    if (!p || p.group.status !== 'ACTIVE') throw new NotFoundException('proposal not found');
    await this.maybeFinalize(p);
    const fresh = await this.prisma.groupProposal.findUnique({ where: { id: proposalId } });
    if (!fresh || fresh.status !== 'ACTIVE') throw new ConflictException('voting is closed for this proposal');
    if (!(await this.admittedMember(p.groupId, userId))) throw new ForbiddenException('only admitted members may vote');
    const rows: { choice: string }[] = [];
    if (fresh.type === 'POLL') {
      const poll = fresh.pollOptions as { multiple?: boolean; options?: string[] } | null;
      const options = poll?.options ?? [];
      if (dto.choice === 'ABSTAIN') {
        rows.push({ choice: 'ABSTAIN' });
      } else {
        const chosen = dto.options ?? [];
        if (chosen.length === 0) throw new BadRequestException('select at least one option');
        if (!poll?.multiple && chosen.length !== 1) throw new BadRequestException('this poll allows exactly one option');
        for (const o of chosen) if (!options.includes(o)) throw new BadRequestException(`unknown option: ${o}`);
        chosen.forEach((o) => rows.push({ choice: o }));
      }
    } else {
      if (!['YES', 'NO', 'ABSTAIN'].includes(dto.choice ?? '')) throw new BadRequestException('choice must be YES, NO or ABSTAIN');
      rows.push({ choice: dto.choice as string });
    }
    // Re-vote replaces the member's prior votes (no on-chain history needed here).
    await this.prisma.groupVote.deleteMany({ where: { proposalId, voterUserId: userId } });
    const rationale = dto.rationale?.trim() || null;
    await this.prisma.groupVote.createMany({ data: rows.map((r) => ({ proposalId, voterUserId: userId, choice: r.choice, rationale })) });
    return this.getProposal(userId, proposalId);
  }

  private async admittedMemberIds(groupId: string): Promise<Set<string>> {
    const rows = await this.prisma.groupMember.findMany({ where: { groupId, status: 'ADMITTED' }, select: { userId: true } });
    return new Set(rows.map((r) => r.userId));
  }

  private async tally(p: { id: string; groupId: string; type: string; pollOptions: unknown }) {
    const group = await this.prisma.group.findUnique({ where: { id: p.groupId }, select: { thresholdPct: true } });
    const thresholdPct = group?.thresholdPct ?? 67;
    const memberIds = await this.admittedMemberIds(p.groupId);
    const eligible = memberIds.size;
    const votes = (await this.prisma.groupVote.findMany({ where: { proposalId: p.id } })).filter((v) => memberIds.has(v.voterUserId));
    if (p.type === 'POLL') {
      const cfg = (p.pollOptions ?? {}) as { multiple?: boolean; options?: string[] };
      const counts = new Map<string, number>();
      for (const o of cfg.options ?? []) counts.set(o, 0);
      const voters = new Set<string>();
      let abstain = 0;
      for (const v of votes) {
        voters.add(v.voterUserId);
        if (v.choice === 'ABSTAIN') { abstain++; continue; }
        counts.set(v.choice, (counts.get(v.choice) ?? 0) + 1);
      }
      return { kind: 'POLL' as const, eligible, voted: voters.size, abstain, options: [...counts.entries()].map(([option, voters]) => ({ option, voters })) };
    }
    // INFORMATIVE — 1 member = 1 vote, denominator = eligible members − abstainers, pass at ≥ 67% YES.
    const choiceBy = new Map<string, string>();
    for (const v of votes) choiceBy.set(v.voterUserId, v.choice); // one row per member for INFORMATIVE
    let yes = 0, no = 0, abstain = 0;
    for (const uid of memberIds) {
      const c = choiceBy.get(uid);
      if (c === 'YES') yes++;
      else if (c === 'NO') no++;
      else if (c === 'ABSTAIN') abstain++;
    }
    const denominator = Math.max(0, eligible - abstain);
    const ratioPct = denominator > 0 ? Math.round((yes / denominator) * 1000) / 10 : 0;
    return { kind: 'THRESHOLD' as const, eligible, voted: yes + no + abstain, yes, no, abstain, denominator, ratioPct, thresholdPct, approved: ratioPct >= thresholdPct };
  }

  private async maybeFinalize(p: { id: string; status: string; votingEndAt: Date; type: string; groupId: string; pollOptions: unknown }) {
    if (p.status !== 'ACTIVE' || p.votingEndAt.getTime() > Date.now()) return;
    const t = await this.tally(p);
    const status = p.type === 'POLL' ? 'CLOSED' : t.kind === 'THRESHOLD' && t.approved ? 'PASSED' : 'FAILED';
    await this.prisma.groupProposal.update({ where: { id: p.id }, data: { status, decidedAt: new Date() } });
  }

  // ── app: comments (recursive; shared with the DiscussionThread UI) ───────────
  async addComment(userId: string, proposalId: string, dto: GroupCommentDto) {
    const p = await this.prisma.groupProposal.findUnique({ where: { id: proposalId }, include: { group: true } });
    if (!p || p.group.status !== 'ACTIVE') throw new NotFoundException('proposal not found');
    if (!(await this.canComment(userId, p.group))) throw new ForbiddenException('you are not allowed to comment on this group’s proposals');
    const text = (dto.contentMd ?? '').trim();
    if (!text) throw new BadRequestException('a comment is required');
    let parentId: string | null = null;
    if (dto.parentId) {
      const parent = await this.prisma.groupComment.findUnique({ where: { id: dto.parentId }, select: { proposalId: true } });
      if (!parent || parent.proposalId !== proposalId) throw new BadRequestException('invalid parent comment');
      parentId = dto.parentId;
    }
    await this.prisma.groupComment.create({ data: { proposalId, authorUserId: userId, contentMd: text, parentId } });
    return this.getProposal(userId, proposalId);
  }

  async deleteComment(userId: string, commentId: string) {
    const c = await this.prisma.groupComment.findUnique({ where: { id: commentId }, include: { proposal: { include: { group: true } } } });
    if (!c) throw new NotFoundException('comment not found');
    const canModerate = await this.canManageMembers(userId, c.proposal.group);
    if (c.authorUserId !== userId && !canModerate) throw new ForbiddenException('only the comment author or a group manager can delete a comment');
    if (!c.deletedAt) await this.prisma.groupComment.update({ where: { id: commentId }, data: { deletedAt: new Date() } });
    return this.getProposal(userId, c.proposalId);
  }

  private async loadComments(proposalId: string, userId: string | null | undefined, g: GroupRow) {
    const [rows, boardSeats, admitted, experts, memberIds] = await Promise.all([
      this.prisma.groupComment.findMany({ where: { proposalId }, orderBy: { createdAt: 'asc' }, include: { author: { select: { displayName: true, drepKeyHash: true } } } }),
      this.prisma.boardSeat.findMany({ where: { removedAt: null }, select: { drepKeyHash: true } }),
      this.prisma.drep.findMany({ where: { status: 'ADMITTED' }, select: { userId: true } }),
      this.prisma.expert.findMany({ where: { approvedByBoard: true, leftAt: null }, select: { userId: true } }),
      this.admittedMemberIds(g.id),
    ]);
    const boardHashes = new Set(boardSeats.map((b) => b.drepKeyHash));
    const admittedIds = new Set(admitted.map((d) => d.userId));
    const expertIds = new Set(experts.map((e) => e.userId));
    type Row = (typeof rows)[number];
    const role = (c: Row) =>
      c.author.drepKeyHash && boardHashes.has(c.author.drepKeyHash) ? 'Board member'
      : memberIds.has(c.authorUserId) ? `${g.name} member`
      : admittedIds.has(c.authorUserId) ? 'Council member'
      : expertIds.has(c.authorUserId) ? 'Expert'
      : null;
    const shape = (c: Row): Record<string, unknown> => ({
      id: c.id,
      authorName: c.author.displayName ?? 'Member',
      authorRole: role(c),
      isMine: c.authorUserId === userId,
      contentMd: c.deletedAt ? null : c.contentMd,
      deleted: !!c.deletedAt,
      createdAt: c.createdAt.toISOString(),
      replies: rows.filter((x) => x.parentId === c.id).map(shape),
    });
    return rows.filter((c) => !c.parentId).map(shape).filter((t) => !(t.deleted as boolean) || (t.replies as unknown[]).length > 0);
  }

  // ── sysadmin member oversight (also drives ADMIN-admission approvals) ─────────
  async adminMembers(id: string) {
    const g = await this.prisma.group.findUnique({ where: { id } });
    if (!g) throw new NotFoundException('group not found');
    const rows = await this.prisma.groupMember.findMany({
      where: { groupId: id, status: { in: ['ADMITTED', 'PENDING'] } },
      include: { user: { select: { displayName: true } } },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((m) => ({ id: m.id, status: m.status, name: m.displayName ?? m.user.displayName ?? 'Member', since: m.admittedAt?.toISOString() ?? null }));
  }

  async adminSetMemberStatus(memberId: string, action: 'approve' | 'kick') {
    const m = await this.prisma.groupMember.findUnique({ where: { id: memberId } });
    if (!m) throw new NotFoundException('membership not found');
    await this.prisma.groupMember.update({
      where: { id: memberId },
      data: action === 'approve' ? { status: 'ADMITTED', admittedAt: new Date() } : { status: 'REMOVED', removedAt: new Date() },
    });
    return { ok: true };
  }
}
