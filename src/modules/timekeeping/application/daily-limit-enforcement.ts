import { limitReachedAt, remainingSeconds } from '../domain/daily-limit.js';
import type { TimeEntry } from '../domain/time-entry.js';
import type { TimeEntryRepository } from './ports/time-entry.repository.js';

export interface DailyLimitStatus {
  readonly minutes: number;
  readonly workedSeconds: number;
  readonly remainingSeconds: number;
  readonly reached: boolean;
}

export function dailyLimitStatusOf(
  limitMinutes: number | null,
  workedSeconds: number,
): DailyLimitStatus | null {
  if (limitMinutes === null) return null;
  const remaining = remainingSeconds(limitMinutes, workedSeconds);
  return {
    minutes: limitMinutes,
    workedSeconds,
    remainingSeconds: remaining,
    reached: remaining === 0,
  };
}

// Cierra la entrada en el instante exacto en que se agoto el limite, no cuando alguien lo noto
export async function closeIfOverLimit(
  entries: TimeEntryRepository,
  entry: TimeEntry,
  limitMinutes: number | null,
  now: Date,
): Promise<boolean> {
  if (limitMinutes === null || !entry.isOpen || entry.dailyLimitWaived) return false;

  const worked = await entries.closedSecondsOn(entry.employeeId, entry.workDate);
  const closeAt = limitReachedAt(entry.clockInAt, worked, limitMinutes);
  if (now < closeAt) return false;

  entry.close(closeAt, 'daily_limit');
  await entries.closeIfOpen(entry.companyId, entry.id, closeAt, 'daily_limit', entry.clockInAt);
  return true;
}
