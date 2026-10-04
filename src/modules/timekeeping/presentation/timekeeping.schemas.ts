import { toLocalIsoString } from '#shared/domain/timezone.js';
import { paginationQuery, uuidSchema } from '#shared/http/schemas.js';
import { z } from '#shared/http/zod.js';
import { CORRECTION_REASON_LIMITS } from '../application/correct-time-entry.use-case.js';
import type { CorrectionView, TimeEntryView } from '../application/ports/time-entry.repository.js';
import { DAILY_REPORT_LIMITS } from '../domain/daily-report.js';
import type { DailyReportView } from '../application/ports/daily-report.repository.js';
import type { PayPeriodStatus } from '../application/pay-period.use-cases.js';
import type { PeriodClosureView } from '../application/ports/period-closure.repository.js';
import type { RosterRow } from '../application/attendance-roster.use-case.js';
import {
  ATTENDANCE_ACTIVITY_TYPES,
  type AttendanceActivityView,
} from '../application/ports/attendance-activity.reader.js';
import type { TimeEntry } from '../domain/time-entry.js';
import { centihoursToHours, durationSeconds, toDecimalHours } from '../domain/work-hours.js';

const MIN_YEAR = 2000;
const MAX_YEAR = 2100;
const RANGE_MESSAGE = `La fecha debe estar entre los años ${MIN_YEAR} y ${MAX_YEAR}`;

const workDate = z.iso
  .date()
  .refine((value) => value >= `${MIN_YEAR}-01-01` && value <= `${MAX_YEAR}-12-31`, RANGE_MESSAGE)
  .openapi({ example: '2026-06-01' });
const entryStatus = z.enum(['open', 'closed']);

const pendingDaysSchema = z.array(workDate).openapi({
  description:
    'Días anteriores con marcajes y sin reporte, de los últimos 14, del más viejo al más nuevo',
});

const rangeQuery = {
  from: workDate.optional().openapi({ description: 'Día laboral inicial (inclusive)' }),
  to: workDate.optional().openapi({ description: 'Día laboral final (inclusive)' }),
  status: entryStatus.optional(),
};

export const myTimeEntriesQuery = paginationQuery.extend(rangeQuery);

export const companyTimeEntriesQuery = paginationQuery.extend({
  ...rangeQuery,
  status: z.enum(['open', 'closed', 'voided']).optional().openapi({
    description: 'Sin estado no se incluyen los anulados; voided trae solo los anulados',
  }),
  employeeId: uuidSchema.optional(),
});

export const voidTimeEntryBody = z
  .object({
    reason: z
      .string()
      .trim()
      .min(CORRECTION_REASON_LIMITS.min)
      .max(CORRECTION_REASON_LIMITS.max)
      .openapi({ example: 'Se creó por duplicado' }),
  })
  .strict()
  .openapi('VoidTimeEntryRequest');

const instant = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value))
  .refine(
    (value) => value.getUTCFullYear() >= MIN_YEAR && value.getUTCFullYear() <= MAX_YEAR,
    RANGE_MESSAGE,
  )
  .openapi({ example: '2026-06-01T08:00:00-06:00' });

export const correctTimeEntryBody = z
  .object({
    clockInAt: instant.optional(),
    clockOutAt: instant.optional(),
    reason: z
      .string()
      .trim()
      .min(CORRECTION_REASON_LIMITS.min)
      .max(CORRECTION_REASON_LIMITS.max)
      .openapi({ example: 'Olvidó marcar la salida; confirmado con su supervisor' }),
  })
  .strict()
  .refine((body) => body.clockInAt !== undefined || body.clockOutAt !== undefined, {
    message: 'Indica clockInAt, clockOutAt o ambos',
  })
  .openapi('CorrectTimeEntryRequest');

export const manualTimeEntryBody = z
  .object({
    clockInAt: instant,
    clockOutAt: instant,
    reason: z
      .string()
      .trim()
      .min(CORRECTION_REASON_LIMITS.min)
      .max(CORRECTION_REASON_LIMITS.max)
      .openapi({ example: 'Olvidó marcar; confirmado con su supervisor' }),
  })
  .strict()
  .openapi('CreateManualTimeEntryRequest');

