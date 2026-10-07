import type { Page, PageRequest } from '#shared/application/pagination.js';
import type { UseCase } from '#shared/application/use-case.js';
import type {
  MultiAdminListFilter,
  MultiAdminRepository,
  MultiAdminView,
} from './ports/multi-admin.repository.js';

export interface ListMultiAdminsInput {
  readonly filter: MultiAdminListFilter;
  readonly page: PageRequest;
}

interface Deps {
  multiAdminRepository: MultiAdminRepository;
}

export class ListMultiAdminsUseCase implements UseCase<ListMultiAdminsInput, Page<MultiAdminView>> {
  constructor(private readonly deps: Deps) {}

  execute({ filter, page }: ListMultiAdminsInput): Promise<Page<MultiAdminView>> {
    return this.deps.multiAdminRepository.list(filter, page);
  }
}
