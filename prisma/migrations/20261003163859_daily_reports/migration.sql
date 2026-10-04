-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "require_daily_report" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "daily_reports" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "daily_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_report_revisions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "saved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_report_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "daily_reports_company_id_work_date_idx" ON "daily_reports"("company_id", "work_date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_reports_employee_id_work_date_key" ON "daily_reports"("employee_id", "work_date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_reports_company_id_id_key" ON "daily_reports"("company_id", "id");

-- CreateIndex
CREATE INDEX "daily_report_revisions_report_id_saved_at_idx" ON "daily_report_revisions"("report_id", "saved_at" DESC);

-- AddForeignKey
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_company_id_employee_id_fkey" FOREIGN KEY ("company_id", "employee_id") REFERENCES "employees"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_report_revisions" ADD CONSTRAINT "daily_report_revisions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_report_revisions" ADD CONSTRAINT "daily_report_revisions_company_id_report_id_fkey" FOREIGN KEY ("company_id", "report_id") REFERENCES "daily_reports"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- El reporte no puede estar vacio ni pasar de 2000 caracteres
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_content_check"
  CHECK (char_length(btrim("content")) >= 1 AND char_length("content") <= 2000);
ALTER TABLE "daily_report_revisions" ADD CONSTRAINT "daily_report_revisions_content_check"
  CHECK (char_length("content") <= 2000);
