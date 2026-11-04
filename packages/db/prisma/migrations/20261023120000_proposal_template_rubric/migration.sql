-- A fixed, numbered requirement checklist compiled once from the template's extracted text, so every
-- proposal is scored against the SAME items (stable count, comparable coverage across proposals).
ALTER TABLE "proposal_check_template" ADD COLUMN "rubric" JSONB;
