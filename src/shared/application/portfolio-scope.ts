import { NotFoundError } from '#shared/domain/errors.js';
import type { Actor } from './actor.js';

export interface PortfolioCompany {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly timezone: string;
}

// Las empresas con las que puede trabajar un admin multiempresa; la lista sale de sus membresias
// y nunca de lo que mande el cliente. Las suspendidas no entran: no tienen actividad
export interface PortfolioScope {
  activeCompaniesOf(userId: string): Promise<PortfolioCompany[]>;
}

// Empresas de la vista consolidada, o solo una si se filtra por ella. Una empresa fuera de la lista
// responde igual que una inexistente
export async function companiesInScope(
  scope: PortfolioScope,
  actor: Actor,
  companyId?: string,
): Promise<PortfolioCompany[]> {
  const companies = await scope.activeCompaniesOf(actor.userId);
  if (companyId === undefined) return companies;

  const selected = companies.filter((company) => company.id === companyId);
  if (selected.length === 0) {
    throw new NotFoundError(
      'COMPANY_NOT_FOUND',
      'La empresa no existe o no está asignada a tu cuenta',
    );
  }
  return selected;
}
