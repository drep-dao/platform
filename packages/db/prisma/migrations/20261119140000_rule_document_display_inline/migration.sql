-- §27 — author/board option to display attached PDFs inline on the platform (default: download-only).
ALTER TABLE "rule_document" ADD COLUMN "display_files_inline" BOOLEAN NOT NULL DEFAULT false;
