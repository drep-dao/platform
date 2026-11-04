-- Treasury-withdrawal total (ADA) for a scored gov action — drives + snapshots ask-size tiering.
ALTER TABLE "proposal_check_result" ADD COLUMN "amount_ada" numeric(20,6);
