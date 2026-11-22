-- CreateEnum
CREATE TYPE "OrchestrationStatus" AS ENUM ('PLANNING', 'RUNNING', 'SYNTHESIZING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'WAITING_APPROVAL', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "UsageKind" ADD VALUE 'ORCHESTRATION_RUN';

-- CreateTable
CREATE TABLE "orchestrations" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT,
    "goal" TEXT NOT NULL,
    "status" "OrchestrationStatus" NOT NULL DEFAULT 'PLANNING',
    "planSummary" TEXT,
    "output" TEXT,
    "error" TEXT,
    "sources" TEXT[],
    "idempotencyKey" TEXT,
    "durable" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "modelCalls" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orchestrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orchestration_tasks" (
    "id" TEXT NOT NULL,
    "orchestrationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "tools" TEXT[],
    "dependsOn" TEXT[],
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "leaseUntil" TIMESTAMP(3),
    "runAfter" TIMESTAMP(3),
    "output" TEXT,
    "error" TEXT,
    "toolCalls" JSONB,
    "modelCalls" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orchestration_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "orchestrationId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "requestedById" TEXT,
    "tools" TEXT[],
    "reason" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orchestrations_workspaceId_createdAt_idx" ON "orchestrations"("workspaceId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "orchestrations_status_updatedAt_idx" ON "orchestrations"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "orchestrations_workspaceId_idempotencyKey_key" ON "orchestrations"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "orchestration_tasks_status_leaseUntil_idx" ON "orchestration_tasks"("status", "leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "orchestration_tasks_orchestrationId_key_key" ON "orchestration_tasks"("orchestrationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "approval_requests_taskId_key" ON "approval_requests"("taskId");

-- CreateIndex
CREATE INDEX "approval_requests_workspaceId_status_createdAt_idx" ON "approval_requests"("workspaceId", "status", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "orchestrations" ADD CONSTRAINT "orchestrations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orchestrations" ADD CONSTRAINT "orchestrations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orchestration_tasks" ADD CONSTRAINT "orchestration_tasks_orchestrationId_fkey" FOREIGN KEY ("orchestrationId") REFERENCES "orchestrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_orchestrationId_fkey" FOREIGN KEY ("orchestrationId") REFERENCES "orchestrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "orchestration_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
