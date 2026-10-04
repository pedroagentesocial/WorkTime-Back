import { defineRoute, type AnyRoute } from '#shared/http/route.js';
import { dataResponse } from '#shared/http/schemas.js';
import { z } from '#shared/http/zod.js';
import type { GetHealthUseCase } from '../application/get-health.use-case.js';

const healthReport = z
  .object({
    status: z.enum(['ok', 'degraded']),
    checks: z.record(z.string(), z.enum(['up', 'down'])),
    uptimeSeconds: z.number().int(),
    timestamp: z.iso.datetime(),
  })
  .openapi('HealthReport');

interface Deps {
  getHealth: GetHealthUseCase;
}

export function systemRoutes({ getHealth }: Deps): AnyRoute[] {
  return [
    defineRoute({
      method: 'get',
      path: '/health',
      summary: 'Estado del servicio',
      description:
        'Devuelve 200 si todo funciona y 503 si algún componente (p. ej. la BD) no responde.',
      tags: ['Sistema'],
      auth: 'public',
      responses: {
        200: { description: 'Servicio operativo', schema: dataResponse(healthReport) },
        503: { description: 'Servicio degradado', schema: dataResponse(healthReport) },
      },
      handler: async () => {
        const report = await getHealth.execute();
        return { status: report.status === 'ok' ? 200 : 503, body: { data: report } };
      },
    }),
  ];
}
