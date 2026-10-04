-- AlterTable
ALTER TABLE "employees" ADD COLUMN "phone" VARCHAR(30);

-- El telefono es opcional; si existe, entre 7 y 30 caracteres
ALTER TABLE "employees" ADD CONSTRAINT "employees_phone_length" CHECK (phone IS NULL OR char_length(phone) BETWEEN 7 AND 30);
