import { describe, expect, it } from 'vitest';
import { limitReachedAt, remainingSeconds } from './daily-limit.js';

describe('limite diario', () => {
  it('8 h 10 min son 490 minutos y se agotan 490 minutos despues de la entrada', () => {
    const clockIn = new Date('2026-06-01T14:00:00Z');
    expect(limitReachedAt(clockIn, 0, 490)).toEqual(new Date('2026-06-01T22:10:00Z'));
  });

  it('descuenta lo ya trabajado ese dia', () => {
    const clockIn = new Date('2026-06-01T20:00:00Z');
    expect(limitReachedAt(clockIn, 5 * 3600, 490)).toEqual(new Date('2026-06-01T23:10:00Z'));
  });

  it('si ya agoto el limite no queda tiempo', () => {
    expect(remainingSeconds(490, 490 * 60)).toBe(0);
    expect(remainingSeconds(490, 600 * 60)).toBe(0);
    expect(remainingSeconds(490, 30 * 60)).toBe(460 * 60);
    const clockIn = new Date('2026-06-01T20:00:00Z');
    expect(limitReachedAt(clockIn, 600 * 60, 490)).toEqual(clockIn);
  });
});
