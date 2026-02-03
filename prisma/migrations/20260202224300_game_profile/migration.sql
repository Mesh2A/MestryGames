-- CreateTable
CREATE TABLE "GameProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "GameProfile_email_key" ON "GameProfile"("email");

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileEmail" TEXT NOT NULL,
    "stripeSessionId" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "coins" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "unitAmount" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_stripeSessionId_key" ON "Purchase"("stripeSessionId");

-- CreateIndex
CREATE INDEX "Purchase_profileEmail_createdAt_idx" ON "Purchase"("profileEmail", "createdAt");

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_profileEmail_fkey" FOREIGN KEY ("profileEmail") REFERENCES "GameProfile"("email") ON DELETE CASCADE ON UPDATE CASCADE;
