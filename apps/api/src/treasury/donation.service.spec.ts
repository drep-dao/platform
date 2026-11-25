import { describe, it, expect } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { DonationService } from './donation.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { CardanoQueryService } from '../cardano/cardano-query.service';
import type { TreasuryService } from './treasury.service';

/** A service with stub deps; `treasuryAddress` controls what resolveTreasuryAddress returns. */
function svc(treasuryAddress: string | null = 'addr_test1wq_fake') {
  const prisma = {} as PrismaService;
  const cardano = {} as CardanoQueryService;
  const treasury = { resolveTreasuryAddress: async () => treasuryAddress } as unknown as TreasuryService;
  return new DonationService(prisma, cardano, treasury);
}

const base = { changeAddressHex: 'aa', utxosHex: ['bb'] };

describe('DonationService.prepare — input validation (before any DB/chain call)', () => {
  it('rejects a donation below 1 ADA', async () => {
    await expect(svc().prepare({ ...base, amountAda: 0.5 })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('rejects a non-numeric amount', async () => {
    await expect(svc().prepare({ ...base, amountAda: NaN })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('rejects when the wallet sent no UTxOs', async () => {
    await expect(svc().prepare({ ...base, utxosHex: [], amountAda: 5 })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('rejects when the wallet sent no change address', async () => {
    await expect(svc().prepare({ ...base, changeAddressHex: '', amountAda: 5 })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('rejects (ConflictException) when no treasury address is configured', async () => {
    await expect(svc(null).prepare({ ...base, amountAda: 5 })).rejects.toBeInstanceOf(ConflictException);
  });
});
