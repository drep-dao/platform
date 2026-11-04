-- Requested treasury amount in ADA (optional — only withdrawal proposals state one).
ALTER TABLE "public_scan" ADD COLUMN "amount_ada" numeric(20,6);
