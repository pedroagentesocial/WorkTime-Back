// Crea el admin global inicial. Es idempotente: si ya existe no lo modifica
import { EnvValidationError, loadEnv, loadSeedAdminConfig } from '#config/env.js';
import { Argon2PasswordHasher } from '#shared/infrastructure/argon2-password-hasher.js';
import { createPrismaClient } from '#shared/infrastructure/prisma/prisma-client.js';
import { UuidV7IdGenerator } from '#shared/infrastructure/uuid-v7-id-generator.js';
import { SecurityEventType } from '#shared/application/ports/security-event-recorder.js';

async function seed(): Promise<void> {
  const env = loadEnv();
  const admin = loadSeedAdminConfig();
  const prisma = createPrismaClient(env);

  try {
    const existing = await prisma.user.findFirst({
      where: { role: 'platform_admin' },
      select: { email: true },
    });
    if (existing) {
      console.log(`✔ Ya existe un admin global (${maskEmail(existing.email)}); no se modifica.`);
      return;
    }

    const emailTaken = await prisma.user.findUnique({ where: { email: admin.email } });
    if (emailTaken) {
      throw new Error(`El email ${maskEmail(admin.email)} ya pertenece a otro usuario.`);
    }

    const id = new UuidV7IdGenerator().generate();
    await prisma.user.create({
      data: {
        id,
        email: admin.email,
        passwordHash: await new Argon2PasswordHasher().hash(admin.password),
        role: 'platform_admin',
        firstName: 'Administrador',
        lastName: 'Global',
        mustChangePassword: true,
      },
    });
    await prisma.securityEvent.create({
      data: {
        id: new UuidV7IdGenerator().generate(),
        type: SecurityEventType.USER_SEEDED,
        userId: id,
        metadata: { role: 'platform_admin' },
      },
    });

    console.log(`✔ Admin global creado: ${maskEmail(admin.email)}`);
    console.log('  Deberá cambiar su contraseña en el primer inicio de sesión.');
  } finally {
    await prisma.$disconnect();
  }
}

function maskEmail(email: string): string {
  const [user = '', domain = ''] = email.split('@');
  return `${user.slice(0, 2)}***@${domain}`;
}

seed().catch((error: unknown) => {
  console.error(
    error instanceof EnvValidationError || error instanceof Error ? `✖ ${error.message}` : error,
  );
  process.exit(1);
});
