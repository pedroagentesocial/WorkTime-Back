import type { z } from 'zod';
import type { Actor } from '#shared/application/actor.js';
import type { Permission } from '#shared/domain/permissions.js';
import type { RateLimitPreset } from './middlewares/rate-limit.js';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

// Obligatorio en cada ruta: sin valor por defecto nada queda expuesto por olvido
export type RouteAuth = 'public' | 'authenticated' | Permission;

export interface RequestSchemas {
  body?: z.ZodType;
  query?: z.ZodObject;
  params?: z.ZodObject;
}

type Parsed<S extends RequestSchemas, K extends keyof RequestSchemas> = S extends {
  [P in K]: infer T extends z.ZodType;
}
  ? z.output<T>
  : undefined;

export interface RequestInfo {
  readonly id: string;
  readonly ip: string | undefined;
  readonly userAgent: string | undefined;
}

export interface RouteContext<S extends RequestSchemas, A extends RouteAuth> {
  readonly body: Parsed<S, 'body'>;
  readonly query: Parsed<S, 'query'>;
  readonly params: Parsed<S, 'params'>;
  readonly actor: A extends 'public' ? null : Actor;
  readonly request: RequestInfo;
}

export interface HttpResult {
  readonly status: number;
  readonly body?: unknown;
  readonly contentType?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface ResponseSpec {
  readonly description: string;
  readonly schema?: z.ZodType;
  readonly contentType?: string;
  readonly errorCodes?: readonly string[];
}

export interface RouteDefinition<
  S extends RequestSchemas = RequestSchemas,
  A extends RouteAuth = RouteAuth,
> {
  readonly method: HttpMethod;
  readonly path: string;
  readonly summary: string;
  readonly description?: string;
  readonly tags: readonly string[];
  readonly auth: A;
  readonly allowWhenPasswordChangeRequired?: boolean;
  readonly rateLimit?: RateLimitPreset | readonly RateLimitPreset[];
  readonly request?: S;
  readonly responses: Readonly<Record<number, ResponseSpec>>;
  handler(context: RouteContext<S, A>): Promise<HttpResult>;
}

export type AnyRoute = RouteDefinition;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- {} = "sin esquemas"
export function defineRoute<const A extends RouteAuth, S extends RequestSchemas = {}>(
  definition: RouteDefinition<S, A>,
): AnyRoute {
  return definition;
}

export interface PaginationMeta {
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly totalPages: number;
}

export function ok(data: unknown, meta?: Record<string, unknown>): HttpResult {
  return { status: 200, body: meta ? { data, meta } : { data } };
}

export function created(data: unknown): HttpResult {
  return { status: 201, body: { data } };
}

export function noContent(): HttpResult {
  return { status: 204 };
}

export function paginated(
  items: readonly unknown[],
  page: { page: number; limit: number; total: number },
  extraMeta?: Record<string, unknown>,
): HttpResult {
  const meta: PaginationMeta & Record<string, unknown> = {
    page: page.page,
    limit: page.limit,
    total: page.total,
    totalPages: Math.ceil(page.total / page.limit),
    ...extraMeta,
  };
  return { status: 200, body: { data: items, meta } };
}
