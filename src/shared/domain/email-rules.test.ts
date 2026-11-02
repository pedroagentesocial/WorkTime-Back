import { describe, expect, it } from 'vitest';
import { isReservedEmailDomain } from './email-rules.js';

describe('isReservedEmailDomain', () => {
  it.each([
    'ana@acme.test',
    'x@example.com',
    'x@mail.example.org',
    'y@algo.invalid',
    'z@localhost',
  ])('no se envía a %s', (email) => {
    expect(isReservedEmailDomain(email)).toBe(true);
  });

  it.each(['diego@gmail.com', 'a@dashclass.studio', 'b@test.com', 'c@examples.com'])(
    'sí se envía a %s',
    (email) => {
      expect(isReservedEmailDomain(email)).toBe(false);
    },
  );
});
