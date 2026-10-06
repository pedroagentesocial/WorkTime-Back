import type { Role } from '#shared/domain/permissions.js';

export type UserStatus = 'active' | 'inactive';
export type CompanyStatus = 'active' | 'suspended';

export interface AccountCompany {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly timezone: string;
  readonly status: CompanyStatus;
}

export interface AccountEmployee {
  readonly employeeCode: string;
  readonly timezone: string;
}

export interface UserAccountProps {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly role: Role;
  readonly status: UserStatus;
  readonly firstName: string;
  readonly lastName: string;
  readonly mustChangePassword: boolean;
  readonly temporaryPasswordExpiresAt: Date | null;
  readonly tokenVersion: number;
  readonly lockedUntil: Date | null;
  readonly lockLevel: number;
  readonly company: AccountCompany | null;
  readonly employee?: AccountEmployee | null;
}

export type AccessDenial = 'USER_INACTIVE' | 'COMPANY_SUSPENDED' | 'TEMPORARY_PASSWORD_EXPIRED';

export class UserAccount {
  private constructor(private readonly props: UserAccountProps) {}

  static restore(props: UserAccountProps): UserAccount {
    return new UserAccount(props);
  }

  get id(): string {
    return this.props.id;
  }
  get email(): string {
    return this.props.email;
  }
  get passwordHash(): string {
    return this.props.passwordHash;
  }
  get role(): Role {
    return this.props.role;
  }
  get firstName(): string {
    return this.props.firstName;
  }
  get lastName(): string {
    return this.props.lastName;
  }
  get mustChangePassword(): boolean {
    return this.props.mustChangePassword;
  }
  get tokenVersion(): number {
    return this.props.tokenVersion;
  }
  get lockedUntil(): Date | null {
    return this.props.lockedUntil;
  }
  get lockLevel(): number {
    return this.props.lockLevel;
  }
  get company(): AccountCompany | null {
    return this.props.company;
  }
  get employee(): AccountEmployee | null {
    return this.props.employee ?? null;
  }
  get companyId(): string | null {
    return this.props.company?.id ?? null;
  }

  isLocked(now: Date): boolean {
    return this.props.lockedUntil !== null && this.props.lockedUntil > now;
  }

  loginDenial(now: Date): AccessDenial | null {
    const sessionDenial = this.sessionDenial();
    if (sessionDenial) return sessionDenial;

    const expiresAt = this.props.temporaryPasswordExpiresAt;
    if (this.props.mustChangePassword && expiresAt !== null && expiresAt <= now) {
      return 'TEMPORARY_PASSWORD_EXPIRED';
    }
    return null;
  }

  sessionDenial(): Exclude<AccessDenial, 'TEMPORARY_PASSWORD_EXPIRED'> | null {
    if (this.props.status !== 'active') return 'USER_INACTIVE';
    if (this.props.company && this.props.company.status !== 'active') return 'COMPANY_SUSPENDED';
    return null;
  }
}