const timeEntryFields = {
  id: z.uuid(),
  status: entryStatus,
  clockInAt: z.iso.datetime().openapi({ description: 'Instante exacto en UTC' }),
  clockOutAt: z.iso.datetime().nullable(),
  clockInLocal: z.string().openapi({
    example: '2026-06-01T08:00:00-06:00',
    description: 'Hora local del empleado, con su desfase',
  }),
  clockOutLocal: z.string().nullable(),
  timezone: z.string().openapi({ example: 'America/Denver' }),
  workDate: workDate.openapi({ description: 'Día laboral local (fecha de la entrada)' }),
  durationSeconds: z.number().int().nullable().openapi({ description: 'null si sigue abierta' }),
  durationHours: z.number().nullable().openapi({
    example: 8.52,
    description:
      'Horas decimales con 2 decimales, redondeadas al más cercano. null si sigue abierta',
  }),
  source: z.enum(['web', 'admin']),
  createdReason: z.string().nullable().openapi({
    description: 'Motivo cuando el admin creó el registro a mano; null en un marcaje normal',
  }),
  closedBy: z.enum(['employee', 'admin', 'daily_limit']).nullable().openapi({
    description:
      'Quién cerró el registro: el empleado, un admin o el límite diario. null si sigue abierto o es anterior a este dato',
  }),
};

export const myTimeEntrySchema = z
  .object({
    ...timeEntryFields,
    corrected: z.boolean().openapi({ description: 'true si un admin lo corrigió' }),
  })
  .openapi('MyTimeEntry');

const employeeSummarySchema = z.object({
  id: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
  employeeCode: z.string().nullable(),
});

