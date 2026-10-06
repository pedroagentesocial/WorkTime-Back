export interface LockoutState {
  readonly lockedUntil: Date | null;
  readonly lockLevel: number;
}

export interface Lockout {
  readonly until: Date;
  readonly level: number;
}

export class LoginLockoutPolicy {
  constructor(
    private readonly maxFailedAttempts: number,
    private readonly baseMs: number,
    private readonly maxMs: number,
    private readonly resetMs: number,
  ) {}

  shouldLock(failedAttempts: number): boolean {
    return failedAttempts >= this.maxFailedAttempts;
  }

  exceeded(reservedAttempts: number): boolean {
    return reservedAttempts > this.maxFailedAttempts;
  }

  // Cada reincidencia duplica la espera; sin reincidir durante resetMs vuelve al primer nivel
  nextLock(state: LockoutState, now: Date): Lockout {
    const recent =
      state.lockedUntil !== null && state.lockedUntil.getTime() + this.resetMs > now.getTime();
    const level = recent ? state.lockLevel + 1 : 1;
    const waitMs = Math.min(this.baseMs * 2 ** Math.min(level - 1, 30), this.maxMs);
    return { until: new Date(now.getTime() + waitMs), level };
  }
}
