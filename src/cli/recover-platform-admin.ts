// Rescate del admin global: contrasena temporal nueva, desbloqueo y cierre de todas sus sesiones
// Desarrollo: npm run admin:recover · Docker: docker compose run --rm api node dist/cli/recover-platform-admin.js
import { EnvValidationError, loadEnv } from '#config/env.js';
import { modules } from '#modules/index.js';
import { AppError } from '#shared/domain/errors.js';
import { bootstrap } from '../bootstrap.js';

async function recover(): Promise<void> {
  const { container } = bootstrap(loadEnv(), modules);
  try {
    const result = await container.cradle.recoverPlatformAdmin.execute();
    console.log(`✔ Admin global restablecido: ${maskEmail(result.admin.email)}`);
    console.log(`  Contraseña temporal: ${result.temporaryPassword}`);
    console.log(`  Vence: ${result.temporaryPasswordExpiresAt.toISOString()}`);
    console.log('  Se muestra una sola vez. Deberá cambiarla al iniciar sesión.');
    console.log('  Sus sesiones abiertas se cerraron y el bloqueo por intentos se quitó.');
  } finally {
    await container.dispose();
  }
}

function maskEmail(email: string): string {
  const [user = '', domain = ''] = email.split('@');
  return `${user.slice(0, 2)}***@${domain}`;
}

recover().catch((error: unknown) => {
  const known = error instanceof EnvValidationError || error instanceof AppError;
  console.error(known ? `✖ ${error.message}` : error);
  process.exit(1);
});
