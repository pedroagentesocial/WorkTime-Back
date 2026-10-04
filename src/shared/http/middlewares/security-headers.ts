import type { RequestHandler } from 'express';
import { requestIdOf } from '../request-id.js';

const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH']);

export const noStore: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

export const requireJsonBody: RequestHandler = (req, res, next) => {
  const hasBody =
    Number(req.get('content-length') ?? 0) > 0 || req.get('transfer-encoding') !== undefined;

  if (METHODS_WITH_BODY.has(req.method) && hasBody && !req.is('application/json')) {
    res.status(415).json({
      error: {
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'El cuerpo de la petición debe ser application/json',
        requestId: requestIdOf(req),
      },
    });
    return;
  }
  next();
};
