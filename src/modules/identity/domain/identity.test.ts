import { describe, expect, it } from 'vitest';
import { Role } from '#shared/domain/permissions.js';
import { LoginLockoutPolicy } from './login-lockout-policy.js';
import { PasswordPolicy } from './password-policy.js';
import { UserAccount, type UserAccountProps } from './user-account.js';

const now = new Date('2026-06-01T12:00:00Z');
const minutes = (n: number) => new Date(now.getTime() + n * 60_000);

const base: UserAccountProps = {
  id: 'u1',
  email: 'ana@empresa.com',
  passwordHash: 'hash',
  role: Role.EMPLOYEE,
  status: 'active',
  firstName: 'Ana',
  lastName: 'López',
  mustChangePassword: false,
  temporaryPasswordExpiresAt: null,
  tokenVersion: 0,
  lockedUntil: null,
  company: { id: 'c1', code: 'K7QF-29MX', name: 'Empresa', timezone: 'UTC', status: 'active' },
};

const account = (overrides: Partial<UserAccountProps> = {}) =>
  UserAccount.restore({ ...base, ...overrides });

describe('UserAccount', () => {
  it('una cuenta activa de una empresa activa puede entrar', () => {
    expect(account().loginDenial(now)).toBeNull();
    expect(account().sessionDenial()).toBeNull();
  });

  it('bloqueada mientras lockedUntil esté en el futuro', () => {
    const locked = account({ lockedUntil: minutes(5) });
    expect(locked.isLocked(now)).toBe(true);
    expect(locked.isLocked(minutes(5))).toBe(false);
  });

  it('usuario inactivo o empresa suspendida no pueden entrar ni seguir en sesión', () => {
    expect(account({ status: 'inactive' }).loginDenial(now)).toBe('USER_INACTIVE');
    const suspended = account({ company: { ...base.company!, status: 'suspended' } });
    expect(suspended.loginDenial(now)).toBe('COMPANY_SUSPENDED');
    expect(suspended.sessionDenial()).toBe('COMPANY_SUSPENDED');
  });

  it('el admin global no depende de ninguna empresa', () => {
    expect(account({ role: Role.PLATFORM_ADMIN, company: null }).sessionDenial()).toBeNull();
  });

  it('una contraseña temporal vencida impide iniciar sesión', () => {
    const temp = account({ mustChangePassword: true, temporaryPasswordExpiresAt: minutes(-1) });
    expect(temp.loginDenial(now)).toBe('TEMPORARY_PASSWORD_EXPIRED');
    const valid = account({ mustChangePassword: true, temporaryPasswordExpiresAt: minutes(60) });
    expect(valid.loginDenial(now)).toBeNull();
  });
});

describe('LoginLockoutPolicy', () => {
  const policy = new LoginLockoutPolicy(5, 15 * 60_000);

  it('bloquea al llegar al máximo de intentos', () => {
    expect(policy.shouldLock(4)).toBe(false);
    expect(policy.shouldLock(5)).toBe(true);
  });

  it('calcula el fin del bloqueo', () => {
    expect(policy.lockedUntil(now)).toEqual(minutes(15));
  });
});

describe('PasswordPolicy', () => {
  const policy = new PasswordPolicy(12, 128);
  const ctx = { email: 'ana.lopez@empresa.com' };

  it('acepta una contraseña larga', () => {
    expect(() => {
      policy.assertAcceptable('mi perro se llama Toby', ctx);
    }).not.toThrow();
  });

  it.each([
    ['corta', 'Debe tener al menos 12'],
    ['x'.repeat(129), 'como máximo 128'],
    ['ana.lopez@empresa.com', 'igual a tu email'],
    ['aaaaaaaaaaaaaa', 'fácil de adivinar'],
    ['Password1234', 'fácil de adivinar'],
  ])('rechaza "%s"', (password, expected) => {
    expect(() => {
      policy.assertAcceptable(password, ctx);
    }).toThrow(
      expect.objectContaining({
        code: 'WEAK_PASSWORD',
        details: expect.arrayContaining([
          expect.objectContaining({ message: expect.stringContaining(expected) }),
        ]),
      }),
    );
  });
});
