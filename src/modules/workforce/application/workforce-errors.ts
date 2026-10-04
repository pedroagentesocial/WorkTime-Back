import { ConflictError, NotFoundError } from '#shared/domain/errors.js';

export const WorkforceErrors = {
  employeeNotFound: () => new NotFoundError('EMPLOYEE_NOT_FOUND', 'El empleado no existe'),
  companyNotFound: () => new NotFoundError('COMPANY_NOT_FOUND', 'La empresa no existe'),
  emailTaken: () => new ConflictError('EMAIL_TAKEN', 'Ya existe un usuario con ese email'),
};
