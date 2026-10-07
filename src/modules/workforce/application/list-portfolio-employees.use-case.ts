import type { Actor } from '#shared/application/actor.js';
import type { Page, PageRequest } from '#shared/application/pagination.js';
import { companiesInScope, type PortfolioScope } from '#shared/application/portfolio-scope.js';
import type { UseCase } from '#shared/application/use-case.js';
import type { EmployeeListFilter } from './ports/employee.repository.js';
import type {
  PortfolioEmployeeReader,
  PortfolioEmployeeView,
} from './ports/portfolio-employee.reader.js';

interface Deps {
  portfolioScope: PortfolioScope;
  portfolioEmployeeReader: PortfolioEmployeeReader;
}

export interface PortfolioEmployeeFilter extends EmployeeListFilter {
  readonly companyId?: string | undefined;
}

export interface ListPortfolioEmployeesInput {
  readonly actor: Actor;
  readonly filter: PortfolioEmployeeFilter;
  readonly page: PageRequest;
}

// Empleados de todas las empresas activas de la persona, con la empresa de cada uno
export class ListPortfolioEmployeesUseCase implements UseCase<
  ListPortfolioEmployeesInput,
  Page<PortfolioEmployeeView>
> {
  constructor(private readonly deps: Deps) {}

  async execute({
    actor,
    filter,
    page,
  }: ListPortfolioEmployeesInput): Promise<Page<PortfolioEmployeeView>> {
    const companies = await companiesInScope(this.deps.portfolioScope, actor, filter.companyId);
    const { companyId: _companyId, ...rest } = filter;
    return this.deps.portfolioEmployeeReader.list(
      companies.map((company) => company.id),
      rest,
      page,
    );
  }
}
