-- §29 OG — self-governed proposal-timing settings + deadline-extension history.
ALTER TABLE "group" ADD COLUMN "extend_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "group" ADD COLUMN "extend_who" TEXT NOT NULL DEFAULT 'MEMBERS';
ALTER TABLE "group" ADD COLUMN "early_finalize_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "group" ADD COLUMN "early_finalize_who" TEXT NOT NULL DEFAULT 'MEMBERS';
ALTER TABLE "group_proposal" ADD COLUMN "extensions" JSONB;
