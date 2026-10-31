-- AlterTable
ALTER TABLE "time_entries" ADD COLUMN "clock_in_latitude" DOUBLE PRECISION,
ADD COLUMN "clock_in_longitude" DOUBLE PRECISION,
ADD COLUMN "clock_in_accuracy_m" DOUBLE PRECISION;

-- Ubicacion de la entrada: o van las tres columnas o ninguna, dentro de rangos validos
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_clock_in_location_valid" CHECK (
  (clock_in_latitude IS NULL AND clock_in_longitude IS NULL AND clock_in_accuracy_m IS NULL)
  OR (
    clock_in_latitude BETWEEN -90 AND 90
    AND clock_in_longitude BETWEEN -180 AND 180
    AND clock_in_accuracy_m >= 0
    AND clock_in_accuracy_m <= 100000
  )
);
