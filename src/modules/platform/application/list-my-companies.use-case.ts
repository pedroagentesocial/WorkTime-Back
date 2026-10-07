import type { Actor } from '#shared/application/actor.js';
import type { UseCase } from '#shared/application/use-case.js';
import { PlatformErrors } from './platform-errors.js';
import type { CompanyRepository, CompanyView } from './ports/company.repository.js';
import type { MultiAdminRepository } from './ports/multi-admin.repository.js';

export interface MyCompanies {
  readonly limits: {
    readonly maxCompanies: number;
    readonly maxEmployeesPerCompany: number;
    readonly usedCompanies: number;
  };
  readonly companies: readonly CompanyView[];
}

interface Deps {
  multiAdminRepository: MultiAdminRepository;
  companyRepository: CompanyRepository;
}

// Las empresas de la persona que consulta y cuanto le queda de su paquete
export class ListMyCompaniesUseCase implements UseCase<Actor, MyCompanies> {
  constructor(private readonly deps: Deps) {}

  async execute(actor: Actor): Promise<MyCompanies> {
    const multiAdmin = await this.deps.multiAdminRepository.findById(actor.userId);
    if (!multiAdmin) throw PlatformErrors.multiAdminNotFound();

    const companies = await this.deps.companyRepository.listByMember(actor.userId);
    return {
      limits: {
        maxCompanies: multiAdmin.maxCompanies,
        maxEmployeesPerCompany: multiAdmin.maxEmployeesPerCompany,
        usedCompanies: multiAdmin.companyCount,
      },
      companies,
    };
  }
}
