import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { modules } from '#modules/index.js';
import { hasPermission, Role } from '#shared/domain/permissions.js';
import type { AnyRoute } from '#shared/http/route.js';
import { createTestPrisma, resetDatabase } from './helpers/database.js';
import {
  createCompany,
  createEmployee,
  createMultiAdmin,
  createUser,
  DEFAULT_PASSWORD,
} from './helpers/fixtures.js';
import { api, bearer, createTestApp, login, switchCompany } from './helpers/test-app.js';

const prisma = createTestPrisma();
const { app, container } = createTestApp();
const routes: AnyRoute[] = modules.flatMap((module) => [...(module.routes?.(container) ?? [])]);

// Unicas rutas sin sesion: agregar una aqui debe ser una decision consciente
const EXPECTED_PUBLIC_ROUTES = [
  'GET /health',
  'POST /auth/login',
  'POST /auth/refresh',
  'POST /auth/logout',
  // Recuperar la contrasena: quien la olvido no tiene sesion
  'POST /auth/password-reset',
  'POST /auth/password-reset/confirm',
].sort();

const tokens: Partial<Record<Role, Record<string, string>>> = {};
const emails: Partial<Record<Role, string>> = {};

// Cierran sesiones de verdad: invalidarian los tokens compartidos, asi que se prueban aparte
const SESSION_KILLER_ROUTES = ['POST /auth/me/logout-all'];

beforeAll(async () => {
  await resetDatabase(prisma);
  const company = await createCompany(prisma);
  const platform = await createUser(prisma, { role: Role.PLATFORM_ADMIN });
  const admin = await createUser(prisma, { role: Role.COMPANY_ADMIN, companyId: company.id });
  const { user: employee } = await createEmployee(prisma, company.id);
  const multi = await createMultiAdmin(prisma, { companyIds: [company.id] });

  emails[Role.PLATFORM_ADMIN] = platform.email;
  emails[Role.COMPANY_ADMIN] = admin.email;
  emails[Role.MULTI_COMPANY_ADMIN] = multi.email;
  emails[Role.EMPLOYEE] = employee.email;

  tokens[Role.PLATFORM_ADMIN] = bearer(
    (await login(app, platform.email, DEFAULT_PASSWORD)).accessToken,
  );
  tokens[Role.COMPANY_ADMIN] = bearer(
    (await login(app, admin.email, DEFAULT_PASSWORD)).accessToken,
  );
  // Con empresa activa, para que las rutas de empresa respondan como a un admin de empresa
  const multiSession = await login(app, multi.email, DEFAULT_PASSWORD);
  tokens[Role.MULTI_COMPANY_ADMIN] = bearer(
    (await switchCompany(app, multiSession, company.id)).accessToken,
  );
  tokens[Role.EMPLOYEE] = bearer((await login(app, employee.email, DEFAULT_PASSWORD)).accessToken);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const key = (route: AnyRoute) => `${route.method.toUpperCase()} ${route.path}`;

function call(route: AnyRoute, auth?: Record<string, string>) {
  const path = api(route.path.replace(/:[A-Za-z]+/g, () => uuidv7()));
  const req = request(app)[route.method](path);
  if (auth) req.set(auth);
  return ['post', 'put', 'patch'].includes(route.method) ? req.send({}) : req;
}

describe('Matriz de autorización (todas las rutas)', () => {
  it('hay rutas registradas (sanidad del test)', () => {
    expect(routes.length).toBeGreaterThan(25);
  });

  it('solo las rutas esperadas son públicas', () => {
    const publicRoutes = routes
      .filter((r) => r.auth === 'public')
      .map(key)
      .sort();
    expect(publicRoutes).toEqual(EXPECTED_PUBLIC_ROUTES);
  });

  const protectedRoutes = routes.filter(
    (r) => r.auth !== 'public' && !SESSION_KILLER_ROUTES.includes(key(r)),
  );

  it.each(protectedRoutes.map((r) => [key(r), r] as const))(
    '%s: sin token → 401; con token → solo los roles con permiso',
    async (_name, route) => {
      const anonymous = await call(route);
      expect(anonymous.status, 'sin token').toBe(401);

      for (const role of Object.values(Role)) {
        const res = await call(route, tokens[role]);
        const allowed =
          route.auth === 'authenticated' ||
          (route.auth !== 'public' && hasPermission(role, route.auth));

        if (allowed) {
          expect([401, 403], `${role} debería poder entrar`).not.toContain(res.status);
        } else {
          expect(res.status, `${role} NO debería poder entrar`).toBe(403);
          expect(res.body.error.code).toBe('FORBIDDEN');
        }
      }
    },
  );

  it.each(SESSION_KILLER_ROUTES)(
    '%s: sin token → 401; cada rol autenticado puede usarla',
    async (name) => {
      const route = routes.find((r) => key(r) === name);
      expect(route, 'la ruta debe existir').toBeDefined();
      expect((await call(route!)).status, 'sin token').toBe(401);

      for (const role of Object.values(Role)) {
        const session = await login(app, emails[role]!, DEFAULT_PASSWORD);
        const res = await call(route!, bearer(session.accessToken));
        expect([401, 403], `${role} debería poder entrar`).not.toContain(res.status);
      }
    },
  );
});
