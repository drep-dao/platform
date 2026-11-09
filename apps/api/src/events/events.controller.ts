import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BoardGuard } from '../auth/board.guard';
import { EventsService } from './events.service';
import { CreateEventDto } from './dto';

// §events — landing-page events. `upcoming` is public (shown on the landing); scheduling is board-only.
@Controller('events')
export class EventsController {
  constructor(private readonly svc: EventsService) {}

  @Get('upcoming')
  upcoming() {
    return this.svc.upcoming();
  }

  // Public: one event by id — used by the share-link card unfurl.
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getOne(id);
  }

  @Get()
  @UseGuards(JwtAuthGuard, BoardGuard)
  list() {
    return this.svc.listAll();
  }

  @Post()
  @UseGuards(JwtAuthGuard, BoardGuard)
  create(@Body() dto: CreateEventDto) {
    return this.svc.create(dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, BoardGuard)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(id);
  }
}
