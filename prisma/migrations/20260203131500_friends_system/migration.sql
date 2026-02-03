-- AlterTable
ALTER TABLE "GameProfile" ADD COLUMN "publicId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "GameProfile_publicId_key" ON "GameProfile"("publicId");

-- CreateTable
CREATE TABLE "Friendship" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "aEmail" TEXT NOT NULL,
    "bEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Friendship_aEmail_bEmail_key" ON "Friendship"("aEmail", "bEmail");

-- CreateIndex
CREATE INDEX "Friendship_aEmail_updatedAt_idx" ON "Friendship"("aEmail", "updatedAt");

-- CreateIndex
CREATE INDEX "Friendship_bEmail_updatedAt_idx" ON "Friendship"("bEmail", "updatedAt");

-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_aEmail_fkey" FOREIGN KEY ("aEmail") REFERENCES "GameProfile"("email") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_bEmail_fkey" FOREIGN KEY ("bEmail") REFERENCES "GameProfile"("email") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "FriendGift" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromEmail" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "lastGiftAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "FriendGift_fromEmail_toEmail_key" ON "FriendGift"("fromEmail", "toEmail");

-- CreateIndex
CREATE INDEX "FriendGift_toEmail_updatedAt_idx" ON "FriendGift"("toEmail", "updatedAt");

-- CreateIndex
CREATE INDEX "FriendGift_fromEmail_updatedAt_idx" ON "FriendGift"("fromEmail", "updatedAt");

-- AddForeignKey
ALTER TABLE "FriendGift" ADD CONSTRAINT "FriendGift_fromEmail_fkey" FOREIGN KEY ("fromEmail") REFERENCES "GameProfile"("email") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendGift" ADD CONSTRAINT "FriendGift_toEmail_fkey" FOREIGN KEY ("toEmail") REFERENCES "GameProfile"("email") ON DELETE CASCADE ON UPDATE CASCADE;

