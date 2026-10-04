import type { IdGenerator } from '#shared/application/ports/id-generator.js';
import { localDateOf } from '#shared/domain/timezone.js';
import { DailyReportRules } from '../domain/daily-report.js';
import type { DailyReportRepository } from './ports/daily-report.repository.js';
import type { EmployeeProfile } from './ports/employee-directory.js';
import type { TimeEntryRepository } from './ports/time-entry.repository.js';

export interface DailyReportWriterDeps {
  timeEntryRepository: TimeEntryRepository;
  dailyReportRepository: DailyReportRepository;
  idGenerator: IdGenerator;
}

// Debe correr dentro de una transaccion: bloquea al empleado para que dos escrituras no se pisen
export async function saveDailyReport(
  deps: DailyReportWriterDeps,
  profile: EmployeeProfile,
  workDate: string,
  rawContent: string,
  now: Date,
): Promise<void> {
  const content = DailyReportRules.normalize(rawContent);
  const { timeEntryRepository: entries, dailyReportRepository: reports } = deps;

  await entries.lockEmployee(profile.companyId, profile.employeeId);
  const existing = await reports.find(profile.employeeId, workDate);
  const open = await entries.findOpenByEmployee(profile.employeeId);

  DailyReportRules.assertCanWrite({
    workDate,
    todayLocal: localDateOf(now, profile.effectiveTimezone),
    reportExists: existing !== null,
    hasOpenEntryOnDate: open?.workDate === workDate,
    hasEntriesOnDate: await entries.hasEntriesOn(profile.employeeId, workDate),
  });

  await reports.save(
    {
      id: deps.idGenerator.generate(),
      companyId: profile.companyId,
      employeeId: profile.employeeId,
      workDate,
      content,
    },
    existing,
  );
}
