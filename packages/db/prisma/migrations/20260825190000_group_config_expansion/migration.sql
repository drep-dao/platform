-- AlterTable
ALTER TABLE "group" ADD COLUMN     "threshold_pct" INTEGER NOT NULL DEFAULT 67,
ADD COLUMN     "voting_type" TEXT NOT NULL DEFAULT 'ONE_PERSON_ONE_VOTE';

-- AlterTable
ALTER TABLE "group_member" ADD COLUMN     "address" TEXT,
ADD COLUMN     "conflict_of_interest" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "preferences" JSONB,
ADD COLUMN     "socials" JSONB,
ADD COLUMN     "subcategory_ids" TEXT[];

-- AlterTable
ALTER TABLE "group_proposal" ADD COLUMN     "actors" JSONB,
ADD COLUMN     "delivery_date" TIMESTAMPTZ(6);

