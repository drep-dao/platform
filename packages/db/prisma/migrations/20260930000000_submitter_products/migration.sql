-- §2.1 — "FOR BUILDERS": products/protocols shipped, as [{url, description, iconDataUrl?}]. Optional.
-- A non-empty previous_funding OR a non-empty products list auto-labels the applicant BUILDER.
ALTER TABLE "submitter_application" ADD COLUMN "products" JSONB;
ALTER TABLE "submitter_application_history" ADD COLUMN "products" JSONB;
