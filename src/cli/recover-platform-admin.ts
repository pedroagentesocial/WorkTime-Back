// Recupera el acceso del admin global desde la terminal. No hay pantalla ni ruta para esto a proposito:
// solo puede usarlo quien ya entra al servidor y tiene el .env
import { EnvValidationError, loadEnv } from '#config/env.js';
import { modules } from '#modules/index.js';
import { bootstrap } from '../bootstrap.js';

async function recover(): Promise<void> {
  const env = loadEnv();
  const { container } = bootstrap(env, modules);

  try {
    const result = await container.cradle.recoverPlatformAdmin.execute();
    console.log('');
    console.log('✔ Acceso del admin global recuperado');
    console.log(`  Correo:              ${result.admin.email}`);
    console.log(`  Contraseña temporal: ${result.temporaryPassword}`);
    console.log(`  Vence:               ${result.temporaryPasswordExpiresAt.toISOString()} (UTC)`);
    console.log('');
    console.log('  Cópiala ahora: no se vuelve a mostrar ni se guarda en ningún lado.');
    console.log(
      '  Al entrar deberá cambiarla. Se cerraron todas sus sesiones y se quitó el bloqueo.',
    );
    console.log('');
  } finally {
    await container.dispose();
  }
}

recover().catch((error: unknown) => {
  const message =
    error instanceof EnvValidationError || error instanceof Error ? error.message : String(error);
  console.error(`\n✖ No se pudo recuperar el acceso: ${message}\n`);
  process.exit(1);
});
