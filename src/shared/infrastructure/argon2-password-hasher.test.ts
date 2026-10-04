import argon2 from 'argon2';
import { describe, expect, it } from 'vitest';
import { Argon2PasswordHasher } from './argon2-password-hasher.js';

describe('Argon2PasswordHasher', () => {
  const hasher = new Argon2PasswordHasher();

  it('genera hashes argon2id que verifican la contraseña correcta', async () => {
    const hash = await hasher.hash('una contraseña larga');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    await expect(hasher.verify(hash, 'una contraseña larga')).resolves.toBe(true);
    await expect(hasher.verify(hash, 'otra contraseña')).resolves.toBe(false);
  });

  it('el mismo texto produce hashes distintos (salt aleatorio)', async () => {
    const [a, b] = await Promise.all([hasher.hash('repetida'), hasher.hash('repetida')]);
    expect(a).not.toBe(b);
  });

  it('un hash corrupto se trata como credencial inválida, sin lanzar', async () => {
    await expect(hasher.verify('no-es-un-hash', 'x')).resolves.toBe(false);
  });

  it('detecta hashes creados con parámetros más débiles', async () => {
    const weak = await argon2.hash('x', { type: argon2.argon2id, memoryCost: 4096, timeCost: 1 });
    expect(hasher.needsRehash(weak)).toBe(true);
    expect(hasher.needsRehash(await hasher.hash('x'))).toBe(false);
  });
});
