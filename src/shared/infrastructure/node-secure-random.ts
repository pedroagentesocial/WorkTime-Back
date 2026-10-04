import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { SecureRandom } from '#shared/application/ports/secure-random.js';

const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

export class NodeSecureRandom implements SecureRandom {
  token(bytes = 48): string {
    return randomBytes(bytes).toString('base64url');
  }

  int(maxExclusive: number): number {
    return randomInt(maxExclusive);
  }

  password(length: number): string {
    let result = '';
    for (let i = 0; i < length; i++) {
      result += PASSWORD_ALPHABET.charAt(randomInt(PASSWORD_ALPHABET.length));
    }
    return result;
  }

  sha256(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
}
