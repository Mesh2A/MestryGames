CREATE TABLE "ResetToken" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "used" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "ResetToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ResetToken_tokenHash_key" ON "ResetToken"("tokenHash");
CREATE INDEX "ResetToken_email_expiresAt_idx" ON "ResetToken"("email", "expiresAt");
