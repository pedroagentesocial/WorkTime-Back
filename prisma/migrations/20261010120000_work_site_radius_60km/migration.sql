-- El radio maximo de una zona sube de 5 km a 60 km
ALTER TABLE "work_sites" DROP CONSTRAINT "work_sites_valid";
ALTER TABLE "work_sites" ADD CONSTRAINT "work_sites_valid" CHECK (
  latitude BETWEEN -90 AND 90
  AND longitude BETWEEN -180 AND 180
  AND radius_m BETWEEN 10 AND 60000
  AND char_length(btrim(name)) >= 1
);
