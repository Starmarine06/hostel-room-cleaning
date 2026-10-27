-- AlterTable
ALTER TABLE "User" ADD COLUMN     "activatedAt" TIMESTAMP(3),
ALTER COLUMN "password" DROP NOT NULL;
