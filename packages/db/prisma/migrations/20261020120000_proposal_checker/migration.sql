-- Proposal checker: board-uploaded requirement templates + AI judging results of governance actions.

CREATE TABLE "proposal_check_template" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_url" TEXT,
    "file_name" TEXT,
    "mime_type" TEXT,
    "file_data_url" TEXT,
    "extracted_text" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_check_template_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "proposal_check_template_active_created_at_idx" ON "proposal_check_template"("active", "created_at" DESC);

CREATE TABLE "proposal_check_result" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "gov_action_id" TEXT NOT NULL,
    "gov_action_title" TEXT,
    "gov_action_type" TEXT,
    "score_pct" INTEGER NOT NULL,
    "summary" TEXT,
    "questions" JSONB NOT NULL,
    "model" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_check_result_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "proposal_check_result_template_id_created_at_idx" ON "proposal_check_result"("template_id", "created_at" DESC);
CREATE INDEX "proposal_check_result_gov_action_id_created_at_idx" ON "proposal_check_result"("gov_action_id", "created_at" DESC);

ALTER TABLE "proposal_check_result" ADD CONSTRAINT "proposal_check_result_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "proposal_check_template"("id") ON DELETE CASCADE ON UPDATE CASCADE;
