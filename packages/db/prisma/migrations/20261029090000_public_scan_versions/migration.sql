-- "Edit and Rescan": a scan can be forked into a new version that keeps the old one and links to its parent.
ALTER TABLE "public_scan" ADD COLUMN "parent_scan_id" uuid;
ALTER TABLE "public_scan" ADD COLUMN "version" integer NOT NULL DEFAULT 1;
ALTER TABLE "public_scan"
  ADD CONSTRAINT "public_scan_parent_scan_id_fkey"
  FOREIGN KEY ("parent_scan_id") REFERENCES "public_scan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "public_scan_parent_scan_id_idx" ON "public_scan"("parent_scan_id");
