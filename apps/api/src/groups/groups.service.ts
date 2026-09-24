import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GovSubject, VotingStyle } from '@drep-dao/cardano';
import { EXPLORERS, PLATFORM_CONFIG_DEFAULTS } from '@drep-dao/shared';
import { PrismaService } from '../prisma/prisma.service';
import { BoardService } from '../auth/board.service';
import { AnchorService } from '../cardano/anchor.service';
import type { AdminCreateGroupDto, AdminUpdateGroupDto, GroupCommentDto, GroupVoteDto, RegisterGroupDto, SubmitGroupProposalDto } from './dto';

type GroupRow = {
  id: string; key: string; name: string; status: string;
  profileFields: string[]; proposalTypes: string[]; admissionType: string;
  approverUserId: string | null; commenters: string[]; votingType: string; thresholdPct: number; sortIdx: number;
  membersCanApprove: boolean; quorumMode: string; quorumCount: number | null;
};

// §29 BULK — per-item tally shape (also the JSON stored in decidedTally for a closed bulk proposal).
// `decided` = the item's pass/fail outcome can no longer change, whatever the not-yet-voted members do.
type BulkItemTally = { id: string; yes: number; no: number; abstain: number; eligible: number; denominator: number; ratioPct: number; thresholdPct: number; approved: boolean; voted: number; decided: boolean };
// `allDecided` = every item's outcome is locked (all voted, OR enough votes that the rest can't change it).
type BulkTally = { kind: 'BULK'; eligible: number; votedMembers: number; allVoted: boolean; allDecided: boolean; items: BulkItemTally[] };

// §29 BULK — the per-item detail shape returned to the client (tally + this member's vote + all votes/rationales).
type BulkItemTallyView = { yes: number; no: number; abstain: number; eligible: number; denominator: number; ratioPct: number; thresholdPct: number; approved: boolean; voted: number };
type BulkDetail = {
  eligible: number; votedMembers: number; allVoted: boolean; allDecided: boolean;
  resultHash: string | null; // SHA-256 of the downloadable result.json (once closed); matches the on-chain anchor
  items: {
    id: string; title: string; description: string;
    tally: BulkItemTallyView | null;
    myChoice: string | null; myRationale: string | null;
    voters: { voter: string; choice: string }[];
    rationales: { voter: string; choice: string; rationale: string }[];
  }[];
};

