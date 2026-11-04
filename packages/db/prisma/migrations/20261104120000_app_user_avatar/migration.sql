-- §2.1 — profile photo for any account (plain viewers included), shown on comments/votes/authored docs.
ALTER TABLE "app_user" ADD COLUMN "avatar_data_url" TEXT;
