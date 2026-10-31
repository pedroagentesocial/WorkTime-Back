import { ConflictError, NotFoundError, ValidationError } from '#shared/domain/errors.js';

export const WorkforceErrors = {
  employeeNotFound: () => new NotFoundError('EMPLOYEE_NOT_FOUND', 'El empleado no existe'),
  companyNotFound: () => new NotFoundError('COMPANY_NOT_FOUND', 'La empresa no existe'),
  employeeHasHistory: () =>
    new ConflictError(
      'EMPLOYEE_HAS_HISTORY',
      'No se puede eliminar: el empleado ya tiene marcajes, reportes, check-ins o pagos cerrados. Desactívalo en su lugar',
    ),
  workSiteNotFound: () => new NotFoundError('WORK_SITE_NOT_FOUND', 'La zona de trabajo no existe'),
  workSitesRequired: () =>
    new ConflictError(
      'WORK_SITES_REQUIRED',
      'Para exigir marcar dentro de una zona la empresa necesita al menos una zona de trabajo activa',
    ),
  workSiteLimit: (max: number) =>
    new ConflictError('WORK_SITE_LIMIT', `Una empresa puede tener hasta ${max} zonas de trabajo`),
  payRateInClosedPeriod: (lastClosedDay: string) =>
    new ConflictError(
      'PAY_RATE_IN_CLOSED_PERIOD',
      `El cambio no puede regir desde un día de un periodo ya cerrado: elige un día posterior al ${lastClosedDay}`,
    ),
  payRateLocked: () =>
    new ConflictError(
      'PAY_RATE_IN_CLOSED_PERIOD',
      'No se puede quitar: ese cambio rige en un periodo ya cerrado y con él ya se pagó',
    ),
  payRateNotFound: () => new NotFoundError('PAY_RATE_NOT_FOUND', 'El cambio de sueldo no existe'),
  invalidStatusDate: (message: string) => new ValidationError('INVALID_STATUS_DATE', message),
  statusDateInClosedPeriod: (lastClosedDay: string) =>
    new ConflictError(
      'STATUS_DATE_IN_CLOSED_PERIOD',
      `La fecha no puede caer en un periodo ya cerrado: elige un día posterior al ${lastClosedDay}`,
    ),
  emailTaken: () => new ConflictError('EMAIL_TAKEN', 'Ya existe un usuario con ese email'),
};
