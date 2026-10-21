-- CreateTable
CREATE TABLE "UsageRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "estimatedCostMicroUsd" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UsageRecord_userId_createdAt_idx" ON "UsageRecord"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
