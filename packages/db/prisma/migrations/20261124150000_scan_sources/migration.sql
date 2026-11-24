-- The sources the scorer read for one score: the proposal itself + each link it fetched
-- (whether it loaded, its kind, and GitHub repo stats). Rendered as "Sources considered".
ALTER TABLE "proposal_check_result" ADD COLUMN "sources" JSONB;
ALTER TABLE "public_scan" ADD COLUMN "sources" JSONB;
