-- AlterTable
ALTER TABLE "companies" ALTER COLUMN "require_daily_report" SET DEFAULT true;

-- Las empresas que ya existian tambien pasan a exigir el reporte
UPDATE "companies" SET "require_daily_report" = true;
