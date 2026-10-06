import { ConflictError, NotFoundError, ValidationError } from '#shared/domain/errors.js';

export const TimekeepingErrors = {
  alreadyClockedIn: () =>
    new ConflictError(
      'ALREADY_CLOCKED_IN',
      'Ya tienes una entrada abierta; marca tu salida primero',
    ),
  notClockedIn: () => new ConflictError('NOT_CLOCKED_IN', 'No tienes una entrada abierta'),
  employeeProfileNotFound: () =>
    new NotFoundError(
      'EMPLOYEE_PROFILE_NOT_FOUND',
      'Tu usuario no tiene un perfil de empleado; contacta a tu administrador',
    ),
  dailyLimitReached: (limitMinutes: number) =>
    new ConflictError(
      'DAILY_LIMIT_REACHED',
      'Alcanzaste tu límite de horas de hoy; no puedes marcar entrada de nuevo hasta mañana',
      { limitMinutes },
    ),
  employeeDailyLimitReached: (limitMinutes: number) =>
    new ConflictError(
      'DAILY_LIMIT_REACHED',
      'El empleado ya alcanzó su límite de horas de hoy; confirma que autorizas horas extra para marcarle entrada',
      { limitMinutes },
    ),
  employeeAlreadyClockedIn: () =>
    new ConflictError('EMPLOYEE_ALREADY_CLOCKED_IN', 'El empleado ya tiene una entrada abierta'),
  employeeNotClockedIn: () =>
    new ConflictError('EMPLOYEE_NOT_CLOCKED_IN', 'El empleado no tiene una entrada abierta'),
  employeeInactive: () =>
    new ConflictError('EMPLOYEE_INACTIVE', 'El empleado está desactivado; actívalo primero'),
  dailyReportRequired: () =>
    new ValidationError(
      'DAILY_REPORT_REQUIRED',
      'Escribe el reporte de lo que hiciste hoy para poder marcar tu salida',
    ),
  pendingReports: (dates: readonly string[]) =>
    new ConflictError(
      'DAILY_REPORT_PENDING',
      'Tienes reportes del día pendientes; escríbelos para poder marcar entrada',
      { dates },
    ),
  dailyReportNotFound: () =>
    new NotFoundError('DAILY_REPORT_NOT_FOUND', 'El reporte del día no existe'),
  employeeNotFound: () => new NotFoundError('EMPLOYEE_NOT_FOUND', 'El empleado no existe'),
  exportTooLarge: (max: number) =>
    new ValidationError(
      'EXPORT_TOO_LARGE',
      `Hay demasiados reportes para exportar de una vez; acota el rango de fechas (máximo ${max})`,
      { max },
    ),
  timeEntryNotFound: () =>
    new NotFoundError('TIME_ENTRY_NOT_FOUND', 'El registro de asistencia no existe'),
  changedConcurrently: () =>
    new ConflictError(
      'TIME_ENTRY_CHANGED',
      'El registro cambió mientras lo corregías (p. ej. el empleado marcó su salida); recárgalo e intenta de nuevo',
    ),
  periodClosed: (periodStart: string, periodEnd: string) =>
    new ConflictError(
      'PERIOD_CLOSED',
      `El periodo del ${periodStart} al ${periodEnd} está cerrado y ya no admite cambios`,
      { periodStart, periodEnd },
    ),
  periodNotFinished: (periodEnd: string) =>
    new ConflictError(
      'PERIOD_NOT_FINISHED',
      `El periodo termina el ${periodEnd}; solo se puede cerrar cuando ya terminó`,
      { periodEnd },
    ),
  periodBeforeStart: (firstPeriodStart: string) =>
    new ValidationError(
      'PERIOD_BEFORE_START',
      `Los periodos de pago empiezan el ${firstPeriodStart}`,
    ),
  periodAlreadyClosed: () =>
    new ConflictError('PERIOD_ALREADY_CLOSED', 'Ese periodo ya está cerrado'),
  periodHasOpenEntries: (entries: readonly { employee: string; workDate: string }[]) =>
    new ConflictError(
      'PERIOD_HAS_OPEN_ENTRIES',
      'Hay entradas sin salida; corrígelas o anúlalas antes de cerrar el periodo',
      { entries },
    ),
  timeEntryVoided: () =>
    new ConflictError('TIME_ENTRY_VOIDED', 'El registro está anulado y ya no se puede modificar'),
  overlap: () =>
    new ConflictError(
      'TIME_ENTRY_OVERLAP',
      'El horario se cruza con otro registro del mismo empleado',
    ),
};
