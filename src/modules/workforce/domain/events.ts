import type { DomainEvent } from '#shared/domain/domain-event.js';

export const WorkforceEvents = {
  EMPLOYEE_DEACTIVATED: 'workforce.employee_deactivated',
} as const;

export type EmployeeDeactivated = DomainEvent<
  typeof WorkforceEvents.EMPLOYEE_DEACTIVATED,
  {
    readonly companyId: string;
    readonly employeeId: string;
    readonly userId: string;
    readonly deactivatedBy: string;
  }
>;
