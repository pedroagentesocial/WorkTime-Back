-- Quien anula o cierra un periodo debe ser de la misma empresa, tambien a nivel de base de datos
ALTER TABLE "time_entries" DROP CONSTRAINT "time_entries_voided_by_id_fkey";
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_company_id_voided_by_id_fkey" FOREIGN KEY ("company_id", "voided_by_id") REFERENCES "users"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "pay_period_closures" DROP CONSTRAINT "pay_period_closures_closed_by_id_fkey";
ALTER TABLE "pay_period_closures" ADD CONSTRAINT "pay_period_closures_company_id_closed_by_id_fkey" FOREIGN KEY ("company_id", "closed_by_id") REFERENCES "users"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Red de seguridad: las horas de un periodo cerrado no cambian aunque una ruta futura olvide la guarda de la app
CREATE FUNCTION "time_entries_period_lock"() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pay_period_closures c
    WHERE c.company_id = NEW.company_id AND NEW.work_date BETWEEN c.period_start AND c.period_end
  ) OR (TG_OP = 'UPDATE' AND EXISTS (
    SELECT 1 FROM pay_period_closures c
    WHERE c.company_id = OLD.company_id AND OLD.work_date BETWEEN c.period_start AND c.period_end
  )) THEN
    RAISE EXCEPTION 'time_entries_period_closed: el periodo de pago esta cerrado y sus horas no cambian';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "time_entries_period_lock"
BEFORE INSERT OR UPDATE ON "time_entries"
FOR EACH ROW EXECUTE FUNCTION "time_entries_period_lock"();
