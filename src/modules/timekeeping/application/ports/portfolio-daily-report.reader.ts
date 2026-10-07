import type { Page, PageRequest } from '#shared/application/pagination.js';
import type { CompanyRef } from '../../domain/portfolio-timesheet.js';
import type { WorkDateRange } from '../../domain/work-date-range.js';
import type { DailyReportView } from './daily-report.repository.js';

export interface PortfolioDailyReportView extends DailyReportView {
  readonly company: CompanyRef;
}

// Lectura de reportes de varias empresas a la vez; quien llama decide las empresas, nunca el cliente
export interface PortfolioDailyReportReader {
  list(
    companyIds: readonly string[],
    filter: WorkDateRange,
    page: PageRequest,
  ): Promise<Page<PortfolioDailyReportView>>;
}
