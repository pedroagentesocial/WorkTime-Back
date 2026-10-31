import type { Page, PageRequest } from '#shared/application/pagination.js';
import type { ClockLocation } from '../../domain/clock-location.js';
import type { WorkDateRange } from '../../domain/work-date-range.js';
import type { ClockZone } from '../../domain/work-zone.js';
import type { EmployeeSummary } from './time-entry.repository.js';

export interface NewCheckIn {
  readonly id: string;
  readonly companyId: string;
  readonly employeeId: string;
  readonly checkedInAt: Date;
  readonly timezone: string;
  readonly workDate: string;
  readonly location: ClockLocation;
  readonly zone: ClockZone | null;
  readonly note: string | null;
}

export interface CheckInView {
  readonly id: string;
  readonly employee: EmployeeSummary;
  readonly checkedInAt: Date;
  readonly timezone: string;
  readonly workDate: string;
  readonly location: ClockLocation;
  readonly zone: ClockZone | null;
  readonly note: string | null;
  readonly voided: {
    readonly at: Date;
    readonly reason: string;
    readonly by: { readonly id: string; readonly firstName: string; readonly lastName: string };
  } | null;
}

export interface CheckInFilter extends WorkDateRange {
  readonly employeeId?: string | undefined;
  // outside: solo los registrados fuera de toda zona de trabajo
  readonly location?: 'outside' | undefined;
  // Sin estado se excluyen los anulados; voided trae solo los anulados
  readonly status?: 'voided' | undefined;
}

export interface CheckInRepository {
  insert(checkIn: NewCheckIn): Promise<void>;
  // Cuantos registro el empleado en un dia laboral, anulados incluidos: el tope frena el abuso
  countOn(employeeId: string, workDate: string): Promise<number>;
  list(companyId: string, filter: CheckInFilter, page: PageRequest): Promise<Page<CheckInView>>;
  findViewById(companyId: string, id: string): Promise<CheckInView | null>;
  // Devuelve false si no existe en la empresa o ya estaba anulado
  voidIfActive(
    companyId: string,
    id: string,
    voiding: { at: Date; byId: string; reason: string },
  ): Promise<boolean>;
}
