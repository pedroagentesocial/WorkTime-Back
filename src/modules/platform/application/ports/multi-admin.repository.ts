import type { Page, PageRequest } from '#shared/application/pagination.js';

export interface MultiAdminView {
  readonly id: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly status: 'active' | 'inactive';
  readonly lastLoginAt: Date | null;
  readonly maxCompanies: number;
  readonly maxEmployeesPerCompany: number;
  readonly companyCount: number;
  readonly createdAt: Date;
}

// Cuanto le queda a un admin multiempresa, con su fila bloqueada para decidir sin carreras
export interface MultiAdminLimits {
  readonly maxCompanies: number;
  readonly maxEmployeesPerCompany: number;
  readonly companyCount: number;
}

export interface NewMultiAdmin {
  readonly id: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly passwordHash: string;
  readonly temporaryPasswordExpiresAt: Date;
  readonly maxCompanies: number;
  readonly maxEmployeesPerCompany: number;
}

export interface MultiAdminListFilter {
  readonly search?: string | undefined;
  readonly status?: 'active' | 'inactive' | undefined;
}

export interface MultiAdminPatch {
  readonly firstName?: string | undefined;
  readonly lastName?: string | undefined;
  readonly maxCompanies?: number | undefined;
  readonly maxEmployeesPerCompany?: number | undefined;
}

export interface MultiAdminRepository {
  createWithLimits(input: NewMultiAdmin): Promise<void>;
  findById(id: string): Promise<MultiAdminView | null>;
  list(filter: MultiAdminListFilter, page: PageRequest): Promise<Page<MultiAdminView>>;
  update(id: string, patch: MultiAdminPatch): Promise<void>;
  setStatus(id: string, status: 'active' | 'inactive'): Promise<void>;
  resetPassword(
    id: string,
    password: { passwordHash: string; expiresAt: Date },
  ): Promise<MultiAdminView | null>;

  // Bloquea la fila de limites hasta el fin de la transaccion; null si no es un admin multiempresa
  lockLimits(userId: string): Promise<MultiAdminLimits | null>;
  hasMembership(userId: string, companyId: string): Promise<boolean>;
  addMembership(userId: string, companyId: string): Promise<void>;
  removeMembership(userId: string, companyId: string): Promise<boolean>;
}
