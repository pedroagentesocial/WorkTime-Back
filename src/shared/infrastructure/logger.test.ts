import { Writable } from 'node:stream';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { serializeError } from './logger.js';

class FakePrismaError extends Error {
  readonly code = 'P2002';
  constructor() {
    super('Invalid `prisma.user.create()` invocation: { passwordHash: "$argon2id$v=19$secreto" }');
    this.name = 'PrismaClientKnownRequestError';
  }
}

describe('serializeError', () => {
  it('omite el mensaje de los errores de Prisma (puede traer datos) y conserva tipo y código', () => {
    const serialized = serializeError(new FakePrismaError());
    expect(serialized).toMatchObject({ type: 'PrismaClientKnownRequestError', code: 'P2002' });
    expect(JSON.stringify(serialized)).not.toContain('argon2id');
  });

  it('conserva el mensaje de los errores normales', () => {
    expect(serializeError(new Error('falló X'))).toMatchObject({
      type: 'Error',
      message: 'falló X',
    });
  });

  it('no vuelca valores que no son errores', () => {
    expect(JSON.stringify(serializeError({ password: 'x' }))).not.toContain('password');
  });
});

describe('redacción en logs', () => {
  it('oculta campos sensibles también anidados', () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(chunk.toString());
        done();
      },
    });
    const logger = pino(
      {
        redact: {
          paths: ['*.password', '*.*.password', '*.*.refreshToken'],
          censor: '[REDACTED]',
        },
      },
      sink,
    );

    logger.info({
      body: { password: 'uno' },
      ctx: { user: { password: 'dos', refreshToken: 't' } },
    });
    const output = lines.join('');
    expect(output).not.toMatch(/uno|dos|"t"/);
    expect(output).toContain('[REDACTED]');
  });
});
