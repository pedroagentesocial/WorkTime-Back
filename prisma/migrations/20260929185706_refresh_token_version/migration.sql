-- Los refresh tokens guardan la tokenVersion del usuario al emitirse.
-- Si luego cambia (reset de contraseña, desactivación…), el token deja de servir.

-- 1. Columna con valor temporal para las filas existentes.
ALTER TABLE "refresh_tokens" ADD COLUMN "token_version" INTEGER NOT NULL DEFAULT 0;

-- 2. Los tokens ya emitidos toman la versión actual de su usuario (siguen siendo válidos).
UPDATE "refresh_tokens" rt
SET "token_version" = u."token_version"
FROM "users" u
WHERE u."id" = rt."user_id";

-- 3. Sin valor por defecto: la app siempre debe indicarlo.
ALTER TABLE "refresh_tokens" ALTER COLUMN "token_version" DROP DEFAULT;
