-- 第11章：添付ファイルの状態、CSV エクスポート、非同期ジョブ（Outbox）。
-- attachment は第11章まで書き込む処理がなく空なので、NOT NULL の列を既定値なしで足す。

-- CreateEnum
CREATE TYPE "AttachmentStatus" AS ENUM ('pending', 'uploaded');

-- CreateEnum
CREATE TYPE "CustomerExportStatus" AS ENUM ('pending', 'done', 'failed');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed');

-- AlterTable
ALTER TABLE "attachment" ADD COLUMN     "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "fileName" TEXT NOT NULL,
ADD COLUMN     "status" "AttachmentStatus" NOT NULL DEFAULT 'pending',
ADD COLUMN     "uploadedByUserId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "customerExport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "status" "CustomerExportStatus" NOT NULL DEFAULT 'pending',
    "s3Key" TEXT,
    "rowCount" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "customerExport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "publishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customerExport_organizationId_createdAt_idx" ON "customerExport"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "customerExport_organizationId_id_key" ON "customerExport"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "job_idempotencyKey_key" ON "job"("idempotencyKey");

-- CreateIndex
CREATE INDEX "job_status_createdAt_idx" ON "job"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "attachment_organizationId_id_key" ON "attachment"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "customerExport" ADD CONSTRAINT "customerExport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

