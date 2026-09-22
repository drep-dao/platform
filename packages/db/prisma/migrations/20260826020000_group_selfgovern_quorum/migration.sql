-- §29 OG — self-governance + configurable voting quorum.
ALTER TABLE "group" ADD COLUMN "members_can_approve" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "group" ADD COLUMN "quorum_mode" TEXT NOT NULL DEFAULT 'OPEN';
ALTER TABLE "group" ADD COLUMN "quorum_count" INTEGER;
