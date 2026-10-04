import type { UserAccount } from '../../domain/user-account.js';

export interface UserAccountRepository {
  findByEmail(email: string): Promise<UserAccount | null>;
  findById(id: string): Promise<UserAccount | null>;

  reserveLoginAttempt(userId: string, now: Date): Promise<number | null>;
  clearFailedLoginAttempts(userId: string): Promise<void>;
  lock(userId: string, until: Date): Promise<void>;
  recordSuccessfulLogin(userId: string, at: Date): Promise<void>;
  updatePasswordHash(userId: string, passwordHash: string): Promise<void>;
  updateName(userId: string, firstName: string, lastName: string): Promise<void>;
  revokeSessions(userId: string): Promise<void>;
  changePassword(userId: string, passwordHash: string, at: Date): Promise<void>;
}
