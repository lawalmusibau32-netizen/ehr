-- AlterTable
ALTER TABLE "users" ADD COLUMN     "mfa_recovery_codes" TEXT,
ADD COLUMN     "otp_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "otp_expires_at" TIMESTAMP(3),
ADD COLUMN     "otp_hash" TEXT;
