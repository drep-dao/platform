-- DropForeignKey
ALTER TABLE "board_multisig_key" DROP CONSTRAINT "board_multisig_key_board_seat_id_fkey";

-- DropForeignKey
ALTER TABLE "board_multisig_key" DROP CONSTRAINT "board_multisig_key_user_id_fkey";

-- DropForeignKey
ALTER TABLE "budget_change_request" DROP CONSTRAINT "budget_change_request_decided_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "budget_change_request" DROP CONSTRAINT "budget_change_request_proposal_id_fkey";

-- DropForeignKey
ALTER TABLE "budget_change_request" DROP CONSTRAINT "budget_change_request_requester_id_fkey";

-- DropForeignKey
ALTER TABLE "hot_wallet_sweep" DROP CONSTRAINT "hot_wallet_sweep_user_fkey";

-- DropForeignKey
ALTER TABLE "multisig_action" DROP CONSTRAINT "multisig_action_from_config_fkey";

-- DropForeignKey
ALTER TABLE "multisig_action" DROP CONSTRAINT "multisig_action_source_bucket_fkey";

-- DropForeignKey
ALTER TABLE "multisig_action" DROP CONSTRAINT "multisig_action_to_config_fkey";

-- DropForeignKey
ALTER TABLE "multisig_commitment" DROP CONSTRAINT "multisig_commitment_action_fkey";

-- DropForeignKey
ALTER TABLE "multisig_commitment" DROP CONSTRAINT "multisig_commitment_drep_fkey";

-- DropForeignKey
ALTER TABLE "multisig_commitment" DROP CONSTRAINT "multisig_commitment_user_fkey";

-- DropForeignKey
ALTER TABLE "multisig_config" DROP CONSTRAINT "multisig_config_replaced_by_fkey";

-- DropForeignKey
ALTER TABLE "quick_poll_vote" DROP CONSTRAINT "quick_poll_vote_choice_fkey";

-- DropForeignKey
ALTER TABLE "reward_calculation" DROP CONSTRAINT "reward_calculation_round_id_fkey";

-- DropForeignKey
ALTER TABLE "reward_entry" DROP CONSTRAINT "reward_entry_drep_id_fkey";

-- DropForeignKey
ALTER TABLE "stop_funding_proposal" DROP CONSTRAINT "stop_funding_proposal_proposal_id_fkey";

-- DropForeignKey
ALTER TABLE "stop_funding_proposal" DROP CONSTRAINT "stop_funding_proposal_proposer_drep_id_fkey";

-- DropForeignKey
ALTER TABLE "stop_funding_proposal" DROP CONSTRAINT "stop_funding_proposal_proposer_user_id_fkey";

-- DropForeignKey
ALTER TABLE "stop_funding_vote" DROP CONSTRAINT "stop_funding_vote_board_drep_id_fkey";

-- DropForeignKey
ALTER TABLE "stop_funding_vote" DROP CONSTRAINT "stop_funding_vote_stop_id_fkey";

-- DropForeignKey
ALTER TABLE "treasury_bucket" DROP CONSTRAINT "treasury_bucket_config_fkey";

-- DropForeignKey
ALTER TABLE "treasury_bucket" DROP CONSTRAINT "treasury_bucket_createdBy_fkey";

-- DropIndex
DROP INDEX "multisig_action_source_bucket_id_idx";

-- AlterTable
ALTER TABLE "budget_change_request" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "quick_poll" ALTER COLUMN "eligible_drep_ids" DROP DEFAULT;

-- AlterTable
ALTER TABLE "stop_funding_proposal" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "stop_funding_vote" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "submitter_application" ALTER COLUMN "github_urls" DROP DEFAULT;

-- AlterTable
ALTER TABLE "submitter_application_history" ALTER COLUMN "github_urls" DROP DEFAULT;

-- CreateTable
CREATE TABLE "request_type" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "price_ada" BIGINT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request" (
    "id" UUID NOT NULL,
    "submitter_user_id" UUID NOT NULL,
    "type_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "fee_tx_hash" TEXT,
    "fee_seen_onchain_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(6),
    "decided_by_user_id" UUID,

    CONSTRAINT "request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "request_status_created_at_idx" ON "request"("status", "created_at");

-- AddForeignKey
ALTER TABLE "budget_change_request" ADD CONSTRAINT "budget_change_request_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_change_request" ADD CONSTRAINT "budget_change_request_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_change_request" ADD CONSTRAINT "budget_change_request_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stop_funding_proposal" ADD CONSTRAINT "stop_funding_proposal_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stop_funding_proposal" ADD CONSTRAINT "stop_funding_proposal_proposer_drep_id_fkey" FOREIGN KEY ("proposer_drep_id") REFERENCES "drep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stop_funding_proposal" ADD CONSTRAINT "stop_funding_proposal_proposer_user_id_fkey" FOREIGN KEY ("proposer_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stop_funding_vote" ADD CONSTRAINT "stop_funding_vote_stop_id_fkey" FOREIGN KEY ("stop_id") REFERENCES "stop_funding_proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stop_funding_vote" ADD CONSTRAINT "stop_funding_vote_board_drep_id_fkey" FOREIGN KEY ("board_drep_id") REFERENCES "drep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quick_poll_vote" ADD CONSTRAINT "quick_poll_vote_choice_fkey" FOREIGN KEY ("choice") REFERENCES "proposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_calculation" ADD CONSTRAINT "reward_calculation_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "round"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_entry" ADD CONSTRAINT "reward_entry_drep_id_fkey" FOREIGN KEY ("drep_id") REFERENCES "drep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "multisig_action" ADD CONSTRAINT "multisig_action_from_config_id_fkey" FOREIGN KEY ("from_config_id") REFERENCES "multisig_config"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "multisig_action" ADD CONSTRAINT "multisig_action_to_config_id_fkey" FOREIGN KEY ("to_config_id") REFERENCES "multisig_config"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "multisig_action" ADD CONSTRAINT "multisig_action_source_bucket_id_fkey" FOREIGN KEY ("source_bucket_id") REFERENCES "treasury_bucket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "multisig_commitment" ADD CONSTRAINT "multisig_commitment_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "multisig_action"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "multisig_commitment" ADD CONSTRAINT "multisig_commitment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "multisig_commitment" ADD CONSTRAINT "multisig_commitment_drep_id_fkey" FOREIGN KEY ("drep_id") REFERENCES "drep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_multisig_key" ADD CONSTRAINT "board_multisig_key_board_seat_id_fkey" FOREIGN KEY ("board_seat_id") REFERENCES "board_seat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_multisig_key" ADD CONSTRAINT "board_multisig_key_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hot_wallet_sweep" ADD CONSTRAINT "hot_wallet_sweep_initiated_by_user_id_fkey" FOREIGN KEY ("initiated_by_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "multisig_config" ADD CONSTRAINT "multisig_config_replaced_by_config_id_fkey" FOREIGN KEY ("replaced_by_config_id") REFERENCES "multisig_config"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_bucket" ADD CONSTRAINT "treasury_bucket_configId_fkey" FOREIGN KEY ("configId") REFERENCES "multisig_config"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_bucket" ADD CONSTRAINT "treasury_bucket_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request" ADD CONSTRAINT "request_submitter_user_id_fkey" FOREIGN KEY ("submitter_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request" ADD CONSTRAINT "request_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "request_type"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "multisig_commitment_action_user_key" RENAME TO "multisig_commitment_action_id_user_id_key";

-- RenameIndex
ALTER INDEX "stop_funding_vote_stop_board_uniq" RENAME TO "stop_funding_vote_stop_id_board_drep_id_key";
