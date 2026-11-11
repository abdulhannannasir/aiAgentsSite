-- CreateEnum
CREATE TYPE "ToolInvocationStatus" AS ENUM ('SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "tool_invocations" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "status" "ToolInvocationStatus" NOT NULL,
    "summary" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tool_invocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tool_invocations_executionId_createdAt_idx" ON "tool_invocations"("executionId", "createdAt");

-- CreateIndex
CREATE INDEX "tool_invocations_toolId_createdAt_idx" ON "tool_invocations"("toolId", "createdAt");

-- AddForeignKey
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "agent_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
