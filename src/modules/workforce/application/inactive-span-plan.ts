import type { InactiveSpanView } from './ports/inactive-span.repository.js';
import { WorkforceErrors } from './workforce-errors.js';

const DAY_MS = 86_400_000;

export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

interface Limits {
  readonly today: string;
  // Ultimo dia de un periodo cerrado; ninguna fecha elegida puede caer ahi
  readonly lastClosedDay: string | null;
}

function assertChosenDay(day: string, { today, lastClosedDay }: Limits): void {
  if (day > today) throw WorkforceErrors.invalidStatusDate('La fecha no puede ser posterior a hoy');
  if (lastClosedDay && day <= lastClosedDay) {
    throw WorkforceErrors.statusDateInClosedPeriod(lastClosedDay);
  }
}

// Desactivar: el ultimo dia pagado es activo y la baja empieza al dia siguiente
export function planDeactivation(
  spans: readonly InactiveSpanView[],
  lastPaidDay: string,
  limits: Limits,
): { readonly startFrom: string } {
  assertChosenDay(lastPaidDay, limits);
  const previous = spans.at(-1);
  if (previous?.toDay && lastPaidDay <= previous.toDay) {
    throw WorkforceErrors.invalidStatusDate(
      `La fecha no puede ser anterior a su última reactivación, el ${addDays(previous.toDay, 1)}`,
    );
  }
  return { startFrom: addDays(lastPaidDay, 1) };
}

export type ReactivationPlan =
  | { readonly action: 'none' }
  // Vuelve a cobrar desde el dia siguiente a su ultimo dia pagado: la baja queda vacia
  | { readonly action: 'remove'; readonly fromDay: string }
  | { readonly action: 'end'; readonly fromDay: string; readonly toDay: string };

// Reactivar: desde el primer dia que vuelve a cobrar; puede ser el mismo dia de la baja
export function planReactivation(
  spans: readonly InactiveSpanView[],
  firstPaidDay: string,
  limits: Limits,
): ReactivationPlan {
  assertChosenDay(firstPaidDay, limits);
  const open = spans.find((span) => span.toDay === null);
  if (!open) return { action: 'none' };
  const lastPaidDay = addDays(open.fromDay, -1);
  if (firstPaidDay < lastPaidDay) {
    throw WorkforceErrors.invalidStatusDate(
      `La fecha no puede ser anterior a su baja, el ${lastPaidDay}`,
    );
  }
  return firstPaidDay <= open.fromDay
    ? { action: 'remove', fromDay: open.fromDay }
    : { action: 'end', fromDay: open.fromDay, toDay: addDays(firstPaidDay, -1) };
}
