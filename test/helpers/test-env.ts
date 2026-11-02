import { parseEnv, type Env } from '#config/env.js';
import { testDatabaseUrl } from './database.js';

export function testEnv(overrides: Record<string, string> = {}): Env {
  return parseEnv({
    NODE_ENV: 'test',
    CORS_ORIGINS: 'http://localhost:4200',
    DATABASE_URL: testDatabaseUrl(),
    JWT_SECRET: 'tests-only-hmac-key-'.padEnd(64, 'k'),
    // Los tests nunca llegan a Resend: createTestApp cambia el envio por FakeEmailSender
    RESEND_API_KEY: 're_tests',
    EMAIL_FROM: 'WorkTime <no-responder@worktime.dev>',
    APP_URL: 'https://app.worktime.dev',
    ...overrides,
  });
}
