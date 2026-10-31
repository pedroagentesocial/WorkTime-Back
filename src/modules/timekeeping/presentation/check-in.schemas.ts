import { toLocalIsoString } from '#shared/domain/timezone.js';
import { paginationQuery, uuidSchema } from '#shared/http/schemas.js';
import { z } from '#shared/http/zod.js';
import { CORRECTION_REASON_LIMITS } from '../application/correct-time-entry.use-case.js';
import type { CheckInView } from '../application/ports/check-in.repository.js';
import { CHECK_IN_LIMITS } from '../domain/check-in.js';
import {
  employeeSummarySchema,
  locationSchema,
  workDate,
  zoneDto,
  zoneSchema,
} from './timekeeping.schemas.js';

// Los campos de ubicacion son opcionales en el esquema para responder LOCATION_REQUIRED con un mensaje claro
export const createCheckInBody = z
  .object({
    latitude: locationSchema.shape.latitude.optional(),
    longitude: locationSchema.shape.longitude.optional(),
    accuracyMeters: locationSchema.shape.accuracyMeters.optional(),
    note: z
      .string()
      .max(CHECK_IN_LIMITS.noteMax)
      .optional()
      .openapi({
        example: 'Llegué con el cliente Pérez',
        description: `Nota opcional, hasta ${CHECK_IN_LIMITS.noteMax} caracteres`,
      }),
  })
  .strict()
  .optional()
  .openapi('CreateCheckInRequest');

const rangeQuery = {
  from: workDate.optional().openapi({ description: 'Día laboral inicial (inclusive)' }),
  to: workDate.optional().openapi({ description: 'Día laboral final (inclusive)' }),
};

export const myCheckInsQuery = paginationQuery.extend(rangeQuery);

export const companyCheckInsQuery = paginationQuery.extend({
  ...rangeQuery,
  employeeId: uuidSchema.optional(),
  location: z.enum(['outside']).optional().openapi({
    description: 'outside: solo los registrados fuera de toda zona de trabajo',
  }),
  status: z.enum(['voided']).optional().openapi({
    description: 'Sin estado no se incluyen los anulados; voided trae solo los anulados',
  }),
});

export const voidCheckInBody = z
  .object({
    reason: z
      .string()
      .trim()
      .min(CORRECTION_REASON_LIMITS.min)
      .max(CORRECTION_REASON_LIMITS.max)
      .openapi({ example: 'Lo registró por error en otro cliente' }),
  })
  .strict()
  .openapi('VoidCheckInRequest');

const checkInFields = {
  id: z.uuid(),
  checkedInAt: z.iso.datetime().openapi({ description: 'Instante exacto en UTC' }),
  checkedInLocal: z.string().openapi({
    example: '2026-06-01T10:15:00-06:00',
    description: 'La misma hora en la zona horaria del empleado',
  }),
  timezone: z.string(),
  workDate: workDate.openapi({ description: 'Día laboral local del empleado' }),
  location: locationSchema,
  zone: zoneSchema.or(z.null()).openapi({
    description:
      'Dentro o fuera de la zona de trabajo más cercana; null si la empresa no tiene zonas',
  }),
  note: z.string().nullable(),
};

export const myCheckInSchema = z.object(checkInFields).openapi('MyCheckIn');

export const companyCheckInSchema = z
  .object({
    ...checkInFields,
    employee: employeeSummarySchema,
    status: z.enum(['active', 'voided']),
    voidedAt: z.iso.datetime().nullable(),
    voidReason: z.string().nullable(),
    voidedBy: z.object({ id: z.uuid(), firstName: z.string(), lastName: z.string() }).nullable(),
  })
  .openapi('CompanyCheckIn');

function baseDto(view: CheckInView) {
  return {
    id: view.id,
    checkedInAt: view.checkedInAt.toISOString(),
    checkedInLocal: toLocalIsoString(view.checkedInAt, view.timezone),
    timezone: view.timezone,
    workDate: view.workDate,
    location: view.location,
    zone: zoneDto(view.zone),
    note: view.note,
  };
}

export function myCheckInDto(view: CheckInView) {
  return baseDto(view);
}

export function companyCheckInDto(view: CheckInView) {
  return {
    ...baseDto(view),
    employee: view.employee,
    status: view.voided ? ('voided' as const) : ('active' as const),
    voidedAt: view.voided?.at.toISOString() ?? null,
    voidReason: view.voided?.reason ?? null,
    voidedBy: view.voided?.by ?? null,
  };
}