export const companyTimeEntrySchema = z
  .object({
    ...timeEntryFields,
    status: z.enum(['open', 'closed', 'voided']),
    employee: employeeSummarySchema,
    corrections: z.number().int(),
    voidedAt: z.iso.datetime().nullable(),
    voidReason: z.string().nullable(),
    voidedBy: z.object({ id: z.uuid(), firstName: z.string(), lastName: z.string() }).nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .openapi('TimeEntry');

export const clockStatusSchema = z
  .object({
    clockedIn: z.boolean(),
    // Se usa or null y no nullable porque con un esquema con nombre Swagger perdia el null
    openEntry: myTimeEntrySchema
      .or(z.null())
      .openapi({ description: 'null si no hay entrada abierta' }),
    serverTime: z.iso.datetime(),
    dailyLimit: z
      .object({
        minutes: z.number().int(),
        workedSeconds: z
          .number()
          .int()
          .openapi({ description: 'Trabajado hoy, incluida la entrada abierta' }),
        remainingSeconds: z.number().int(),
        reached: z.boolean().openapi({ description: 'true: ya no puede marcar entrada hoy' }),
      })
      .nullable()
      .openapi({ description: 'null si el empleado no tiene límite diario' }),
    elapsedSeconds: z
      .number()
      .int()
      .nullable()
      .openapi({
        description:
          'Segundos transcurridos de la entrada abierta al momento de serverTime. ' +
          'El cliente avanza el contador desde aquí con su propio reloj',
      }),
    timezone: z.string().openapi({ description: 'Zona que se usará al marcar' }),
    pendingReports: pendingDaysSchema.openapi({
      description: 'Días con el reporte pendiente; mientras haya alguno no se puede marcar entrada',
    }),
    canClockIn: z.boolean().openapi({
      description:
        'false si ya hay una entrada abierta, hay reportes pendientes o se alcanzó el límite diario',
    }),
    dailyReport: z
      .object({
        required: z
          .boolean()
          .openapi({ description: 'true: la empresa exige el reporte al marcar salida' }),
        workDate: workDate,
        content: z.string().nullable().openapi({
          description: 'Reporte ya escrito ese día, para mostrarlo cargado al marcar salida',
        }),
      })
      .openapi({ description: 'Reporte del día de la entrada abierta, o de hoy si no hay' }),
  })
  .openapi('ClockStatus');

export const liveAttendanceSchema = z
  .object({
    asOf: z.iso.datetime(),
    working: z.number().int(),
    entries: z.array(
      companyTimeEntrySchema.extend({ elapsedSeconds: z.number().int(), elapsedHours: z.number() }),
    ),
  })
  .openapi('LiveAttendance');

export const rosterQuery = paginationQuery.extend({
  search: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .openapi({ description: 'Busca en nombre, apellido, email o código' }),
  status: z.enum(['in', 'out']).optional().openapi({ description: 'in = trabajando, out = fuera' }),
});

export const rosterEntrySchema = z
  .object({
    employee: employeeSummarySchema,
    timezone: z.string(),
    status: z.enum(['in', 'out']),
    openEntryId: z.uuid().nullable(),
    clockedInAt: z.iso.datetime().nullable(),
    clockedInLocal: z.string().nullable(),
    elapsedSeconds: z.number().int().nullable().openapi({ description: 'De la entrada abierta' }),
    workedTodaySeconds: z.number().int(),
    workedTodayHours: z.number(),
    dailyLimit: z
      .object({
        minutes: z.number().int(),
        workedSeconds: z.number().int(),
        remainingSeconds: z.number().int(),
        reached: z.boolean(),
      })
      .nullable()
      .openapi({ description: 'null si el empleado no tiene límite diario' }),
  })
  .openapi('AttendanceRosterEntry');

export function rosterRowDto(row: RosterRow) {
  const { employee } = row;
  return {
    employee: {
      id: employee.employeeId,
      firstName: employee.firstName,
      lastName: employee.lastName,
      employeeCode: employee.employeeCode,
    },
    timezone: employee.effectiveTimezone,
    status: row.clockedIn ? ('in' as const) : ('out' as const),
    openEntryId: employee.openEntry?.id ?? null,
    clockedInAt: employee.openEntry?.clockInAt.toISOString() ?? null,
    clockedInLocal: employee.openEntry
      ? toLocalIsoString(employee.openEntry.clockInAt, employee.effectiveTimezone)
      : null,
    elapsedSeconds: row.elapsedSeconds,
    workedTodaySeconds: row.workedTodaySeconds,
    workedTodayHours: toDecimalHours(row.workedTodaySeconds),
    dailyLimit: row.dailyLimit,
  };
}

export const clockOutBody = z
  .object({
    dailyReport: z.string().max(DAILY_REPORT_LIMITS.max).optional().openapi({
      description:
        'Reporte de lo que hiciste hoy (10 a 2000 caracteres). Si la empresa lo exige es obligatorio y se manda completo en cada salida, con el texto ya escrito ese día si lo hay. Reemplaza el reporte del día y se conserva la versión anterior.',
    }),
  })
  .strict()
  .optional()
  .openapi('ClockOutRequest');

export const myPendingReportsSchema = z
  .object({
    required: z.boolean().openapi({ description: 'false: la empresa no exige el reporte' }),
    days: pendingDaysSchema,
  })
  .openapi('MyPendingReports');

export const companyPendingReportsQuery = paginationQuery.extend({
  employeeId: uuidSchema.optional(),
});

export const companyPendingReportSchema = z
  .object({
    employee: employeeSummarySchema,
    days: pendingDaysSchema,
  })
  .openapi('PendingReportsOfEmployee');

export const attendanceSummarySchema = z
  .object({
    asOf: z.iso.datetime(),
    employees: z.object({
      active: z.number().int(),
      in: z.number().int().openapi({ description: 'Trabajando ahora' }),
      out: z.number().int(),
    }),
    worked: z
      .object({ seconds: z.number().int(), hours: z.number() })
      .openapi({ description: 'Trabajado hoy por todos, incluidas las entradas abiertas' }),
    atLimit: z.object({
      count: z.number().int(),
      employees: z.array(
        employeeSummarySchema.extend({
          limitMinutes: z.number().int(),
          workedSeconds: z.number().int(),
        }),
      ),
    }),
    pendingReports: z.object({
      required: z.boolean(),
      employees: z.number().int().openapi({ description: 'Empleados con reportes pendientes' }),
      days: z.number().int().openapi({ description: 'Reportes pendientes en total' }),
    }),
  })
  .openapi('AttendanceSummary');

export const activityQuery = paginationQuery.extend({
  employeeId: uuidSchema.optional().openapi({ description: 'Solo lo que afectó a este empleado' }),
  type: z.enum(ATTENDANCE_ACTIVITY_TYPES).optional(),
  from: instant.optional().openapi({ description: 'Desde este instante (inclusive)' }),
  to: instant.optional().openapi({ description: 'Hasta este instante (inclusive)' }),
});

export const activitySchema = z
  .object({
    id: z.uuid(),
    type: z.enum(ATTENDANCE_ACTIVITY_TYPES).openapi({
      description:
        'time_entry.clocked_in_by_admin, clocked_out_by_admin, created_by_admin, corrected_by_admin, voided_by_admin o pay_period.closed',
    }),
    occurredAt: z.iso.datetime(),
    actor: z
      .object({ id: z.uuid(), firstName: z.string(), lastName: z.string() })
      .nullable()
      .openapi({ description: 'Quién lo hizo' }),
    employee: employeeSummarySchema.nullable().openapi({ description: 'A quién afectó' }),
    details: z.object({
      timeEntryId: z.uuid().optional(),
      reason: z.string().optional(),
      clockInAt: z.iso.datetime().optional(),
      clockOutAt: z.iso.datetime().nullable().optional(),
      previousClockInAt: z.iso.datetime().optional(),
      previousClockOutAt: z.iso.datetime().nullable().optional(),
      overrideDailyLimit: z.boolean().optional(),
      periodStart: workDate.optional(),
      periodEnd: workDate.optional(),
      totalHours: z.number().optional(),
    }),
  })
  .openapi('AttendanceActivity');

export function activityDto(view: AttendanceActivityView) {
  return { ...view, occurredAt: view.occurredAt.toISOString() };
}

export const dailyReportParams = z.object({ date: workDate });

export const saveDailyReportBody = z
  .object({ content: z.string().max(DAILY_REPORT_LIMITS.max) })
  .strict()
  .openapi('SaveDailyReportRequest');

export const dailyReportsQuery = paginationQuery.extend({
  from: workDate.optional().openapi({ description: 'Día laboral inicial (inclusive)' }),
  to: workDate.optional().openapi({ description: 'Día laboral final (inclusive)' }),
});

export const companyDailyReportsQuery = dailyReportsQuery.extend({
  employeeId: uuidSchema.optional(),
});

const dailyReportFields = {
  id: z.uuid(),
  workDate: workDate,
  content: z.string(),
  revisions: z.number().int().openapi({ description: 'Versiones anteriores conservadas' }),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};

export const myDailyReportSchema = z.object(dailyReportFields).openapi('MyDailyReport');

export const companyDailyReportSchema = z
  .object({ ...dailyReportFields, employee: employeeSummarySchema })
  .openapi('DailyReport');

export const dailyReportRevisionSchema = z
  .object({
    id: z.uuid(),
    content: z.string(),
    savedAt: z.iso.datetime().openapi({ description: 'Cuándo se reemplazó esta versión' }),
  })
  .openapi('DailyReportRevision');

export function myDailyReportDto(view: DailyReportView) {
  return {
    id: view.id,
    workDate: view.workDate,
    content: view.content,
    revisions: view.revisions,
    createdAt: view.createdAt.toISOString(),
    updatedAt: view.updatedAt.toISOString(),
  };
}

export function companyDailyReportDto(view: DailyReportView) {
  return { ...myDailyReportDto(view), employee: view.employee };
}

export const adminClockInBody = z
  .object({
    overrideDailyLimit: z.boolean().default(false).openapi({
      description:
        'true autoriza trabajar por encima del límite diario (horas extra): si el empleado ya lo alcanzó se le marca entrada igual y esa entrada no se cierra sola. Con false se respeta el límite',
    }),
  })
  .strict()
  .openapi('AdminClockInRequest');

export const timesheetQuery = z.object({
  date: workDate.optional().openapi({
    description:
      'Cualquier día dentro del periodo que quieres ver. Sin él se usa el periodo actual',
  }),
});

const searchParam = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .optional()
  .openapi({ description: 'Busca en nombre, apellido, email o código' });

export const companyTimesheetQuery = paginationQuery.extend({
  date: timesheetQuery.shape.date,
  search: searchParam,
});

export const companyTimesheetExportQuery = z.object({
  date: timesheetQuery.shape.date,
  search: searchParam,
});

const weekdaySchema = z.enum([
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]);

export const companyTimesheetRowSchema = z
  .object({
    employee: employeeSummarySchema.extend({ active: z.boolean() }),
    hours: z.array(z.number()).openapi({
      description: 'Horas decimales de cada día del periodo, en el mismo orden que meta.days',
    }),
    totalHours: z.number(),
    openEntries: z.number().int().openapi({
      description: 'Marcajes aún abiertos en el periodo (no suman horas hasta que se cierren)',
    }),
  })
  .openapi('CompanyTimesheetRow');

export const closePeriodBody = z
  .object({
    date: workDate.openapi({ description: 'Cualquier día dentro del periodo que se cierra' }),
  })
  .strict()
  .openapi('ClosePeriodRequest');

export const closureSchema = z
  .object({
    id: z.uuid(),
    periodStart: workDate,
    periodEnd: workDate,
    totalHours: z
      .number()
      .openapi({ description: 'Horas del periodo al cerrar, para comparar con lo exportado' }),
    closedAt: z.iso.datetime(),
    closedBy: z.object({ id: z.uuid(), firstName: z.string(), lastName: z.string() }),
  })
  .openapi('PeriodClosure');

export function closureDto(view: PeriodClosureView) {
  return {
    id: view.id,
    periodStart: view.periodStart,
    periodEnd: view.periodEnd,
    totalHours: centihoursToHours(view.totalCentihours),
    closedAt: view.closedAt.toISOString(),
    closedBy: view.closedBy,
  };
}

export const payPeriodStatusSchema = z
  .object({
    period: z.object({ start: workDate, end: workDate }),
    previousPeriodStart: workDate,
    nextPeriodStart: workDate,
    finished: z
      .boolean()
      .openapi({ description: 'El periodo ya terminó en la zona de la empresa' }),
    closure: closureSchema
      .or(z.null())
      .openapi({ description: 'null si el periodo sigue abierto' }),
    totalHours: z.number().openapi({ description: 'Horas de los marcajes cerrados hoy' }),
    openEntries: z
      .array(
        z.object({
          timeEntryId: z.uuid(),
          employee: employeeSummarySchema,
          workDate: workDate,
        }),
      )
      .openapi({ description: 'Entradas sin salida que impiden cerrar (máximo 50)' }),
    pendingReports: z.object({
      required: z.boolean(),
      employees: z.number().int(),
      days: z.number().int().openapi({ description: 'Avisa pero no impide cerrar' }),
    }),
    canClose: z.boolean(),
  })
  .openapi('PayPeriodStatus');

export function payPeriodStatusDto(status: PayPeriodStatus) {
  return {
    period: status.period,
    previousPeriodStart: status.previousPeriodStart,
    nextPeriodStart: status.nextPeriodStart,
    finished: status.finished,
    closure: status.closure ? closureDto(status.closure) : null,
    totalHours: centihoursToHours(status.totalCentihours),
    openEntries: status.openEntries,
    pendingReports: status.pendingReports,
    canClose: status.canClose,
  };
}

export const companyTimesheetMetaSchema = z.object({
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
  period: z.object({ start: workDate, end: workDate }),
  previousPeriodStart: workDate,
  nextPeriodStart: workDate,
  days: z.array(z.object({ date: workDate, weekday: weekdaySchema })),
  closed: closureSchema
    .or(z.null())
    .openapi({ description: 'Datos del cierre; null si sigue abierto' }),
  totals: z.object({
    hours: z.array(z.number()).openapi({
      description: 'Horas de todos los empleados que coinciden con el filtro, por día',
    }),
    totalHours: z.number(),
  }),
});

export const timesheetSchema = z
  .object({
    period: z.object({ start: workDate, end: workDate }).openapi({
      description: 'Periodo de pago de 14 días, de lunes a domingo',
    }),
    previousPeriodStart: workDate,
    nextPeriodStart: workDate,
    timezone: z.string().openapi({ example: 'America/Denver' }),
    closed: z.boolean().openapi({
      description: 'El periodo ya se cerró: sus horas están congeladas y no cambian',
    }),
    requiresDailyReport: z.boolean().openapi({
      description: 'Si es true, un día con marcajes y hasReport false tiene el reporte pendiente',
    }),
    days: z.array(
      z.object({
        date: workDate,
        weekday: z.enum([
          'monday',
          'tuesday',
          'wednesday',
          'thursday',
          'friday',
          'saturday',
          'sunday',
        ]),
        entries: z.number().int().openapi({ description: 'Marcajes del día, abiertos o cerrados' }),
        openEntries: z.number().int().openapi({ description: 'Marcajes aún sin salida' }),
        hasReport: z.boolean().openapi({ description: 'Si ese día tiene reporte escrito' }),
        hours: z.number().openapi({
          example: 8,
          description: 'Horas decimales del día (solo marcajes cerrados)',
        }),
      }),
    ),
    totalHours: z.number().openapi({ example: 80.5 }),
  })
  .openapi('Timesheet');

export const correctionSchema = z
  .object({
    id: z.uuid(),
    correctedBy: z.object({ id: z.uuid(), firstName: z.string(), lastName: z.string() }),
    previousClockInAt: z.iso.datetime(),
    previousClockOutAt: z.iso.datetime().nullable(),
    newClockInAt: z.iso.datetime(),
    newClockOutAt: z.iso.datetime().nullable(),
    reason: z.string(),
    createdAt: z.iso.datetime(),
  })
  .openapi('TimeEntryCorrection');

interface EntryTimes {
  readonly id: string;
  readonly clockInAt: Date;
  readonly clockOutAt: Date | null;
  readonly timezone: string;
  readonly workDate: string;
  readonly source: 'web' | 'admin';
  readonly closeSource: 'employee' | 'admin' | 'daily_limit' | null;
  readonly createdReason: string | null;
  readonly voided?: unknown;
}

function baseDto(entry: EntryTimes) {
  const seconds = entry.clockOutAt ? durationSeconds(entry.clockInAt, entry.clockOutAt) : null;
  return {
    id: entry.id,
    status: entry.voided
      ? ('voided' as const)
      : entry.clockOutAt
        ? ('closed' as const)
        : ('open' as const),
    clockInAt: entry.clockInAt.toISOString(),
    clockOutAt: entry.clockOutAt?.toISOString() ?? null,
    clockInLocal: toLocalIsoString(entry.clockInAt, entry.timezone),
    clockOutLocal: entry.clockOutAt ? toLocalIsoString(entry.clockOutAt, entry.timezone) : null,
    timezone: entry.timezone,
    workDate: entry.workDate,
    durationSeconds: seconds,
    durationHours: seconds === null ? null : toDecimalHours(seconds),
    source: entry.source,
    createdReason: entry.createdReason,
    closedBy: entry.closeSource,
  };
}

export function myEntryFromDomain(entry: TimeEntry) {
  return { ...baseDto(entry), corrected: false };
}

export function myEntryFromView(view: TimeEntryView) {
  return { ...baseDto(view), corrected: view.corrections > 0 };
}

export function companyEntryFromView(view: TimeEntryView) {
  return {
    ...baseDto(view),
    employee: view.employee,
    corrections: view.corrections,
    voidedAt: view.voided?.at.toISOString() ?? null,
    voidReason: view.voided?.reason ?? null,
    voidedBy: view.voided?.by ?? null,
    createdAt: view.createdAt.toISOString(),
    updatedAt: view.updatedAt.toISOString(),
  };
}

export function correctionDto(correction: CorrectionView) {
  return {
    ...correction,
    previousClockInAt: correction.previousClockInAt.toISOString(),
    previousClockOutAt: correction.previousClockOutAt?.toISOString() ?? null,
    newClockInAt: correction.newClockInAt.toISOString(),
    newClockOutAt: correction.newClockOutAt?.toISOString() ?? null,
    createdAt: correction.createdAt.toISOString(),
  };
}
