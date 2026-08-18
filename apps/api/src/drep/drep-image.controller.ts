import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CardanoQueryService } from '../cardano/cardano-query.service';

/**
 * §2.1 — public DRep-image proxy. On-chain CIP-119 images live on arbitrary hosts
 * (googleusercontent, github, cloudinary, ipfs, …). Rather than hotlink them — which
 * leaks every viewer's IP to those hosts and breaks when a host is slow/down — the
 * platform downloads each image once, caches the bytes, and serves them from its own
 * origin. Bounded in-memory cache; only real image content-types under a size cap are
 * served; any failure is a 404 so the frontend falls back to an initials avatar.
 */
@Controller('public')
export class DrepImageController {
  private readonly cache = new Map<string, { buf: Buffer; type: string; exp: number }>();
  private readonly TTL_MS = 6 * 60 * 60 * 1000;
  private readonly MAX_BYTES = 3 * 1024 * 1024;
  private readonly MAX_ENTRIES = 1000;

  constructor(private readonly cardano: CardanoQueryService) {}

  @Get('drep-image/:drepId')
  async image(@Param('drepId') drepId: string, @Res() res: Response): Promise<void> {
    const now = Date.now();
    const hit = this.cache.get(drepId);
    if (hit && hit.exp > now) { this.serve(res, hit.buf, hit.type); return; }

    // Resolve the DRep's on-chain image URL (normalized: ImageObject.contentUrl, ipfs→gateway).
    let url: string | undefined;
    try { url = (await this.cardano.drepMetadata([drepId])).get(drepId)?.image; } catch { /* down → 404 */ }
    if (!url || !/^https?:\/\//i.test(url)) { res.status(404).end(); return; }

    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10000), redirect: 'follow' });
      const type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!r.ok || !type.startsWith('image/')) { res.status(404).end(); return; }
      const ab = await r.arrayBuffer();
      if (ab.byteLength === 0 || ab.byteLength > this.MAX_BYTES) { res.status(404).end(); return; }
      const buf = Buffer.from(ab);
      if (this.cache.size >= this.MAX_ENTRIES) { const k = this.cache.keys().next().value; if (k) this.cache.delete(k); }
      this.cache.set(drepId, { buf, type, exp: now + this.TTL_MS });
      this.serve(res, buf, type);
    } catch { res.status(404).end(); }
  }

  private serve(res: Response, buf: Buffer, type: string): void {
    res.set('Content-Type', type);
    res.set('Cache-Control', 'public, max-age=21600');
    res.send(buf);
  }
}
