-- DropForeignKey
ALTER TABLE "staffProfile" DROP CONSTRAINT "staffProfile_memberId_fkey";

-- AlterTable
ALTER TABLE "staffProfile" ALTER COLUMN "memberId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "staffProfile" ADD CONSTRAINT "staffProfile_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "member"("id") ON DELETE SET NULL ON UPDATE CASCADE;
