import type { Actor } from '#shared/application/actor.js';
import { companiesInScope, type PortfolioScope } from '#shared/application/portfolio-scope.js';
import type { Clock } from '#shared/application/ports/clock.js';
import type { UseCase } from '#shared/application/use-case.js';
import type { ClockLocation } from '../domain/clock-location.js';
import type { CompanyRef } from '../domain/portfolio-timesheet.js';
import type { ClockZone } from '../domain/work-zone.js';
import { durationSeconds } from '../domain/work-hours.js';
import { mapInBatches } from './portfolio-batches.js';
import type { EmployeeDirectory } from './ports/employee-directory.js';

interface Deps {
  portfolioScope: PortfolioScope;
  employeeDirectory: EmployeeDirectory;
  clock: Clock;
}

export interface PortfolioLiveInput {
  readonly actor: Actor;
  readonly companyId?: string | undefined;
}

export interface PortfolioLiveEntry {
  readonly company: CompanyRef;
  readonly employee: {
    readonly id: string;
    readonly firstName: string;
    readonly lastName: string;
    readonly employeeCode: string | null;
  };
  readonly timezone: string;
  readonly clockedInAt: Date;
  readonly elapsedSeconds: number;
  readonly clockInLocation: ClockLocation | null;
  readonly clockInZone: ClockZone | null;
}

export interface PortfolioLive {
  readonly asOf: Date;
  readonly working: number;
  readonly entries: PortfolioLiveEntry[];
}

// Quienes estan trabajando ahora en todas las empresas activas de la persona, con donde marcaron
export class GetPortfolioLiveUseCase implements UseCase<PortfolioLiveInput, PortfolioLive> {
  constructor(private readonly deps: Deps) {}

  async execute({ actor, companyId }: PortfolioLiveInput): Promise<PortfolioLive> {
    const companies = await companiesInScope(this.deps.portfolioScope, actor, companyId);
    const now = this.deps.clock.now();

    const perCompany = await mapInBatches(companies, async (company) => {
      const employees = await this.deps.employeeDirectory.listActive(company.id);
      return employees.flatMap((employee): PortfolioLiveEntry[] =>
        employee.openEntry
          ? [
              {
                company: { id: company.id, name: company.name, code: company.code },
                employee: {
                  id: employee.employeeId,
                  firstName: employee.firstName,
                  lastName: employee.lastName,
                  employeeCode: employee.employeeCode,
                },
                timezone: employee.effectiveTimezone,
                clockedInAt: employee.openEntry.clockInAt,
                elapsedSeconds: durationSeconds(employee.openEntry.clockInAt, now),
                clockInLocation: employee.openEntry.clockInLocation,
                clockInZone: employee.openEntry.clockInZone,
              },
            ]
          : [],
      );
    });

    const entries = perCompany.flat();
    return { asOf: now, working: entries.length, entries };
  }
}
