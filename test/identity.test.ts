import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '#shared/domain/permissions.js';
import { createTestPrisma, resetDatabase } from './helpers/database.js';
import { createCompany, createUser, DEFAULT_PASSWORD } from './helpers/fixtures.js';
import { api, bearer, createTestApp, login } from './helpers/test-app.js';

const prisma = createTestPrisma();

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase(prisma);
});

async function employeeSetup() {
  const company = await createCompany(prisma);
  const user = await createUser(prisma, { role: Role.EMPLOYEE, companyId: company.id });
  return { company, user };
}

async function eventTypes(userId?: string) {
  const events = await prisma.securityEvent.findMany({
    where: userId ? { userId } : {},
    orderBy: { createdAt: 'asc' },
  });
  return events.map((e) => e.type);
}

describe('POST /auth/login', () => {
  it('devuelve tokens y el perfil con permisos', async () => {
    const { app } = createTestApp();
    const { company, user } = await employeeSetup();

    const res = await request(app)
      .post(api('/auth/login'))
      .send({ email: user.email, password: DEFAULT_PASSWORD })
      .expect(200);

    expect(res.body.data).toMatchObject({
      tokenType: 'Bearer',
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      user: {
        id: user.id,
        email: user.email,
        role: 'employee',
        mustChangePassword: false,
        company: { id: company.id, name: company.name },
        permissions: ['attendance.clock_own', 'attendance.read_own'],
      },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2/);
    expect(await eventTypes(user.id)).toEqual(['login.succeeded']);
  });

  it('acepta el email sin importar mayúsculas y espacios', async () => {
    const { app } = createTestApp();
    const { user } = await employeeSetup();
    await request(app)
      .post(api('/auth/login'))
      .send({ email: `  ${user.email.toUpperCase()} `, password: DEFAULT_PASSWORD })
      .expect(200);
  });

  it('email inexistente y contraseña incorrecta responden exactamente igual', async () => {
    const { app } = createTestApp();
    const { user } = await employeeSetup();

    const wrongPassword = await request(app)
      .post(api('/auth/login'))
      .send({ email: user.email, password: 'no-es-esta' });
    const unknownEmail = await request(app)
      .post(api('/auth/login'))
      .send({ email: 'nadie@test.com', password: 'no-es-esta' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    const strip = (body: { error: Record<string, unknown> }) => ({ ...body.error, requestId: '' });
    expect(strip(wrongPassword.body)).toEqual(strip(unknownEmail.body));
    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('bloquea la cuenta tras 5 intentos fallidos y la libera a los 15 minutos', async () => {
    const { app, clock } = createTestApp();
    const { user } = await employeeSetup();
    const attempt = (password: string) =>
      request(app).post(api('/auth/login')).send({ email: user.email, password });

    for (let i = 0; i < 5; i++) await attempt('incorrecta').expect(401);

    const blocked = await attempt(DEFAULT_PASSWORD);
    expect(blocked.status).toBe(401);
    expect(blocked.body.error.code).toBe('INVALID_CREDENTIALS');

    clock.advanceMinutes(14);
    await attempt(DEFAULT_PASSWORD).expect(401);

    clock.advanceMinutes(2);
    await attempt(DEFAULT_PASSWORD).expect(200);

    const types = await eventTypes(user.id);
    expect(types.filter((t) => t === 'login.failed')).toHaveLength(5);
    expect(types).toContain('account.locked');
    expect(types).toContain('login.blocked');
    expect(types.at(-1)).toBe('login.succeeded');
  });

  it('una ráfaga de 20 intentos en paralelo evalúa como máximo 5 contraseñas', async () => {
    const { app } = createTestApp();
    const { user } = await employeeSetup();

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        request(app).post(api('/auth/login')).send({ email: user.email, password: 'adivinando' }),
      ),
    );

    expect(results.every((r) => r.status === 401)).toBe(true);
    const evaluated = await prisma.securityEvent.count({
      where: { userId: user.id, type: 'login.failed' },
    });
    expect(evaluated).toBeLessThanOrEqual(5);
    await request(app)
      .post(api('/auth/login'))
      .send({ email: user.email, password: DEFAULT_PASSWORD })
      .expect(401);
  });

  it('un login exitoso reinicia el contador de intentos', async () => {
    const { app } = createTestApp();
    const { user } = await employeeSetup();
    const attempt = (password: string) =>
      request(app).post(api('/auth/login')).send({ email: user.email, password });

    for (let i = 0; i < 4; i++) await attempt('incorrecta').expect(401);
    await attempt(DEFAULT_PASSWORD).expect(200);
    for (let i = 0; i < 4; i++) await attempt('incorrecta').expect(401);
    await attempt(DEFAULT_PASSWORD).expect(200);
  });

  it('usuario inactivo → 403 USER_INACTIVE (solo con la contraseña correcta)', async () => {
    const { app } = createTestApp();
    const company = await createCompany(prisma);
    const user = await createUser(prisma, {
      role: Role.EMPLOYEE,
      companyId: company.id,
      status: 'inactive',
    });

    await request(app)
      .post(api('/auth/login'))
      .send({ email: user.email, password: 'incorrecta' })
      .expect(401);
    const res = await request(app)
      .post(api('/auth/login'))
      .send({ email: user.email, password: DEFAULT_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('USER_INACTIVE');
  });

  it('empresa suspendida → 403 COMPANY_SUSPENDED', async () => {
    const { app } = createTestApp();
    const company = await createCompany(prisma, { status: 'suspended' });
    const user = await createUser(prisma, { role: Role.COMPANY_ADMIN, companyId: company.id });

    const res = await request(app)
      .post(api('/auth/login'))
      .send({ email: user.email, password: DEFAULT_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('COMPANY_SUSPENDED');
  });

  it('contraseña temporal vencida → 403 TEMPORARY_PASSWORD_EXPIRED', async () => {
    const { app, clock } = createTestApp();
    const company = await createCompany(prisma);
    const user = await createUser(prisma, {
      role: Role.EMPLOYEE,
      companyId: company.id,
      mustChangePassword: true,
      temporaryPasswordExpiresAt: new Date(clock.now().getTime() - 1),
    });

    const res = await request(app)
      .post(api('/auth/login'))
      .send({ email: user.email, password: DEFAULT_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('TEMPORARY_PASSWORD_EXPIRED');
  });

  it('el admin global (sin empresa) puede iniciar sesión', async () => {
    const { app } = createTestApp();
    const admin = await createUser(prisma, { role: Role.PLATFORM_ADMIN });
    const session = await login(app, admin.email, DEFAULT_PASSWORD);
    const me = await request(app).get(api('/auth/me')).set(bearer(session.accessToken));
    expect(me.body.data).toMatchObject({
      role: 'platform_admin',
      company: null,
      permissions: ['companies.manage'],
    });
  });

  it('aplica el rate limit estricto por IP', async () => {
    const { app } = createTestApp({ presetLimit: 3 });
    const attempt = () =>
      request(app).post(api('/auth/login')).send({ email: 'x@test.com', password: 'x' });

    for (let i = 0; i < 3; i++) await attempt().expect(401);
    const limited = await attempt();
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('TOO_MANY_REQUESTS');
  });

  it('el cupo de login es por cuenta: una cuenta agotada no bloquea a los compañeros de la misma IP', async () => {
    const { app } = createTestApp({ presetLimit: 3 });
    const { user } = await employeeSetup();
    const attempt = (email: string, password: string) =>
      request(app).post(api('/auth/login')).send({ email, password });

    for (let i = 0; i < 3; i++) await attempt('otra@test.com', 'x').expect(401);
    await attempt('otra@test.com', 'x').expect(429);

    await attempt(user.email, DEFAULT_PASSWORD).expect(200);
  });

  it('cada endpoint tiene su propio cupo: agotar el login no bloquea el refresh', async () => {
    const { app } = createTestApp({ presetLimit: 3 });
    const { user } = await employeeSetup();
    const session = await login(app, user.email, DEFAULT_PASSWORD);

    for (let i = 0; i < 3; i++) {
      await request(app).post(api('/auth/login')).send({ email: 'x@test.com', password: 'x' });
    }
    await request(app)
      .post(api('/auth/login'))
      .send({ email: 'x@test.com', password: 'x' })
      .expect(429);

    await request(app)
      .post(api('/auth/refresh'))
      .send({ refreshToken: session.refreshToken })
      .expect(200);
  });
});

describe('GET /auth/me y autenticación por request', () => {
  it('sin token → 401; con token → perfil', async () => {
    const { app } = createTestApp();
    const { user } = await employeeSetup();
    await request(app).get(api('/auth/me')).expect(401);

    const session = await login(app, user.email, DEFAULT_PASSWORD);
    const me = await request(app).get(api('/auth/me')).set(bearer(session.accessToken));
    expect(me.status).toBe(200);
    expect(me.body.data.id).toBe(user.id);
  });

  it('el access token expira a los 15 minutos', async () => {
    const { app, clock } = createTestApp();
    const { user } = await employeeSetup();
    const session = await login(app, user.email, DEFAULT_PASSWORD);

    clock.advanceMinutes(16);
    const res = await request(app).get(api('/auth/me')).set(bearer(session.accessToken));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('desactivar al usuario invalida su token al instante', async () => {
    const { app } = createTestApp();
    const { user } = await employeeSetup();
    const session = await login(app, user.email, DEFAULT_PASSWORD);

    await prisma.user.update({ where: { id: user.id }, data: { status: 'inactive' } });
    const res = await request(app).get(api('/auth/me')).set(bearer(session.accessToken));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('USER_INACTIVE');
  });

  it('suspender la empresa invalida los tokens de sus usuarios al instante', async () => {
    const { app } = createTestApp();
    const { company, user } = await employeeSetup();
    const session = await login(app, user.email, DEFAULT_PASSWORD);

    await prisma.company.update({ where: { id: company.id }, data: { status: 'suspended' } });
    const res = await request(app).get(api('/auth/me')).set(bearer(session.accessToken));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('COMPANY_SUSPENDED');
  });

  it('un cambio de rol invalida el token anterior', async () => {
    const { app } = createTestApp();
    const { company } = await employeeSetup();
    const user = await createUser(prisma, { role: Role.EMPLOYEE, companyId: company.id });
    const session = await login(app, user.email, DEFAULT_PASSWORD);

    await prisma.user.update({ where: { id: user.id }, data: { role: 'company_admin' } });
    const res = await request(app).get(api('/auth/me')).set(bearer(session.accessToken));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_REVOKED');
  });
});

describe('POST /auth/refresh', () => {
  it('rota el refresh token: el nuevo sirve y el viejo no', async () => {
    const { app } = createTestApp();
    const { user } = await employeeSetup();
    const first = await login(app, user.email, DEFAULT_PASSWORD);

    const rotated = await request(app)
      .post(api('/auth/refresh'))
      .send({ refreshToken: first.refreshToken })
      .expect(200);
    const second = rotated.body.data;
    expect(second.refreshToken).not.toBe(first.refreshToken);
    await request(app).get(api('/auth/me')).set(bearer(second.accessToken)).expect(200);

    await request(app)
      .post(api('/auth/refresh'))
      .send({ refreshToken: second.refreshToken })
      .expect(200);
  });

  it('reusar un refresh token ya usado revoca TODA la sesión (posible robo)', async () => {
    const { app } = createTestApp();
    const { user } = await employeeSetup();
    const first = await login(app, user.email, DEFAULT_PASSWORD);

    const rotated = await request(app)
      .post(api('/auth/refresh'))
      .send({ refreshToken: first.refreshToken });
    const second = rotated.body.data;

    const reuse = await request(app)
      .post(api('/auth/refresh'))
      .send({ refreshToken: first.refreshToken });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('INVALID_REFRESH_TOKEN');

    await request(app)
      .post(api('/auth/refresh'))
      .send({ refreshToken: second.refreshToken })
      .expect(401);
    expect(await eventTypes(user.id)).toContain('refresh.reuse_detected');
  });

  it('dos refresh simultáneos con el mismo token: solo uno puede ganar', async () => {
    const { app } = createTestApp();
    const { user } = await employeeSetup();
    const session = await login(app, user.email, DEFAULT_PASSWORD);

    const results = await Promise.all(
      [1, 2, 3].map(() =>
        request(app).post(api('/auth/refresh')).send({ refreshToken: session.refreshToken }),
      ),
    );

    expect(results.filter((r) => r.status === 200).length).toBeLessThanOrEqual(1);
    expect(results.some((r) => r.status === 401)).toBe(true);
  });

  it('renovar no alarga la sesión más allá de 30 días desde el login', async () => {
    const { app, clock } = createTestApp();
    const { user } = await employeeSetup();
    let refreshToken = (await login(app, user.email, DEFAULT_PASSWORD)).refreshToken;

    for (const day of [6, 12, 18, 24, 29]) {
      clock.advanceDays(day === 29 ? 5 : 6);
      const res = await request(app).post(api('/auth/refresh')).send({ refreshToken });
      expect(res.status, `día ${day}`).toBe(200);
      refreshToken = res.body.data.refreshToken as string;
    }

    clock.advanceDays(2);
    const expired = await request(app).post(api('/auth/refresh')).send({ refreshToken });
    expect(expired.status).toBe(401);
    expect(expired.body.error.code).toBe('SESSION_MAX_AGE_REACHED');
  });

  it('el refresh token expira a los 7 días', async () => {
    const { app, clock } = createTestApp();
    const { user } = await employeeSetup();
    const session = await login(app, user.email, DEFAULT_PASSWORD);

    clock.advanceDays(8);
    const res = await request(app)
      .post(api('/auth/refresh'))
      .send({ refreshToken: session.refreshToken });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('REFRESH_TOKEN_EXPIRED');
  });

  it('una sesión con contraseña temporal no se renueva después de que ésta vence', async () => {
    const { app, clock } = createTestApp();
    const company = await createCompany(prisma);
    const user = await createUser(prisma, {
      role: Role.EMPLOYEE,
      companyId: company.id,
      mustChangePassword: true,
      temporaryPasswordExpiresAt: new Date(clock.now().getTime() + 3_600_000),
    });
    const session = await login(app, user.email, DEFAULT_PASSWORD);

    clock.advanceMinutes(61);
    const res = await request(app)
      .post(api('/auth/refresh'))
      .send({ refreshToken: session.refreshToken });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('TEMPORARY_PASSWORD_EXPIRED');
  });

  it('no renueva si la empresa fue suspendida', async () => {
    const { app } = createTestApp();
    const { company, user } = await employeeSetup();
    const session = await login(app, user.email, DEFAULT_PASSWORD);

    await prisma.company.update({ where: { id: company.id }, data: { status: 'suspended' } });
    const res = await request(app)
      .post(api('/auth/refresh'))
      .send({ refreshToken: session.refreshToken });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('COMPANY_SUSPENDED');
  });

  it('si la versión de sesión del usuario cambió (p. ej. reset), el refresh viejo ya no sirve', async () => {
    const { app } = createTestApp();
    const { user } = await employeeSetup();
    const session = await login(app, user.email, DEFAULT_PASSWORD);

    await prisma.user.update({ where: { id: user.id }, data: { tokenVersion: { increment: 1 } } });

    const res = await request(app)
      .post(api('/auth/refresh'))
      .send({ refreshToken: session.refreshToken });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('un token inventado → 401', async () => {
    const { app } = createTestApp();
    await request(app)
      .post(api('/auth/refresh'))
      .send({ refreshToken: 'x'.repeat(64) })
      .expect(401);
  });

  it('los refresh tokens se guardan hasheados, nunca en claro', async () => {
    const { app } = createTestApp();
    const { user } = await employeeSetup();
    const session = await login(app, user.email, DEFAULT_PASSWORD);

    const stored = await prisma.refreshToken.findMany({ where: { userId: user.id } });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored[0]!.tokenHash).not.toBe(session.refreshToken);
  });
});

describe('POST /auth/logout', () => {
  it('anula el refresh token y es idempotente', async () => {
    const { app } = createTestApp();
    const { user } = await employeeSetup();
    const session = await login(app, user.email, DEFAULT_PASSWORD);

    await request(app)
      .post(api('/auth/logout'))
      .send({ refreshToken: session.refreshToken })
      .expect(204);
    await request(app)
      .post(api('/auth/logout'))
      .send({ refreshToken: session.refreshToken })
      .expect(204);
    await request(app)
      .post(api('/auth/refresh'))
      .send({ refreshToken: session.refreshToken })
      .expect(401);
  });

  it('con un token desconocido también responde 204 (no revela nada)', async () => {
    const { app } = createTestApp();
    await request(app)
      .post(api('/auth/logout'))
      .send({ refreshToken: 'y'.repeat(64) })
      .expect(204);
  });
});

describe('PATCH /auth/me/password', () => {
  const NEW_PASSWORD = 'otra contraseña muy larga';

  it('cambia la contraseña, cierra todas las sesiones y entrega una nueva', async () => {
    const { app } = createTestApp();
    const { user } = await employeeSetup();
    const deviceA = await login(app, user.email, DEFAULT_PASSWORD);
    const deviceB = await login(app, user.email, DEFAULT_PASSWORD);

    const res = await request(app)
      .patch(api('/auth/me/password'))
      .set(bearer(deviceA.accessToken))
      .send({ currentPassword: DEFAULT_PASSWORD, newPassword: NEW_PASSWORD })
      .expect(200);
    const fresh = res.body.data;

    for (const old of [deviceA, deviceB]) {
      const me = await request(app).get(api('/auth/me')).set(bearer(old.accessToken));
      expect(me.status).toBe(401);
      expect(me.body.error.code).toBe('SESSION_REVOKED');
      await request(app)
        .post(api('/auth/refresh'))
        .send({ refreshToken: old.refreshToken })
        .expect(401);
    }

    await request(app).get(api('/auth/me')).set(bearer(fresh.accessToken)).expect(200);
    await login(app, user.email, NEW_PASSWORD);
    await request(app)
      .post(api('/auth/login'))
      .send({ email: user.email, password: DEFAULT_PASSWORD })
      .expect(401);
    expect(await eventTypes(user.id)).toContain('password.changed');
  });

  it('con contraseña temporal: solo permite /auth/me y el cambio; luego queda libre', async () => {
    const { app, clock } = createTestApp();
    const company = await createCompany(prisma);
    const user = await createUser(prisma, {
      role: Role.EMPLOYEE,
      companyId: company.id,
      mustChangePassword: true,
      temporaryPasswordExpiresAt: new Date(clock.now().getTime() + 3_600_000),
    });

    const session = await login(app, user.email, DEFAULT_PASSWORD);
    expect(session.user.mustChangePassword).toBe(true);
    const me = await request(app).get(api('/auth/me')).set(bearer(session.accessToken));
    expect(me.body.data.mustChangePassword).toBe(true);

    const res = await request(app)
      .patch(api('/auth/me/password'))
      .set(bearer(session.accessToken))
      .send({ currentPassword: DEFAULT_PASSWORD, newPassword: NEW_PASSWORD })
      .expect(200);

    const after = await request(app).get(api('/auth/me')).set(bearer(res.body.data.accessToken));
    expect(after.body.data.mustChangePassword).toBe(false);
  });

  it('rechaza la contraseña actual incorrecta', async () => {
    const { app } = createTestApp();
    const { user } = await employeeSetup();
    const session = await login(app, user.email, DEFAULT_PASSWORD);

    const res = await request(app)
      .patch(api('/auth/me/password'))
      .set(bearer(session.accessToken))
      .send({ currentPassword: 'no-es-esta', newPassword: NEW_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CURRENT_PASSWORD');
  });

  it('rechaza reutilizar la misma contraseña', async () => {
    const { app } = createTestApp();
    const { user } = await employeeSetup();
    const session = await login(app, user.email, DEFAULT_PASSWORD);

    const res = await request(app)
      .patch(api('/auth/me/password'))
      .set(bearer(session.accessToken))
      .send({ currentPassword: DEFAULT_PASSWORD, newPassword: DEFAULT_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PASSWORD_REUSED');
  });

  it('rechaza una contraseña débil con el detalle del problema', async () => {
    const { app } = createTestApp();
    const { user } = await employeeSetup();
    const session = await login(app, user.email, DEFAULT_PASSWORD);

    const res = await request(app)
      .patch(api('/auth/me/password'))
      .set(bearer(session.accessToken))
      .send({ currentPassword: DEFAULT_PASSWORD, newPassword: 'corta' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('WEAK_PASSWORD');
    expect(res.body.error.details[0].message).toMatch(/al menos 12/);
  });

  it('proponer contraseñas nuevas débiles NO bloquea la cuenta (la actual era correcta)', async () => {
    const { app } = createTestApp();
    const { user } = await employeeSetup();
    const session = await login(app, user.email, DEFAULT_PASSWORD);

    for (let i = 0; i < 7; i++) {
      const res = await request(app)
        .patch(api('/auth/me/password'))
        .set(bearer(session.accessToken))
        .send({ currentPassword: DEFAULT_PASSWORD, newPassword: 'corta' });
      expect(res.body.error.code).toBe('WEAK_PASSWORD');
    }
    await request(app)
      .patch(api('/auth/me/password'))
      .set(bearer(session.accessToken))
      .send({ currentPassword: DEFAULT_PASSWORD, newPassword: NEW_PASSWORD })
      .expect(200);
  });

  it('adivinar la contraseña actual también cuenta para el bloqueo', async () => {
    const { app } = createTestApp();
    const { user } = await employeeSetup();
    const session = await login(app, user.email, DEFAULT_PASSWORD);
    const change = () =>
      request(app)
        .patch(api('/auth/me/password'))
        .set(bearer(session.accessToken))
        .send({ currentPassword: 'adivinando', newPassword: NEW_PASSWORD });

    for (let i = 0; i < 5; i++) await change().expect(400);
    const locked = await change();
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
  });
});
