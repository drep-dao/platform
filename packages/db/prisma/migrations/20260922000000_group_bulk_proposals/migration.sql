-- §29 BULK — a group proposal that bundles several sub-proposals voted on together.
-- Items live on the proposal; each member's per-item YES/NO/ABSTAIN vote reuses group_vote (item_id).
ALTER TABLE "group_proposal" ADD COLUMN "bulk_items" JSONB;
ALTER TABLE "group_vote" ADD COLUMN "item_id" TEXT;
