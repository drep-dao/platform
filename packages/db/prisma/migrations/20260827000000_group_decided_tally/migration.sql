-- §29 — freeze a group proposal's tally at decision so later membership changes never rewrite a closed result
ALTER TABLE "group_proposal" ADD COLUMN "decided_tally" JSONB;
