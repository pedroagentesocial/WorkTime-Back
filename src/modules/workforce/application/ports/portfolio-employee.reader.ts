import type { Page, PageRequest } from '#shared/application/pagination.js';
import type { EmployeeListFilter, EmployeeView } from './employee.repository.js';

export interface PortfolioEmployeeView extends EmployeeView {
  readonly company: { readonly id: string; readonly name: string; readonly code: string };
}

// Lectura de empleados de varias empresas a la vez; quien llama decide las empresas, nunca el cliente
export interface PortfolioEmployeeReader {
  list(
    companyIds: readonly string[],
    filter: EmployeeListFilter,
    page: PageRequest,
  ): Promise<Page<PortfolioEmployeeView>>;
}
