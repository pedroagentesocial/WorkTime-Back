-- AlterTable
ALTER TABLE "companies" ADD COLUMN "enforce_work_sites" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "work_sites" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "radius_m" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "work_sites_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "time_entries" ADD COLUMN "clock_in_zone" VARCHAR(10),
ADD COLUMN "clock_in_site_id" UUID,
ADD COLUMN "clock_in_distance_m" INTEGER;

-- CreateIndex
CREATE INDEX "work_sites_company_id_active_idx" ON "work_sites"("company_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "work_sites_company_id_id_key" ON "work_sites"("company_id", "id");

-- AddForeignKey
ALTER TABLE "work_sites" ADD CONSTRAINT "work_sites_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_company_id_clock_in_site_id_fkey" FOREIGN KEY ("company_id", "clock_in_site_id") REFERENCES "work_sites"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Restricciones CHECK (agregadas a mano: Prisma no las modela)
ALTER TABLE "work_sites" ADD CONSTRAINT "work_sites_valid" CHECK (
  latitude BETWEEN -90 AND 90
  AND longitude BETWEEN -180 AND 180
  AND radius_m BETWEEN 10 AND 5000
  AND char_length(btrim(name)) >= 1
);

-- Resultado de la zona al marcar la entrada: solo existe si hubo ubicacion, y el sitio y la distancia van con el
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_clock_in_zone_valid" CHECK (
  (
    clock_in_zone IS NULL
    AND clock_in_site_id IS NULL
    AND clock_in_distance_m IS NULL
  )
  OR (
    clock_in_zone IN ('inside', 'outside')
    AND clock_in_site_id IS NOT NULL
    AND clock_in_distance_m >= 0
    AND clock_in_latitude IS NOT NULL
  )
);
