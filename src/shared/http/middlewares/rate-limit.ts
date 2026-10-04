import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import type { Request, RequestHandler } from 'express';
import { SECURITY } from '#config/security.js';
import { TooManyRequestsError } from '#shared/domain/errors.js';

export interface RateLimitRule {
  readonly windowMs: number;
  readonly limit: number;
  readonly key?: 'ip' | 'ip+email';
}

export type RateLimitPreset =
  'login' | 'loginIp' | 'refresh' | 'sensitive' | 'heavyRead' | 'export';

export interface RateLimitPolicy {
  readonly global: RateLimitRule;
  readonly presets: Readonly<Record<RateLimitPreset, RateLimitRule>>;
}

export const DEFAULT_RATE_LIMITS: RateLimitPolicy = SECURITY.rateLimit;

function ipOf(req: Request): string {
  return ipKeyGenerator(req.ip ?? 'desconocida');
}

function emailOf(req: Request): string {
  const body: unknown = req.body;
  if (typeof body !== 'object' || body === null || !('email' in body)) return '';
  return typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 254) : '';
}

export function createRateLimiter(rule: RateLimitRule): RequestHandler {
  return rateLimit({
    windowMs: rule.windowMs,
    limit: rule.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    ...(rule.key === 'ip+email' && {
      keyGenerator: (req: Request) => `${ipOf(req)}|${emailOf(req)}`,
    }),
    handler: (_req, _res, next) => {
      next(
        new TooManyRequestsError('TOO_MANY_REQUESTS', 'Demasiadas peticiones; intenta más tarde'),
      );
    },
  });
}
