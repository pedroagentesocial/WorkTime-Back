import { resolveTimezone } from '#shared/domain/timezone.js';
import type { PrismaDb } from '#shared/infrastructure/prisma/prisma-db.js';
import type { Prisma } from '#generated/prisma/client.js';
import type { UserAccountRepository } from '../application/ports/user-account.repository.js';
import { UserAccount } from '../domain/user-account.js';

interface Deps {
  db: PrismaDb;
}

const ACCOUNT_SELECT = {
  id: true,
  email: true,
  passwordHash: true,
  role: true,
  status: true,
  firstName: true,
  lastName: true,
  mustChangePassword: true,
  temporaryPasswordExpiresAt: true,
  tokenVersion: true,
  lockedUntil: true,
  lockLevel: true,
  company: { select: { id: true, code: true, name: true, timezone: true, status: true } },
  employee: { select: { employeeCode: true, timezone: true } },
} satisfies Prisma.UserSelect;

type AccountRow = Prisma.UserGetPayload<{ select: typeof ACCOUNT_SELECT }>;

export class PrismaUserAccountRepository implements UserAccountRepository {
  private readonly db: PrismaDb;

  constructor({ db }: Deps) {
    this.db = db;
  }

  async findByEmail(email: string): Promise<UserAccount | null> {
    const row = await this.db.client.user.findUnique({ where: { email }, select: ACCOUNT_SELECT });
    return row ? toDomain(row) : null;
  }

  async findById(id: string): Promise<UserAccount | null> {
    const row = await this.db.client.user.findUnique({ where: { id }, select: ACCOUNT_SELECT });
    return row ? toDomain(row) : null;
  }

  async reserveLoginAttempt(userId: string, now: Date): Promise<number | null> {
    const rows = await this.db.client.$queryRaw<{ failed_login_attempts: number }[]>`
      UPDATE users
      SET failed_login_attempts = failed_login_attempts + 1
      WHERE id = ${userId}::uuid AND (locked_until IS NULL OR locked_until <= ${now})
      RETURNING failed_login_attempts`;
    return rows[0]?.failed_login_attempts ?? null;
  }

  async clearFailedLoginAttempts(userId: string): Promise<void> {
    await this.db.client.user.update({ where: { id: userId }, data: { failedLoginAttempts: 0 } });
  }

  async lock(userId: string, until: Date, level: number): Promise<void> {
    await this.db.client.user.update({
      where: { id: userId },
      data: { lockedUntil: until, lockLevel: level, failedLoginAttempts: 0 },
    });
  }

  async recordSuccessfulLogin(userId: string, at: Date): Promise<void> {
    await this.db.client.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: 0, lockedUntil: null, lockLevel: 0, lastLoginAt: at },
    });
  }

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.db.client.user.update({ where: { id: userId }, data: { passwordHash } });
  }

  async updateName(userId: string, firstName: string, lastName: string): Promise<void> {
    await this.db.client.user.update({ where: { id: userId }, data: { firstName, lastName } });
  }

  async revokeSessions(userId: string): Promise<void> {
    await this.db.client.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });
  }

  async changePassword(userId: string, passwordHash: string, at: Date): Promise<void> {
    await this.db.client.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        passwordChangedAt: at,
        mustChangePassword: false,
        temporaryPasswordExpiresAt: null,
        failedLoginAttempts: 0,
        lockedUntil: null,
        lockLevel: 0,
        tokenVersion: { increment: 1 },
      },
    });
  }
}

function toDomain(row: AccountRow): UserAccount {
  return UserAccount.restore({
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    role: row.role,
    status: row.status,
    firstName: row.firstName,
    lastName: row.lastName,
    mustChangePassword: row.mustChangePassword,
    temporaryPasswordExpiresAt: row.temporaryPasswordExpiresAt,
    tokenVersion: row.tokenVersion,
    lockedUntil: row.lockedUntil,
    lockLevel: row.lockLevel,
    company: row.company,
    employee:
      row.employee && row.company
        ? {
            employeeCode: row.employee.employeeCode,
            timezone: resolveTimezone(row.employee.timezone, row.company.timezone),
          }
        : null,
  });
}
