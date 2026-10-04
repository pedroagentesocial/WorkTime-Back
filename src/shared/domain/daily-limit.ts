import { ValidationError } from '#shared/domain/errors.js';

export const MAX_DAILY_LIMIT_MINUTES = 1440;

export const DailyLimit = {
  assertValid(minutes: number | null): void {
    if (
      minutes !== null &&
      (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_DAILY_LIMIT_MINUTES)
    ) {
      throw new ValidationError(
        'INVALID_DAILY_LIMIT',
        `El límite diario debe ser un número entero de minutos entre 1 y ${MAX_DAILY_LIMIT_MINUTES}`,
      );
    }
  },

  resolve(employeeMinutes: number | null, companyMinutes: number | null): number | null {
    return employeeMinutes ?? companyMinutes;
  },
};
