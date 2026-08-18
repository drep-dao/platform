/**
 * Runs the whole DRep DAO service-level test suite, in order, against the
 * isolated `drepdao_gov_test` database (NOT the dev DB) + live Koios (Preprod).
 *
 * Each test file `require()`s `tools/_test-env.cjs` first, which redirects
 * DATABASE_URL to the test DB so the dev DB is never touched. This runner
 * additionally:
 *   1. Bootstraps `drepdao_gov_test` (creates it + runs `prisma migrate deploy`).
 *   2. TRUNCATEs every table before the run for a deterministic starting state.
 *
 * Prereqs: infra up (pnpm infra:up) and the built dist (the dev server keeps
 * it fresh; otherwise run `pnpm build`).
 *
 *   node tools/test-all.cjs   (or: pnpm test:e2e)
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

if (!fs.existsSync(path.join(__dirname, '..', 'apps/api/dist/drep/drep.service.js'))) {
  console.error('apps/api/dist is missing — run `pnpm build` (or start `pnpm dev`) first.');
  process.exit(1);
}

const setup = spawnSync(process.execPath, [path.join(__dirname, 'setup-test-db.cjs'), '--reset'], { stdio: 'inherit' });
if (setup.status !== 0) {
  console.error('test-db setup failed.');
  process.exit(setup.status ?? 1);
}

// Order matters: genesis leaves the 5-board seated; the rest build on it.
const SUITES = [
  ['test-genesis', 'Genesis: JSON load, partial load, add/remove, incremental'],
  ['test-cast', 'Cast roles: board / voting DRep / ADA holder + genesis verify'],
  ['test-dao', 'DAO membership: board auto-member, join + 3-of-5 admission'],
  ['test-free-period', '§14 free period: no board ⇒ auto-admission (anchored); submitter apps queue for the board; board back ⇒ 3-of-5 flow again (self-cleaning)'],
  ['test-overview', 'DAO overview voting power + Expert apply/approve'],
  ['test-entry-gate', '§14.1 entry gate: config save, eligibility, below-min flag, MERIT cap (self-restoring)'],
  ['test-removal', 'Removal: propose + 3-of-5 vote → REMOVED, re-apply'],
  ['test-internal', '§10 internal proposals: submit/threshold/poll/extend/scope/private + on-chain anchor (self-cleaning)'],
  ['test-internal-election', '§14 board-member election: validation, voting → approval, install authorization, manual + auto install (self-cleaning, restores board)'],
  ['test-shared-math', 'Shared single-source math: money, reward pools, reviewer ranking, §4.2 power'],
  ['test-signing-mode', '§15/§20 TX_SIGNING_PROCESS: 1-phase default + gates, 2-phase fallback gates, governance validation'],
  ['test-merit-tx', '§13.2 treasury-action merit: TX_INITIATED/TX_SIGNED deltas, initiator tracking, idempotent award'],
  ['test-internal-transfer', '§15.5 internal transfers: board-only, distinct buckets, bucket-address destination, initiator stamp'],
  ['test-multisig-migration', '§15.2 board hand-over: assembly + carry-over keys, key reminder, auto FUND MIGRATION per source, resolveSource, terminate + both on-chain proofs (self-cleaning)'],
  ['test-requests', '§R requests: fixed bucket set, board price list, free→ACTIVE, paid→PENDING_FEE→verified fee→ACTIVE, queue visibility, board-only status (self-cleaning)'],
];

const failed = [];
for (const [file, desc] of SUITES) {
  console.log(`\n████ ${file} — ${desc} ████`);
  const r = spawnSync(process.execPath, [path.join(__dirname, `${file}.cjs`)], { stdio: 'inherit' });
  if (r.status !== 0) failed.push(file);
}

console.log('\n==================== SUMMARY ====================');
for (const [file, desc] of SUITES) {
  console.log(`  ${failed.includes(file) ? '❌ FAIL' : '✅ PASS'}  ${file.padEnd(14)} ${desc}`);
}
console.log(failed.length ? `\n❌ ${failed.length} suite(s) failed.` : '\n✅ All suites passed.');
process.exit(failed.length ? 1 : 0);
