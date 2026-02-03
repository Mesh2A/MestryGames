-- CreateTable
CREATE TABLE "FriendRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromEmail" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "FriendRequest_fromEmail_toEmail_key" ON "FriendRequest"("fromEmail", "toEmail");

-- CreateIndex
CREATE INDEX "FriendRequest_toEmail_createdAt_idx" ON "FriendRequest"("toEmail", "createdAt");

-- CreateIndex
CREATE INDEX "FriendRequest_fromEmail_createdAt_idx" ON "FriendRequest"("fromEmail", "createdAt");

-- AddForeignKey
ALTER TABLE "FriendRequest" ADD CONSTRAINT "FriendRequest_fromEmail_fkey" FOREIGN KEY ("fromEmail") REFERENCES "GameProfile"("email") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendRequest" ADD CONSTRAINT "FriendRequest_toEmail_fkey" FOREIGN KEY ("toEmail") REFERENCES "GameProfile"("email") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "FriendRequestEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromEmail" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "FriendRequestEvent_toEmail_createdAt_idx" ON "FriendRequestEvent"("toEmail", "createdAt");

-- CreateIndex
CREATE INDEX "FriendRequestEvent_fromEmail_createdAt_idx" ON "FriendRequestEvent"("fromEmail", "createdAt");

-- AddForeignKey
ALTER TABLE "FriendRequestEvent" ADD CONSTRAINT "FriendRequestEvent_fromEmail_fkey" FOREIGN KEY ("fromEmail") REFERENCES "GameProfile"("email") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendRequestEvent" ADD CONSTRAINT "FriendRequestEvent_toEmail_fkey" FOREIGN KEY ("toEmail") REFERENCES "GameProfile"("email") ON DELETE CASCADE ON UPDATE CASCADE;

