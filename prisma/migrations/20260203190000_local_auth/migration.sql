-- AlterTable
ALTER TABLE "GameProfile" ADD COLUMN "username" TEXT;
ALTER TABLE "GameProfile" ADD COLUMN "passwordHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "GameProfile_username_key" ON "GameProfile"("username");
