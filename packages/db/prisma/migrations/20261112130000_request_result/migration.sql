-- §R2 — the board's response/result attached to a request (markdown, editable any time).
ALTER TABLE "request" ADD COLUMN "result" TEXT;
ALTER TABLE "request" ADD COLUMN "result_at" TIMESTAMPTZ(6);
ALTER TABLE "request" ADD COLUMN "result_by_user_id" UUID;
