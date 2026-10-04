import { ConflictError, ValidationError } from '#shared/domain/errors.js';
import { isValidTimezone } from '#shared/domain/timezone.js';

export type EmployeeStatus = 'active' | 'inactive';

export const EMPLOYEE_LIMITS = {
  phoneMinLength: 7,
  phoneMaxLength: 30,
} as const;

const PHONE_PATTERN = /^[0-9+().\-\s]+$/;

export const EmployeeRules = {
  assertCanAddActiveEmployee(activeEmployees: number, maxEmployees: number): void {
    if (activeEmployees >= maxEmployees) {
      throw new ConflictError(
        'EMPLOYEE_LIMIT_REACHED',
        `La empresa alcanzó su límite de ${maxEmployees} empleados activos`,
        { maxEmployees, activeEmployees },
      );
    }
  },

  normalizePhone(phone: string | null | undefined): string | null {
    if (phone === null || phone === undefined) return null;
    const normalized = phone.trim();
    if (normalized.length === 0) return null;
    const digits = normalized.replace(/\D/g, '').length;
    if (
      normalized.length > EMPLOYEE_LIMITS.phoneMaxLength ||
      digits < EMPLOYEE_LIMITS.phoneMinLength ||
      !PHONE_PATTERN.test(normalized)
    ) {
      throw new ValidationError(
        'INVALID_PHONE',
        `El teléfono debe tener entre ${EMPLOYEE_LIMITS.phoneMinLength} y ${EMPLOYEE_LIMITS.phoneMaxLength} caracteres, con números y los signos + ( ) - .`,
      );
    }
    return normalized;
  },

  assertTimezone(timezone: string | null): void {
    if (timezone !== null && !isValidTimezone(timezone)) {
      throw new ValidationError(
        'INVALID_TIMEZONE',
        `"${timezone}" no es una zona horaria válida (usa el formato IANA, p. ej. America/Mexico_City)`,
      );
    }
  },
};
