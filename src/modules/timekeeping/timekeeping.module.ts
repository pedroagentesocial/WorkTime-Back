import { asClass } from 'awilix';
import { JOBS } from '#config/jobs.js';
import type { AppModule } from '#shared/composition/app-module.js';
import { WorkforceEvents, type EmployeeDeactivated } from '#modules/workforce/domain/events.js';
import {
  ClockInUseCase,
  ClockOutUseCase,
  GetClockStatusUseCase,
} from './application/clock.use-cases.js';
import { CloseEntryOnDeactivationUseCase } from './application/close-entry-on-deactivation.use-case.js';
import { AdminClockInUseCase, AdminClockOutUseCase } from './application/admin-clock.use-cases.js';
import {
  ExportCompanyDailyReportsUseCase,
  ListCompanyDailyReportsUseCase,
  ListDailyReportRevisionsUseCase,
  ListMyDailyReportsUseCase,
  SaveMyDailyReportUseCase,
} from './application/daily-report.use-cases.js';
import type { DailyReportRepository } from './application/ports/daily-report.repository.js';
import { PrismaDailyReportRepository } from './infrastructure/prisma-daily-report.repository.js';
import { GetAttendanceRosterUseCase } from './application/attendance-roster.use-case.js';
import { CloseEntriesOfInactiveEmployeesUseCase } from './application/close-entries-of-inactive-employees.use-case.js';
import { CloseEntriesOverLimitUseCase } from './application/close-entries-over-limit.use-case.js';
import { GetAttendanceSummaryUseCase } from './application/attendance-summary.use-case.js';
import {
  ListCompanyPendingReportsUseCase,
  ListMyPendingReportsUseCase,
} from './application/pending-reports.use-cases.js';
import { CorrectTimeEntryUseCase } from './application/correct-time-entry.use-case.js';
import { CorrectOwnTimeEntryUseCase } from './application/self-correction.use-case.js';
import { ListAttendanceActivityUseCase } from './application/attendance-activity.use-case.js';
import type { AttendanceActivityReader } from './application/ports/attendance-activity.reader.js';
import { PrismaAttendanceActivityReader } from './infrastructure/prisma-attendance-activity.reader.js';
import {
  ClosePayPeriodUseCase,
  GetPayPeriodStatusUseCase,
} from './application/pay-period.use-cases.js';
import type { PeriodClosureRepository } from './application/ports/period-closure.repository.js';
import { PrismaPeriodClosureRepository } from './infrastructure/prisma-period-closure.repository.js';
import { VoidTimeEntryUseCase } from './application/void-time-entry.use-case.js';
import { CreateManualTimeEntryUseCase } from './application/create-manual-time-entry.use-case.js';
import {
  ExportCompanyTimesheetUseCase,
  GetCompanyTimesheetUseCase,
} from './application/company-timesheet.use-cases.js';
import type { EmployeeDirectory } from './application/ports/employee-directory.js';
import type { TimeEntryRepository } from './application/ports/time-entry.repository.js';
import {
  GetLiveAttendanceUseCase,
  GetTimeEntryUseCase,
  ListCompanyTimeEntriesUseCase,
  ListMyTimeEntriesUseCase,
  ListTimeEntryCorrectionsUseCase,
} from './application/query-time-entries.use-cases.js';
import {
  GetEmployeeTimesheetUseCase,
  GetMyTimesheetUseCase,
} from './application/timesheet.use-cases.js';
import { PrismaEmployeeDirectory } from './infrastructure/prisma-employee-directory.js';
import { PrismaTimeEntryRepository } from './infrastructure/prisma-time-entry.repository.js';
import { PrismaWorkSiteReader } from './infrastructure/prisma-work-site.reader.js';
import type { WorkSiteReader } from './application/ports/work-site.reader.js';
import {
  GetAttendanceMapUseCase,
  GetPortfolioAttendanceMapUseCase,
} from './application/attendance-map.use-cases.js';
import type { AttendanceMapReader } from './application/ports/attendance-map.reader.js';
import { PrismaAttendanceMapReader } from './infrastructure/prisma-attendance-map.reader.js';
import { timekeepingRoutes } from './presentation/timekeeping.routes.js';
import {
  CreateCheckInUseCase,
  ListCompanyCheckInsUseCase,
  ListMyCheckInsUseCase,
  VoidCheckInUseCase,
} from './application/check-in.use-cases.js';
import type { CheckInRepository } from './application/ports/check-in.repository.js';
import { PrismaCheckInRepository } from './infrastructure/prisma-check-in.repository.js';
import { checkInRoutes } from './presentation/check-in.routes.js';
import {
  ExportPortfolioDailyReportsUseCase,
  ListPortfolioDailyReportsUseCase,
} from './application/portfolio-daily-reports.use-cases.js';
import { GetPortfolioLiveUseCase } from './application/portfolio-live.use-case.js';
import { GetPortfolioSummaryUseCase } from './application/portfolio-summary.use-case.js';
import {
  ExportPortfolioTimesheetUseCase,
  GetPortfolioTimesheetUseCase,
} from './application/portfolio-timesheet.use-cases.js';
import type { PortfolioDailyReportReader } from './application/ports/portfolio-daily-report.reader.js';
import { PrismaPortfolioDailyReportReader } from './infrastructure/prisma-portfolio-daily-report.reader.js';
import { portfolioRoutes } from './presentation/portfolio.routes.js';
import { payrollRoutes } from './presentation/payroll.routes.js';
import {
  ExportCompanyPayrollUseCase,
  ExportPortfolioPayrollUseCase,
  GetCompanyPayrollUseCase,
  GetPortfolioPayrollUseCase,
} from './application/payroll.use-cases.js';

