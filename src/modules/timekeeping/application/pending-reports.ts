import { localDateOf } from '#shared/domain/timezone.js';
import { pendingReportRange, REPORT_BACKFILL_DAYS } from '../domain/daily-report.js';
import { addDays } from '../domain/pay-period.js';
import type { DailyReportRepository } from './ports/daily-report.repository.js';
import type { EmployeeProfile, RosterEmployee } from './ports/employee-directory.js';

interface Deps {
  dailyReportRepository: DailyReportRepository;
}

export async function pendingDaysOf(
  deps: Deps,
  profile: EmployeeProfile,
  now: Date,
): Promise<string[]> {
  if (!profile.requireDailyReport) return [];
  const range = pendingReportRange(
    localDateOf(now, profile.effectiveTimezone),
    profile.dailyReportRequiredSince,
  );
  if (!range) return [];
  const rows = await deps.dailyReportRepository.findDaysWithoutReport(
    profile.companyId,
    range,
    profile.employeeId,
  );
  return rows.map((row) => row.workDate);
}

export async function pendingDaysByEmployee(
  deps: Deps,
  companyId: string,
  employees: readonly RosterEmployee[],
  requiredSince: string,
  now: Date,
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  const utcToday = now.toISOString().slice(0, 10);
  const oldest = addDays(utcToday, -(REPORT_BACKFILL_DAYS + 2));
  const rows = await deps.dailyReportRepository.findDaysWithoutReport(companyId, {
    from: requiredSince > oldest ? requiredSince : oldest,
    to: utcToday,
  });

  const days = new Map<string, string[]>();
  for (const row of rows)
    days.set(row.employeeId, [...(days.get(row.employeeId) ?? []), row.workDate]);

  for (const employee of employees) {
    const range = pendingReportRange(localDateOf(now, employee.effectiveTimezone), requiredSince);
    if (!range) continue;
    const pending = (days.get(employee.employeeId) ?? []).filter(
      (day) => day >= range.from && day <= range.to,
    );
    if (pending.length > 0) result.set(employee.employeeId, pending);
  }
  return result;
}
