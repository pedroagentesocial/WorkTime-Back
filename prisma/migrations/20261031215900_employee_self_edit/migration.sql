-- Permiso para que el empleado corrija sus propias horas y cuantos dias hacia atras
-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "self_edit_days" INTEGER NOT NULL DEFAULT 7;

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "allow_self_edit" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "self_edit_until" DATE;

-- Entre 1 y 31 dias hacia atras
ALTER TABLE "companies" ADD CONSTRAINT "companies_self_edit_days" CHECK ("self_edit_days" BETWEEN 1 AND 31);
