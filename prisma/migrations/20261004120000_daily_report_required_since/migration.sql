-- AlterTable
-- Desde cuando se exige el reporte diario: los dias anteriores no se vuelven pendientes ni bloquean la entrada
ALTER TABLE "companies" ADD COLUMN "daily_report_required_since" DATE NOT NULL DEFAULT CURRENT_DATE;
