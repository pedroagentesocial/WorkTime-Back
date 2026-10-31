-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "allow_check_ins" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "check_ins" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "checked_in_at" TIMESTAMPTZ(3) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL,
    "work_date" DATE NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracy_m" DOUBLE PRECISION NOT NULL,
    "zone" VARCHAR(10),
    "site_id" UUID,
    "distance_m" INTEGER,
    "note" VARCHAR(200),
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_id" UUID,
    "void_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "check_ins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "check_ins_company_id_checked_in_at_idx" ON "check_ins"("company_id", "checked_in_at" DESC);

-- CreateIndex
CREATE INDEX "check_ins_employee_id_checked_in_at_idx" ON "check_ins"("employee_id", "checked_in_at" DESC);

-- CreateIndex
CREATE INDEX "check_ins_employee_id_work_date_idx" ON "check_ins"("employee_id", "work_date");

-- CreateIndex
CREATE UNIQUE INDEX "check_ins_company_id_id_key" ON "check_ins"("company_id", "id");

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_company_id_employee_id_fkey" FOREIGN KEY ("company_id", "employee_id") REFERENCES "employees"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_company_id_site_id_fkey" FOREIGN KEY ("company_id", "site_id") REFERENCES "work_sites"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_company_id_voided_by_id_fkey" FOREIGN KEY ("company_id", "voided_by_id") REFERENCES "users"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Restricciones CHECK (agregadas a mano: Prisma no las modela)
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_location_valid" CHECK (
  latitude BETWEEN -90 AND 90
  AND longitude BETWEEN -180 AND 180
  AND accuracy_m >= 0
);

-- La zona solo existe con el sitio y la distancia
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_zone_valid" CHECK (
  (zone IS NULL AND site_id IS NULL AND distance_m IS NULL)
  OR (zone IN ('inside', 'outside') AND site_id IS NOT NULL AND distance_m >= 0)
);

ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_note_valid" CHECK (
  note IS NULL OR char_length(btrim(note)) BETWEEN 1 AND 200
);

-- Anulacion: los tres campos juntos o ninguno
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_void_consistent" CHECK (
  (voided_at IS NULL AND voided_by_id IS NULL AND void_reason IS NULL)
  OR (voided_at IS NOT NULL AND voided_by_id IS NOT NULL AND char_length(void_reason) BETWEEN 5 AND 500)
);

-- Un check-in es evidencia: no se borra y solo admite anularse una vez, sin tocar lo registrado
CREATE FUNCTION check_ins_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Los check-ins no se borran' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'El check-in ya esta anulado' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.id, NEW.company_id, NEW.employee_id, NEW.checked_in_at, NEW.timezone, NEW.work_date,
      NEW.latitude, NEW.longitude, NEW.accuracy_m, NEW.zone, NEW.site_id, NEW.distance_m,
      NEW.note, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.company_id, OLD.employee_id, OLD.checked_in_at, OLD.timezone, OLD.work_date,
      OLD.latitude, OLD.longitude, OLD.accuracy_m, OLD.zone, OLD.site_id, OLD.distance_m,
      OLD.note, OLD.created_at) THEN
    RAISE EXCEPTION 'Un check-in solo se puede anular' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER check_ins_guard
  BEFORE UPDATE OR DELETE ON "check_ins"
  FOR EACH ROW EXECUTE FUNCTION check_ins_guard();
