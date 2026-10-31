-- Un CHECK con NULL no falla: la version anterior dejaba pasar una ubicacion a medias.
-- Ahora se exige que vayan las tres columnas o ninguna, y los rangos solo se miran si hay ubicacion
ALTER TABLE "time_entries" DROP CONSTRAINT "time_entries_clock_in_location_valid";

ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_clock_in_location_valid" CHECK (
  num_nonnulls(clock_in_latitude, clock_in_longitude, clock_in_accuracy_m) IN (0, 3)
  AND (
    clock_in_latitude IS NULL
    OR (
      clock_in_latitude BETWEEN -90 AND 90
      AND clock_in_longitude BETWEEN -180 AND 180
      AND clock_in_accuracy_m >= 0
      AND clock_in_accuracy_m <= 100000
    )
  )
);
