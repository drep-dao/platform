-- AlterTable
ALTER TABLE "rule_document_comment" ADD COLUMN     "parent_id" UUID;
-- AddForeignKey
ALTER TABLE "rule_document_comment" ADD CONSTRAINT "rule_document_comment_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "rule_document_comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
