-- Third scoring dimension (Cardano Vision 2030) + detailed template findings.
ALTER TABLE "proposal_check_result" ADD COLUMN "template_findings" JSONB;
ALTER TABLE "proposal_check_result" ADD COLUMN "vision_pct" INTEGER;
ALTER TABLE "proposal_check_result" ADD COLUMN "vision_findings" JSONB;
