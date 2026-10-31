-- Bajas del empleado: reemplazan a employees.deactivated_on, que solo guardaba la ultima

-- CreateTable
CREATE TABLE "employee_inactive_spans" (
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "from_day" DATE NOT NULL,
    "to_day" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "employee_inactive_spans_pkey" PRIMARY KEY ("employee_id","from_day"),
    CONSTRAINT "employee_inactive_spans_order" CHECK ("to_day" IS NULL OR "to_day" >= "from_day")
);

-- CreateIndex
CREATE INDEX "employee_inactive_spans_company_id_idx" ON "employee_inactive_spans"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_inactive_spans_one_open" ON "employee_inactive_spans"("employee_id") WHERE (to_day IS NULL);

-- AddForeignKey
ALTER TABLE "employee_inactive_spans" ADD CONSTRAINT "employee_inactive_spans_company_id_employee_id_fkey" FOREIGN KEY ("company_id", "employee_id") REFERENCES "employees"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Los inactivos de hoy quedan de baja desde el dia siguiente al ultimo que se conoce activo:
-- la fecha de baja guardada, si no la de su ultima desactivacion auditada, si no la de su alta
INSERT INTO "employee_inactive_spans" ("company_id", "employee_id", "from_day", "updated_at")
SELECT e."company_id",
       e."id",
       COALESCE(
         e."deactivated_on",
         (
           SELECT (MAX(ev."created_at") AT TIME ZONE COALESCE(e."timezone", c."timezone"))::date
           FROM "security_events" ev
           WHERE ev."type" = 'employee.deactivated' AND ev."metadata"->>'employeeId' = e."id"::text
         ),
         (e."created_at" AT TIME ZONE COALESCE(e."timezone", c."timezone"))::date
       ) + 1,
       CURRENT_TIMESTAMP
FROM "employees" e
JOIN "users" u ON u."id" = e."user_id"
JOIN "companies" c ON c."id" = e."company_id"
WHERE u."status" = 'inactive';

-- AlterTable
ALTER TABLE "employees" DROP COLUMN "deactivated_on";

-- Una baja no puede cambiar dias de un periodo cerrado: el pago de esos dias ya se congelo.
-- Borrarla solo pasa al eliminar a un empleado sin historial, asi que no se revisa
CREATE FUNCTION "employee_inactive_spans_period_lock"() RETURNS trigger AS $$
DECLARE
  last_closed DATE;
BEGIN
  SELECT MAX("period_end") INTO last_closed FROM "pay_period_closures"
  WHERE "company_id" = NEW.company_id;
  IF last_closed IS NOT NULL AND (
    (TG_OP = 'INSERT' AND NEW.from_day <= last_closed)
    OR (TG_OP = 'UPDATE' AND NEW.from_day <> OLD.from_day)
    OR (TG_OP = 'UPDATE' AND NEW.to_day IS DISTINCT FROM OLD.to_day
        AND COALESCE(LEAST(NEW.to_day, OLD.to_day), NEW.to_day, OLD.to_day) < last_closed)
  ) THEN
    RAISE EXCEPTION 'employee_inactive_spans_period_lock: la baja toca un periodo cerrado'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "employee_inactive_spans_period_lock"
BEFORE INSERT OR UPDATE ON "employee_inactive_spans"
FOR EACH ROW EXECUTE FUNCTION "employee_inactive_spans_period_lock"();

-- Quitar un cambio de sueldo de un periodo cerrado tampoco se permite si ese pago ya se congelo.
-- Un empleado sin pagos congelados se puede eliminar con su historial de sueldo
CREATE FUNCTION "employee_pay_rates_delete_lock"() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "pay_period_closures"
    WHERE "company_id" = OLD.company_id AND "period_end" >= OLD.effective_from
  ) AND EXISTS (
    SELECT 1 FROM "pay_period_closure_pays" WHERE "employee_id" = OLD.employee_id
  ) THEN
    RAISE EXCEPTION 'employee_pay_rates_delete_lock: % cae en un periodo cerrado', OLD.effective_from
      USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "employee_pay_rates_delete_lock"
BEFORE DELETE ON "employee_pay_rates"
FOR EACH ROW EXECUTE FUNCTION "employee_pay_rates_delete_lock"();
