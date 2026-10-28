-- AlterTable
ALTER TABLE "User" ADD COLUMN     "regNo" TEXT;

-- AlterTable
ALTER TABLE "CleaningRequest" ADD COLUMN     "rating" INTEGER,
ADD COLUMN     "feedback" TEXT,
ADD COLUMN     "overdueAlertedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "User_regNo_key" ON "User"("regNo");

-- CreateIndex
CREATE INDEX "CleaningRequest_requestedAt_idx" ON "CleaningRequest"("requestedAt");
