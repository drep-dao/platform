-- §events — upcoming events shown on the landing page.
CREATE TABLE "scheduled_event" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL,
    "start_at" TIMESTAMPTZ(6) NOT NULL,
    "end_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "scheduled_event_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "scheduled_event_end_at_idx" ON "scheduled_event"("end_at");
