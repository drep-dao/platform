-- Store the gov action's on-chain submission time on the score, so the public list can order by
-- submission date without depending on a live (slow/flaky) Koios gov-actions fetch.
ALTER TABLE "proposal_check_result" ADD COLUMN "submitted_at" timestamptz(6);
