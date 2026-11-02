import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '#shared/domain/permissions.js';
import { createTestPrisma, resetDatabase } from './helpers/database.js';
import { createCompany, createUser, DEFAULT_PASSWORD } from './helpers/fixtures.js';
import { api, createTestApp, login } from './helpers/test-app.js';

const prisma = createTestPrisma();
const NEW_PASSWORD = 'Otra-Clave-Segura-2026';

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase(prisma);
});

const ask = (app: Express, email: string) =>
  request(app).post(api('/auth/password-reset')).send({ email });
const confirm = (app: Express, token: string, newPassword = NEW_PASSWORD) =>
  request(app).post(api('/auth/password-reset/confirm')).send({ token, newPassword });

async function setup() {
  const test = createTestApp();
  const company = await createCompany(prisma);
  const admin = await createUser(prisma, {
    role: Role.COMPANY_ADMIN,
    companyId: company.id,
    email: 'laura@acme.com',
  });
  return { ...test, company, admin };
}

const eventTypes = async (userId: string) =>
  (await prisma.securityEvent.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } })).map(
    (event) => event.type,
  );

describe('Recuperar la contraseña por correo', () => {
  it('manda un enlace de un solo uso y responde igual exista o no la cuenta', async () => {
    const { app, emails, admin } = await setup();

    await ask(app, 'Laura@Acme.com ').expect(204);
    await ask(app, 'nadie@acme.com').expect(204);

    expect(emails.sent).toHaveLength(1);
    expect(emails.sent[0]).toMatchObject({
      to: 'laura@acme.com',
      subject: 'Restablece tu contraseña de WorkTime',
    });
    expect(emails.sent[0]?.text).toContain(
      'https://app.worktime.dev/restablecer-contrasena?token=',
    );
    expect(await eventTypes(admin.id)).toContain('password.reset_requested');
    // Solo se guarda el hash del token
    const stored = await prisma.passwordResetToken.findFirstOrThrow({
      where: { userId: admin.id },
    });
    expect(stored.tokenHash).not.toBe(emails.resetTokenFor('laura@acme.com'));
  });

  it('con el enlace pone la contraseña nueva, cierra las sesiones y ya no sirve otra vez', async () => {
    const { app, emails, admin } = await setup();
    const old = await login(app, admin.email, DEFAULT_PASSWORD);

    await ask(app, admin.email).expect(204);
    const token = emails.resetTokenFor(admin.email);
    await confirm(app, token).expect(204);

    await login(app, admin.email, NEW_PASSWORD);
    const refresh = await request(app)
      .post(api('/auth/refresh'))
      .send({ refreshToken: old.refreshToken });
    expect(refresh.status).toBe(401);
    expect(await eventTypes(admin.id)).toContain('password.reset_completed');

    const again = await confirm(app, token, 'Tercera-Clave-Segura-2026');
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('INVALID_RESET_TOKEN');
  });

  it('el enlace vence a los 30 minutos y uno nuevo reemplaza al anterior', async () => {
    const { app, clock, emails, admin } = await setup();

    await ask(app, admin.email).expect(204);
    const first = emails.resetTokenFor(admin.email);
    // Dentro del minuto no manda otro correo
    await ask(app, admin.email).expect(204);
    expect(emails.sent).toHaveLength(1);

    clock.advance(2 * 60_000);
    await ask(app, admin.email).expect(204);
    expect(emails.sent).toHaveLength(2);
    const second = emails.resetTokenFor(admin.email);
    expect((await confirm(app, first)).body.error.code).toBe('INVALID_RESET_TOKEN');

    clock.advance(31 * 60_000);
    expect((await confirm(app, second)).body.error.code).toBe('INVALID_RESET_TOKEN');
  });

  it('una contraseña débil no gasta el enlace', async () => {
    const { app, emails, admin } = await setup();
    await ask(app, admin.email).expect(204);
    const token = emails.resetTokenFor(admin.email);

    const weak = await confirm(app, token, '123');
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe('WEAK_PASSWORD');
    await confirm(app, token).expect(204);
  });

  it('no manda nada al admin global, a una cuenta desactivada ni a una empresa suspendida', async () => {
    const { app, emails } = await setup();
    await createUser(prisma, { role: Role.PLATFORM_ADMIN, email: 'global@worktime.com' });
    const inactive = await createUser(prisma, {
      role: Role.COMPANY_ADMIN,
      companyId: (await createCompany(prisma)).id,
      email: 'baja@acme.com',
      status: 'inactive',
    });
    const suspended = await createCompany(prisma, { status: 'suspended' });
    await createUser(prisma, {
      role: Role.COMPANY_ADMIN,
      companyId: suspended.id,
      email: 'suspendida@acme.com',
    });

    for (const email of ['global@worktime.com', inactive.email, 'suspendida@acme.com']) {
      await ask(app, email).expect(204);
    }
    expect(emails.sent).toHaveLength(0);
  });

  it('un token inventado no sirve', async () => {
    const { app } = await setup();
    const res = await confirm(app, 'x'.repeat(64));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_RESET_TOKEN');
  });
});
