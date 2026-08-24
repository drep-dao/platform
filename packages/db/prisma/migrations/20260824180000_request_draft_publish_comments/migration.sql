-- AlterTable
ALTER TABLE "request" ADD COLUMN     "published_at" TIMESTAMPTZ(6),
ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- CreateTable
CREATE TABLE "request_comment" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "content_md" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "request_comment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "request_comment_request_id_idx" ON "request_comment"("request_id");

-- AddForeignKey
ALTER TABLE "request_comment" ADD CONSTRAINT "request_comment_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_comment" ADD CONSTRAINT "request_comment_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

