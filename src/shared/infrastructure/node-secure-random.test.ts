import { describe, expect, it } from 'vitest';
import { NodeSecureRandom } from './node-secure-random.js';

describe('NodeSecureRandom', () => {
  const random = new NodeSecureRandom();

  it('genera tokens base64url únicos', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => random.token()));
    expect(tokens.size).toBe(100);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{64}$/);
  });

  it('genera contraseñas del largo pedido y sin caracteres ambiguos', () => {
    const password = random.password(16);
    expect(password).toHaveLength(16);
    expect(password).not.toMatch(/[0O1lI]/);
  });

  it('sha256 es determinista y en hex', () => {
    expect(random.sha256('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
