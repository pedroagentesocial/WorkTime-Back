/*
  Warnings:

  - Added the required column `timezone` to the `time_entries` table without a default value. This is not possible if the table is not empty.
  - Added the required column `work_date` to the `time_entries` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "timezone" VARCHAR(64);

-- AlterTable
ALTER TABLE "time_entries" ADD COLUMN     "timezone" VARCHAR(64) NOT NULL,
ADD COLUMN     "work_date" DATE NOT NULL;

-- CreateIndex
CREATE INDEX "time_entries_company_id_work_date_idx" ON "time_entries"("company_id", "work_date");

-- CreateIndex
CREATE INDEX "time_entries_employee_id_work_date_idx" ON "time_entries"("employee_id", "work_date");
