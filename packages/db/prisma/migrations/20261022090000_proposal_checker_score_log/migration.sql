-- Proposal checker: keep the exact prompt sent + the raw AI response per score (board-only log).
ALTER TABLE "proposal_check_result" ADD COLUMN "prompt" TEXT;
ALTER TABLE "proposal_check_result" ADD COLUMN "raw_response" TEXT;
