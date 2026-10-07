-- AlterEnum
-- Va en su propia migracion: un valor nuevo de enum no se puede usar en la misma transaccion que lo agrega
ALTER TYPE "user_role" ADD VALUE 'multi_company_admin';
