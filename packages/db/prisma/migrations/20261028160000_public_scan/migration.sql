-- Public paid proposal-scan: a submitter pays a fee in ADA to run the proposal-checker engine on a
-- DRAFT proposal before submitting it on-chain. Keyed by the connected wallet; one payment = one scan
-- (fee_tx_hash unique). Result columns mirror proposal_check_result.
CREATE TABLE "public_scan" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "wallet_stake_addr" TEXT NOT NULL,
  "wallet_payment_addr" TEXT,
  "title" TEXT NOT NULL,
  "abstract" TEXT NOT NULL,
  "motivation" TEXT NOT NULL,
  "rationale" TEXT NOT NULL,
  "extra_links" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "price_ada" BIGINT NOT NULL,
  "to_address" TEXT NOT NULL,
  "fee_tx_hash" TEXT,
  "fee_seen_onchain_at" TIMESTAMPTZ(6),
  "status" TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "score_pct" INTEGER,
  "template_findings" JSONB,
  "questions" JSONB,
  "vision_pct" INTEGER,
  "vision_findings" JSONB,
  "model" TEXT,
  "prompt" TEXT,
  "raw_response" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "public_scan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "public_scan_fee_tx_hash_key" ON "public_scan" ("fee_tx_hash");
CREATE INDEX "public_scan_wallet_created_idx" ON "public_scan" ("wallet_stake_addr", "created_at" DESC);
CREATE INDEX "public_scan_status_seen_idx" ON "public_scan" ("status", "fee_seen_onchain_at");
