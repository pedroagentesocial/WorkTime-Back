-- Quien anula, corrige o cierra puede ser un admin multiempresa, que no tiene empresa propia:
-- las llaves apuntan al usuario sin exigir que sea de la misma empresa, como en check_ins
-- DropForeignKey
ALTER TABLE "time_entries" DROP CONSTRAINT "time_entries_company_id_voided_by_id_fkey";

-- DropForeignKey
ALTER TABLE "time_entry_corrections" DROP CONSTRAINT "time_entry_corrections_company_id_corrected_by_id_fkey";

-- DropForeignKey
ALTER TABLE "pay_period_closures" DROP CONSTRAINT "pay_period_closures_company_id_closed_by_id_fkey";

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entry_corrections" ADD CONSTRAINT "time_entry_corrections_corrected_by_id_fkey" FOREIGN KEY ("corrected_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pay_period_closures" ADD CONSTRAINT "pay_period_closures_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Triggers agregados a mano: Prisma no los modela

-- Sin la llave compuesta se conserva la garantia de que quien actua pertenece a la empresa:
-- es un usuario de ella o un admin multiempresa con membresia en ella
CREATE FUNCTION "assert_actor_in_company"() RETURNS trigger AS $$
DECLARE
  actor_id UUID := (to_jsonb(NEW) ->> TG_ARGV[0])::UUID;
BEGIN
  IF actor_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM "users" WHERE "id" = actor_id AND "company_id" = NEW.company_id)
     OR EXISTS (SELECT 1 FROM "company_memberships"
                WHERE "user_id" = actor_id AND "company_id" = NEW.company_id) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'assert_actor_in_company: % no pertenece a la empresa %', TG_ARGV[0], NEW.company_id
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "time_entries_voided_by_in_company"
BEFORE INSERT OR UPDATE OF "voided_by_id" ON "time_entries"
FOR EACH ROW EXECUTE FUNCTION "assert_actor_in_company"('voided_by_id');

CREATE TRIGGER "time_entry_corrections_corrected_by_in_company"
BEFORE INSERT OR UPDATE OF "corrected_by_id" ON "time_entry_corrections"
FOR EACH ROW EXECUTE FUNCTION "assert_actor_in_company"('corrected_by_id');

CREATE TRIGGER "pay_period_closures_closed_by_in_company"
BEFORE INSERT OR UPDATE OF "closed_by_id" ON "pay_period_closures"
FOR EACH ROW EXECUTE FUNCTION "assert_actor_in_company"('closed_by_id');

CREATE TRIGGER "check_ins_voided_by_in_company"
BEFORE INSERT OR UPDATE OF "voided_by_id" ON "check_ins"
FOR EACH ROW EXECUTE FUNCTION "assert_actor_in_company"('voided_by_id');
