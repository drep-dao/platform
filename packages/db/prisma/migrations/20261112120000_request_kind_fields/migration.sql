-- §R2 — request kind + configurable form-element values.
-- kind: NOTIFICATION (default, original flow) | CALL | PROPOSAL_REVIEW | ANSWER.
-- fields: snapshot of the configured form-element values the submitter filled in.
ALTER TABLE "request" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'NOTIFICATION';
ALTER TABLE "request" ADD COLUMN "fields" JSONB;
