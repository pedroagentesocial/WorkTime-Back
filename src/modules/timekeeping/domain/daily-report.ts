import { ConflictError, ValidationError } from '#shared/domain/errors.js';
import { addDays } from './pay-period.js';

export const DAILY_REPORT_LIMITS = { min: 10, max: 2000 } as const;

export const REPORT_BACKFILL_DAYS = 14;

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

// Dias que pueden estar pendientes: los ultimos que aun se pueden escribir, sin contar hoy
// y sin contar los anteriores a que la empresa exigiera el reporte
export function pendingReportRange(
  todayLocal: string,
  requiredSince: string,
): { from: string; to: string } | null {
  const oldestWritable = addDays(todayLocal, -REPORT_BACKFILL_DAYS);
  const from = oldestWritable > requiredSince ? oldestWritable : requiredSince;
  const to = addDays(todayLocal, -1);
  return from > to ? null : { from, to };
}

export interface WriteContext {
  readonly workDate: string;
  readonly todayLocal: string;
  readonly reportExists: boolean;
  readonly hasOpenEntryOnDate: boolean;
  readonly hasEntriesOnDate: boolean;
}

export const DailyReportRules = {
  normalize(content: string): string {
    const text = content.trim();
    if (text.length < DAILY_REPORT_LIMITS.min || text.length > DAILY_REPORT_LIMITS.max) {
      throw new ValidationError(
        'INVALID_DAILY_REPORT',
        `El reporte debe tener entre ${DAILY_REPORT_LIMITS.min} y ${DAILY_REPORT_LIMITS.max} caracteres`,
      );
    }
    return text;
  },

  assertCanWrite(context: WriteContext): void {
    const { workDate, todayLocal } = context;
    if (workDate > todayLocal) {
      throw new ValidationError(
        'INVALID_REPORT_DATE',
        'No se puede escribir el reporte de un día que aún no llega',
      );
    }
    if (context.reportExists) {
      if (workDate !== todayLocal && !context.hasOpenEntryOnDate) {
        throw new ConflictError(
          'DAILY_REPORT_LOCKED',
          'El reporte de un día anterior ya no se puede editar',
        );
      }
      return;
    }
    if (!context.hasEntriesOnDate) {
      throw new ValidationError('NO_WORK_ON_DATE', 'No hay marcajes en ese día para reportar');
    }
    if (!context.hasOpenEntryOnDate && daysBetween(workDate, todayLocal) > REPORT_BACKFILL_DAYS) {
      throw new ValidationError(
        'REPORT_DATE_TOO_OLD',
        `Solo se puede escribir el reporte de los últimos ${REPORT_BACKFILL_DAYS} días`,
      );
    }
  },
};
