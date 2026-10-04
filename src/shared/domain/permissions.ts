// Las rutas preguntan por permisos, nunca por roles: un rol nuevo no toca las rutas
export const Role = {
  PLATFORM_ADMIN: 'platform_admin',
  COMPANY_ADMIN: 'company_admin',
  EMPLOYEE: 'employee',
} as const;

export type Role = (typeof Role)[keyof typeof Role];

export const Permission = {
  COMPANIES_MANAGE: 'companies.manage',

  COMPANY_SETTINGS_MANAGE: 'company.settings.manage',
  EMPLOYEES_MANAGE: 'employees.manage',
  ATTENDANCE_READ_ALL: 'attendance.read_all',
  TIME_ENTRIES_CORRECT: 'time_entries.correct',
  ATTENDANCE_CLOCK_EMPLOYEES: 'attendance.clock_employees',
  PERIODS_MANAGE: 'periods.manage',

  ATTENDANCE_CLOCK_OWN: 'attendance.clock_own',
  ATTENDANCE_READ_OWN: 'attendance.read_own',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  [Role.PLATFORM_ADMIN]: new Set([Permission.COMPANIES_MANAGE]),
  [Role.COMPANY_ADMIN]: new Set([
    Permission.COMPANY_SETTINGS_MANAGE,
    Permission.EMPLOYEES_MANAGE,
    Permission.ATTENDANCE_READ_ALL,
    Permission.TIME_ENTRIES_CORRECT,
    Permission.ATTENDANCE_CLOCK_EMPLOYEES,
    Permission.PERIODS_MANAGE,
  ]),
  [Role.EMPLOYEE]: new Set([Permission.ATTENDANCE_CLOCK_OWN, Permission.ATTENDANCE_READ_OWN]),
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export function isPermission(value: string): value is Permission {
  return (Object.values(Permission) as string[]).includes(value);
}

export function permissionsOf(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}
