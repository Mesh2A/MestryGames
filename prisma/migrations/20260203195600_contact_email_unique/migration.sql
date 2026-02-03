-- DropIndex
DROP INDEX IF EXISTS "GameProfile_contactEmail_idx";

-- CreateIndex
CREATE UNIQUE INDEX "GameProfile_contactEmail_key" ON "GameProfile"("contactEmail");
