import type { ClockLocation } from '../../domain/clock-location.js';
import type { CompanyRef } from '../../domain/portfolio-timesheet.js';
import type { WorkDateRange } from '../../domain/work-date-range.js';
import type { ClockZone } from '../../domain/work-zone.js';
import type { EmployeeSummary } from './time-entry.repository.js';

export interface AttendanceMapPoint {
  readonly id: string;
  readonly company: CompanyRef;
  readonly employee: EmployeeSummary;
  readonly workDate: string;
  readonly clockInAt: Date;
  readonly timezone: string;
  // true mientras la entrada sigue abierta
  readonly open: boolean;
  readonly clockInLocation: ClockLocation;
  readonly clockInZone: ClockZone | null;
}

export interface AttendanceMapFilter extends WorkDateRange {
  readonly employeeId?: string | undefined;
}

export interface AttendanceMapResult {
  readonly points: AttendanceMapPoint[];
  // true si habia mas marcajes con ubicacion que el tope y se devolvieron los mas recientes
  readonly truncated: boolean;
}

// Marcajes con ubicacion de varias empresas a la vez; quien llama decide las empresas, nunca el cliente
export interface AttendanceMapReader {
  list(
    companyIds: readonly string[],
    filter: AttendanceMapFilter,
    limit: number,
  ): Promise<AttendanceMapResult>;
}
