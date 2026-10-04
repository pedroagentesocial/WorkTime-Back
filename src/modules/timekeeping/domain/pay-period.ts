import { localDateOf } from '#shared/domain/timezone.js';

export const PAY_PERIOD_DAYS = 14;
export const FIRST_PAY_PERIOD_START = '2026-09-21';

const DAY_MS = 86_400_000;

export interface PayPeriod {
  readonly start: string;
  readonly end: string;
}

const toDay = (date: string): number => Date.parse(`${date}T00:00:00Z`);
const fromDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export function addDays(date: string, days: number): string {
  return fromDay(toDay(date) + days * DAY_MS);
}

export function payPeriodOf(date: string): PayPeriod {
  const offset = Math.floor((toDay(date) - toDay(FIRST_PAY_PERIOD_START)) / DAY_MS);
  const start = addDays(
    FIRST_PAY_PERIOD_START,
    Math.floor(offset / PAY_PERIOD_DAYS) * PAY_PERIOD_DAYS,
  );
  return { start, end: addDays(start, PAY_PERIOD_DAYS - 1) };
}

// El dia laboral mas atrasado del mundo en este instante, que es el de UTC menos 12
// Un periodo solo termino de verdad cuando ya termino ahi, o alguien aun podria marcar dentro
export function earliestWorkDateInUse(now: Date): string {
  return localDateOf(now, 'Etc/GMT+12');
}

export function previousPayPeriodStart(period: PayPeriod): string {
  return addDays(period.start, -PAY_PERIOD_DAYS);
}

export function nextPayPeriodStart(period: PayPeriod): string {
  return addDays(period.start, PAY_PERIOD_DAYS);
}

const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

export function weekdayOf(date: string): Weekday {
  return WEEKDAYS[new Date(toDay(date)).getUTCDay()] as Weekday;
}

export function daysOf(period: PayPeriod): string[] {
  return Array.from({ length: PAY_PERIOD_DAYS }, (_, index) => addDays(period.start, index));
}
