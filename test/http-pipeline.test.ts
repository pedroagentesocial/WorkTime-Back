import { asValue } from 'awilix';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { API_PREFIX } from '#config/security.js';
import type { Actor } from '#shared/application/actor.js';
import { Permission, Role } from '#shared/domain/permissions.js';
import type { AppModule } from '#shared/composition/app-module.js';
import { UnauthorizedError } from '#shared/domain/errors.js';
import { created, defineRoute, ok } from '#shared/http/route.js';
import { idParams } from '#shared/http/schemas.js';
import { z } from '#shared/http/zod.js';
import { systemModule } from '#modules/system/system.module.js';
import { bootstrap } from '../src/bootstrap.js';
import { testEnv } from './helpers/test-env.js';

const actors: Record<string, Actor> = {
  admin: {
    userId: 'u-admin',
    role: Role.COMPANY_ADMIN,
    companyId: 'c-1',
    mustChangePassword: false,
  },
  employee: { userId: 'u-emp', role: Role.EMPLOYEE, companyId: 'c-1', mustChangePassword: false },
  pending: { userId: 'u-new', role: Role.EMPLOYEE, companyId: 'c-1', mustChangePassword: true },
};

const fakeModule: AppModule = {
  name: 'fake',
  register(container) {
    container.register({
      authenticator: asValue({
        authenticate: (token: string) => {
          const actor = actors[token];
          return actor
            ? Promise.resolve(actor)
            : Promise.reject(new UnauthorizedError('INVALID_TOKEN', 'Token inválido'));
        },
      }),
    });
  },
  routes: () => [
    defineRoute({
      method: 'get',
      path: '/fake/me',
      summary: 'Cualquier usuario autenticado',
      tags: ['Fake'],
      auth: 'authenticated',
      responses: { 200: { description: 'ok' } },
      handler: async ({ actor }) => ok({ userId: actor.userId }),
    }),
    defineRoute({
      method: 'post',
      path: '/fake/employees',
      summary: 'Requiere permiso',
      tags: ['Fake'],
      auth: Permission.EMPLOYEES_MANAGE,
      request: { body: z.object({ name: z.string().min(2) }).strict() },
      responses: { 201: { description: 'creado' } },
      handler: async ({ body, actor }) => created({ name: body.name, companyId: actor.companyId }),
    }),
    defineRoute({
      method: 'get',
      path: '/fake/employees/:id',
      summary: 'Valida params',
      tags: ['Fake'],
      auth: Permission.EMPLOYEES_MANAGE,
      request: { params: idParams },
      responses: { 200: { description: 'ok' } },
      handler: async ({ params }) => ok({ id: params.id }),
    }),
    defineRoute({
      method: 'patch',
      path: '/fake/password',
      summary: 'Permitida con contraseña pendiente',
      tags: ['Fake'],
      auth: 'authenticated',
      allowWhenPasswordChangeRequired: true,
      responses: { 200: { description: 'ok' } },
      handler: async () => ok({ changed: true }),
    }),
    defineRoute({
      method: 'get',
      path: '/fake/boom',
      summary: 'Error inesperado',
      tags: ['Fake'],
      auth: 'public',
      responses: { 200: { description: 'nunca' } },
      handler: () => Promise.reject(new Error('detalle interno secreto: SELECT * FROM users')),
    }),
  ],
};

const { app } = bootstrap(testEnv(), [systemModule, fakeModule]);
const api = (path: string) => `${API_PREFIX}${path}`;

