-- §R — requests: an optional link to an internal proposal (escalation to a vote). Default request
-- flow stays notification + status only; the ACCEPTED status is handled purely in application code
-- (the status column is a free-form string), so only the new nullable column + FK are needed here.
ALTER TABLE "request" ADD COLUMN "linked_proposal_id" UUID;
ALTER TABLE "request" ADD CONSTRAINT "request_linked_proposal_id_fkey" FOREIGN KEY ("linked_proposal_id") REFERENCES "proposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
