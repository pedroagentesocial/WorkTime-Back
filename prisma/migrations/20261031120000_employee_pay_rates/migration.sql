-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "currency" CHAR(3) NOT NULL DEFAULT 'USD';

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "deactivated_on" DATE;

-- AlterTable
ALTER TABLE "pay_period_closures" ADD COLUMN     "currency" CHAR(3);

-- CreateTable
CREATE TABLE "employee_pay_rates" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "effective_from" DATE NOT NULL,
    "changed_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "employee_pay_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pay_period_closure_pays" (
    "closure_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "amount_cents" BIGINT NOT NULL,

    CONSTRAINT "pay_period_closure_pays_pkey" PRIMARY KEY ("closure_id","employee_id")
);

-- CreateIndex
CREATE INDEX "employee_pay_rates_company_id_idx" ON "employee_pay_rates"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_pay_rates_employee_id_effective_from_key" ON "employee_pay_rates"("employee_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "pay_period_closures_company_id_id_key" ON "pay_period_closures"("company_id", "id");

-- AddForeignKey
ALTER TABLE "employee_pay_rates" ADD CONSTRAINT "employee_pay_rates_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_pay_rates" ADD CONSTRAINT "employee_pay_rates_company_id_employee_id_fkey" FOREIGN KEY ("company_id", "employee_id") REFERENCES "employees"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_pay_rates" ADD CONSTRAINT "employee_pay_rates_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pay_period_closure_pays" ADD CONSTRAINT "pay_period_closure_pays_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pay_period_closure_pays" ADD CONSTRAINT "pay_period_closure_pays_company_id_closure_id_fkey" FOREIGN KEY ("company_id", "closure_id") REFERENCES "pay_period_closures"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pay_period_closure_pays" ADD CONSTRAINT "pay_period_closure_pays_company_id_employee_id_fkey" FOREIGN KEY ("company_id", "employee_id") REFERENCES "employees"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Restricciones y triggers agregados a mano: Prisma no los modela

ALTER TABLE "companies" ADD CONSTRAINT "companies_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "pay_period_closures" ADD CONSTRAINT "pay_period_closures_currency_format"
  CHECK ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$');

-- Por hora o sueldo fijo por periodo; montos en centavos, sin negativos y con un tope razonable
ALTER TABLE "employee_pay_rates" ADD CONSTRAINT "employee_pay_rates_kind" CHECK ("kind" IN ('hourly', 'salary'));
ALTER TABLE "employee_pay_rates" ADD CONSTRAINT "employee_pay_rates_amount"
  CHECK ("amount_cents" BETWEEN 0 AND 1000000000);
ALTER TABLE "pay_period_closure_pays" ADD CONSTRAINT "pay_period_closure_pays_amount" CHECK ("amount_cents" >= 0);

-- Quien cambia un sueldo debe ser de la empresa o tener membresia en ella, como en las correcciones
CREATE TRIGGER "employee_pay_rates_changed_by_in_company"
BEFORE INSERT OR UPDATE OF "changed_by_id" ON "employee_pay_rates"
FOR EACH ROW EXECUTE FUNCTION "assert_actor_in_company"('changed_by_id');

-- Un cambio de sueldo no puede regir dentro de un periodo ya cerrado: su pago ya se congelo
CREATE FUNCTION "employee_pay_rates_period_lock"() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "pay_period_closures"
    WHERE "company_id" = NEW.company_id AND "period_end" >= NEW.effective_from
  ) THEN
    RAISE EXCEPTION 'employee_pay_rates_period_lock: % cae en un periodo cerrado', NEW.effective_from
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "employee_pay_rates_period_lock"
BEFORE INSERT OR UPDATE ON "employee_pay_rates"
FOR EACH ROW EXECUTE FUNCTION "employee_pay_rates_period_lock"();

-- El pago congelado al cerrar no se toca, igual que el cierre
CREATE TRIGGER "pay_period_closure_pays_immutable"
BEFORE UPDATE OR DELETE ON "pay_period_closure_pays"
FOR EACH ROW EXECUTE FUNCTION "pay_period_closures_immutable"();
