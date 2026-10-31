import type { Page, PageRequest } from '#shared/application/pagination.js';
import { SecurityEventType } from '#shared/application/ports/security-event-recorder.js';
import type { EmployeeSummary } from './time-entry.repository.js';

export const ATTENDANCE_ACTIVITY_TYPES = [
  SecurityEventType.TIME_ENTRY_CLOCKED_IN_BY_ADMIN,
  SecurityEventType.TIME_ENTRY_CLOCKED_OUT_BY_ADMIN,
  SecurityEventType.TIME_ENTRY_CREATED_BY_ADMIN,
  SecurityEventType.TIME_ENTRY_CORRECTED_BY_ADMIN,
  SecurityEventType.TIME_ENTRY_CORRECTED_BY_EMPLOYEE,
  SecurityEventType.TIME_ENTRY_VOIDED_BY_ADMIN,
  SecurityEventType.CHECK_IN_VOIDED_BY_ADMIN,
  SecurityEventType.PAY_PERIOD_CLOSED,
] as const;

export type AttendanceActivityType = (typeof ATTENDANCE_ACTIVITY_TYPES)[number];

export interface AttendanceActivityFilter {
  readonly employeeId?: string | undefined;
  readonly type?: AttendanceActivityType | undefined;
  readonly from?: Date | undefined;
  readonly to?: Date | undefined;
}

export interface AttendanceActivityDetails {
  readonly timeEntryId?: string;
  readonly checkInId?: string;
  readonly checkedInAt?: string;
  readonly reason?: string;
  readonly clockInAt?: string;
  readonly clockOutAt?: string | null;
  readonly previousClockInAt?: string;
  readonly previousClockOutAt?: string | null;
  readonly overrideDailyLimit?: boolean;
  readonly periodStart?: string;
  readonly periodEnd?: string;
  readonly totalHours?: number;
}

export interface AttendanceActivityView {
  readonly id: string;
  readonly type: AttendanceActivityType;
  readonly occurredAt: Date;
  readonly actor: {
    readonly id: string;
    readonly firstName: string;
    readonly lastName: string;
  } | null;
  readonly employee: EmployeeSummary | null;
  readonly details: AttendanceActivityDetails;
}

export interface AttendanceActivityReader {
  list(
    companyId: string,
    filter: AttendanceActivityFilter,
    page: PageRequest,
  ): Promise<Page<AttendanceActivityView>>;
}
