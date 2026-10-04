import type { Page, PageRequest } from '#shared/application/pagination.js';
import type { UseCase } from '#shared/application/use-case.js';
import type {
  CompanyListFilter,
  CompanyRepository,
  CompanyView,
} from './ports/company.repository.js';

export interface ListCompaniesInput {
  readonly filter: CompanyListFilter;
  readonly page: PageRequest;
}

interface Deps {
  companyRepository: CompanyRepository;
}

export class ListCompaniesUseCase implements UseCase<ListCompaniesInput, Page<CompanyView>> {
  constructor(private readonly deps: Deps) {}

  execute({ filter, page }: ListCompaniesInput): Promise<Page<CompanyView>> {
    return this.deps.companyRepository.list(filter, page);
  }
}
