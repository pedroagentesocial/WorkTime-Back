import type { UserAccount } from '../../domain/user-account.js';

export interface FindByIdOptions {
  readonly activeCompanyId?: string | null | undefined;
}

export interface UserAccountRepository {
  findByEmail(email: string): Promise<UserAccount | null>;
  // Para un admin multiempresa, activeCompanyId es la empresa con la que trabaja la sesion. La cuenta
  // trae esa empresa solo si la membresia sigue vigente; si no, queda sin empresa
  findById(id: string, options?: FindByIdOptions): Promise<UserAccount | null>;

  reserveLoginAttempt(userId: string, now: Date): Promise<number | null>;
  clearFailedLoginAttempts(userId: string): Promise<void>;
  lock(userId: string, until: Date, level: number): Promise<void>;
  recordSuccessfulLogin(userId: string, at: Date): Promise<void>;
  updatePasswordHash(userId: string, passwordHash: string): Promise<void>;
  updateName(userId: string, firstName: string, lastName: string): Promise<void>;
  revokeSessions(userId: string): Promise<void>;
  changePassword(userId: string, passwordHash: string, at: Date): Promise<void>;
}
