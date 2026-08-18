/**
 * Service-level tests for §R submitter Requests (DRep DAO governance edition):
 *   • board-only request-type CRUD (create / update / deactivate-on-delete)
 *   • only APPROVED submitters can submit
 *   • FREE request → straight to ACTIVE
 *   • PAID request → PENDING_FEE → on-chain fee verification (stubbed) → ACTIVE
 *   • queue visibility: PENDING_FEE hidden from everyone but owner + board
 *   • board-only status changes (DONE / REJECTED / re-ACTIVATE); PENDING_FEE blocked
 *   • fee address comes from the Request-fees bucket (SUBMISSION_FEES default flag)
 *   • fixed bucket set auto-provisioned: Main + Request fees + Operations + Rewards
 *
 * Self-cleaning: throwaway users/drep/seat/multisig/buckets/types/requests.
 *   node tools/test-requests.cjs
 */
require('./_test-env.cjs');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
delete process.env.ANCHOR_MNEMONIC;
process.env.JOBS_DISABLED = '1';

const { PrismaService } = require(root + '/apps/api/dist/prisma/prisma.service.js');
const { CardanoQueryService } = require(root + '/apps/api/dist/cardano/cardano-query.service.js');
const { TreasuryBucketsService } = require(root + '/apps/api/dist/treasury/treasury-buckets.service.js');
const { RequestsService } = require(root + '/apps/api/dist/requests/requests.service.js');
const { prisma: db } = require(root + '/packages/db/dist/index.js');

const config = { get: (k) => process.env[k] };
let fail = 0;
const ok = (l, c, d) => { console.log(`  ${c ? '✅' : '❌'} ${l}${d ? ` — ${d}` : ''}`); if (!c) fail++; };
const throws = async (l, fn, re) => { try { await fn(); ok(l, false, 'did not throw'); } catch (e) { ok(l, re.test(e.message), e.message); } };

