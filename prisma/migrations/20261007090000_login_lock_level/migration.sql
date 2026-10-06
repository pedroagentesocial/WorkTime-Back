-- AlterTable
ALTER TABLE "users" ADD COLUMN "lock_level" INTEGER NOT NULL DEFAULT 0;

-- Nivel de bloqueo progresivo, nunca negativo
ALTER TABLE "users" ADD CONSTRAINT "users_lock_level_nonneg" CHECK ("lock_level" >= 0);
