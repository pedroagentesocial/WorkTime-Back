-- Quien anula un check-in puede ser un admin multiempresa, que no tiene empresa propia:
-- la llave apunta al usuario sin exigir que sea de la misma empresa
-- DropForeignKey
ALTER TABLE "check_ins" DROP CONSTRAINT "check_ins_company_id_voided_by_id_fkey";

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
