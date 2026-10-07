import type { ClientInfo } from '../client-info.js';

export const SecurityEventType = {
  USER_SEEDED: 'user.seeded',
  LOGIN_SUCCEEDED: 'login.succeeded',
  LOGIN_FAILED: 'login.failed',
  LOGIN_BLOCKED: 'login.blocked',
  ACCOUNT_LOCKED: 'account.locked',
  REFRESH_REUSE_DETECTED: 'refresh.reuse_detected',
  LOGOUT: 'logout',
  ACTIVE_COMPANY_CHANGED: 'session.active_company_changed',
  PASSWORD_CHANGED: 'password.changed',
  PROFILE_UPDATED: 'profile.updated',
  SESSIONS_REVOKED: 'sessions.revoked',
  EMPLOYEE_SESSIONS_REVOKED: 'employee.sessions_revoked',
  PASSWORD_CHANGE_FAILED: 'password.change_failed',
  TEMPORARY_PASSWORD_ISSUED: 'password.temporary_issued',
  COMPANY_CREATED: 'company.created',
  COMPANY_UPDATED: 'company.updated',
  COMPANY_SUSPENDED: 'company.suspended',
  COMPANY_REACTIVATED: 'company.reactivated',
  COMPANY_SETTINGS_UPDATED: 'company.settings_updated',
  MULTI_ADMIN_CREATED: 'multi_admin.created',
  MULTI_ADMIN_UPDATED: 'multi_admin.updated',
  MULTI_ADMIN_DEACTIVATED: 'multi_admin.deactivated',
  MULTI_ADMIN_REACTIVATED: 'multi_admin.reactivated',
  MULTI_ADMIN_COMPANY_ASSIGNED: 'multi_admin.company_assigned',
  MULTI_ADMIN_COMPANY_REMOVED: 'multi_admin.company_removed',
  EMPLOYEE_CREATED: 'employee.created',
  EMPLOYEE_UPDATED: 'employee.updated',
  EMPLOYEE_DEACTIVATED: 'employee.deactivated',
  EMPLOYEE_REACTIVATED: 'employee.reactivated',
  EMPLOYEE_DELETED: 'employee.deleted',
  TIME_ENTRY_CLOCKED_IN_BY_ADMIN: 'time_entry.clocked_in_by_admin',
  TIME_ENTRY_CLOCKED_OUT_BY_ADMIN: 'time_entry.clocked_out_by_admin',
  TIME_ENTRY_CREATED_BY_ADMIN: 'time_entry.created_by_admin',
  TIME_ENTRY_VOIDED_BY_ADMIN: 'time_entry.voided_by_admin',
  PAY_PERIOD_CLOSED: 'pay_period.closed',
  TIME_ENTRY_CORRECTED_BY_ADMIN: 'time_entry.corrected_by_admin',
} as const;

export type SecurityEventType = (typeof SecurityEventType)[keyof typeof SecurityEventType];

export interface SecurityEventInput {
  readonly type: SecurityEventType;
  readonly userId?: string | null;
  readonly companyId?: string | null;
  readonly client?: ClientInfo;
  readonly metadata?: Record<string, unknown>;
}

export interface SecurityEventRecorder {
  // Mejor esfuerzo: un fallo no debe tumbar un login ni otras acciones del propio usuario
  record(event: SecurityEventInput): Promise<void>;
  // Para acciones sensibles dentro de una transaccion: si no se puede auditar, no se hace
  recordOrThrow(event: SecurityEventInput): Promise<void>;
}
