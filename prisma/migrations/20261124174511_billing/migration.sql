-- AlterTable
ALTER TABLE "subscription" ADD COLUMN     "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastEventAt" TIMESTAMPTZ(3),
ADD COLUMN     "stripePriceId" TEXT;

-- CreateTable
CREATE TABLE "stripeEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "organizationId" TEXT,
    "result" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stripeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stripeEvent_organizationId_createdAt_idx" ON "stripeEvent"("organizationId", "createdAt");
