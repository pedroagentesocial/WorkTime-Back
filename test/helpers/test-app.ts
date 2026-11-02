import { asValue } from 'awilix';
import type { Express } from 'express';
import request from 'supertest';
import { API_PREFIX } from '#config/security.js';
import { modules } from '#modules/index.js';
import type { AppContainer } from '#shared/composition/container.js';
import type { RateLimitPolicy } from '#shared/http/middlewares/rate-limit.js';
import { bootstrap } from '../../src/bootstrap.js';
import { FakeClock } from './fake-clock.js';
import { FakeEmailSender } from './fake-email-sender.js';
import { testEnv } from './test-env.js';

export interface TestApp {
  readonly app: Express;
  readonly clock: FakeClock;
  readonly container: AppContainer;
  // Correos que la API habria enviado
  readonly emails: FakeEmailSender;
}

export function createTestApp(options: { presetLimit?: number } = {}): TestApp {
  const clock = new FakeClock(new Date('2026-06-01T12:00:00Z'));
  const preset = { windowMs: 60_000, limit: options.presetLimit ?? 10_000 };
  const emails = new FakeEmailSender();
  const rateLimits: RateLimitPolicy = {
    global: { windowMs: 60_000, limit: 10_000 },
    presets: {
      login: { ...preset, key: 'ip+email' },
      loginIp: { ...preset, limit: preset.limit * 10 },
      refresh: preset,
      sensitive: preset,
      heavyRead: preset,
      export: preset,
    },
  };
  const { app, container } = bootstrap(testEnv(), modules, {
    configure(container) {
      container.register({
        clock: asValue(clock),
        rateLimits: asValue(rateLimits),
        emailSender: asValue(emails),
      });
    },
  });
  return { app, clock, container, emails };
}

export const api = (path: string): string => `${API_PREFIX}${path}`;

export async function login(app: Express, email: string, password: string) {
  const res = await request(app).post(api('/auth/login')).send({ email, password });
  if (res.status !== 200) {
    throw new Error(`login falló (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.data as {
    accessToken: string;
    refreshToken: string;
    user: { mustChangePassword: boolean };
  };
}

// Un admin multiempresa elige con que empresa trabaja; devuelve la sesion nueva. La sesion rota:
// se guarda en session el refresh token nuevo para poder volver a cambiar desde ella
export async function switchCompany(
  app: Express,
  session: { accessToken: string; refreshToken: string },
  companyId: string | null,
) {
  const res = await request(app)
    .post(api('/auth/active-company'))
    .set(bearer(session.accessToken))
    .send({ companyId, refreshToken: session.refreshToken });
  if (res.status !== 200) {
    throw new Error(`cambio de empresa falló (${res.status}): ${JSON.stringify(res.body)}`);
  }
  const next = res.body.data as { accessToken: string; refreshToken: string };
  session.refreshToken = next.refreshToken;
  return next;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
