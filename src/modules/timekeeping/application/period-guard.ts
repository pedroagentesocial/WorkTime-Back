import type { PeriodClosureRepository } from './ports/period-closure.repository.js';
import { TimekeepingErrors } from './timekeeping-errors.js';

// Debe llamarse dentro de la transaccion del cambio: el bloqueo compartido impide que un cierre
// se cuele entre esta revision y el guardado, y el cierre espera a que los cambios en curso terminen
export async function assertPeriodsOpen(
  closures: PeriodClosureRepository,
  companyId: string,
  workDates: readonly string[],
): Promise<void> {
  await closures.lockForChanges(companyId);
  for (const workDate of new Set(workDates)) {
    const closure = await closures.findCovering(companyId, workDate);
    if (closure) throw TimekeepingErrors.periodClosed(closure.periodStart, closure.periodEnd);
  }
}
