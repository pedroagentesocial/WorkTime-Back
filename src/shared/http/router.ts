import { Router, type Request, type RequestHandler, type Response } from 'express';
import type { z } from 'zod';
import type { Actor } from '#shared/application/actor.js';
import { hasPermission } from '#shared/domain/permissions.js';
import type { Authenticator } from '#shared/application/ports/authenticator.js';
import { ForbiddenError, UnauthorizedError, ValidationError } from '#shared/domain/errors.js';
import type { RateLimitPreset } from './middlewares/rate-limit.js';
import type { AnyRoute, RouteAuth, RouteContext } from './route.js';
import { requestIdOf } from './request-id.js';

export interface RouterDeps {
  getAuthenticator(): Authenticator;
  createRateLimiter(preset: RateLimitPreset): RequestHandler;
}

// Orden por ruta: limite, autenticacion, permiso, validacion y handler
export function buildApiRouter(routes: readonly AnyRoute[], deps: RouterDeps): Router {
  assertNoDuplicates(routes);
  const router = Router();

  for (const route of routes) {
    const middlewares: RequestHandler[] = [];
    for (const preset of [route.rateLimit ?? []].flat()) {
      middlewares.push(deps.createRateLimiter(preset));
    }

    router[route.method](route.path, ...middlewares, async (req: Request, res: Response) => {
      const actor = route.auth === 'public' ? null : await authorize(route, route.auth, req, deps);

      const context: RouteContext<Record<string, z.ZodType>, 'authenticated'> = {
        body: parse(route.request?.body, req.body, 'body'),
        query: parse(route.request?.query, req.query, 'query'),
        params: parse(route.request?.params, req.params, 'params'),
        actor: actor as Actor,
        request: { id: requestIdOf(req), ip: req.ip, userAgent: req.get('user-agent') },
      } as never;

      const result = await route.handler(context);
      if (result.headers) res.set(result.headers);
      res.status(result.status);
      if (result.body === undefined) res.end();
      else if (result.contentType)
        res.type(result.contentType).send(typeof result.body === 'string' ? result.body : '');
      else res.json(result.body);
    });
  }

  return router;
}

async function authorize(
  route: AnyRoute,
  required: Exclude<RouteAuth, 'public'>,
  req: Request,
  deps: RouterDeps,
): Promise<Actor> {
  const token = extractBearerToken(req.get('authorization'));
  if (!token) {
    throw new UnauthorizedError('MISSING_TOKEN', 'Falta el token de acceso');
  }

  const actor = await deps.getAuthenticator().authenticate(token);

  if (actor.mustChangePassword && !route.allowWhenPasswordChangeRequired) {
    throw new ForbiddenError(
      'PASSWORD_CHANGE_REQUIRED',
      'Debes cambiar tu contraseña antes de continuar',
    );
  }
  if (required !== 'authenticated' && !hasPermission(actor.role, required)) {
    throw new ForbiddenError('FORBIDDEN', 'No tienes permiso para realizar esta acción');
  }
  return actor;
}

function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token, ...rest] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token || rest.length > 0) return null;
  return token;
}

function parse(schema: z.ZodType | undefined, value: unknown, location: string): unknown {
  if (!schema) return undefined;
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new ValidationError(
    'VALIDATION_ERROR',
    'Los datos enviados no son válidos',
    result.error.issues.map((issue) => ({
      location,
      path: issue.path.join('.'),
      message: issue.message,
    })),
  );
}

function assertNoDuplicates(routes: readonly AnyRoute[]): void {
  const seen = new Set<string>();
  for (const { method, path } of routes) {
    const key = `${method.toUpperCase()} ${path}`;
    if (seen.has(key)) throw new Error(`Ruta duplicada: ${key}`);
    seen.add(key);
  }
}
