import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import * as CSL from '@emurgo/cardano-serialization-lib-nodejs';
import { cip20MessageChunks, CIP20_MESSAGE_LABEL } from '@drep-dao/cardano';
import { PrismaService } from '../prisma/prisma.service';
import { CardanoQueryService } from '../cardano/cardano-query.service';
import { TreasuryService } from './treasury.service';

const LOVELACE = 1_000_000;

/**
 * Public treasury donations. Anyone connects a wallet and sends ADA to the Council's multisig —
 * no login, no board role. Two phases, so the donor's wallet does the only signing:
 *
 *   1. prepare()  — the platform builds the UNSIGNED tx (donor's UTxOs → treasury output + change,
 *                   with the optional comment as CIP-20 label-674 metadata), caches it, and returns
 *                   the tx CBOR. The donor's wallet signs it (CIP-30 signTx, full sign — they own
 *                   every input).
 *   2. submit()   — the platform attaches the donor's witness to the cached body + metadata,
 *                   submits via Koios, and records the on-chain tx hash. The comment then shows
 *                   against the incoming tx in the treasury history (and natively in any explorer).
 *
 * The donor pays the network fee; nothing leaves the DAO here (funds come IN), so there is no
 * multisig threshold to satisfy.
 */
@Injectable()
export class DonationService {
  private readonly logger = new Logger(DonationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cardano: CardanoQueryService,
    private readonly treasury: TreasuryService,
  ) {}

  /** Build the unsigned donation tx from the donor's wallet UTxOs + change address. */
  async prepare(dto: { amountAda: number; comment?: string; changeAddressHex: string; utxosHex: string[] }) {
    // Cheap input checks first (defence in depth behind the DTO), before any DB / chain call.
    if (!Number.isFinite(dto.amountAda)) throw new BadRequestException('the donation amount is not a number');
    const amountLovelace = BigInt(Math.round(dto.amountAda * LOVELACE));
    if (amountLovelace < BigInt(LOVELACE)) throw new BadRequestException('the minimum donation is 1 ADA');
    if (!dto.utxosHex?.length) throw new BadRequestException('your wallet returned no spendable UTxOs');
    if (!dto.changeAddressHex) throw new BadRequestException('your wallet returned no change address');

    const toAddressBech32 = await this.treasury.resolveTreasuryAddress();
    if (!toAddressBech32) {
      throw new ConflictException('the treasury address is not configured yet — donations are not open');
    }

    let changeAddr: CSL.Address;
    try { changeAddr = CSL.Address.from_bytes(Buffer.from(dto.changeAddressHex, 'hex')); }
    catch { throw new BadRequestException('the wallet change address is not a valid Cardano address'); }

    const toAddr = CSL.Address.from_bech32(toAddressBech32);
    const pp = await this.cardano.epochParams();
    const txb = CSL.TransactionBuilder.new(this.builderCfg(pp));

    // CIP-20 (label 674) comment metadata — set BEFORE build so the body's auxiliary-data hash (and
    // thus the fee) accounts for it. Explorers render it in the tx detail; we also store it in the DB.
    const comment = (dto.comment ?? '').trim();
    if (comment) {
      const chunks = cip20MessageChunks(comment);
      if (chunks.length) {
        const meta = CSL.GeneralTransactionMetadata.new();
        const datum = CSL.encode_json_str_to_metadatum(JSON.stringify({ msg: chunks }), CSL.MetadataJsonSchema.NoConversions);
        meta.insert(CSL.BigNum.from_str(String(CIP20_MESSAGE_LABEL)), datum);
        const aux = CSL.AuxiliaryData.new();
        aux.set_metadata(meta);
        txb.set_auxiliary_data(aux);
      }
    }

    // The treasury output, then coin-selection over the donor's UTxOs to cover it + the fee.
    txb.add_output(CSL.TransactionOutput.new(toAddr, CSL.Value.new(CSL.BigNum.from_str(String(amountLovelace)))));
    const unspent = CSL.TransactionUnspentOutputs.new();
    for (const hex of dto.utxosHex) {
      try { unspent.add(CSL.TransactionUnspentOutput.from_bytes(Buffer.from(hex, 'hex'))); }
      catch { /* skip an unparseable UTxO rather than fail the whole donation */ }
    }
    if (unspent.len() === 0) throw new BadRequestException('none of your wallet UTxOs could be read');
    try {
      txb.add_inputs_from(unspent, CSL.CoinSelectionStrategyCIP2.LargestFirst);
      txb.add_change_if_needed(changeAddr);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/insufficient|not enough|UTxO Balance/i.test(msg)) {
        throw new BadRequestException('your wallet balance is not enough to cover this donation plus the network fee');
      }
      throw new BadRequestException(`could not build the donation transaction: ${msg.slice(0, 160)}`);
    }

