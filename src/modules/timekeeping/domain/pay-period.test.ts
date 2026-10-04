import { describe, expect, it } from 'vitest';
import { earliestWorkDateInUse } from './pay-period.js';

describe('earliestWorkDateInUse', () => {
  it('es el día más atrasado del mundo: UTC-12', () => {
    expect(earliestWorkDateInUse(new Date('2026-10-05T08:00:00Z'))).toBe('2026-10-04');
    expect(earliestWorkDateInUse(new Date('2026-10-05T11:59:59Z'))).toBe('2026-10-04');
    expect(earliestWorkDateInUse(new Date('2026-10-05T12:00:00Z'))).toBe('2026-10-05');
  });

  it('nunca va por delante de un empleado en Hawái', () => {
    const now = new Date('2026-10-05T08:00:00Z');
    expect(earliestWorkDateInUse(now) <= '2026-10-04').toBe(true);
  });
});
