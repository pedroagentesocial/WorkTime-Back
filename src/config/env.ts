import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { parseDuration } from '#shared/domain/duration.js';
import { SECURITY } from './security.js';

// Unico archivo que lee process.env; si algo falta o es invalido la app no arranca
const MIN_JWT_SECRET_LENGTH = 64;

const PLACEHOLDER_SECRETS = [
  'change-me',
  'changeme',
  'secret',
  'password',
  'your-secret',
  'jwt_secret',
];

const durationBetween = (min: string, max: string) =>
  z.string().transform((value, ctx) => {
    try {
      const ms = parseDuration(value);
      if (ms < parseDuration(min) || ms > parseDuration(max)) {
        ctx.addIssue({ code: 'custom', message: `Debe estar entre ${min} y ${max}` });
        return z.NEVER;
      }
      return ms;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Formato inválido; usa por ejemplo 15m, 12h o 7d' });
      return z.NEVER;
    }
  });

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production'], {
      error: 'Es obligatoria: development, test o production',
    }),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    CORS_ORIGINS: z
      .string({ error: 'Es obligatoria' })
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      )
      .pipe(
        z
          .array(
            z.union([z.literal('*'), z.url({ message: 'Cada origen debe ser una URL válida' })]),
          )
          .min(1, 'Define al menos un origen'),
      ),
    DATABASE_URL: z
      .string({ error: 'Es obligatoria' })
      .regex(/^postgres(ql)?:\/\/.+/, 'Debe ser una URL postgresql://'),
    JWT_SECRET: z
      .string({ error: 'Es obligatoria' })
      .min(MIN_JWT_SECRET_LENGTH, `Debe tener al menos ${MIN_JWT_SECRET_LENGTH} caracteres`)
      .refine(
        (value) => !PLACEHOLDER_SECRETS.some((p) => value.toLowerCase().includes(p)),
        'Parece un valor de ejemplo; genera uno aleatorio',
      ),
    JWT_ACCESS_TTL: durationBetween('5m', '1h').default(parseDuration('15m')),
    REFRESH_TOKEN_TTL: durationBetween('1d', '30d').default(parseDuration('7d')),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === 'production' && value.CORS_ORIGINS.includes('*')) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'No se permite * en producción',
      });
    }
  });

export interface Env {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly isProduction: boolean;
  readonly isTest: boolean;
  readonly port: number;
  readonly corsOrigins: readonly string[];
  readonly databaseUrl: string;
  readonly jwt: {
    readonly secret: string;
    readonly accessTtlMs: number;
  };
  readonly refreshTokenTtlMs: number;
}

export class EnvValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Configuración inválida en el .env:\n  - ${issues.join('\n  - ')}`);
    this.name = 'EnvValidationError';
  }
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(raíz)'}: ${issue.message}`),
    );
  }
  const v = result.data;
  return Object.freeze({
    nodeEnv: v.NODE_ENV,
    isProduction: v.NODE_ENV === 'production',
    isTest: v.NODE_ENV === 'test',
    port: v.PORT,
    corsOrigins: Object.freeze(v.CORS_ORIGINS),
    databaseUrl: v.DATABASE_URL,
    jwt: Object.freeze({ secret: v.JWT_SECRET, accessTtlMs: v.JWT_ACCESS_TTL }),
    refreshTokenTtlMs: v.REFRESH_TOKEN_TTL,
  });
}

export function loadEnv(): Env {
  loadDotenv({ path: '.env', quiet: true });
  return parseEnv(process.env);
}

export interface SeedAdminConfig {
  readonly email: string;
  readonly password: string;
}

const seedAdminSchema = z.object({
  SEED_ADMIN_EMAIL: z
    .email({ message: 'Debe ser un email válido' })
    .transform((email) => email.trim().toLowerCase()),
  SEED_ADMIN_PASSWORD: z
    .string({ error: 'Es obligatoria' })
    .min(
      SECURITY.password.minLength,
      `Debe tener al menos ${SECURITY.password.minLength} caracteres`,
    )
    .max(
      SECURITY.password.maxLength,
      `Debe tener como máximo ${SECURITY.password.maxLength} caracteres`,
    ),
});

export function parseSeedAdminConfig(source: Record<string, string | undefined>): SeedAdminConfig {
  const result = seedAdminSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  return Object.freeze({
    email: result.data.SEED_ADMIN_EMAIL,
    password: result.data.SEED_ADMIN_PASSWORD,
  });
}

export function loadSeedAdminConfig(): SeedAdminConfig {
  return parseSeedAdminConfig(process.env);
}
