import { companyIdOf, type Actor } from '#shared/application/actor.js';
import { companiesInScope, type PortfolioScope } from '#shared/application/portfolio-scope.js';
import type { UseCase } from '#shared/application/use-case.js';
import { assertValidWorkDateRange } from '../domain/work-date-range.js';
import type {
  AttendanceMapFilter,
  AttendanceMapReader,
  AttendanceMapResult,
} from './ports/attendance-map.reader.js';
import type { EmployeeDirectory } from './ports/employee-directory.js';
import { TimekeepingErrors } from './timekeeping-errors.js';

// Tope de puntos por respuesta para que el mapa siga siendo legible y barato
export const MAP_MAX_POINTS = 500;

interface Deps {
  attendanceMapReader: AttendanceMapReader;
  employeeDirectory: EmployeeDirectory;
  portfolioScope: PortfolioScope;
}

export interface AttendanceMapInput {
  readonly actor: Actor;
  readonly filter: AttendanceMapFilter;
}

// Donde marco cada empleado de la empresa en un rango de dias, los mas recientes primero
export class GetAttendanceMapUseCase implements UseCase<AttendanceMapInput, AttendanceMapResult> {
  constructor(private readonly deps: Deps) {}

  async execute({ actor, filter }: AttendanceMapInput): Promise<AttendanceMapResult> {
    assertValidWorkDateRange(filter);
    const companyId = companyIdOf(actor);
    if (
      filter.employeeId &&
      !(await this.deps.employeeDirectory.exists(companyId, filter.employeeId))
    ) {
      throw TimekeepingErrors.employeeNotFound();
    }
    return this.deps.attendanceMapReader.list([companyId], filter, MAP_MAX_POINTS);
  }
}

export interface PortfolioAttendanceMapInput extends AttendanceMapInput {
  readonly companyId?: string | undefined;
}

// Lo mismo para todas las empresas activas de la persona; el cliente solo puede acotar a una suya
export class GetPortfolioAttendanceMapUseCase implements UseCase<
  PortfolioAttendanceMapInput,
  AttendanceMapResult
> {
  constructor(private readonly deps: Deps) {}

  async execute({
    actor,
    filter,
    companyId,
  }: PortfolioAttendanceMapInput): Promise<AttendanceMapResult> {
    assertValidWorkDateRange(filter);
    const companies = await companiesInScope(this.deps.portfolioScope, actor, companyId);
    return this.deps.attendanceMapReader.list(
      companies.map((company) => company.id),
      filter,
      MAP_MAX_POINTS,
    );
  }
}
