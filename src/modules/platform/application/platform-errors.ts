import { ConflictError, NotFoundError } from '#shared/domain/errors.js';

export const PlatformErrors = {
  identifierTaken: () =>
    new ConflictError('COMPANY_IDENTIFIER_TAKEN', 'El código de empresa generado ya existe'),
  companyNotFound: () => new NotFoundError('COMPANY_NOT_FOUND', 'La empresa no existe'),
  companyAdminNotFound: () =>
    new NotFoundError('COMPANY_ADMIN_NOT_FOUND', 'La empresa no tiene un administrador asignado'),
  emailTaken: () => new ConflictError('EMAIL_TAKEN', 'Ya existe un usuario con ese email'),
};
