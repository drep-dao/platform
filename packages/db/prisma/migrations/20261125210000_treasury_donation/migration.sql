-- Public donations to the treasury: anyone sends ADA to the multisig with an optional on-chain
-- comment (CIP-20 label 674). Built unsigned (PREPARED), signed by the donor, then submitted.
CREATE TABLE "treasury_donation" (
    "id" UUID NOT NULL,
    "amount_lovelace" BIGINT NOT NULL,
    "comment" TEXT,
    "to_address" TEXT NOT NULL,
    "change_address" TEXT NOT NULL,
    "from_address" TEXT,
    "tx_cbor" TEXT,
    "tx_hash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PREPARED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMPTZ(6),
    CONSTRAINT "treasury_donation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "treasury_donation_tx_hash_key" ON "treasury_donation"("tx_hash");
CREATE INDEX "treasury_donation_tx_hash_idx" ON "treasury_donation"("tx_hash");
