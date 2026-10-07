import type { UseCase } from '#shared/application/use-case.js';
import { PlatformErrors } from './platform-errors.js';
import type { CompanyRepository, CompanyView } from './ports/company.repository.js';
import type { MultiAdminRepository, MultiAdminView } from './ports/multi-admin.repository.js';

export interface MultiAdminDetail {
  readonly multiAdmin: MultiAdminView;
  readonly companies: readonly CompanyView[];
}

interface Deps {
  multiAdminRepository: MultiAdminRepository;
  companyRepository: CompanyRepository;
}

export class GetMultiAdminUseCase implements UseCase<string, MultiAdminDetail> {
  constructor(private readonly deps: Deps) {}

  async execute(id: string): Promise<MultiAdminDetail> {
    const multiAdmin = await this.deps.multiAdminRepository.findById(id);
    if (!multiAdmin) throw PlatformErrors.multiAdminNotFound();
    const companies = await this.deps.companyRepository.listByMember(id);
    return { multiAdmin, companies };
  }
}
