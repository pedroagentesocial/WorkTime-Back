import { companyIdOf, type Actor } from '#shared/application/actor.js';
import type { Page, PageRequest } from '#shared/application/pagination.js';
import type { UseCase } from '#shared/application/use-case.js';
import type {
  EmployeeListFilter,
  EmployeeRepository,
  EmployeeView,
} from './ports/employee.repository.js';
import { WorkforceErrors } from './workforce-errors.js';

interface Deps {
  employeeRepository: EmployeeRepository;
}

export interface ListEmployeesInput {
  readonly actor: Actor;
  readonly filter: EmployeeListFilter;
  readonly page: PageRequest;
}

export class ListEmployeesUseCase implements UseCase<ListEmployeesInput, Page<EmployeeView>> {
  constructor(private readonly deps: Deps) {}

  execute({ actor, filter, page }: ListEmployeesInput): Promise<Page<EmployeeView>> {
    return this.deps.employeeRepository.list(companyIdOf(actor), filter, page);
  }
}

export interface GetEmployeeInput {
  readonly actor: Actor;
  readonly employeeId: string;
}

export class GetEmployeeUseCase implements UseCase<GetEmployeeInput, EmployeeView> {
  constructor(private readonly deps: Deps) {}

  async execute({ actor, employeeId }: GetEmployeeInput): Promise<EmployeeView> {
    const employee = await this.deps.employeeRepository.findById(companyIdOf(actor), employeeId);
    if (!employee) throw WorkforceErrors.employeeNotFound();
    return employee;
  }
}
