-- El vencimiento del permiso para corregir horas pasa de dia a instante: hay atajos de minutos
ALTER TABLE "employees" ADD COLUMN "self_edit_until_at" TIMESTAMPTZ(3);

-- Un permiso con dia vence al terminar ese dia en la zona del empleado, como hasta ahora
UPDATE "employees" AS e
SET "self_edit_until_at" = (e."self_edit_until" + 1)::timestamp AT TIME ZONE COALESCE(e."timezone", c."timezone")
FROM "companies" AS c
WHERE c."id" = e."company_id" AND e."self_edit_until" IS NOT NULL;

ALTER TABLE "employees" DROP COLUMN "self_edit_until";
ALTER TABLE "employees" RENAME COLUMN "self_edit_until_at" TO "self_edit_until";
