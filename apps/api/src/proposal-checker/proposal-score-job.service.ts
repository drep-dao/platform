import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ProposalCheckerService } from './proposal-checker.service';

// Ticks often; runCheck() self-gates to the board-configured interval (default 24h), so a due check
// fires within one tick of becoming due. Disabled in tests/CLI like the other job services.
const TICK_MS = 30 * 60_000;
// Public pay-to-scan fee verification — a user's payment should unlock the scan within ~30s.
const FEE_TICK_MS = 30_000;

@Injectable()
export class ProposalScoreJobService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProposalScoreJobService.name);
  private timer: NodeJS.Timeout | null = null;
  private feeTimer: NodeJS.Timeout | null = null;
  constructor(private readonly svc: ProposalCheckerService) {}

  onModuleInit() {
    if (process.env.JOBS_DISABLED === '1') return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
    // A first tick shortly after boot (not immediately) so startup isn't slowed.
    setTimeout(() => void this.tick(), 60_000).unref?.();
    // Fast poller: verify pending public-scan payments so SCAN unlocks promptly.
    this.feeTimer = setInterval(() => void this.feeTick(), FEE_TICK_MS);
    this.feeTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.feeTimer) clearInterval(this.feeTimer);
  }

  private async feeTick() {
    try {
      const paid = await this.svc.pollPublicScanPayments();
      if (paid) this.logger.log(`public-scan: ${paid} payment(s) confirmed`);
    } catch (e) {
      this.logger.warn(`public-scan fee tick failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  private async tick() {
    try {
      const r = await this.svc.runCheck({ force: false });
      if (r.ran && (r.scored.length || r.errors.length)) {
        this.logger.log(`auto-score: ${r.scored.length} scored, ${r.errors.length} errors${r.reason ? ` (${r.reason})` : ''}`);
      }
    } catch (e) {
      this.logger.warn(`auto-score tick failed: ${e instanceof Error ? e.message : e}`);
    }
  }
}
