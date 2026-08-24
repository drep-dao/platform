-- AlterTable
ALTER TABLE "request_comment" ADD COLUMN     "parent_id" UUID;

-- AddForeignKey
ALTER TABLE "request_comment" ADD CONSTRAINT "request_comment_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "request_comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

