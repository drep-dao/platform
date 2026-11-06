-- SEC — a fee tx funds at most one request (mirror public_scan_fee_tx_hash_key).
-- Partial so uncredited DRAFT/PENDING rows may still hold a (speculative) hash, but at most one
-- request may ever be CREDITED (fee_seen_onchain_at set) per fee tx hash.
CREATE UNIQUE INDEX IF NOT EXISTS "request_fee_tx_hash_credited_key"
  ON "request" ("fee_tx_hash")
  WHERE "fee_seen_onchain_at" IS NOT NULL;
