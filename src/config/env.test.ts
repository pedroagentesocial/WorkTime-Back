import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseEnv } from './env.js';

const validSecret = 'a'.repeat(32) + 'Z9'.repeat(16);

const base = {
  NODE_ENV: 'development',
  CORS_ORIGINS: 'http://localhost:4200, https://app.example.com',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/worktime',
  JWT_SECRET: validSecret,
};

function issuesOf(source: Record<string, string | undefined>): string[] {
  try {
    parseEnv(source);
  } catch (error) {
    if (error instanceof EnvValidationError) return [...error.issues];
    throw error;
  }
  return [];
}

describe('parseEnv', () => {
  it('acepta una configuración mínima y aplica valores por defecto', () => {
    const env = parseEnv(base);
    expect(env.port).toBe(3000);
    expect(env.trustProxyHops).toBe(0);
    expect(env.corsOrigins).toEqual(['http://localhost:4200', 'https://app.example.com']);
    expect(env.jwt.accessTtlMs).toBe(15 * 60_000);
    expect(env.refreshTokenTtlMs).toBe(7 * 86_400_000);
    expect(env.isProduction).toBe(false);
  });

  it('acepta saltos de proxy y rechaza valores fuera de rango', () => {
    expect(parseEnv({ ...base, TRUST_PROXY_HOPS: '1' }).trustProxyHops).toBe(1);
    expect(issuesOf({ ...base, TRUST_PROXY_HOPS: '9' })).toHaveLength(1);
    expect(issuesOf({ ...base, TRUST_PROXY_HOPS: '-1' })).toHaveLength(1);
  });

  it('el resultado es inmutable', () => {
    const env = parseEnv(base);
    expect(Object.isFrozen(env)).toBe(true);
    expect(Object.isFrozen(env.jwt)).toBe(true);
  });

  it('exige los secretos obligatorios', () => {
    const issues = issuesOf({ NODE_ENV: 'development' });
    expect(issues.some((i) => i.startsWith('JWT_SECRET'))).toBe(true);
    expect(issues.some((i) => i.startsWith('DATABASE_URL'))).toBe(true);
    expect(issues.some((i) => i.startsWith('CORS_ORIGINS'))).toBe(true);
  });

  it('exige NODE_ENV: sin él no se asume "development"', () => {
    const { NODE_ENV: _omitted, ...withoutNodeEnv } = base;
    expect(issuesOf(withoutNodeEnv)[0]).toMatch(/^NODE_ENV: Es obligatoria/);
  });

  it('rechaza un JWT_SECRET corto', () => {
    expect(issuesOf({ ...base, JWT_SECRET: 'corto' })[0]).toMatch(
      /^JWT_SECRET: Debe tener al menos 64/,
    );
  });

  it('rechaza un JWT_SECRET con valor de ejemplo', () => {
    expect(issuesOf({ ...base, JWT_SECRET: 'change-me'.repeat(10) })[0]).toMatch(
      /valor de ejemplo/,
    );
  });

  it('rechaza TTL fuera de rango o mal escritos', () => {
    expect(issuesOf({ ...base, JWT_ACCESS_TTL: '2h' })[0]).toMatch(/entre 5m y 1h/);
    expect(issuesOf({ ...base, REFRESH_TOKEN_TTL: 'siete' })[0]).toMatch(/Formato inválido/);
  });

  it('rechaza CORS * en producción pero lo permite en desarrollo', () => {
    expect(parseEnv({ ...base, CORS_ORIGINS: '*' }).corsOrigins).toEqual(['*']);
    expect(issuesOf({ ...base, NODE_ENV: 'production', CORS_ORIGINS: '*' })[0]).toMatch(
      /No se permite \* en producción/,
    );
  });

  it('rechaza una DATABASE_URL que no es de Postgres', () => {
    expect(issuesOf({ ...base, DATABASE_URL: 'mysql://x' })[0]).toMatch(/^DATABASE_URL/);
  });
});
