import { ValidationError } from '#shared/domain/errors.js';

export const MAX_RANGE_DAYS = 400;

export interface WorkDateRange {
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

export function assertValidWorkDateRange({ from, to }: WorkDateRange): void {
  if (!from || !to) return;
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (days < 0) {
    throw new ValidationError('INVALID_DATE_RANGE', '"from" debe ser anterior o igual a "to"');
  }
  if (days > MAX_RANGE_DAYS) {
    throw new ValidationError(
      'INVALID_DATE_RANGE',
      `El rango no puede superar ${MAX_RANGE_DAYS} días`,
    );
  }
}
