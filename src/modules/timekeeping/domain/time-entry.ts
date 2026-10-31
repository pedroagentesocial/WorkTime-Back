import { ConflictError, ValidationError } from '#shared/domain/errors.js';
import { localDateOf } from '#shared/domain/timezone.js';
import type { ClockLocation } from './clock-location.js';
import { addDays } from './pay-period.js';
import type { ClockZone } from './work-zone.js';
import { durationSeconds } from './work-hours.js';

export const MANUAL_ENTRY_BACKFILL_DAYS = 14;

export type TimeEntrySource = 'web' | 'admin';
export type TimeEntryCloseSource = 'employee' | 'admin' | 'daily_limit';

export interface TimeEntryProps {
  readonly id: string;
  readonly companyId: string;
  readonly employeeId: string;
  readonly clockInAt: Date;
  readonly clockOutAt: Date | null;
  readonly timezone: string;
  readonly workDate: string;
  readonly source: TimeEntrySource;
  readonly closeSource: TimeEntryCloseSource | null;
  readonly dailyLimitWaived: boolean;
  readonly createdReason: string | null;
  // Solo la entrada de un marcaje del propio empleado; null si la hizo un admin o es anterior a este dato
  readonly clockInLocation: ClockLocation | null;
  // Si cayo dentro o fuera de una zona de trabajo; null si la empresa no tenia zonas o no hubo ubicacion
  readonly clockInZone: ClockZone | null;
}

export interface TimeRange {
  readonly clockInAt: Date;
  readonly clockOutAt: Date | null;
}

// Un turno nocturno cuenta para el dia en que empezo
export class TimeEntry {
  private constructor(private props: TimeEntryProps) {}

  static restore(props: TimeEntryProps): TimeEntry {
    return new TimeEntry(props);
  }

  static start(input: {
    id: string;
    companyId: string;
    employeeId: string;
    at: Date;
    timezone: string;
    source: TimeEntrySource;
    dailyLimitWaived?: boolean;
    location?: ClockLocation | null;
    zone?: ClockZone | null;
  }): TimeEntry {
    return new TimeEntry({
      id: input.id,
      companyId: input.companyId,
      employeeId: input.employeeId,
      clockInAt: input.at,
      clockOutAt: null,
      timezone: input.timezone,
      workDate: localDateOf(input.at, input.timezone),
      source: input.source,
      closeSource: null,
      dailyLimitWaived: input.dailyLimitWaived ?? false,
      createdReason: null,
      clockInLocation: input.location ?? null,
      clockInZone: input.zone ?? null,
    });
  }

  static createManual(input: {
    id: string;
    companyId: string;
    employeeId: string;
    clockInAt: Date;
    clockOutAt: Date;
    timezone: string;
    now: Date;
    reason: string;
  }): TimeEntry {
    const { clockInAt, clockOutAt, now, timezone } = input;
    if (clockInAt > now || clockOutAt > now) {
      throw new ValidationError('TIME_IN_FUTURE', 'No se pueden registrar horas en el futuro');
    }
    if (clockOutAt <= clockInAt) {
      throw new ValidationError('INVALID_TIME_RANGE', 'La salida debe ser posterior a la entrada');
    }
    const workDate = localDateOf(clockInAt, timezone);
    const oldest = addDays(localDateOf(now, timezone), -MANUAL_ENTRY_BACKFILL_DAYS);
    if (workDate < oldest) {
      throw new ValidationError(
        'MANUAL_ENTRY_TOO_OLD',
        `Solo se pueden crear registros de los últimos ${MANUAL_ENTRY_BACKFILL_DAYS} días`,
      );
    }
    return new TimeEntry({
      id: input.id,
      companyId: input.companyId,
      employeeId: input.employeeId,
      clockInAt,
      clockOutAt,
      timezone,
      workDate,
      source: 'admin',
      closeSource: 'admin',
      dailyLimitWaived: false,
      createdReason: input.reason,
      clockInLocation: null,
      clockInZone: null,
    });
  }

  get id(): string {
    return this.props.id;
  }
  get companyId(): string {
    return this.props.companyId;
  }
  get employeeId(): string {
    return this.props.employeeId;
  }
  get clockInAt(): Date {
    return this.props.clockInAt;
  }
  get clockOutAt(): Date | null {
    return this.props.clockOutAt;
  }
  get timezone(): string {
    return this.props.timezone;
  }
  get workDate(): string {
    return this.props.workDate;
  }
  get source(): TimeEntrySource {
    return this.props.source;
  }
  get closeSource(): TimeEntryCloseSource | null {
    return this.props.closeSource;
  }
  get dailyLimitWaived(): boolean {
    return this.props.dailyLimitWaived;
  }
  get createdReason(): string | null {
    return this.props.createdReason;
  }
  get clockInLocation(): ClockLocation | null {
    return this.props.clockInLocation;
  }
  get clockInZone(): ClockZone | null {
    return this.props.clockInZone;
  }
  get isOpen(): boolean {
    return this.props.clockOutAt === null;
  }

  snapshot(): TimeEntryProps {
    return { ...this.props };
  }

  close(at: Date, closeSource: TimeEntryCloseSource = 'employee'): void {
    if (!this.isOpen) {
      throw new ConflictError('NOT_CLOCKED_IN', 'No tienes una entrada abierta');
    }
    if (at < this.props.clockInAt) {
      throw new ValidationError(
        'INVALID_TIME_RANGE',
        'La salida no puede ser anterior a la entrada',
      );
    }
    this.props = { ...this.props, clockOutAt: at, closeSource };
  }

  correct(
    changes: { clockInAt?: Date | undefined; clockOutAt?: Date | undefined },
    now: Date,
  ): TimeRange {
    const previous: TimeRange = { clockInAt: this.clockInAt, clockOutAt: this.clockOutAt };
    const clockInAt = changes.clockInAt ?? this.clockInAt;
    const clockOutAt = changes.clockOutAt ?? this.clockOutAt;

    if (clockInAt > now || (clockOutAt !== null && clockOutAt > now)) {
      throw new ValidationError('TIME_IN_FUTURE', 'No se pueden registrar horas en el futuro');
    }
    if (clockOutAt !== null && clockOutAt < clockInAt) {
      throw new ValidationError(
        'INVALID_TIME_RANGE',
        'La salida no puede ser anterior a la entrada',
      );
    }
    if (
      clockInAt.getTime() === previous.clockInAt.getTime() &&
      clockOutAt?.getTime() === previous.clockOutAt?.getTime()
    ) {
      throw new ValidationError('NO_CHANGES', 'La corrección no cambia ningún valor');
    }

    this.props = {
      ...this.props,
      clockInAt,
      clockOutAt,
      workDate: localDateOf(clockInAt, this.props.timezone),
    };
    return previous;
  }

  durationSeconds(): number | null {
    return this.props.clockOutAt
      ? durationSeconds(this.props.clockInAt, this.props.clockOutAt)
      : null;
  }
}
