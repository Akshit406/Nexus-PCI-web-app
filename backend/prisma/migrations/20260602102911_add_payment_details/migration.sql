-- AlterTable
ALTER TABLE "PaymentStatus" ADD COLUMN "paidAt" DATETIME;
ALTER TABLE "PaymentStatus" ADD COLUMN "payerBank" TEXT;
ALTER TABLE "PaymentStatus" ADD COLUMN "paymentAmount" REAL;
ALTER TABLE "PaymentStatus" ADD COLUMN "paymentCurrency" TEXT DEFAULT 'MXN';
ALTER TABLE "PaymentStatus" ADD COLUMN "paymentReference" TEXT;