import type { PayRateReader } from './application/ports/pay-rate.reader.js';
import { PrismaPayRateReader } from './infrastructure/prisma-pay-rate.reader.js';

declare module '#shared/composition/container.js' {
  interface Cradle {
    timeEntryRepository: TimeEntryRepository;
    workSiteReader: WorkSiteReader;
    dailyReportRepository: DailyReportRepository;
    saveMyDailyReport: SaveMyDailyReportUseCase;
    listMyDailyReports: ListMyDailyReportsUseCase;
    listCompanyDailyReports: ListCompanyDailyReportsUseCase;
    exportCompanyDailyReports: ExportCompanyDailyReportsUseCase;
    listDailyReportRevisions: ListDailyReportRevisionsUseCase;
    employeeDirectory: EmployeeDirectory;
    clockIn: ClockInUseCase;
    clockOut: ClockOutUseCase;
    getClockStatus: GetClockStatusUseCase;
    listMyTimeEntries: ListMyTimeEntriesUseCase;
    listCompanyTimeEntries: ListCompanyTimeEntriesUseCase;
    getTimeEntry: GetTimeEntryUseCase;
    listTimeEntryCorrections: ListTimeEntryCorrectionsUseCase;
    getLiveAttendance: GetLiveAttendanceUseCase;
    correctTimeEntry: CorrectTimeEntryUseCase;
    correctOwnTimeEntry: CorrectOwnTimeEntryUseCase;
    closeEntryOnDeactivation: CloseEntryOnDeactivationUseCase;
    closeEntriesOverLimit: CloseEntriesOverLimitUseCase;
    closeEntriesOfInactiveEmployees: CloseEntriesOfInactiveEmployeesUseCase;
    adminClockIn: AdminClockInUseCase;
    getAttendanceRoster: GetAttendanceRosterUseCase;
    adminClockOut: AdminClockOutUseCase;
    getMyTimesheet: GetMyTimesheetUseCase;
    getEmployeeTimesheet: GetEmployeeTimesheetUseCase;
    createManualTimeEntry: CreateManualTimeEntryUseCase;
    voidTimeEntry: VoidTimeEntryUseCase;
    periodClosureRepository: PeriodClosureRepository;
    payRateReader: PayRateReader;
    getPayPeriodStatus: GetPayPeriodStatusUseCase;
    closePayPeriod: ClosePayPeriodUseCase;
    attendanceActivityReader: AttendanceActivityReader;
    listAttendanceActivity: ListAttendanceActivityUseCase;
    getAttendanceSummary: GetAttendanceSummaryUseCase;
    listMyPendingReports: ListMyPendingReportsUseCase;
    listCompanyPendingReports: ListCompanyPendingReportsUseCase;
    getCompanyTimesheet: GetCompanyTimesheetUseCase;
    exportCompanyTimesheet: ExportCompanyTimesheetUseCase;
    portfolioDailyReportReader: PortfolioDailyReportReader;
    getPortfolioSummary: GetPortfolioSummaryUseCase;
    getPortfolioLive: GetPortfolioLiveUseCase;
    attendanceMapReader: AttendanceMapReader;
    getAttendanceMap: GetAttendanceMapUseCase;
    getPortfolioAttendanceMap: GetPortfolioAttendanceMapUseCase;
    getPortfolioTimesheet: GetPortfolioTimesheetUseCase;
    exportPortfolioTimesheet: ExportPortfolioTimesheetUseCase;
    getCompanyPayroll: GetCompanyPayrollUseCase;
    exportCompanyPayroll: ExportCompanyPayrollUseCase;
    getPortfolioPayroll: GetPortfolioPayrollUseCase;
    exportPortfolioPayroll: ExportPortfolioPayrollUseCase;
    listPortfolioDailyReports: ListPortfolioDailyReportsUseCase;
    exportPortfolioDailyReports: ExportPortfolioDailyReportsUseCase;
    checkInRepository: CheckInRepository;
    createCheckIn: CreateCheckInUseCase;
    listMyCheckIns: ListMyCheckInsUseCase;
    listCompanyCheckIns: ListCompanyCheckInsUseCase;
    voidCheckIn: VoidCheckInUseCase;
  }
}

