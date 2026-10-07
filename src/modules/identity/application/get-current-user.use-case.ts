import type { Actor } from '#shared/application/actor.js';
import type { UseCase } from '#shared/application/use-case.js';
import { permissionsOf, type Permission, type Role } from '#shared/domain/permissions.js';
import type { UserAccount } from '../domain/user-account.js';
import { IdentityErrors } from './identity-errors.js';
import type { UserAccountRepository } from './ports/user-account.repository.js';

export interface CurrentUserProfile {
  readonly id: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly role: Role;
  readonly mustChangePassword: boolean;
  readonly company: {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly timezone: string;
  } | null;
  readonly employee: { readonly employeeCode: string; readonly timezone: string } | null;
  readonly permissions: readonly Permission[];
}

export function toProfile(account: UserAccount): CurrentUserProfile {
  const { company } = account;
  return {
    id: account.id,
    email: account.email,
    firstName: account.firstName,
    lastName: account.lastName,
    role: account.role,
    mustChangePassword: account.mustChangePassword,
    company: company
      ? { id: company.id, code: company.code, name: company.name, timezone: company.timezone }
      : null,
    employee: account.employee
      ? { employeeCode: account.employee.employeeCode, timezone: account.employee.timezone }
      : null,
    permissions: permissionsOf(account.role),
  };
}

interface Deps {
  userAccountRepository: UserAccountRepository;
}

export class GetCurrentUserUseCase implements UseCase<Actor, CurrentUserProfile> {
  constructor(private readonly deps: Deps) {}

  async execute(actor: Actor): Promise<CurrentUserProfile> {
    const account = await this.deps.userAccountRepository.findById(actor.userId, {
      activeCompanyId: actor.companyId,
    });
    if (!account) throw IdentityErrors.sessionRevoked();
    return toProfile(account);
  }
}
