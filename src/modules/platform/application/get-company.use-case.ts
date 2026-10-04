import type { UseCase } from '#shared/application/use-case.js';
import { PlatformErrors } from './platform-errors.js';
import type { CompanyRepository, CompanyView } from './ports/company.repository.js';

interface Deps {
  companyRepository: CompanyRepository;
}

export class GetCompanyUseCase implements UseCase<string, CompanyView> {
  constructor(private readonly deps: Deps) {}

  async execute(companyId: string): Promise<CompanyView> {
    const company = await this.deps.companyRepository.findById(companyId);
    if (!company) throw PlatformErrors.companyNotFound();
    return company;
  }
}