export const timekeepingModule: AppModule = {
  name: 'timekeeping',

  register(container) {
    container.register({
      timeEntryRepository: asClass(PrismaTimeEntryRepository).singleton(),
      workSiteReader: asClass(PrismaWorkSiteReader).singleton(),
      dailyReportRepository: asClass(PrismaDailyReportRepository).singleton(),
      saveMyDailyReport: asClass(SaveMyDailyReportUseCase).singleton(),
      listMyDailyReports: asClass(ListMyDailyReportsUseCase).singleton(),
      listCompanyDailyReports: asClass(ListCompanyDailyReportsUseCase).singleton(),
      exportCompanyDailyReports: asClass(ExportCompanyDailyReportsUseCase).singleton(),
      listDailyReportRevisions: asClass(ListDailyReportRevisionsUseCase).singleton(),
      employeeDirectory: asClass(PrismaEmployeeDirectory).singleton(),
      clockIn: asClass(ClockInUseCase).singleton(),
      clockOut: asClass(ClockOutUseCase).singleton(),
      getClockStatus: asClass(GetClockStatusUseCase).singleton(),
      listMyTimeEntries: asClass(ListMyTimeEntriesUseCase).singleton(),
      listCompanyTimeEntries: asClass(ListCompanyTimeEntriesUseCase).singleton(),
      getTimeEntry: asClass(GetTimeEntryUseCase).singleton(),
      listTimeEntryCorrections: asClass(ListTimeEntryCorrectionsUseCase).singleton(),
      getLiveAttendance: asClass(GetLiveAttendanceUseCase).singleton(),
      correctTimeEntry: asClass(CorrectTimeEntryUseCase).singleton(),
      correctOwnTimeEntry: asClass(CorrectOwnTimeEntryUseCase).singleton(),
      closeEntryOnDeactivation: asClass(CloseEntryOnDeactivationUseCase).singleton(),
      closeEntriesOverLimit: asClass(CloseEntriesOverLimitUseCase).singleton(),
      closeEntriesOfInactiveEmployees: asClass(CloseEntriesOfInactiveEmployeesUseCase).singleton(),
      adminClockIn: asClass(AdminClockInUseCase).singleton(),
      getAttendanceRoster: asClass(GetAttendanceRosterUseCase).singleton(),
      adminClockOut: asClass(AdminClockOutUseCase).singleton(),
      getMyTimesheet: asClass(GetMyTimesheetUseCase).singleton(),
      getEmployeeTimesheet: asClass(GetEmployeeTimesheetUseCase).singleton(),
      createManualTimeEntry: asClass(CreateManualTimeEntryUseCase).singleton(),
      voidTimeEntry: asClass(VoidTimeEntryUseCase).singleton(),
      periodClosureRepository: asClass(PrismaPeriodClosureRepository).singleton(),
      payRateReader: asClass(PrismaPayRateReader).singleton(),
      getPayPeriodStatus: asClass(GetPayPeriodStatusUseCase).singleton(),
      closePayPeriod: asClass(ClosePayPeriodUseCase).singleton(),
      attendanceActivityReader: asClass(PrismaAttendanceActivityReader).singleton(),
      listAttendanceActivity: asClass(ListAttendanceActivityUseCase).singleton(),
      getAttendanceSummary: asClass(GetAttendanceSummaryUseCase).singleton(),
      listMyPendingReports: asClass(ListMyPendingReportsUseCase).singleton(),
      listCompanyPendingReports: asClass(ListCompanyPendingReportsUseCase).singleton(),
      getCompanyTimesheet: asClass(GetCompanyTimesheetUseCase).singleton(),
      exportCompanyTimesheet: asClass(ExportCompanyTimesheetUseCase).singleton(),
      portfolioDailyReportReader: asClass(PrismaPortfolioDailyReportReader).singleton(),
      getPortfolioSummary: asClass(GetPortfolioSummaryUseCase).singleton(),
      getPortfolioLive: asClass(GetPortfolioLiveUseCase).singleton(),
      attendanceMapReader: asClass(PrismaAttendanceMapReader).singleton(),
      getAttendanceMap: asClass(GetAttendanceMapUseCase).singleton(),
      getPortfolioAttendanceMap: asClass(GetPortfolioAttendanceMapUseCase).singleton(),
      getPortfolioTimesheet: asClass(GetPortfolioTimesheetUseCase).singleton(),
      exportPortfolioTimesheet: asClass(ExportPortfolioTimesheetUseCase).singleton(),
      getCompanyPayroll: asClass(GetCompanyPayrollUseCase).singleton(),
      exportCompanyPayroll: asClass(ExportCompanyPayrollUseCase).singleton(),
      getPortfolioPayroll: asClass(GetPortfolioPayrollUseCase).singleton(),
      exportPortfolioPayroll: asClass(ExportPortfolioPayrollUseCase).singleton(),
      listPortfolioDailyReports: asClass(ListPortfolioDailyReportsUseCase).singleton(),
      exportPortfolioDailyReports: asClass(ExportPortfolioDailyReportsUseCase).singleton(),
      checkInRepository: asClass(PrismaCheckInRepository).singleton(),
      createCheckIn: asClass(CreateCheckInUseCase).singleton(),
      listMyCheckIns: asClass(ListMyCheckInsUseCase).singleton(),
      listCompanyCheckIns: asClass(ListCompanyCheckInsUseCase).singleton(),
      voidCheckIn: asClass(VoidCheckInUseCase).singleton(),
    });
  },

  subscribe(container) {
    const { eventBus, closeEntryOnDeactivation } = container.cradle;
    eventBus.subscribe<EmployeeDeactivated>(WorkforceEvents.EMPLOYEE_DEACTIVATED, (event) =>
      closeEntryOnDeactivation.execute({ ...event.payload, at: event.occurredAt }),
    );
  },

  jobs: (container) => [
    {
      name: 'close-entries-over-limit',
      intervalMs: JOBS.closeEntriesOverLimitMs,
      run: () => container.cradle.closeEntriesOverLimit.execute(),
    },
    {
      name: 'close-entries-of-inactive-employees',
      intervalMs: JOBS.closeEntriesOfInactiveEmployeesMs,
      run: () => container.cradle.closeEntriesOfInactiveEmployees.execute(),
    },
  ],

  routes: (container) => [
    ...timekeepingRoutes(container.cradle),
    ...portfolioRoutes(container.cradle),
    ...payrollRoutes(container.cradle),
    ...checkInRoutes(container.cradle),
  ],
};