(async () => {
  const prisma = new PrismaService(config);
  const cardano = new CardanoQueryService(config);
  const buckets = new TreasuryBucketsService(prisma, config, cardano);
  const svc = new RequestsService(prisma, cardano, buckets);

  // Chain stubs: no live balance lookups, and fee verification is controllable.
  cardano.addressBalance = async () => new Map();
  let feePaid = false;
  cardano.verifyPayment = async () => ({ found: feePaid, paid: feePaid });

  const ts = Date.now();
  // Board member (drepKeyHash + active seat).
  const boardUser = await db.appUser.create({ data: { stakeKeyHash: `treq_b_${ts}`, stakeAddress: `stake_test_req_b_${ts}`, drepKeyHash: `dkh_req_${ts}` } });
  const drep = await db.drep.create({ data: { userId: boardUser.id, drepIdOnchain: `drep_test_req_${ts}`, status: 'ADMITTED' } });
  const seat = await db.boardSeat.create({ data: { drepId: drep.drepIdOnchain, drepKeyHash: boardUser.drepKeyHash, displayName: 'req board' } });
  // Approved submitter + a second (non-approved) user.
  const submitter = await db.appUser.create({ data: { stakeKeyHash: `treq_s_${ts}`, stakeAddress: `stake_test_req_s_${ts}` } });
  const app = await db.submitterApplication.create({ data: { userId: submitter.id, status: 'APPROVED', displayName: 'req submitter', description: 'd', country: 'CZ', githubUrls: [], socialLinks: [] } });
  const stranger = await db.appUser.create({ data: { stakeKeyHash: `treq_x_${ts}`, stakeAddress: `stake_test_req_x_${ts}` } });
  // Active multisig — a real 1-of-1 script so the bucket wrap can be built.
  const kh = 'a'.repeat(56);
  const cfg = await db.multisigConfig.create({
    data: { scriptJson: { type: 'all', scripts: [{ type: 'sig', keyHash: kh }] }, scriptHash: `sh_req_${ts}`, bech32Address: `addr_test_req_ms_${ts}`, threshold: 1, totalKeys: 1 },
  });

  const created = { types: [], requests: [] };
  try {
    console.log('— fixed bucket set —');
    const bl = await buckets.list();
    const labels = bl.buckets.map((b) => b.label).sort();
    ok('fixed set auto-provisioned (Main + 3 labeled)', JSON.stringify(labels) === JSON.stringify(['Main', 'Operations', 'Request fees', 'Rewards']), labels.join(','));
    const reqFees = bl.buckets.find((b) => b.label === 'Request fees');
    ok('Request-fees bucket is the SUBMISSION_FEES default', !!reqFees?.isDefaultSubmissionFees);
    ok('bucket create disabled (fixed set)', await svc.feeAddress() === reqFees.bech32Address, 'feeAddress = Request-fees bucket');
    await throws('ad-hoc bucket creation refused', () => buckets.create(boardUser.id, 'Extra'), /fixed set of treasury buckets/);
    await throws('bucket deletion refused', () => buckets.remove(boardUser.id, reqFees.id), /fixed set of treasury buckets/);

    console.log('— request types (board price list) —');
    await throws('non-board cannot create a type', () => svc.createType(stranger.id, { name: 'X', priceAda: 10 }), /board members only/);
    const t1 = await svc.createType(boardUser.id, { name: 'Request to assess proposal', priceAda: 5000 });
    created.types.push(t1.id);
    const types = await svc.listTypes();
    ok('type listed with ADA price', types.length === 1 && types[0].priceAda === 5000 && types[0].active === true);
    await svc.updateType(boardUser.id, t1.id, { priceAda: 4000 });
    ok('price update applies', (await svc.listTypes())[0].priceAda === 4000);
    await throws('non-board cannot change a type', () => svc.updateType(stranger.id, t1.id, { priceAda: 1 }), /board members only/);

    console.log('— submitting —');
    await throws('non-approved user cannot submit', () => svc.submit(stranger.id, { title: 'Help me', description: 'd' }), /only approved submitters/);
    await throws('short title refused', () => svc.submit(submitter.id, { title: 'ab', description: 'd' }), /at least 4 characters/);
    const free = await svc.submit(submitter.id, { title: 'Free question', description: 'Just advice please.' });
    created.requests.push(free.id);
    ok('free request goes straight to ACTIVE', free.status === 'ACTIVE' && free.free === true);
    const paid = await svc.submit(submitter.id, { title: 'Assess my proposal', description: 'Please assess.', typeId: t1.id });
    created.requests.push(paid.id);
    ok('paid request starts PENDING_FEE', paid.status === 'PENDING_FEE' && paid.type?.priceAda === 4000);

    console.log('— queue visibility —');
    const strangerList = await svc.list(stranger.id);
    ok('PENDING_FEE hidden from other users', !strangerList.some((r) => r.id === paid.id) && strangerList.some((r) => r.id === free.id));
    ok('PENDING_FEE visible to its submitter', (await svc.list(submitter.id)).some((r) => r.id === paid.id));
    ok('PENDING_FEE visible to the board', (await svc.list(boardUser.id)).some((r) => r.id === paid.id));
    await throws('stranger cannot open a pending request', () => svc.get(paid.id, stranger.id), /awaiting its fee/);

    console.log('— fee flow —');
    await throws('non-hex fee tx refused', () => svc.submitFeeTx(submitter.id, paid.id, 'nothex'), /64 hex characters/);
    await throws('someone else cannot submit the fee tx', () => svc.submitFeeTx(stranger.id, paid.id, 'c'.repeat(64)), /not your request/);
    feePaid = false;
    const afterTx = await svc.submitFeeTx(submitter.id, paid.id, 'C'.repeat(64));
    ok('unverified fee keeps PENDING_FEE (hash normalised)', afterTx.status === 'PENDING_FEE' && afterTx.feeTxHash === 'c'.repeat(64));
    await throws('board cannot decide a PENDING_FEE request', () => svc.setStatus(boardUser.id, paid.id, 'DONE'), /fee has not been verified/);
    feePaid = true;
    const re = await svc.recheckFee(submitter.id, paid.id);
    ok('re-check verifies the fee on-chain', re.verified === true);
    const nowActive = await svc.get(paid.id, stranger.id);
    ok('verified paid request is ACTIVE + queue-visible', nowActive.status === 'ACTIVE' && nowActive.feeVerified === true);

    console.log('— board status changes —');
    await throws('non-board cannot change status', () => svc.setStatus(stranger.id, free.id, 'DONE'), /board members only/);
    await throws('unknown status refused', () => svc.setStatus(boardUser.id, free.id, 'WEIRD'), /must be ACTIVE, DONE or REJECTED/);
    const done = await svc.setStatus(boardUser.id, free.id, 'DONE');
    ok('DONE stamps the decision', done.status === 'DONE' && !!done.decidedAt);
    const rej = await svc.setStatus(boardUser.id, paid.id, 'REJECTED');
    ok('REJECTED stamps the decision', rej.status === 'REJECTED' && !!rej.decidedAt);
    const back = await svc.setStatus(boardUser.id, paid.id, 'ACTIVE');
    ok('re-ACTIVATE clears the decision', back.status === 'ACTIVE' && back.decidedAt === null);

    console.log('— type deletion —');
    const del = await svc.deleteType(boardUser.id, t1.id);
    ok('used type is deactivated, not deleted', del.deactivated === true && (await svc.listTypes()).length === 0 && (await svc.listTypes(true)).length === 1);
    const t2 = await svc.createType(boardUser.id, { name: 'Unused type', priceAda: 10 });
    const del2 = await svc.deleteType(boardUser.id, t2.id);
    ok('unused type is hard-deleted', del2.deleted === true && (await svc.listTypes(true)).every((x) => x.id !== t2.id));
  } finally {
    await db.request.deleteMany({ where: { id: { in: created.requests } } }).catch(() => {});
    await db.requestType.deleteMany({ where: { id: { in: created.types } } }).catch(() => {});
    await db.treasuryBucket.deleteMany({ where: { configId: cfg.id } }).catch(() => {});
    await db.multisigConfig.delete({ where: { id: cfg.id } }).catch(() => {});
    await db.boardSeat.delete({ where: { id: seat.id } }).catch(() => {});
    await db.drep.delete({ where: { id: drep.id } }).catch(() => {});
    await db.submitterApplication.delete({ where: { id: app.id } }).catch(() => {});
    await db.appUser.deleteMany({ where: { id: { in: [boardUser.id, submitter.id, stranger.id] } } }).catch(() => {});
    await db.$disconnect();
    await prisma.$disconnect().catch(() => {});
  }

  console.log(fail ? `\n❌ ${fail} check(s) failed.` : '\n✅ requests suite passed.');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
