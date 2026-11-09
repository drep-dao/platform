import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEventDto } from './dto';

type EventRow = { id: string; title: string; description: string; url: string; startAt: Date; endAt: Date };

/** §events — landing-page events (a scheduled call). The landing shows events whose endAt is still in
 *  the future (so a live event stays joinable until it ends); board members schedule/remove them. */
@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  private view(e: EventRow) {
    return { id: e.id, title: e.title, description: e.description, url: e.url, startAt: e.startAt.toISOString(), endAt: e.endAt.toISOString() };
  }

  /** Public: events that have not yet ended, soonest first. */
  async upcoming() {
    const rows = await this.prisma.scheduledEvent.findMany({ where: { endAt: { gt: new Date() } }, orderBy: { startAt: 'asc' } });
    return rows.map((e) => this.view(e));
  }

  /** Board: every scheduled event (incl. past) for the admin list. */
  async listAll() {
    const rows = await this.prisma.scheduledEvent.findMany({ orderBy: { startAt: 'desc' } });
    return rows.map((e) => this.view(e));
  }

  async create(dto: CreateEventDto) {
    const start = new Date(dto.startAt);
    const end = new Date(dto.endAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new BadRequestException('invalid start/end time');
    if (end.getTime() <= start.getTime()) throw new BadRequestException('the end time must be after the start time');
    const url = dto.url.trim();
    if (!/^https?:\/\//i.test(url)) throw new BadRequestException('enter a valid http(s) link');
    const ev = await this.prisma.scheduledEvent.create({
      data: { title: dto.title.trim(), description: (dto.description ?? '').trim(), url, startAt: start, endAt: end },
    });
    return this.view(ev);
  }

  async remove(id: string) {
    await this.prisma.scheduledEvent.delete({ where: { id } }).catch(() => undefined); // idempotent
    return { ok: true };
  }
}
