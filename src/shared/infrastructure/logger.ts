import { pino, type Logger as PinoLogger } from 'pino';
import type { Env } from '#config/env.js';

const SENSITIVE_FIELDS = [
  'password',
  'currentPassword',
  'newPassword',
  'temporaryPassword',
  'passwordHash',
  'refreshToken',
  'accessToken',
  'token',
  'tokenHash',
];

const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  ...SENSITIVE_FIELDS.flatMap((field) => [`*.${field}`, `*.*.${field}`]),
];

const OMITTED = '[omitido: puede contener datos de la consulta]';

// Los errores de Prisma traen argumentos de la consulta en el mensaje: se omiten
export function serializeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { type: typeof error, value: OMITTED };

  const isPrismaError = error.name.startsWith('Prisma');
  const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
  return {
    type: error.name,
    ...(code && { code }),
    message: isPrismaError ? OMITTED : error.message,
    stack: isPrismaError ? error.stack?.split('\n').slice(1).join('\n') : error.stack,
  };
}

export function createLogger(env: Pick<Env, 'isProduction' | 'isTest'>): PinoLogger {
  const pretty = !env.isProduction && !env.isTest;
  return pino({
    level: env.isTest ? 'silent' : env.isProduction ? 'info' : 'debug',
    redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
    serializers: { err: serializeError },
    base: env.isProduction ? { service: 'worktime-api' } : undefined,
    ...(pretty && {
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
      },
    }),
  });
}
