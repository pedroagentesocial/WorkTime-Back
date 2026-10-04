-- CreateTable
CREATE TABLE "pay_period_closures" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "total_centihours" BIGINT NOT NULL,
    "closed_by_id" UUID NOT NULL,
    "closed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pay_period_closures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pay_period_closures_company_id_period_start_key" ON "pay_period_closures"("company_id", "period_start");

-- AddForeignKey
ALTER TABLE "pay_period_closures" ADD CONSTRAINT "pay_period_closures_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pay_period_closures" ADD CONSTRAINT "pay_period_closures_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Un periodo de pago dura exactamente 14 dias
ALTER TABLE "pay_period_closures" ADD CONSTRAINT "pay_period_closures_length" CHECK (period_end = period_start + 13);

-- Un periodo cerrado no se modifica ni se borra, ni siquiera desde la base de datos
CREATE FUNCTION "pay_period_closures_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'pay_period_closures_immutable: un periodo cerrado no se modifica ni se borra';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "pay_period_closures_immutable"
BEFORE UPDATE OR DELETE ON "pay_period_closures"
FOR EACH ROW EXECUTE FUNCTION "pay_period_closures_immutable"();
