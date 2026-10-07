import type { Page, PageRequest } from '#shared/application/pagination.js';
import type { CompanyStatus } from '#shared/domain/company-rules.js';

export interface CompanyAdminSummary {
  readonly id: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly status: 'active' | 'inactive';
  readonly lastLoginAt: Date | null;
}

export interface CompanyView {
  readonly id: string;
  readonly code: string;
  readonly employeeCodePrefix: string;
  readonly name: string;
  readonly timezone: string;
  readonly maxEmployees: number;
  readonly status: CompanyStatus;
  readonly activeEmployees: number;
  readonly admin: CompanyAdminSummary | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewCompanyWithAdmin {
  readonly company: {
    readonly id: string;
    readonly code: string;
    readonly employeeCodePrefix: string;
    readonly name: string;
    readonly timezone: string;
    readonly maxEmployees: number;
  };
  readonly admin: {
    readonly id: string;
    readonly email: string;
    readonly firstName: string;
    readonly lastName: string;
    readonly passwordHash: string;
    readonly temporaryPasswordExpiresAt: Date;
  };
}

export interface CompanyListFilter {
  readonly search?: string | undefined;
  readonly status?: CompanyStatus | undefined;
}

export interface CompanyPatch {
  readonly name?: string | undefined;
  readonly timezone?: string | undefined;
  readonly maxEmployees?: number | undefined;
}

export interface CompanyRepository {
  createWithAdmin(input: NewCompanyWithAdmin): Promise<void>;
  lockActiveEmployees(companyId: string): Promise<number | null>;
  emailExists(email: string): Promise<boolean>;
  findById(id: string): Promise<CompanyView | null>;
  list(filter: CompanyListFilter, page: PageRequest): Promise<Page<CompanyView>>;
  // Las empresas asignadas a un admin multiempresa, por nombre
  listByMember(userId: string): Promise<CompanyView[]>;
  update(id: string, patch: CompanyPatch): Promise<void>;
  setStatus(id: string, status: CompanyStatus): Promise<void>;
  resetAdminPassword(
    companyId: string,
    password: { passwordHash: string; expiresAt: Date },
  ): Promise<CompanyAdminSummary | null>;
}
