-- AlterTable
ALTER TABLE "GameProfile" ADD COLUMN "contactEmail" TEXT;

-- CreateIndex
CREATE INDEX "GameProfile_contactEmail_idx" ON "GameProfile"("contactEmail");
