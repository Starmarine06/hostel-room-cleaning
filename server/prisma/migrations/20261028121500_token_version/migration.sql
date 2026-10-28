-- AlterTable
ALTER TABLE "User" DROP COLUMN "passwordChangedAt",
ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 0;
