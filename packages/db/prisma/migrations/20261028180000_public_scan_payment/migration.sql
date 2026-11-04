-- Public-scan payments ledger: a scan can collect several fee payments (e.g. two 200 ADA txs → 400 ADA)
-- and unlocks when the confirmed total ≥ the fee. One tx funds only one scan (tx_hash is unique).
CREATE TABLE "public_scan_payment" (
    "id" UUID NOT NULL,
    "scan_id" UUID NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "lovelace" BIGINT,
    "sender" TEXT,
    "seen_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "public_scan_payment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "public_scan_payment_tx_hash_key" ON "public_scan_payment"("tx_hash");
CREATE INDEX "public_scan_payment_scan_id_idx" ON "public_scan_payment"("scan_id");

ALTER TABLE "public_scan_payment"
    ADD CONSTRAINT "public_scan_payment_scan_id_fkey"
    FOREIGN KEY ("scan_id") REFERENCES "public_scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: move each existing scan's single fee_tx_hash into the ledger so already-claimed txs stay
-- claimed (and confirmed ones keep their verified amount). priceAda is used as the amount for rows that
-- were already PAID (we only know they met the fee), else left null for the poller to resolve.
INSERT INTO "public_scan_payment" ("id", "scan_id", "tx_hash", "lovelace", "sender", "seen_at", "created_at")
SELECT gen_random_uuid(), "id", "fee_tx_hash",
       CASE WHEN "fee_seen_onchain_at" IS NOT NULL THEN "price_ada" ELSE NULL END,
       "wallet_payment_addr",
       "fee_seen_onchain_at",
       "created_at"
FROM "public_scan"
WHERE "fee_tx_hash" IS NOT NULL;
