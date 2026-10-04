import argon2 from 'argon2';
import { SECURITY } from '#config/security.js';
import type { PasswordHasher } from '#shared/application/ports/password-hasher.js';

const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: SECURITY.argon2.memoryCost,
  timeCost: SECURITY.argon2.timeCost,
  parallelism: SECURITY.argon2.parallelism,
} as const;

export class Argon2PasswordHasher implements PasswordHasher {
  hash(plain: string): Promise<string> {
    return argon2.hash(plain, OPTIONS);
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, OPTIONS);
  }
}
