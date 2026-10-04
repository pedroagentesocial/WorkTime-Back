import type { Clock } from './ports/clock.js';
import type { PasswordHasher } from './ports/password-hasher.js';
import type { SecureRandom } from './ports/secure-random.js';

export interface TemporaryPasswordSettings {
  readonly length: number;
  readonly ttlHours: number;
}

export interface TemporaryPassword {
  readonly password: string;
  readonly passwordHash: string;
  readonly expiresAt: Date;
}

interface Deps {
  secureRandom: SecureRandom;
  passwordHasher: PasswordHasher;
  clock: Clock;
  temporaryPasswordSettings: TemporaryPasswordSettings;
}

export class TemporaryPasswordIssuer {
  constructor(private readonly deps: Deps) {}

  async issue(): Promise<TemporaryPassword> {
    const { secureRandom, passwordHasher, clock, temporaryPasswordSettings: settings } = this.deps;
    const password = secureRandom.password(settings.length);
    return {
      password,
      passwordHash: await passwordHasher.hash(password),
      expiresAt: new Date(clock.now().getTime() + settings.ttlHours * 3_600_000),
    };
  }
}
