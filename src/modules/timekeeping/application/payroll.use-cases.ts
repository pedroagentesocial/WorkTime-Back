import type { UseCase } from '#shared/application/use-case.js';
import type { CompanyRef } from '../domain/portfolio-timesheet.js';
import {
  pageOf,
  timesheetOf,
  type CompanyTimesheetInput,
  type CompanyTimesheetPageInput,
  type CompanyTimesheetPayRow,
  type CompanyTimesheetResult,
  type Deps as CompanyDeps,
} from './company-timesheet.use-cases.js';
import {
  portfolioTimesheetOf,
  type PortfolioTimesheetInput,
  type PortfolioTimesheetPageInput,
  type PortfolioTimesheetPayRow,
  type PortfolioTimesheetResult,
  type Deps as PortfolioDeps,
} from './portfolio-timesheet.use-cases.js';

// La nomina es la hoja del periodo con el pago de cada empleado; la ruta exige pay.manage

export interface PayBreakdown {
  readonly totalCents: number;
  // Por el tipo de pago que tenia cada empleado en su ultimo dia del periodo
  readonly hourlyCents: number;
  readonly salaryCents: number;
}

const isMissing = (row: CompanyTimesheetPayRow) => row.pay !== null && row.pay.amountCents === null;

function breakdownOf(rows: readonly CompanyTimesheetPayRow[]): PayBreakdown {
  let hourlyCents = 0;
  let salaryCents = 0;
  for (const { pay } of rows) {
    if (pay?.amountCents == null) continue;
    if (pay.rate?.kind === 'salary') salaryCents += pay.amountCents;
    else hourlyCents += pay.amountCents;
  }
  return { totalCents: hourlyCents + salaryCents, hourlyCents, salaryCents };
}

export interface CompanyPayroll extends CompanyTimesheetResult {
  // La tabla solo lleva a quien tiene monto; los demas van en missingPay
  readonly missingPay: CompanyTimesheetPayRow['employee'][];
  readonly breakdown: PayBreakdown | null;
  readonly employeeCount: number;
}

function companyPayrollOf(sheet: CompanyTimesheetResult): CompanyPayroll {
  return {
    ...sheet,
    rows: sheet.rows.filter((row) => !isMissing(row)),
    missingPay: sheet.rows.filter(isMissing).map((row) => row.employee),
    breakdown: sheet.pay ? breakdownOf(sheet.rows) : null,
    employeeCount: sheet.rows.length,
  };
}

export interface CurrencyBreakdown extends PayBreakdown {
  readonly currency: string;
}

export interface PortfolioPayroll extends PortfolioTimesheetResult {
  readonly missingPay: {
    readonly company: CompanyRef;
    readonly employee: CompanyTimesheetPayRow['employee'];
  }[];
  // Un desglose por moneda: los montos de monedas distintas nunca se suman
  readonly breakdowns: CurrencyBreakdown[];
  readonly employeeCount: number;
}

function portfolioPayrollOf(sheet: PortfolioTimesheetResult): PortfolioPayroll {
  const byCurrency = new Map<string, PortfolioTimesheetPayRow[]>();
  for (const row of sheet.rows) {
    if (!row.currency || row.pay?.amountCents == null) continue;
    byCurrency.set(row.currency, [...(byCurrency.get(row.currency) ?? []), row]);
  }
  return {
    ...sheet,
    rows: sheet.rows.filter((row) => !isMissing(row)),
    missingPay: sheet.rows
      .filter(isMissing)
      .map(({ company, employee }) => ({ company, employee })),
    breakdowns: [...byCurrency]
      .map(([currency, rows]) => ({ currency, ...breakdownOf(rows) }))
      .sort((a, b) => a.currency.localeCompare(b.currency)),
    employeeCount: sheet.rows.length,
  };
}

export class GetCompanyPayrollUseCase implements UseCase<
  CompanyTimesheetPageInput,
  CompanyPayroll & { readonly page: number; readonly limit: number; readonly total: number }
> {
  constructor(private readonly deps: CompanyDeps) {}

  async execute(input: CompanyTimesheetPageInput) {
    return pageOf(companyPayrollOf(await timesheetOf(this.deps, input, true)), input.page);
  }
}

// El CSV lleva a todos, tambien a quien no tiene sueldo
export class ExportCompanyPayrollUseCase implements UseCase<
  CompanyTimesheetInput,
  CompanyTimesheetResult
> {
  constructor(private readonly deps: CompanyDeps) {}

  execute(input: CompanyTimesheetInput): Promise<CompanyTimesheetResult> {
    return timesheetOf(this.deps, input, true);
  }
}

export class GetPortfolioPayrollUseCase implements UseCase<
  PortfolioTimesheetPageInput,
  PortfolioPayroll & { readonly page: number; readonly limit: number; readonly total: number }
> {
  constructor(private readonly deps: PortfolioDeps) {}

  async execute(input: PortfolioTimesheetPageInput) {
    return pageOf(
      portfolioPayrollOf(await portfolioTimesheetOf(this.deps, input, true)),
      input.page,
    );
  }
}

export class ExportPortfolioPayrollUseCase implements UseCase<
  PortfolioTimesheetInput,
  PortfolioTimesheetResult
> {
  constructor(private readonly deps: PortfolioDeps) {}

  execute(input: PortfolioTimesheetInput): Promise<PortfolioTimesheetResult> {
    return portfolioTimesheetOf(this.deps, input, true);
  }
}
