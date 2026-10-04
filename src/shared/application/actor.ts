import { ForbiddenError } from '#shared/domain/errors.js';
import type { Role } from '#shared/domain/permissions.js';

// La empresa sale solo del token, nunca del body ni de la URL
export interface Actor {
  readonly userId: string;
  readonly role: Role;
  readonly companyId: string | null;
  readonly mustChangePassword: boolean;
}

export interface CompanyActor extends Actor {
  readonly companyId: string;
}

export function isCompanyActor(actor: Actor): actor is CompanyActor {
  return actor.companyId !== null;
}

export function companyIdOf(actor: Actor): string {
  if (!isCompanyActor(actor)) {
    throw new ForbiddenError(
      'COMPANY_REQUIRED',
      'Esta acción solo está disponible para usuarios de una empresa',
    );
  }
  return actor.companyId;
}
