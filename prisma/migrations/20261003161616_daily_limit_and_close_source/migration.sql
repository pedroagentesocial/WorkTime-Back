-- CreateEnum
CREATE TYPE "time_entry_close_source" AS ENUM ('employee', 'admin', 'daily_limit');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "daily_limit_minutes" INTEGER;

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "daily_limit_minutes" INTEGER;

-- AlterTable
ALTER TABLE "time_entries" ADD COLUMN     "close_source" "time_entry_close_source",
ADD COLUMN     "daily_limit_waived" BOOLEAN NOT NULL DEFAULT false;

-- Limite diario entre 1 minuto y 24 horas
ALTER TABLE "companies" ADD CONSTRAINT "companies_daily_limit_minutes_check"
  CHECK ("daily_limit_minutes" IS NULL OR ("daily_limit_minutes" BETWEEN 1 AND 1440));
ALTER TABLE "employees" ADD CONSTRAINT "employees_daily_limit_minutes_check"
  CHECK ("daily_limit_minutes" IS NULL OR ("daily_limit_minutes" BETWEEN 1 AND 1440));
