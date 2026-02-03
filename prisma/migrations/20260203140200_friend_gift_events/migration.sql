-- CreateTable
CREATE TABLE "FriendGiftEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromEmail" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "coins" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "FriendGiftEvent_toEmail_createdAt_idx" ON "FriendGiftEvent"("toEmail", "createdAt");

-- CreateIndex
CREATE INDEX "FriendGiftEvent_fromEmail_createdAt_idx" ON "FriendGiftEvent"("fromEmail", "createdAt");

-- AddForeignKey
ALTER TABLE "FriendGiftEvent" ADD CONSTRAINT "FriendGiftEvent_fromEmail_fkey" FOREIGN KEY ("fromEmail") REFERENCES "GameProfile"("email") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendGiftEvent" ADD CONSTRAINT "FriendGiftEvent_toEmail_fkey" FOREIGN KEY ("toEmail") REFERENCES "GameProfile"("email") ON DELETE CASCADE ON UPDATE CASCADE;