describe('Pipeline HTTP', () => {
  describe('health y cabeceras', () => {
    it('GET /health responde ok con el formato estándar', async () => {
      const res = await request(app).get(api('/health')).expect(200);
      expect(res.body.data).toMatchObject({ status: 'ok', checks: { database: 'up' } });
    });

    it('agrega cabeceras de seguridad y oculta la tecnología', async () => {
      const res = await request(app).get(api('/health'));
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('reutiliza un X-Request-Id válido del cliente y descarta uno inválido', async () => {
      const id = '0199a1b2-1111-7000-8000-000000000001';
      const valid = await request(app).get(api('/health')).set('X-Request-Id', id);
      expect(valid.headers['x-request-id']).toBe(id);

      const invalid = await request(app).get(api('/health')).set('X-Request-Id', '<script>');
      expect(invalid.headers['x-request-id']).not.toBe('<script>');
    });

    it('CORS solo permite los orígenes configurados', async () => {
      const allowed = await request(app).get(api('/health')).set('Origin', 'http://localhost:4200');
      expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:4200');

      const denied = await request(app).get(api('/health')).set('Origin', 'https://evil.example');
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('autenticación y permisos', () => {
    it('sin token → 401 MISSING_TOKEN', async () => {
      const res = await request(app).get(api('/fake/me')).expect(401);
      expect(res.body.error.code).toBe('MISSING_TOKEN');
    });

    it('esquema distinto de Bearer → 401', async () => {
      await request(app).get(api('/fake/me')).set('Authorization', 'Basic admin').expect(401);
    });

    it('token inválido → 401 INVALID_TOKEN', async () => {
      const res = await request(app).get(api('/fake/me')).set('Authorization', 'Bearer nope');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_TOKEN');
    });

    it('token válido → pasa y el handler recibe el actor', async () => {
      const res = await request(app).get(api('/fake/me')).set('Authorization', 'Bearer employee');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: { userId: 'u-emp' } });
    });

    it('sin el permiso requerido → 403 FORBIDDEN', async () => {
      const res = await request(app)
        .post(api('/fake/employees'))
        .set('Authorization', 'Bearer employee')
        .send({ name: 'Ana' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('con el permiso → 201', async () => {
      const res = await request(app)
        .post(api('/fake/employees'))
        .set('Authorization', 'Bearer admin')
        .send({ name: 'Ana' });
      expect(res.status).toBe(201);
      expect(res.body.data).toEqual({ name: 'Ana', companyId: 'c-1' });
    });

    it('con contraseña pendiente de cambio solo accede a rutas permitidas', async () => {
      const blocked = await request(app)
        .get(api('/fake/me'))
        .set('Authorization', 'Bearer pending');
      expect(blocked.status).toBe(403);
      expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

      await request(app)
        .patch(api('/fake/password'))
        .set('Authorization', 'Bearer pending')
        .expect(200);
    });
  });

  describe('validación de entrada', () => {
    const asAdmin = (req: request.Test) => req.set('Authorization', 'Bearer admin');

    it('body inválido → 400 con detalles por campo, en español', async () => {
      const res = await asAdmin(request(app).post(api('/fake/employees'))).send({ name: 'A' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details[0]).toMatchObject({ location: 'body', path: 'name' });
      expect(res.body.error.details[0].message).toMatch(/Demasiado pequeño|al menos/i);
    });

    it('campos no permitidos (asignación masiva) → 400', async () => {
      const res = await asAdmin(request(app).post(api('/fake/employees'))).send({
        name: 'Ana',
        role: 'platform_admin',
      });
      expect(res.status).toBe(400);
    });

    it('params con UUID inválido → 400', async () => {
      const res = await asAdmin(request(app).get(api('/fake/employees/123')));
      expect(res.status).toBe(400);
      expect(res.body.error.details[0].location).toBe('params');
    });

    it('JSON mal formado → 400 INVALID_JSON', async () => {
      const res = await asAdmin(request(app).post(api('/fake/employees')))
        .set('Content-Type', 'application/json')
        .send('{"name": ');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_JSON');
    });

    it('cuerpo que no es JSON (formulario) → 415', async () => {
      const res = await asAdmin(request(app).post(api('/fake/employees')))
        .type('form')
        .send('name=Ana');
      expect(res.status).toBe(415);
      expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    });

    it('cuerpo mayor al límite → 413', async () => {
      const res = await asAdmin(request(app).post(api('/fake/employees'))).send({
        name: 'x'.repeat(200_000),
      });
      expect(res.status).toBe(413);
    });
  });

  describe('errores', () => {
    it('ruta inexistente → 404 ROUTE_NOT_FOUND', async () => {
      const res = await request(app).get(api('/no-existe')).expect(404);
      expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
      expect(res.body.error.requestId).toBeTruthy();
    });

    it('error inesperado → 500 sin filtrar detalles internos', async () => {
      const res = await request(app).get(api('/fake/boom')).expect(500);
      expect(res.body).toEqual({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Ocurrió un error inesperado',
          requestId: expect.any(String),
        },
      });
      expect(JSON.stringify(res.body)).not.toMatch(/SELECT|stack/);
    });
  });

  describe('documentación', () => {
    it('genera OpenAPI desde las mismas rutas, marcando las protegidas', async () => {
      const res = await request(app).get('/docs/openapi.json').expect(200);
      const paths = res.body.paths;
      expect(paths[api('/health')].get.security).toEqual([]);
      expect(paths[api('/fake/employees')].post.security).toEqual([{ bearerAuth: [] }]);
      expect(paths[api('/fake/employees/{id}')]).toBeDefined();
    });

    it('documenta los códigos de error correctos para cada status', async () => {
      const res = await request(app).get('/docs/openapi.json').expect(200);
      const responses = res.body.paths[api('/fake/employees')].post.responses;
      const codesOf = (status: string): string[] =>
        responses[status].content['application/json'].schema.properties.error.properties.code.enum;

      expect(codesOf('400')).toEqual(['VALIDATION_ERROR', 'INVALID_JSON']);
      expect(codesOf('401')).toContain('TOKEN_EXPIRED');
      expect(codesOf('403')).toEqual([
        'FORBIDDEN',
        'PASSWORD_CHANGE_REQUIRED',
        'USER_INACTIVE',
        'COMPANY_SUSPENDED',
      ]);
      expect(codesOf('415')).toEqual(['UNSUPPORTED_MEDIA_TYPE']);
      expect(codesOf('429')).toEqual(['TOO_MANY_REQUESTS']);
      expect(codesOf('500')).toEqual(['INTERNAL_ERROR']);

      const health = res.body.paths[api('/health')].get.responses;
      expect(health['401']).toBeUndefined();
      expect(health['403']).toBeUndefined();
    });

    it('sirve Swagger UI', async () => {
      await request(app).get('/docs/').expect(200).expect('Content-Type', /html/);
    });
  });
});

describe('Seguridad del registro de rutas', () => {
  it('no permite dos rutas con el mismo método y path', () => {
    const duplicate: AppModule = { name: 'dup', register: () => {}, routes: fakeModule.routes };
    expect(() => bootstrap(testEnv(), [fakeModule, duplicate])).toThrow(/Ruta duplicada/);
  });

  it('en producción no expone la documentación', async () => {
    const prod = bootstrap(testEnv({ NODE_ENV: 'production' }), [systemModule]);
    await request(prod.app).get('/docs/openapi.json').expect(404);
  });
});
