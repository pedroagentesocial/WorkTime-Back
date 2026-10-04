import { daysOf, type PayPeriod, type Weekday, weekdayOf } from './pay-period.js';
import { centihoursToHours } from './work-hours.js';

export interface DailyTotal {
  readonly workDate: string;
  readonly entries: number;
  readonly openEntries: number;
  readonly centihours: number;
  readonly hasReport: boolean;
}

export interface TimesheetDay {
  readonly date: string;
  readonly weekday: Weekday;
  readonly entries: number;
  readonly openEntries: number;
  readonly hours: number;
  readonly hasReport: boolean;
}

export interface Timesheet {
  readonly days: TimesheetDay[];
  readonly totalHours: number;
}

export function buildTimesheet(period: PayPeriod, totals: readonly DailyTotal[]): Timesheet {
  const byDate = new Map(totals.map((total) => [total.workDate, total]));
  let totalCentihours = 0;

  const days = daysOf(period).map((date) => {
    const total = byDate.get(date);
    totalCentihours += total?.centihours ?? 0;
    return {
      date,
      weekday: weekdayOf(date),
      entries: total?.entries ?? 0,
      openEntries: total?.openEntries ?? 0,
      hours: centihoursToHours(total?.centihours ?? 0),
      hasReport: total?.hasReport ?? false,
    };
  });

  return { days, totalHours: centihoursToHours(totalCentihours) };
}
