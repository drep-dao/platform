import { Injectable } from '@nestjs/common';
import { Prisma } from '@drep-dao/db';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from './email.service';

/**
 * §20.3 — in-app notification feed. The §27 background jobs write rows here (pledge grace
 * expiry, fee/pledge seen on-chain, overdue stage windows, reconciliation mismatches,
 * milestone/delivery reminders); users read them via the bell in the login card.
 * Dedupe: one row per (user, kind, refId) — jobs can safely re-run.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  /** Create one notification per user, skipping users who already have (kind, refId). Also sends an
   *  email to each user who has email notifications on (default) + a contact email, best-effort. */
  async notifyUsers(userIds: string[], kind: string, refId: string, payload: Record<string, unknown>) {
    let created = 0;
    for (const userId of new Set(userIds)) {
      const dup = await this.prisma.notification.findFirst({
        where: { userId, kind, payload: { path: ['refId'], equals: refId } },
        select: { id: true },
      });
      if (dup) continue;
      const channels = ['inapp'];
      if (await this.tryEmail(userId, kind, payload)) channels.push('email');
      await this.prisma.notification.create({
        data: { userId, kind, payload: { refId, ...payload } as Prisma.InputJsonValue, channelsSent: channels },
      });
      created++;
    }
    return created;
  }

  /** §20.3 — email a user about a notification, unless they've turned email off. Never throws. */
  private async tryEmail(userId: string, kind: string, payload: Record<string, unknown>): Promise<boolean> {
    try {
      const pref = await this.prisma.notificationPreference.findUnique({ where: { userId } });
      if (pref && pref.email === false) return false; // explicitly opted out (default is on)
      const to = pref?.emailAddr?.trim() || (await this.resolveProfileEmail(userId));
      if (!to) return false;
      const title = typeof payload.title === 'string' && payload.title ? payload.title : 'You have a new notification';
      const site = this.email.siteUrl();
      const res = await this.email.send({
        to,
        subject: `DRep Council — ${title}`,
        text: `${title}\n\nOpen the DRep Council platform: ${site}\n\n— You are receiving this because email notifications are on for your account. You can turn them off in your notification settings.`,
      });
      return res.sent;
    } catch {
      return false;
    }
  }

  /** A user's best contact email: their notification override, else DRep / submitter / expert profile email. */
  private async resolveProfileEmail(userId: string): Promise<string> {
    const drep = await this.prisma.drep.findUnique({ where: { userId }, select: { contact: true } });
    const drepEmail = (drep?.contact as { email?: string } | null)?.email?.trim();
    if (drepEmail) return drepEmail;
    const sub = await this.prisma.submitterApplication.findFirst({ where: { userId }, select: { email: true }, orderBy: { createdAt: 'desc' } });
    if (sub?.email?.trim()) return sub.email.trim();
    const exp = await this.prisma.expert.findFirst({ where: { userId }, select: { email: true } });
    if (exp?.email?.trim()) return exp.email.trim();
    return '';
  }

  /** A user's notification preferences (email on/off + the address emails would go to). */
  async getPreferences(userId: string) {
    const pref = await this.prisma.notificationPreference.findUnique({ where: { userId } });
    const profileEmail = await this.resolveProfileEmail(userId);
    return {
      email: pref ? pref.email : true, // default on
      emailAddr: pref?.emailAddr ?? null,
      // where emails actually go (override, else the profile email); null if we have no email for them.
      effectiveEmail: (pref?.emailAddr?.trim() || profileEmail) || null,
    };
  }

  /** Update a user's email-notification toggle (and optional override address). */
  async setPreferences(userId: string, dto: { email?: boolean; emailAddr?: string | null }) {
    const emailAddr = dto.emailAddr === undefined ? undefined : (dto.emailAddr?.trim() || null);
    await this.prisma.notificationPreference.upsert({
      where: { userId },
      update: { ...(dto.email !== undefined ? { email: dto.email } : {}), ...(emailAddr !== undefined ? { emailAddr } : {}) },
      create: { userId, email: dto.email ?? true, emailAddr: emailAddr ?? null },
    });
    return this.getPreferences(userId);
  }

  /** Notify every active board member. */
  async notifyBoard(kind: string, refId: string, payload: Record<string, unknown>) {
    const seats = await this.prisma.boardSeat.findMany({ where: { removedAt: null }, select: { drepKeyHash: true } });
    const users = await this.prisma.appUser.findMany({
      where: { drepKeyHash: { in: seats.map((s) => s.drepKeyHash) } },
      select: { id: true },
    });
    return this.notifyUsers(users.map((u) => u.id), kind, refId, payload);
  }

  async listMine(userId: string, limit = 50) {
    const rows = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((n) => ({
      id: n.id,
      kind: n.kind,
      payload: n.payload as Record<string, unknown>,
      readAt: n.readAt,
      createdAt: n.createdAt,
    }));
  }

  async unreadCount(userId: string) {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  async markRead(userId: string, id: string) {
    await this.prisma.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  }
}
