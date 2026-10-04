import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from '#shared/application/ports/logger.js';
import { requestIdOf } from './request-id.js';
import { AppError, NotFoundError, type ErrorKind } from '#shared/domain/errors.js';

const STATUS_BY_KIND: Readonly<Record<ErrorKind, number>> = {
  validation: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  too_many_requests: 429,
};

const BODY_PARSER_ERRORS: Readonly<
  Record<string, { status: number; code: string; message: string }>
> = {
  'entity.parse.failed': {
    status: 400,
    code: 'INVALID_JSON',
    message: 'El cuerpo de la petición no es JSON válido',
  },
  'entity.too.large': {
    status: 413,
    code: 'PAYLOAD_TOO_LARGE',
    message: 'El cuerpo de la petición es demasiado grande',
  },
  'encoding.unsupported': {
    status: 415,
    code: 'UNSUPPORTED_ENCODING',
    message: 'Codificación no soportada',
  },
  'charset.unsupported': {
    status: 415,
    code: 'UNSUPPORTED_CHARSET',
    message: 'Charset no soportado',
  },
};

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundError('ROUTE_NOT_FOUND', `No existe la ruta ${req.method} ${req.path}`));
};

// Los errores inesperados nunca exponen detalles internos
export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (err: unknown, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const requestId = requestIdOf(req);

    if (err instanceof AppError) {
      const status = STATUS_BY_KIND[err.kind];
      res.status(status).json({
        error: {
          code: err.code,
          message: err.message,
          ...(err.details !== undefined && { details: err.details }),
          requestId,
        },
      });
      return;
    }

    const bodyError = bodyParserError(err);
    if (bodyError) {
      res.status(bodyError.status).json({
        error: { code: bodyError.code, message: bodyError.message, requestId },
      });
      return;
    }

    logger.error({ err, requestId }, 'Error no controlado');
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Ocurrió un error inesperado', requestId },
    });
  };
}

function bodyParserError(err: unknown) {
  if (typeof err !== 'object' || err === null || !('type' in err) || typeof err.type !== 'string') {
    return undefined;
  }
  return Object.hasOwn(BODY_PARSER_ERRORS, err.type) ? BODY_PARSER_ERRORS[err.type] : undefined;
}
