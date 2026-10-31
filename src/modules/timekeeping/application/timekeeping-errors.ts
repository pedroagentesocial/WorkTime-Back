import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '#shared/domain/errors.js';

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
  // Sin ubicacion no se marca la entrada: asi se sabe desde donde empezo la jornada
  locationRequired: () =>
    new ValidationError(
      'LOCATION_REQUIRED',
      'Para marcar tu entrada hay que compartir tu ubicación. Activa el permiso de ubicación en tu navegador e inténtalo de nuevo',
    ),
  // La empresa solo deja marcar la entrada dentro de una de sus zonas de trabajo
  outsideWorkArea: (siteName: string, distanceMeters: number) =>
    new ConflictError(
      'OUTSIDE_WORK_AREA',
      `Estás a ${distanceMeters} m de ${siteName}. Solo puedes marcar tu entrada dentro de una zona de trabajo; acércate o pide a tu administrador que la registre`,
      { siteName, distanceMeters },
    ),
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
  checkInsDisabled: () =>
    new ConflictError(
      'CHECK_INS_DISABLED',
      'Tu empresa no tiene activado el registro de llegada; pide a tu administrador que lo active',
    ),
  checkInLimitReached: (perDay: number) =>
    new ConflictError(
      'CHECK_IN_LIMIT_REACHED',
      `Ya registraste ${perDay} llegadas hoy, el máximo por día`,
      { perDay },
    ),
  selfEditNotAllowed: () =>
    new ForbiddenError(
      'SELF_EDIT_NOT_ALLOWED',
      'No tienes permiso para corregir tus horas: pídeselo a tu administrador',
    ),
  selfEditOutOfRange: (days: number) =>
    new ConflictError(
      'SELF_EDIT_OUT_OF_RANGE',
      `Solo puedes corregir marcajes de los últimos ${days} ${days === 1 ? 'día' : 'días'}`,
    ),
  selfEditOpenToday: () =>
    new ConflictError(
      'SELF_EDIT_OPEN_TODAY',
      'Tu entrada de hoy sigue abierta: termina tu jornada con Salida',
    ),
  selfEditOverLimit: () =>
    new ConflictError(
      'SELF_EDIT_OVER_LIMIT',
      'Con este cambio pasarías tu límite diario: pídele a tu administrador que lo corrija',
    ),
  checkInNotFound: () => new NotFoundError('CHECK_IN_NOT_FOUND', 'El check-in no existe'),
  checkInVoided: () => new ConflictError('CHECK_IN_VOIDED', 'El check-in ya está anulado'),
  timeEntryVoided: () =>
    new ConflictError('TIME_ENTRY_VOIDED', 'El registro está anulado y ya no se puede modificar'),
  overlap: () =>
    new ConflictError(
      'TIME_ENTRY_OVERLAP',
      'El horario se cruza con otro registro del mismo empleado',
    ),
};
