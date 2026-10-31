import { describe, expect, it } from 'vitest';
import { CHECK_IN_LIMITS, CheckInRules } from './check-in.js';

describe('CheckInRules.normalizeNote', () => {
  it('quita espacios y trata la nota vacía como ausente', () => {
    expect(CheckInRules.normalizeNote('  Llegué  ')).toBe('Llegué');
    expect(CheckInRules.normalizeNote('   ')).toBeNull();
    expect(CheckInRules.normalizeNote(undefined)).toBeNull();
    expect(CheckInRules.normalizeNote(null)).toBeNull();
  });

  it('acepta hasta el máximo y rechaza más', () => {
    expect(CheckInRules.normalizeNote('a'.repeat(CHECK_IN_LIMITS.noteMax))).toHaveLength(
      CHECK_IN_LIMITS.noteMax,
    );
    expect(() => CheckInRules.normalizeNote('a'.repeat(CHECK_IN_LIMITS.noteMax + 1))).toThrow(
      expect.objectContaining({ code: 'INVALID_CHECK_IN_NOTE' }),
    );
  });
});
