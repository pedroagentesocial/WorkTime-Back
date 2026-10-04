export const SECURITY = Object.freeze({
  jwt: {
    issuer: 'worktime-api',
    audience: 'worktime-clients',
    algorithm: 'HS256',
  },

  password: {
    minLength: 12,
    maxLength: 128,
    temporaryTtlHours: 72,
    temporaryLength: 16,
  },

  argon2: {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  },

  session: {
    maxAgeDays: 30,
  },

  login: {
    maxFailedAttempts: 5,
    lockoutMinutes: 15,
  },

  // Detras de un proxy hay que configurar trust proxy o todos los clientes compartiran IP
  rateLimit: {
    global: { windowMs: 60_000, limit: 300 },
    presets: {
      login: { windowMs: 15 * 60_000, limit: 10, key: 'ip+email' },
      loginIp: { windowMs: 15 * 60_000, limit: 100 },
      refresh: { windowMs: 15 * 60_000, limit: 120 },
      sensitive: { windowMs: 15 * 60_000, limit: 30 },
      heavyRead: { windowMs: 60_000, limit: 60 },
      export: { windowMs: 15 * 60_000, limit: 20 },
    },
  },

  http: {
    bodyLimit: '100kb',
    requestTimeoutMs: 30_000,
    headersTimeoutMs: 15_000,
    keepAliveTimeoutMs: 5_000,
  },
} as const);

export const API_PREFIX = '/api/v1';
