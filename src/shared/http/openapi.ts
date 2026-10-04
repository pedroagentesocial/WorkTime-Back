import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  type ResponseConfig,
  type RouteConfig,
} from '@asteasolutions/zod-to-openapi';
import { API_PREFIX } from '#config/security.js';
import type { AnyRoute, ResponseSpec } from './route.js';
import { z } from './zod.js';

export function buildOpenApiDocument(routes: readonly AnyRoute[]): object {
  const registry = new OpenAPIRegistry();
  const bearer = registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  });

  for (const route of routes) {
    const isPublic = route.auth === 'public';
    const body = route.request?.body;

    const request: RouteConfig['request'] = {
      ...(route.request?.params && { params: route.request.params }),
      ...(route.request?.query && { query: route.request.query }),
      ...(body && { body: { required: true, content: { 'application/json': { schema: body } } } }),
    };

    registry.registerPath({
      method: route.method,
      path: API_PREFIX + toOpenApiPath(route.path),
      summary: route.summary,
      ...(route.description && { description: route.description }),
      tags: [...route.tags],
      security: isPublic ? [] : [{ [bearer.name]: [] }],
      ...(isPublic ? {} : { 'x-permission': route.auth }),
      request,
      responses: buildResponses(route),
    });
  }

  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'WorkTime API',
      version: '1.0.0',
      description: [
        'API de control de asistencia multiempresa.',
        '',
        '- Respuestas exitosas: `{ data, meta? }`.',
        '- Errores: `{ error: { code, message, details?, requestId } }`. Usa `code` (estable) para ' +
          'decidir qué hacer; `message` es texto para mostrar al usuario.',
        '- Autenticación: `POST /auth/login` y luego el `accessToken` en **Authorize**.',
      ].join('\n'),
    },
  });
}

function toOpenApiPath(expressPath: string): string {
  return expressPath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

interface ErrorDoc {
  description: string;
  codes: string[];
}

function buildResponses(route: AnyRoute): Record<string, ResponseConfig> {
  const errors = defaultErrors(route);
  const result: Record<string, ResponseConfig> = {};

  for (const [statusText, spec] of Object.entries<ResponseSpec>(route.responses)) {
    const status = Number(statusText);
    if (status >= 400) {
      const current = errors.get(status);
      errors.set(status, {
        description: spec.description,
        codes: unique([...(spec.errorCodes ?? []), ...(current?.codes ?? [])]),
      });
      continue;
    }
    result[statusText] = {
      description: spec.description,
      ...(spec.schema && { content: { 'application/json': { schema: spec.schema } } }),
      ...(spec.contentType && {
        content: { [spec.contentType]: { schema: { type: 'string' as const } } },
      }),
    };
  }

  for (const [status, doc] of [...errors].sort(([a], [b]) => a - b)) {
    result[String(status)] = errorResponseConfig(status, doc);
  }
  return result;
}

function defaultErrors(route: AnyRoute): Map<number, ErrorDoc> {
  const errors = new Map<number, ErrorDoc>();
  const hasInput = Boolean(route.request?.body ?? route.request?.query ?? route.request?.params);
  const hasBody = Boolean(route.request?.body);
  const isPublic = route.auth === 'public';

  if (hasInput) {
    errors.set(400, {
      description: 'Datos inválidos',
      codes: hasBody ? ['VALIDATION_ERROR', 'INVALID_JSON'] : ['VALIDATION_ERROR'],
    });
  }
  if (!isPublic) {
    errors.set(401, {
      description: 'Sin sesión válida: inicia sesión o renueva el token',
      codes: ['MISSING_TOKEN', 'INVALID_TOKEN', 'TOKEN_EXPIRED', 'SESSION_REVOKED'],
    });
    errors.set(403, {
      description: 'Sesión válida pero sin acceso a esta acción',
      codes: [
        ...(route.auth === 'authenticated' ? [] : ['FORBIDDEN']),
        ...(route.allowWhenPasswordChangeRequired ? [] : ['PASSWORD_CHANGE_REQUIRED']),
        'USER_INACTIVE',
        'COMPANY_SUSPENDED',
      ],
    });
  }
  if (hasBody) {
    errors.set(413, { description: 'Cuerpo demasiado grande', codes: ['PAYLOAD_TOO_LARGE'] });
    errors.set(415, {
      description: 'El cuerpo debe ser application/json',
      codes: ['UNSUPPORTED_MEDIA_TYPE'],
    });
  }
  errors.set(429, { description: 'Demasiadas peticiones', codes: ['TOO_MANY_REQUESTS'] });
  errors.set(500, { description: 'Error inesperado', codes: ['INTERNAL_ERROR'] });
  return errors;
}

const validationDetails = z
  .array(
    z.object({
      location: z.enum(['body', 'query', 'params']),
      path: z.string().openapi({ example: 'email' }),
      message: z.string().openapi({ example: 'Debe ser un email válido' }),
    }),
  )
  .optional()
  .openapi({ description: 'Solo en errores de validación: un elemento por campo inválido.' });

function errorResponseConfig(status: number, doc: ErrorDoc): ResponseConfig {
  const [firstCode = 'ERROR', ...otherCodes] = doc.codes;
  const schema = z.object({
    error: z.object({
      code: z.enum([firstCode, ...otherCodes]).openapi({ example: firstCode }),
      message: z.string().openapi({ example: doc.description }),
      ...(status === 400 && { details: validationDetails }),
      requestId: z.string().openapi({ example: '0199a1b2-7c3d-7e4f-8a9b-0c1d2e3f4a5b' }),
    }),
  });

  return {
    description: `${doc.description} — \`${doc.codes.join('` · `')}\``,
    content: { 'application/json': { schema } },
  };
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