    const tx = txb.build_tx(); // full Transaction: body + auxiliary data + empty witness set
    const txHex = Buffer.from(tx.to_bytes()).toString('hex');

    const row = await this.prisma.treasuryDonation.create({
      data: {
        amountLovelace,
        comment: comment || null,
        toAddress: toAddressBech32,
        changeAddress: changeAddr.to_bech32(),
        txCbor: txHex,
        status: 'PREPARED',
      },
    });
    return { donationId: row.id, txHex, toAddress: toAddressBech32, amountAda: dto.amountAda };
  }

  /** Attach the donor's witness to the cached tx and submit it to the network. */
  async submit(dto: { donationId: string; witnessHex: string }) {
    const row = await this.prisma.treasuryDonation.findUnique({ where: { id: dto.donationId } });
    if (!row) throw new NotFoundException('donation not found');
    if (row.status === 'SUBMITTED' && row.txHash) return { txHash: row.txHash }; // idempotent
    if (!row.txCbor) throw new ConflictException('this donation has no prepared transaction');

    let cached: CSL.Transaction;
    try { cached = CSL.Transaction.from_hex(row.txCbor); }
    catch { throw new ConflictException('the prepared transaction could not be read — start the donation again'); }

    let ws: CSL.TransactionWitnessSet;
    try { ws = CSL.TransactionWitnessSet.from_hex(dto.witnessHex); }
    catch { throw new BadRequestException('the wallet signature (witness) is not valid'); }
    if (!ws.vkeys() || ws.vkeys()!.len() === 0) {
      throw new BadRequestException('your wallet returned no signature — approve the transaction in the wallet and try again');
    }

    // Combine the donor's witness with the cached body + comment metadata, then submit.
    const tx = CSL.Transaction.new(cached.body(), ws, cached.auxiliary_data());
    const fixed = CSL.FixedTransaction.from_hex(Buffer.from(tx.to_bytes()).toString('hex'));
    const txHash = fixed.transaction_hash().to_hex();

    try {
      await this.cardano.submitTx(fixed.to_hex());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`donation ${row.id} submit failed: ${msg}`);
      // A transient submit-service outage (Koios's submit backend briefly down) is not the donor's
      // fault — their signed tx is fine, it just couldn't be relayed. Tell them to retry; the
      // prepared+signed donation can simply be submitted again.
      if ((e as { connectionError?: boolean })?.connectionError) {
        throw new ServiceUnavailableException('the network submit service is temporarily unavailable — your wallet signed fine, please click Donate again in a moment');
      }
      throw new BadRequestException(`the network rejected the donation: ${msg.slice(0, 200)}`);
    }

    await this.prisma.treasuryDonation.update({
      where: { id: row.id },
      data: { status: 'SUBMITTED', txHash, fromAddress: row.changeAddress, submittedAt: new Date() },
    });
    this.logger.log(`donation ${row.id} submitted: ${txHash} (${Number(row.amountLovelace) / LOVELACE} ADA)`);
    return { txHash };
  }

  /** Public list of confirmed donations (newest first) + totals, for the Treasury "Donators" panel. */
  async listDonations(limit = 200) {
    const [rows, agg] = await Promise.all([
      this.prisma.treasuryDonation.findMany({
        where: { status: 'SUBMITTED', txHash: { not: null } },
        orderBy: { submittedAt: 'desc' },
        take: limit,
        select: { id: true, fromAddress: true, comment: true, amountLovelace: true, txHash: true, submittedAt: true },
      }),
      this.prisma.treasuryDonation.aggregate({
        where: { status: 'SUBMITTED', txHash: { not: null } },
        _sum: { amountLovelace: true },
        _count: true,
      }),
    ]);
    return {
      donations: rows.map((r) => ({
        id: r.id,
        address: r.fromAddress,
        comment: r.comment,
        amountAda: Number(r.amountLovelace) / LOVELACE,
        txHash: r.txHash,
        at: r.submittedAt,
      })),
      count: agg._count,
      totalAda: Number(agg._sum.amountLovelace ?? 0n) / LOVELACE,
    };
  }

  private builderCfg(pp: Record<string, string | number>) {
    const num = (k: string) => Number(pp[k]);
    return CSL.TransactionBuilderConfigBuilder.new()
      .fee_algo(CSL.LinearFee.new(CSL.BigNum.from_str(String(num('min_fee_a'))), CSL.BigNum.from_str(String(num('min_fee_b')))))
      .pool_deposit(CSL.BigNum.from_str(String(num('pool_deposit'))))
      .key_deposit(CSL.BigNum.from_str(String(num('key_deposit'))))
      .max_value_size(num('max_val_size'))
      .max_tx_size(num('max_tx_size'))
      .coins_per_utxo_byte(CSL.BigNum.from_str(String(num('coins_per_utxo_size'))))
      .build();
  }
}
