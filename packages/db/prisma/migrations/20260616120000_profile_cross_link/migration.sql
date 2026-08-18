-- §2 — cross-wallet profile linking between a submitter and a DAO member.
-- Idempotent (IF NOT EXISTS): this migration was originally misdated BEFORE the
-- migration that creates submitter_application, so it was renamed into correct
-- chronological order; DBs that already applied it under the old id re-apply
-- harmlessly.
ALTER TABLE "submitter_application" ADD COLUMN IF NOT EXISTS "linked_drep_id_onchain" TEXT;
ALTER TABLE "drep" ADD COLUMN IF NOT EXISTS "linked_submitter_user_id" UUID;
