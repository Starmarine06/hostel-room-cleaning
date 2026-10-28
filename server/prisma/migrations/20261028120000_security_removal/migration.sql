-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "passwordChangedAt" TIMESTAMP(3);

-- A removed student leaves their requests behind without a requester
ALTER TABLE "CleaningRequest" ALTER COLUMN "requestedBy" DROP NOT NULL;
ALTER TABLE "CleaningRequest" DROP CONSTRAINT "CleaningRequest_requestedBy_fkey";
ALTER TABLE "CleaningRequest" ADD CONSTRAINT "CleaningRequest_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
