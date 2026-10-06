import type { Page, PageRequest } from '#shared/application/pagination.js';
import type { EmployeeStatus } from '../../domain/employee-rules.js';

export interface EmployeeView {
  readonly id: string;
  readonly userId: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly employeeCode: string;
  readonly phone: string | null;
  readonly hiredAt: string | null;
  readonly timezone: string | null;
  readonly effectiveTimezone: string;
  readonly dailyLimitMinutes: number | null;
  readonly effectiveDailyLimitMinutes: number | null;
  readonly status: EmployeeStatus;
  readonly mustChangePassword: boolean;
  readonly lastLoginAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewEmployee {
  readonly companyId: string;
  readonly employeeId: string;
  readonly userId: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly employeeCode: string;
  readonly phone: string | null;
  readonly hiredAt: string | null;
  readonly timezone: string | null;
  readonly passwordHash: string;
  readonly temporaryPasswordExpiresAt: Date;
}

export interface EmployeePatch {
  readonly firstName?: string | undefined;
  readonly lastName?: string | undefined;
  readonly phone?: string | null | undefined;
  readonly hiredAt?: string | null | undefined;
  readonly timezone?: string | null | undefined;
  readonly dailyLimitMinutes?: number | null | undefined;
}

export interface EmployeeListFilter {
  readonly search?: string | undefined;
  readonly status?: EmployeeStatus | undefined;
}

export interface CompanyCapacity {
  readonly timezone: string;
  readonly maxEmployees: number;
  readonly activeEmployees: number;
}

// Todo metodo recibe companyId: no se puede tocar un empleado de otra empresa por error
export interface EmployeeRepository {
  lockCompanyCapacity(companyId: string): Promise<CompanyCapacity | null>;
  emailExists(email: string): Promise<boolean>;
  nextEmployeeCode(companyId: string): Promise<string>;

  create(employee: NewEmployee): Promise<void>;
  findById(companyId: string, employeeId: string): Promise<EmployeeView | null>;
  list(
    companyId: string,
    filter: EmployeeListFilter,
    page: PageRequest,
  ): Promise<Page<EmployeeView>>;
  update(companyId: string, employeeId: string, patch: EmployeePatch): Promise<void>;
  setStatus(companyId: string, employeeId: string, status: EmployeeStatus): Promise<void>;
  lockEmployee(companyId: string, employeeId: string): Promise<void>;
  // Marcajes (incluso anulados) o reportes de cualquier dia
  hasHistory(companyId: string, employeeId: string): Promise<boolean>;
  // Borra al empleado y su cuenta, con sus sesiones y su historial de accesos
  deleteAccount(companyId: string, employeeId: string): Promise<void>;
  revokeSessions(companyId: string, employeeId: string): Promise<void>;
  resetPassword(
    companyId: string,
    employeeId: string,
    password: { passwordHash: string; expiresAt: Date },
  ): Promise<void>;
}
