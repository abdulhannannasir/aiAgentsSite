-- CreateTable
CREATE TABLE "agent_favorites" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_favorites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_reviews" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentKey" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_favorites_userId_agentKey_key" ON "agent_favorites"("userId", "agentKey");

-- CreateIndex
CREATE INDEX "agent_reviews_agentKey_updatedAt_idx" ON "agent_reviews"("agentKey", "updatedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "agent_reviews_userId_agentKey_key" ON "agent_reviews"("userId", "agentKey");

-- CreateIndex
CREATE INDEX "agent_executions_agentKey_createdAt_idx" ON "agent_executions"("agentKey", "createdAt");

-- AddForeignKey
ALTER TABLE "agent_favorites" ADD CONSTRAINT "agent_favorites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_reviews" ADD CONSTRAINT "agent_reviews_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
