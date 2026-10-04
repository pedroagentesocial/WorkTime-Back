export class LoginLockoutPolicy {
  constructor(
    private readonly maxFailedAttempts: number,
    private readonly lockoutMs: number,
  ) {}

  shouldLock(failedAttempts: number): boolean {
    return failedAttempts >= this.maxFailedAttempts;
  }

  exceeded(reservedAttempts: number): boolean {
    return reservedAttempts > this.maxFailedAttempts;
  }

  lockedUntil(now: Date): Date {
    return new Date(now.getTime() + this.lockoutMs);
  }
}