@Injectable()
export class GroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly board: BoardService,
    private readonly anchor: AnchorService,
    private readonly cfg: ConfigService,
  ) {}

  /** §29 — explorer URL for an anchor tx, honouring CARDANO_NETWORK + the admin's CARDANO_EXPLORER choice. */
  private async explorerTxUrl(txHash: string): Promise<string> {
    const network = this.cfg.get<string>('CARDANO_NETWORK') ?? 'Preprod';
    const row = await this.prisma.platformConfig.findUnique({ where: { key: 'CARDANO_EXPLORER' } });
    const explorer = (typeof row?.value === 'string' && row.value.trim()) ? row.value.trim() : PLATFORM_CONFIG_DEFAULTS.CARDANO_EXPLORER;
    const ex = EXPLORERS[explorer] ?? EXPLORERS.cardanoscan;
    return (ex.tx[network] ?? ex.tx.Preprod).replace('{hash}', txHash);
  }

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

  /** §29 — total pending applicants across every ACTIVE group this member may approve. Feeds the
   *  to-do badge so a self-governing group's approver (e.g. an OG member) is notified without
   *  opening the Applications tab. */
  async pendingApprovalsCount(userId: string | null | undefined): Promise<number> {
    if (!userId) return 0;
    const groups = await this.prisma.group.findMany({ where: { status: 'ACTIVE' } });
    let count = 0;
    for (const g of groups) {
      if (!(await this.canManageMembers(userId, g as unknown as GroupRow))) continue;
      count += await this.prisma.groupMember.count({ where: { groupId: g.id, status: 'PENDING' } });
    }
    return count;
  }

  /** §29 — active proposals still open for voting, in groups this member belongs to, that they have
   *  NOT voted on yet. Feeds the My-area to-do badge so a member is nudged to vote before it closes. */
  async pendingVotesCount(userId: string | null | undefined): Promise<number> {
    if (!userId) return 0;
    const memberships = await this.prisma.groupMember.findMany({
      where: { userId, status: 'ADMITTED', group: { status: 'ACTIVE' } },
      select: { groupId: true },
    });
    if (!memberships.length) return 0;
    const active = await this.prisma.groupProposal.findMany({
      where: { groupId: { in: memberships.map((m) => m.groupId) }, status: 'ACTIVE', votingEndAt: { gt: new Date() } },
      select: { id: true },
    });
    if (!active.length) return 0;
    const voted = new Set(
      (await this.prisma.groupVote.findMany({
        where: { proposalId: { in: active.map((p) => p.id) }, voterUserId: userId },
        select: { proposalId: true }, distinct: ['proposalId'],
      })).map((v) => v.proposalId),
    );
    return active.filter((p) => !voted.has(p.id)).length;
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
    // §29 — per-proposal vote summary (count + voter names) so the list shows "who voted / how many".
    const nameOf = await this.groupMemberNames(g.id);
    const allVotes = await this.prisma.groupVote.findMany({
      where: { proposalId: { in: fresh.map((p) => p.id) } },
      select: { proposalId: true, voterUserId: true, choice: true },
      orderBy: { createdAt: 'asc' },
    });
    // proposalId → (voterUserId → their choice(s)); a poll voter may pick several options.
    const byProposal = new Map<string, Map<string, string[]>>();
    for (const v of allVotes) {
      let m = byProposal.get(v.proposalId);
      if (!m) { m = new Map(); byProposal.set(v.proposalId, m); }
      const arr = m.get(v.voterUserId) ?? [];
      arr.push(v.choice);
      m.set(v.voterUserId, arr);
    }
    // §29 — per-proposal tally so the list shows YES% / threshold / passing without opening.
    // Decided proposals use their FROZEN snapshot (membership changes never rewrite history).
    // BULK proposals summarise as "N items · X passed" (once closed) instead of a single ratio.
    const metas = await Promise.all(fresh.map(async (p) => {
      if (p.type === 'BULK') {
        const bt = await this.resolveBulkTally(p);
        const passed = p.status !== 'ACTIVE' ? bt.items.filter((it) => it.approved).length : null;
        return { voted: bt.votedMembers, eligible: bt.eligible, result: null as null, bulk: { items: bt.items.length, passed } };
      }
      const tv = await this.resolveTally(p);
      return {
        voted: tv.voted,
        eligible: tv.eligible,
        result: tv.kind === 'THRESHOLD' ? { ratioPct: tv.ratioPct, thresholdPct: tv.thresholdPct, approved: tv.approved } : null,
        bulk: null as { items: number; passed: number | null } | null,
      };
    }));
    return {
      group: this.config(g),
      canSubmit,
      submitBlockedReason,
      proposals: fresh.map((p, i) => {
        const vmap = byProposal.get(p.id) ?? new Map<string, string[]>();
        const meta = metas[i];
        return {
          id: p.id, title: p.title, type: p.type, status: p.status,
          author: nameOf.get(p.authorUserId) ?? p.author.displayName ?? 'Member',
          votingEndAt: p.votingEndAt.toISOString(), createdAt: p.createdAt.toISOString(),
          // frozen for decided proposals (meta comes from the resolved tally), live while ACTIVE
          votedCount: meta.voted,
          eligible: meta.eligible,
          // BULK per-voter choices are per-item (shown in the detail), so the list omits the voter chips.
          voters: p.type === 'BULK' ? [] : [...vmap.entries()].map(([uid, choices]) => ({ voter: nameOf.get(uid) ?? 'Member', choice: choices.join('/') })),
          result: meta.result,
          bulk: meta.bulk,
        };
      }),
    };
  }

  /** §29 — map each group member's userId to their display name (group profile, then account, then "Member"). */
  private async groupMemberNames(groupId: string): Promise<Map<string, string>> {
    const members = await this.prisma.groupMember.findMany({
      where: { groupId },
      select: { userId: true, displayName: true, user: { select: { displayName: true } } },
    });
    return new Map(members.map((m) => [m.userId, m.displayName || m.user.displayName || 'Member']));
  }

  async getProposal(userId: string | null | undefined, id: string) {
    const p = await this.prisma.groupProposal.findUnique({ where: { id }, include: { group: true, author: { select: { displayName: true } } } });
    if (!p || p.group.status !== 'ACTIVE') throw new NotFoundException('proposal not found');
    await this.maybeFinalize(p);
    const fresh = await this.prisma.groupProposal.findUnique({ where: { id }, include: { group: true, author: { select: { displayName: true } } } });
    if (!fresh) throw new NotFoundException('proposal not found');
    const g = fresh.group as unknown as GroupRow;
    const isMember = !!userId && (await this.admittedMember(g.id, userId));
    const isBulk = fresh.type === 'BULK';
    const poll = fresh.pollOptions as { multiple?: boolean; options?: string[] } | null;
    // §29 — resolve voter names from their GROUP profile (account displayName is often empty for
    // non-council members), so the detail shows real names (e.g. "Ivan the OG") not "Member".
    const nameOf = await this.groupMemberNames(g.id);

    // Single-vote (INFORMATIVE/POLL/INSTRUCTIVE) tally + rationales; null/[] for BULK (per-item, see `bulk`).
    const tally = isBulk ? null : await this.resolveTally(fresh);
    let myVotes: string[] = [];
    let myRationale: string | null = null;
    let rationales: { voter: string; choice: string; rationale: string }[] = [];
    let voters: { voter: string; choice: string }[] = [];
    let bulk: BulkDetail | null = null;

    if (isBulk) {
      const bt = await this.resolveBulkTally(fresh);
      const items = this.bulkItemsOf(fresh);
      const rows = await this.prisma.groupVote.findMany({ where: { proposalId: id, NOT: { itemId: null } }, select: { voterUserId: true, itemId: true, choice: true, rationale: true }, orderBy: { createdAt: 'asc' } });
      const byItem = new Map<string, typeof rows>();
      for (const v of rows) { const a = byItem.get(v.itemId as string) ?? []; a.push(v); byItem.set(v.itemId as string, a); }
      const dt = fresh.decidedTally as { resultHash?: string } | null;
      bulk = {
        eligible: bt.eligible,
        votedMembers: bt.votedMembers,
        allVoted: bt.allVoted,
        allDecided: bt.allDecided,
        resultHash: fresh.status !== 'ACTIVE' && dt?.resultHash ? dt.resultHash : null,
        items: items.map((it) => {
          const ti = bt.items.find((x) => x.id === it.id) ?? null;
          const ivotes = byItem.get(it.id) ?? [];
          const mine = userId ? ivotes.find((r) => r.voterUserId === userId) : null;
          return {
            id: it.id,
            title: it.title,
            description: it.description,
            tally: ti ? { yes: ti.yes, no: ti.no, abstain: ti.abstain, eligible: ti.eligible, denominator: ti.denominator, ratioPct: ti.ratioPct, thresholdPct: ti.thresholdPct, approved: ti.approved, voted: ti.voted } : null,
            myChoice: mine?.choice ?? null,
            myRationale: mine?.rationale ?? null,
            voters: ivotes.map((r) => ({ voter: nameOf.get(r.voterUserId) ?? 'Member', choice: r.choice })),
            rationales: ivotes.filter((r) => r.rationale?.trim()).map((r) => ({ voter: nameOf.get(r.voterUserId) ?? 'Member', choice: r.choice, rationale: r.rationale as string })),
          };
        }),
      };
    } else {
      myVotes = userId
        ? (await this.prisma.groupVote.findMany({ where: { proposalId: id, voterUserId: userId }, select: { choice: true } })).map((v) => v.choice)
        : [];
      const rationaleRows = await this.prisma.groupVote.findMany({
        where: { proposalId: id, NOT: { rationale: null } },
        select: { voterUserId: true, choice: true, rationale: true },
        distinct: ['voterUserId'],
        orderBy: { createdAt: 'asc' },
      });
      rationales = rationaleRows
        .filter((r) => r.rationale?.trim())
        .map((r) => ({ voter: nameOf.get(r.voterUserId) ?? 'Member', choice: r.choice, rationale: r.rationale as string }));
      myRationale = userId
        ? (await this.prisma.groupVote.findFirst({ where: { proposalId: id, voterUserId: userId }, select: { rationale: true } }))?.rationale ?? null
        : null;
      const voterRows = await this.prisma.groupVote.findMany({
        where: { proposalId: id },
        select: { voterUserId: true, choice: true },
        orderBy: { createdAt: 'asc' },
      });
      voters = voterRows.map((v) => ({ voter: nameOf.get(v.voterUserId) ?? 'Member', choice: v.choice }));
    }
    // §29/§3 — the on-chain anchor of this group's decision, so the detail can link to the explorer.
    const anchorRow = await this.prisma.anchor.findFirst({ where: { kind: 'group', proposalId: id }, select: { txHash: true }, orderBy: { createdAt: 'desc' } });
    return {
      id: fresh.id,
      groupKey: g.key,
      groupName: g.name,
      title: fresh.title,
      contentMd: fresh.contentMd,
      type: fresh.type,
      status: fresh.status,
      author: nameOf.get(fresh.authorUserId) ?? fresh.author.displayName ?? 'Member',
      votingEndAt: fresh.votingEndAt.toISOString(),
      decidedAt: fresh.decidedAt?.toISOString() ?? null,
      createdAt: fresh.createdAt.toISOString(),
      poll: fresh.type === 'POLL' ? { multiple: !!poll?.multiple, options: poll?.options ?? [] } : null,
      bulk,
      actors: (fresh.actors as string[] | null) ?? null,
      deliveryDate: fresh.deliveryDate?.toISOString() ?? null,
      canVote: isMember && fresh.status === 'ACTIVE',
      canCloseEarly: isBulk && isMember && fresh.status === 'ACTIVE' && !!bulk?.allDecided,
      canDiscard: isMember && fresh.status === 'ACTIVE', // §29 — discard before voting ends (any type)
      resultAvailable: isBulk && fresh.status !== 'ACTIVE',
      myVotes,
      myRationale,
      rationales,
      voters,
      canComment: await this.canComment(userId, g),
      canModerate: await this.canManageMembers(userId, g),
      comments: await this.loadComments(id, userId, g),
      docHash: this.groupDocHash(fresh),
      anchorTxHash: anchorRow?.txHash ?? null,
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
    // §29 BULK — several sub-proposals in one; each item gets a stable id so per-item votes can reference it.
    let bulkItems: { id: string; title: string; description: string }[] | undefined;
    if (dto.type === 'BULK') {
      const items = (dto.bulkItems ?? [])
        .map((it) => ({ title: (it?.title ?? '').trim(), description: (it?.description ?? '').trim() }))
        .filter((it) => it.title);
      if (items.length < 2) throw new BadRequestException('a bulk proposal needs at least two items (each with a title)');
      bulkItems = items.map((it) => ({ id: randomUUID(), title: it.title.slice(0, 300), description: it.description.slice(0, 4000) }));
    }
    const instructive = dto.type === 'INSTRUCTIVE';
    const p = await this.prisma.groupProposal.create({
      data: {
        groupId: g.id, authorUserId: userId, title: dto.title.trim(), contentMd: dto.contentMd,
        type: dto.type, pollOptions: pollOptions ?? undefined, bulkItems: bulkItems ?? undefined, status: 'ACTIVE', votingEndAt: end,
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
    // §29 BULK — one vote per item; the ballot may cover any subset of items (re-vote replaces that item).
    if (fresh.type === 'BULK') {
      const items = this.bulkItemsOf(fresh);
      const ids = new Set(items.map((i) => i.id));
      const ballot = dto.items ?? [];
      if (ballot.length === 0) throw new BadRequestException('no votes to record');
      for (const b of ballot) {
        if (!ids.has(b.itemId)) throw new BadRequestException(`unknown item: ${b.itemId}`);
        if (!['YES', 'NO', 'ABSTAIN'].includes(b.choice)) throw new BadRequestException('each item choice must be YES, NO or ABSTAIN');
      }
      // Replace only the items included in this ballot (per-item, so a member can vote row by row).
      const touched = ballot.map((b) => b.itemId);
      await this.prisma.groupVote.deleteMany({ where: { proposalId, voterUserId: userId, itemId: { in: touched } } });
      await this.prisma.groupVote.createMany({
        data: ballot.map((b) => ({ proposalId, voterUserId: userId, itemId: b.itemId, choice: b.choice, rationale: b.rationale?.trim() || null })),
      });
      return this.getProposal(userId, proposalId);
    }
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
    return this.tallyWith(p, await this.admittedMemberIds(p.groupId));
  }

  /** §29 — the LIVE tally against a given eligible-member set. `tally()` passes the group's current
   *  members; at finalization the result is frozen into `decidedTally` so later membership changes
   *  (a new OG member joining) can never alter a closed proposal's outcome. */
  private async tallyWith(p: { id: string; groupId: string; type: string; pollOptions: unknown }, memberIds: Set<string>) {
    const group = await this.prisma.group.findUnique({ where: { id: p.groupId }, select: { thresholdPct: true } });
    const thresholdPct = group?.thresholdPct ?? 67;
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

  /** §29 — members admitted as of `at` (and not yet removed): the eligible set at decision time,
   *  used to reconstruct the frozen tally for proposals that were decided before it was stored. */
  private async admittedMemberIdsAsOf(groupId: string, at: Date): Promise<Set<string>> {
    const rows = await this.prisma.groupMember.findMany({
      where: { groupId, admittedAt: { lte: at }, OR: [{ removedAt: null }, { removedAt: { gt: at } }] },
      select: { userId: true },
    });
    return new Set(rows.map((r) => r.userId));
  }

  /** §29 — the tally to DISPLAY: the FROZEN snapshot for a decided proposal (so a later membership
   *  change never rewrites a closed proposal's result), or the live tally while still ACTIVE. */
  private async resolveTally(p: { id: string; groupId: string; type: string; pollOptions: unknown; status: string; decidedTally: unknown }): Promise<Awaited<ReturnType<GroupsService['tallyWith']>>> {
    if (p.status !== 'ACTIVE' && p.decidedTally) return p.decidedTally as Awaited<ReturnType<GroupsService['tallyWith']>>;
    return this.tally(p);
  }

  // ── §29 BULK — several sub-proposals voted on together (one YES/NO/ABSTAIN per item) ──────────
  private bulkItemsOf(p: { bulkItems: unknown }): { id: string; title: string; description: string }[] {
    const arr = (p.bulkItems as { id?: string; title?: string; description?: string }[] | null) ?? [];
    return arr.map((x) => ({ id: String(x.id ?? ''), title: String(x.title ?? ''), description: String(x.description ?? '') }));
  }

  /** §29 BULK — per-item tally (each item scored like an INFORMATIVE proposal: pass at ≥ threshold YES,
   *  denominator = eligible − abstainers) against a given eligible-member set. */
  private async bulkTally(p: { id: string; groupId: string; bulkItems: unknown }, memberIds: Set<string>): Promise<BulkTally> {
    const group = await this.prisma.group.findUnique({ where: { id: p.groupId }, select: { thresholdPct: true } });
    const thresholdPct = group?.thresholdPct ?? 67;
    const eligible = memberIds.size;
    const items = this.bulkItemsOf(p);
    const votes = (await this.prisma.groupVote.findMany({ where: { proposalId: p.id } })).filter((v) => v.itemId && memberIds.has(v.voterUserId));
    const byItem = new Map<string, Map<string, string>>(); // itemId → (voterId → choice)
    for (const v of votes) {
      let m = byItem.get(v.itemId as string);
      if (!m) { m = new Map(); byItem.set(v.itemId as string, m); }
      m.set(v.voterUserId, v.choice);
    }
    const itemTallies = items.map((it) => {
      const m = byItem.get(it.id) ?? new Map<string, string>();
      let yes = 0, no = 0, abstain = 0;
      for (const uid of memberIds) {
        const c = m.get(uid);
        if (c === 'YES') yes++; else if (c === 'NO') no++; else if (c === 'ABSTAIN') abstain++;
      }
      const voted = yes + no + abstain;
      const notVoted = eligible - voted;
      const denominator = Math.max(0, eligible - abstain);
      const ratioPct = denominator > 0 ? Math.round((yes / denominator) * 1000) / 10 : 0;
      // §29 BULK — the item's outcome is "decided" (can no longer flip) when everyone has voted, or when
      // the already-cast votes fix it whatever the rest do: even if every remaining member voted NO the
      // YES ratio still meets the threshold (locked pass), or even if they all voted YES it still can't
      // (locked fail). Compared with integers to avoid the rounding used for display. Abstaining only
      // shrinks the denominator (raising the ratio), so all-NO is the true worst case for a pass.
      let decided: boolean;
      if (notVoted === 0 || denominator === 0) decided = true;
      else decided = yes * 100 >= thresholdPct * denominator || (yes + notVoted) * 100 < thresholdPct * denominator;
      return { id: it.id, yes, no, abstain, eligible, denominator, ratioPct, thresholdPct, approved: ratioPct >= thresholdPct, voted, decided };
    });
    let votedMembers = 0;
    for (const uid of memberIds) {
      if (items.length > 0 && items.every((it) => byItem.get(it.id)?.has(uid))) votedMembers++;
    }
    const allVoted = eligible > 0 && items.length > 0 && votedMembers >= eligible;
    const allDecided = eligible > 0 && items.length > 0 && itemTallies.every((it) => it.decided);
    return { kind: 'BULK', eligible, votedMembers, allVoted, allDecided, items: itemTallies };
  }

  /** §29 BULK — frozen per-item tally for a decided proposal, else the live tally. */
  private async resolveBulkTally(p: { id: string; groupId: string; bulkItems: unknown; status: string; decidedTally: unknown }): Promise<BulkTally> {
    if (p.status !== 'ACTIVE' && p.decidedTally) return p.decidedTally as BulkTally;
    return this.bulkTally(p, await this.admittedMemberIds(p.groupId));
  }

  /** §29 BULK — build the canonical result document (per-item votes + tally) + its stable pretty-printed
   *  string and SHA-256. The string is what gets downloaded and hashed, so the on-chain hash, the stored
   *  copy and the downloadable file are byte-identical and re-verifiable. */
  private async composeBulkResult(p: { id: string; groupId: string; title: string; contentMd: string; bulkItems: unknown; createdAt: Date; votingEndAt: Date; decidedAt: Date | null; group: { key: string; name: string } }, tally: BulkTally, memberIds: Set<string>) {
    const nameOf = await this.groupMemberNames(p.groupId);
    const items = this.bulkItemsOf(p);
    const voteRows = await this.prisma.groupVote.findMany({ where: { proposalId: p.id, NOT: { itemId: null } }, select: { voterUserId: true, itemId: true, choice: true, rationale: true }, orderBy: { createdAt: 'asc' } });
    const byItem = new Map<string, typeof voteRows>();
    for (const v of voteRows) { const a = byItem.get(v.itemId as string) ?? []; a.push(v); byItem.set(v.itemId as string, a); }
    // Every eligible member appears under each item (sorted by name); a member who did not cast a vote
    // on an item is recorded as "Not voted". Deterministic order keeps the JSON (and its hash) stable.
    const eligibleSorted = [...memberIds].map((uid) => ({ uid, name: nameOf.get(uid) ?? 'Member' })).sort((a, b) => a.name.localeCompare(b.name));
    const itemsPassed = tally.items.filter((x) => x.approved).length;
    const doc = {
      group: { key: p.group.key, name: p.group.name },
      proposal: { id: p.id, title: p.title, description: p.contentMd, createdAt: p.createdAt.toISOString(), votingEndAt: p.votingEndAt.toISOString(), closedAt: p.decidedAt?.toISOString() ?? new Date().toISOString() },
      thresholdPct: tally.items[0]?.thresholdPct ?? null,
      // The bulk proposal has no single approved/rejected outcome — the result is the summary of item outcomes.
      summary: { itemsTotal: items.length, itemsPassed, itemsFailed: items.length - itemsPassed },
      eligibleMembers: eligibleSorted.map((m) => m.name),
      items: items.map((it) => {
        const ti = tally.items.find((x) => x.id === it.id);
        const byUid = new Map((byItem.get(it.id) ?? []).map((r) => [r.voterUserId, r]));
        return {
          title: it.title,
          description: it.description,
          result: ti ? { yes: ti.yes, no: ti.no, abstain: ti.abstain, ratioPct: ti.ratioPct, thresholdPct: ti.thresholdPct, approved: ti.approved } : null,
          votes: eligibleSorted.map(({ uid, name }) => {
            const r = byUid.get(uid);
            if (!r) return { voter: name, choice: 'Not voted' };
            return { voter: name, choice: r.choice, ...(r.rationale?.trim() ? { rationale: r.rationale } : {}) };
          }),
        };
      }),
    };
    const json = JSON.stringify(doc, null, 2);
    const hash = createHash('sha256').update(json).digest('hex');
    return { doc, json, hash };
  }

  /** §29 — one-off: freeze the tally of proposals decided before `decidedTally` existed, using the
   *  membership as it was at their decision time. Idempotent — skips proposals already frozen. */
  async backfillDecidedTallies(): Promise<number> {
    const decided = await this.prisma.groupProposal.findMany({ where: { status: { in: ['PASSED', 'FAILED', 'CLOSED'] } } });
    let n = 0;
    for (const p of decided) {
      if (p.decidedTally) continue;
      const at = p.decidedAt ?? p.votingEndAt;
      const t = await this.tallyWith(p, await this.admittedMemberIdsAsOf(p.groupId, at));
      await this.prisma.groupProposal.update({ where: { id: p.id }, data: { decidedTally: t as unknown as object } });
      n++;
    }
    return n;
  }

  private async maybeFinalize(p: { id: string; status: string; votingEndAt: Date; type: string; groupId: string; pollOptions: unknown; bulkItems?: unknown }) {
    if (p.status !== 'ACTIVE' || p.votingEndAt.getTime() > Date.now()) return;
    // §29 BULK — freeze the per-item tally + the exact result JSON/hash, then anchor the hash on-chain.
    if (p.type === 'BULK') {
      const memberIds = await this.admittedMemberIds(p.groupId);
      const tally = await this.bulkTally({ id: p.id, groupId: p.groupId, bulkItems: p.bulkItems }, memberIds);
      const full = await this.prisma.groupProposal.findUnique({ where: { id: p.id }, include: { group: true } });
      if (!full) return;
      const { doc, json, hash } = await this.composeBulkResult(full, tally, memberIds);
      const decided = { ...tally, resultJson: json, resultHash: hash };
      const res = await this.prisma.groupProposal.updateMany({ where: { id: p.id, status: 'ACTIVE' }, data: { status: 'CLOSED', decidedAt: new Date(), decidedTally: decided as unknown as object } });
      if (res.count === 1) await this.anchorBulkResult(full, doc, hash).catch(() => undefined);
      return;
    }
    const t = await this.tally(p);
    const status = p.type === 'POLL' ? 'CLOSED' : t.kind === 'THRESHOLD' && t.approved ? 'PASSED' : 'FAILED';
    // Atomic: only the first finalizer (count === 1) anchors, so concurrent views can't double-anchor.
    const res = await this.prisma.groupProposal.updateMany({ where: { id: p.id, status: 'ACTIVE' }, data: { status, decidedAt: new Date(), decidedTally: t as unknown as object } });
    if (res.count === 1) await this.anchorGroupResult(p.id, status).catch(() => undefined); // anchoring never blocks finalization
  }

  /** §29/§3 — the canonical document hash of a group proposal: SHA-256 of its `title\ncontent`.
   *  The detail view shows this SAME value so anyone can confirm it matches the on-chain anchor. */
  private groupDocHash(p: { title: string; contentMd: string }): string {
    return createHash('sha256').update(`${p.title}\n${p.contentMd}`).digest('hex');
  }

  /** §29/§3 — anchor a finalized group proposal on-chain (pending until a board member submits it).
   *  The self-describing JSON carries the GROUP identity (key + name) + every member's vote + the tally,
   *  so anyone can verify which group decided what. Never throws (anchoring must not block finalization). */
  private async anchorGroupResult(proposalId: string, outcome: string) {
    const p = await this.prisma.groupProposal.findUnique({ where: { id: proposalId }, include: { group: true } });
    if (!p) return;
    const t = await this.tally(p);
    const nameOf = await this.groupMemberNames(p.groupId);
    const voteRows = await this.prisma.groupVote.findMany({ where: { proposalId }, select: { voterUserId: true, choice: true, rationale: true }, orderBy: { createdAt: 'asc' } });
    await this.anchor.anchorResult({
      kind: GovSubject.GROUP,
      subject: GovSubject.GROUP,
      style: VotingStyle.ONE_PERSON_ONE_VOTE, // OG groups are strictly 1 member = 1 vote
      ref: p.title,
      proposalId: p.id,
      publicId: `${p.group.key.toUpperCase()} · ${p.title}`,
      docHash: this.groupDocHash(p),
      votes: voteRows.map((v) => ({ drep: nameOf.get(v.voterUserId) ?? 'Member', vote: v.choice })),
      outcome,
      yes: t.kind === 'THRESHOLD' ? t.yes : 0,
      no: t.kind === 'THRESHOLD' ? t.no : 0,
      threshold: t.kind === 'THRESHOLD' ? t.thresholdPct : 0,
      group: { key: p.group.key, name: p.group.name },
      preimageVotes: voteRows.map((v) => ({ voter: nameOf.get(v.voterUserId) ?? 'Member', choice: v.choice, ...(v.rationale ? { rationale: v.rationale } : {}) })),
    });
  }

  /** §29 BULK — anchor a closed bulk proposal: the SHA-256 of the per-item result JSON goes on-chain
   *  (self-describing GROUP metadata: group + title + "X/Y items passed" + proofHash); the full JSON is
   *  kept as the anchor preimage and served as a download. Never throws. */
  private async anchorBulkResult(p: { id: string }, doc: object, hash: string) {
    await this.anchor.anchorGroupBulk({ proposalRowId: p.id, doc, hash });
  }

  /** §29 BULK — a member closes voting early once EVERY member has voted on EVERY item. Freezes + anchors. */
  async closeEarly(userId: string, proposalId: string) {
    const p = await this.prisma.groupProposal.findUnique({ where: { id: proposalId }, include: { group: true } });
    if (!p || p.group.status !== 'ACTIVE') throw new NotFoundException('proposal not found');
    if (p.type !== 'BULK') throw new BadRequestException('only bulk proposals can be closed early');
    if (p.status !== 'ACTIVE') throw new ConflictException('this proposal is already closed');
    if (!(await this.admittedMember(p.groupId, userId))) throw new ForbiddenException('only admitted members can close a proposal');
    const tally = await this.bulkTally(p, await this.admittedMemberIds(p.groupId));
    if (!tally.allDecided) throw new BadRequestException('the result is not final yet — every member must vote, or there must be enough votes that the remaining members cannot change any item’s outcome');
    await this.prisma.groupProposal.update({ where: { id: proposalId }, data: { votingEndAt: new Date() } });
    const fresh = await this.prisma.groupProposal.findUnique({ where: { id: proposalId } });
    if (fresh) await this.maybeFinalize(fresh);
    return this.getProposal(userId, proposalId);
  }

  /** §29 — an admitted member discards an ACTIVE proposal before voting ends. It is NOT deleted: it stays
   *  in the list with status DISCARDED (no outcome, not anchored). Any proposal type. */
  async discardProposal(userId: string, proposalId: string) {
    const p = await this.prisma.groupProposal.findUnique({ where: { id: proposalId }, include: { group: true } });
    if (!p || p.group.status !== 'ACTIVE') throw new NotFoundException('proposal not found');
    if (!(await this.admittedMember(p.groupId, userId))) throw new ForbiddenException('only admitted members can discard a proposal');
    if (p.status !== 'ACTIVE') throw new ConflictException('only an active proposal can be discarded');
    await this.prisma.groupProposal.update({ where: { id: proposalId }, data: { status: 'DISCARDED', decidedAt: new Date() } });
    return this.getProposal(userId, proposalId);
  }

  /** §29 BULK — the frozen result JSON + its SHA-256 for the download (available once voting closed). */
  async bulkResult(proposalId: string): Promise<{ base: string; json: string; hash: string; title: string; groupName: string; txHash: string | null; explorerUrl: string | null }> {
    const p = await this.prisma.groupProposal.findUnique({ where: { id: proposalId }, include: { group: true } });
    if (!p || p.group.status !== 'ACTIVE') throw new NotFoundException('proposal not found');
    if (p.type !== 'BULK') throw new BadRequestException('not a bulk proposal');
    await this.maybeFinalize(p);
    const fresh = await this.prisma.groupProposal.findUnique({ where: { id: proposalId } });
    const dt = fresh?.decidedTally as (BulkTally & { resultJson?: string; resultHash?: string }) | null;
    if (!fresh || fresh.status === 'ACTIVE' || !dt?.resultJson || !dt?.resultHash) throw new BadRequestException('results are available once voting has closed');
    // The on-chain anchor tx (may still be null/pending until the sweep submits it).
    const anchorRow = await this.prisma.anchor.findFirst({ where: { kind: 'group', proposalId }, select: { txHash: true }, orderBy: { createdAt: 'desc' } });
    const txHash = anchorRow?.txHash ?? null;
    return {
      base: `${p.group.key}-bulk-${proposalId.slice(0, 8)}`,
      json: dt.resultJson,
      hash: dt.resultHash,
      title: p.title,
      groupName: p.group.name,
      txHash,
      explorerUrl: txHash ? await this.explorerTxUrl(txHash) : null,
    };
  }

  /** §29 — finalize + anchor every group proposal whose voting has ended but is still ACTIVE.
   *  Run periodically (jobs) so results are anchored even if no one opened the proposal. Returns how many. */
  async finalizeDueProposals(): Promise<number> {
    const due = await this.prisma.groupProposal.findMany({
      where: { status: 'ACTIVE', votingEndAt: { lte: new Date() } },
      select: { id: true, status: true, votingEndAt: true, type: true, groupId: true, pollOptions: true, bulkItems: true },
    });
    for (const p of due) await this.maybeFinalize(p).catch(() => undefined);
    await this.backfillDecidedAnchors().catch(() => undefined);
    await this.backfillDecidedTallies().catch(() => undefined);
    return due.length;
  }

  /** §29 — anchor already-decided group proposals that have no on-chain anchor yet (e.g. they were
   *  decided before anchoring existed). Idempotent — skips proposals that already have a 'group' anchor. */
  private async backfillDecidedAnchors(): Promise<void> {
    const decided = await this.prisma.groupProposal.findMany({
      where: { status: { in: ['PASSED', 'FAILED', 'CLOSED'] } },
      select: { id: true, status: true },
    });
    for (const p of decided) {
      const has = await this.prisma.anchor.count({ where: { kind: 'group', proposalId: p.id } });
      if (has === 0) await this.anchorGroupResult(p.id, p.status).catch(() => undefined);
    }
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
