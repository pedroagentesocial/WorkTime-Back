import { ConflictError, NotFoundError } from '#shared/domain/errors.js';

export const PlatformErrors = {
  identifierTaken: () =>
    new ConflictError('COMPANY_IDENTIFIER_TAKEN', 'El código de empresa generado ya existe'),
  companyNotFound: () => new NotFoundError('COMPANY_NOT_FOUND', 'La empresa no existe'),
  companyAdminNotFound: () =>
    new NotFoundError('COMPANY_ADMIN_NOT_FOUND', 'La empresa no tiene un administrador asignado'),
  multiAdminNotFound: () =>
    new NotFoundError('MULTI_ADMIN_NOT_FOUND', 'El administrador multiempresa no existe'),
  membershipNotFound: () =>
    new NotFoundError('MEMBERSHIP_NOT_FOUND', 'La empresa no está asignada a ese administrador'),
  alreadyAssigned: () =>
    new ConflictError(
      'COMPANY_ALREADY_ASSIGNED',
      'La empresa ya está asignada a ese administrador',
    ),
  emailTaken: () => new ConflictError('EMAIL_TAKEN', 'Ya existe un usuario con ese email'),
  platformAdminNotFound: () =>
    new NotFoundError(
      'PLATFORM_ADMIN_NOT_FOUND',
      'No existe un admin global; créalo con npm run db:seed',
    ),
  platformAdminAmbiguous: () =>
    new ConflictError(
      'PLATFORM_ADMIN_AMBIGUOUS',
      'Hay más de un admin global; revisa la base de datos antes de continuar',
    ),
};
