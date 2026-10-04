-- AlterTable
ALTER TABLE "time_entries"
  ADD COLUMN "created_reason" VARCHAR(500),
  ADD COLUMN "voided_at" TIMESTAMPTZ(3),
  ADD COLUMN "voided_by_id" UUID,
  ADD COLUMN "void_reason" VARCHAR(500);

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Un registro anulado siempre dice quien, cuando y por que
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_void_consistent" CHECK (
  (voided_at IS NULL AND voided_by_id IS NULL AND void_reason IS NULL)
  OR (voided_at IS NOT NULL AND voided_by_id IS NOT NULL AND void_reason IS NOT NULL)
);

ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_created_reason_length" CHECK (
  created_reason IS NULL OR char_length(created_reason) BETWEEN 5 AND 500
);

ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_void_reason_length" CHECK (
  void_reason IS NULL OR char_length(void_reason) BETWEEN 5 AND 500
);

-- Un registro anulado ya no cuenta como entrada abierta
DROP INDEX "time_entries_one_open_per_employee";
CREATE UNIQUE INDEX "time_entries_one_open_per_employee" ON "time_entries"("employee_id") WHERE (clock_out_at IS NULL AND voided_at IS NULL);
