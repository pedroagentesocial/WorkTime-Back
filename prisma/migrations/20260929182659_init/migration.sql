-- CreateEnum
CREATE TYPE "company_status" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('platform_admin', 'company_admin', 'employee');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "time_entry_source" AS ENUM ('web', 'admin');

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL,
    "max_employees" INTEGER NOT NULL,
    "status" "company_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "company_id" UUID,
    "email" VARCHAR(254) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "user_role" NOT NULL,
    "status" "user_status" NOT NULL DEFAULT 'active',
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "temporary_password_expires_at" TIMESTAMPTZ(3),
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "password_changed_at" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "replaced_by_id" UUID,
    "ip" VARCHAR(45),
    "user_agent" VARCHAR(255),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_events" (
    "id" UUID NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "user_id" UUID,
    "company_id" UUID,
    "ip" VARCHAR(45),
    "user_agent" VARCHAR(255),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "employee_code" VARCHAR(50),
    "hired_at" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_entries" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "clock_in_at" TIMESTAMPTZ(3) NOT NULL,
    "clock_out_at" TIMESTAMPTZ(3),
    "source" "time_entry_source" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_entry_corrections" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "time_entry_id" UUID NOT NULL,
    "corrected_by_id" UUID NOT NULL,
    "previous_clock_in_at" TIMESTAMPTZ(3) NOT NULL,
    "previous_clock_out_at" TIMESTAMPTZ(3),
    "new_clock_in_at" TIMESTAMPTZ(3) NOT NULL,
    "new_clock_out_at" TIMESTAMPTZ(3),
    "reason" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "time_entry_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "companies_status_idx" ON "companies"("status");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_company_id_role_status_idx" ON "users"("company_id", "role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "users_one_company_admin_per_company" ON "users"("company_id") WHERE (role = 'company_admin');

-- CreateIndex
CREATE UNIQUE INDEX "users_company_id_id_key" ON "users"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "security_events_user_id_created_at_idx" ON "security_events"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "security_events_company_id_created_at_idx" ON "security_events"("company_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "security_events_type_created_at_idx" ON "security_events"("type", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "employees_user_id_key" ON "employees"("user_id");

-- CreateIndex
CREATE INDEX "employees_company_id_idx" ON "employees"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "employees_company_id_employee_code_key" ON "employees"("company_id", "employee_code");

-- CreateIndex
CREATE UNIQUE INDEX "employees_company_id_user_id_key" ON "employees"("company_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "employees_company_id_id_key" ON "employees"("company_id", "id");

-- CreateIndex
CREATE INDEX "time_entries_company_id_clock_in_at_idx" ON "time_entries"("company_id", "clock_in_at" DESC);

-- CreateIndex
CREATE INDEX "time_entries_employee_id_clock_in_at_idx" ON "time_entries"("employee_id", "clock_in_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "time_entries_one_open_per_employee" ON "time_entries"("employee_id") WHERE (clock_out_at IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "time_entries_company_id_id_key" ON "time_entries"("company_id", "id");

-- CreateIndex
CREATE INDEX "time_entry_corrections_time_entry_id_created_at_idx" ON "time_entry_corrections"("time_entry_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "time_entry_corrections_company_id_created_at_idx" ON "time_entry_corrections"("company_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_company_id_user_id_fkey" FOREIGN KEY ("company_id", "user_id") REFERENCES "users"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_company_id_employee_id_fkey" FOREIGN KEY ("company_id", "employee_id") REFERENCES "employees"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entry_corrections" ADD CONSTRAINT "time_entry_corrections_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entry_corrections" ADD CONSTRAINT "time_entry_corrections_company_id_time_entry_id_fkey" FOREIGN KEY ("company_id", "time_entry_id") REFERENCES "time_entries"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entry_corrections" ADD CONSTRAINT "time_entry_corrections_company_id_corrected_by_id_fkey" FOREIGN KEY ("company_id", "corrected_by_id") REFERENCES "users"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- Restricciones CHECK (agregadas a mano: Prisma no las modela ni las elimina)
-- ─────────────────────────────────────────────────────────────

-- Una empresa siempre permite al menos un empleado.
ALTER TABLE "companies" ADD CONSTRAINT "companies_max_employees_positive" CHECK ("max_employees" > 0);

-- Solo el admin global existe sin empresa; todos los demás pertenecen a una.
ALTER TABLE "users" ADD CONSTRAINT "users_company_matches_role"
  CHECK (("role" = 'platform_admin') = ("company_id" IS NULL));

-- El email se guarda normalizado para que la unicidad no dependa de mayúsculas.
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email"));

ALTER TABLE "users" ADD CONSTRAINT "users_counters_non_negative"
  CHECK ("token_version" >= 0 AND "failed_login_attempts" >= 0);

-- Una salida nunca puede ser anterior a su entrada.
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_clock_out_after_clock_in"
  CHECK ("clock_out_at" IS NULL OR "clock_out_at" >= "clock_in_at");

ALTER TABLE "time_entry_corrections" ADD CONSTRAINT "time_entry_corrections_valid_range"
  CHECK ("new_clock_out_at" IS NULL OR "new_clock_out_at" >= "new_clock_in_at");

ALTER TABLE "time_entry_corrections" ADD CONSTRAINT "time_entry_corrections_reason_not_blank"
  CHECK (length(trim("reason")) > 0);
