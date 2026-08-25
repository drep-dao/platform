-- CreateTable
CREATE TABLE "group" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'HIDDEN',
    "profile_fields" TEXT[],
    "proposal_types" TEXT[],
    "admission_type" TEXT NOT NULL DEFAULT 'SINGLE_DREP',
    "approver_user_id" UUID,
    "commenters" TEXT[],
    "sort_idx" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_member" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "display_name" TEXT,
    "bio" TEXT,
    "photo" TEXT,
    "admitted_at" TIMESTAMPTZ(6),
    "approved_by_user_id" UUID,
    "removed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_proposal" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "content_md" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "poll_options" JSONB,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "voting_end_at" TIMESTAMPTZ(6) NOT NULL,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_vote" (
    "id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "voter_user_id" UUID NOT NULL,
    "choice" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_vote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_comment" (
    "id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "parent_id" UUID,
    "author_user_id" UUID NOT NULL,
    "content_md" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "group_comment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "group_key_key" ON "group"("key");

-- CreateIndex
CREATE INDEX "group_member_group_id_status_idx" ON "group_member"("group_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "group_member_group_id_user_id_key" ON "group_member"("group_id", "user_id");

-- CreateIndex
CREATE INDEX "group_proposal_group_id_status_idx" ON "group_proposal"("group_id", "status");

-- CreateIndex
CREATE INDEX "group_vote_proposal_id_voter_user_id_idx" ON "group_vote"("proposal_id", "voter_user_id");

-- CreateIndex
CREATE INDEX "group_comment_proposal_id_idx" ON "group_comment"("proposal_id");

-- AddForeignKey
ALTER TABLE "group" ADD CONSTRAINT "group_approver_user_id_fkey" FOREIGN KEY ("approver_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_member" ADD CONSTRAINT "group_member_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_member" ADD CONSTRAINT "group_member_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_proposal" ADD CONSTRAINT "group_proposal_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_proposal" ADD CONSTRAINT "group_proposal_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_vote" ADD CONSTRAINT "group_vote_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "group_proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_vote" ADD CONSTRAINT "group_vote_voter_user_id_fkey" FOREIGN KEY ("voter_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_comment" ADD CONSTRAINT "group_comment_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "group_proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_comment" ADD CONSTRAINT "group_comment_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_comment" ADD CONSTRAINT "group_comment_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "group_comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

