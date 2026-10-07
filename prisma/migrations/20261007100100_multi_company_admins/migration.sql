-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN "company_id" UUID;

-- CreateTable
CREATE TABLE "multi_company_admins" (
    "user_id" UUID NOT NULL,
    "max_companies" INTEGER NOT NULL,
    "max_employees_per_company" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "multi_company_admins_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "company_memberships" (
    "user_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_memberships_pkey" PRIMARY KEY ("user_id","company_id")
);

-- CreateIndex
CREATE INDEX "company_memberships_company_id_idx" ON "company_memberships"("company_id");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "multi_company_admins" ADD CONSTRAINT "multi_company_admins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Restricciones CHECK y triggers (agregados a mano: Prisma no los modela)

-- Sin empresa propia solo el admin global y el admin multiempresa; los demas pertenecen a una
ALTER TABLE "users" DROP CONSTRAINT "users_company_matches_role";
ALTER TABLE "users" ADD CONSTRAINT "users_company_matches_role"
  CHECK (("role" IN ('platform_admin', 'multi_company_admin')) = ("company_id" IS NULL));

ALTER TABLE "multi_company_admins" ADD CONSTRAINT "multi_company_admins_limits"
  CHECK ("max_companies" BETWEEN 1 AND 1000 AND "max_employees_per_company" BETWEEN 1 AND 100000);

-- Solo un usuario con rol multi_company_admin puede tener limites o membresias
CREATE FUNCTION "assert_multi_company_admin"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "users" WHERE "id" = NEW.user_id AND "role" = 'multi_company_admin') THEN
    RAISE EXCEPTION 'assert_multi_company_admin: el usuario % no es admin multiempresa', NEW.user_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "multi_company_admins_role"
BEFORE INSERT OR UPDATE OF "user_id" ON "multi_company_admins"
FOR EACH ROW EXECUTE FUNCTION "assert_multi_company_admin"();

CREATE TRIGGER "company_memberships_role"
BEFORE INSERT OR UPDATE OF "user_id" ON "company_memberships"
FOR EACH ROW EXECUTE FUNCTION "assert_multi_company_admin"();
