import { asClass } from 'awilix';
import type { AppModule } from '#shared/composition/app-module.js';
import { ChangeEmployeeStatusUseCase } from './application/change-employee-status.use-case.js';
import {
  GetCompanySettingsUseCase,
  UpdateCompanySettingsUseCase,
} from './application/company-settings.use-cases.js';
import { CreateEmployeeUseCase } from './application/create-employee.use-case.js';
import type { CompanySettingsRepository } from './application/ports/company-settings.repository.js';
import type { EmployeeRepository } from './application/ports/employee.repository.js';
import {
  GetEmployeeUseCase,
  ListEmployeesUseCase,
} from './application/query-employees.use-cases.js';
import { DeleteEmployeeUseCase } from './application/delete-employee.use-case.js';
import {
  ListEmployeePayRatesUseCase,
  RemoveEmployeePayRateUseCase,
  SetEmployeePayRateUseCase,
} from './application/pay-rate.use-cases.js';
import type { PayRateRepository } from './application/ports/pay-rate.repository.js';
import type { InactiveSpanRepository } from './application/ports/inactive-span.repository.js';
import { PrismaInactiveSpanRepository } from './infrastructure/prisma-inactive-span.repository.js';
import { PrismaPayRateRepository } from './infrastructure/prisma-pay-rate.repository.js';
import { RevokeEmployeeSessionsUseCase } from './application/revoke-employee-sessions.use-case.js';
import { ResetEmployeePasswordUseCase } from './application/reset-employee-password.use-case.js';
import { UpdateEmployeeUseCase } from './application/update-employee.use-case.js';
import {
  CreateWorkSiteUseCase,
  ListWorkSitesUseCase,
  UpdateWorkSiteUseCase,
} from './application/work-site.use-cases.js';
import type { WorkSiteRepository } from './application/ports/work-site.repository.js';
import { PrismaWorkSiteRepository } from './infrastructure/prisma-work-site.repository.js';
import { PrismaCompanySettingsRepository } from './infrastructure/prisma-company-settings.repository.js';
import { PrismaEmployeeRepository } from './infrastructure/prisma-employee.repository.js';
import { workforceRoutes } from './presentation/workforce.routes.js';
import { ListPortfolioEmployeesUseCase } from './application/list-portfolio-employees.use-case.js';
import type { PortfolioEmployeeReader } from './application/ports/portfolio-employee.reader.js';
import { PrismaPortfolioEmployeeReader } from './infrastructure/prisma-portfolio-employee.reader.js';
import { portfolioEmployeeRoutes } from './presentation/portfolio.routes.js';

declare module '#shared/composition/container.js' {
  interface Cradle {
    employeeRepository: EmployeeRepository;
    companySettingsRepository: CompanySettingsRepository;
    workSiteRepository: WorkSiteRepository;
    listWorkSites: ListWorkSitesUseCase;
    createWorkSite: CreateWorkSiteUseCase;
    updateWorkSite: UpdateWorkSiteUseCase;
    getCompanySettings: GetCompanySettingsUseCase;
    updateCompanySettings: UpdateCompanySettingsUseCase;
    createEmployee: CreateEmployeeUseCase;
    listEmployees: ListEmployeesUseCase;
    getEmployee: GetEmployeeUseCase;
    updateEmployee: UpdateEmployeeUseCase;
    changeEmployeeStatus: ChangeEmployeeStatusUseCase;
    resetEmployeePassword: ResetEmployeePasswordUseCase;
    revokeEmployeeSessions: RevokeEmployeeSessionsUseCase;
    deleteEmployee: DeleteEmployeeUseCase;
    payRateRepository: PayRateRepository;
    inactiveSpanRepository: InactiveSpanRepository;
    listEmployeePayRates: ListEmployeePayRatesUseCase;
    setEmployeePayRate: SetEmployeePayRateUseCase;
    removeEmployeePayRate: RemoveEmployeePayRateUseCase;
    portfolioEmployeeReader: PortfolioEmployeeReader;
    listPortfolioEmployees: ListPortfolioEmployeesUseCase;
  }
}

export const workforceModule: AppModule = {
  name: 'workforce',

  register(container) {
    container.register({
      employeeRepository: asClass(PrismaEmployeeRepository).singleton(),
      companySettingsRepository: asClass(PrismaCompanySettingsRepository).singleton(),
      workSiteRepository: asClass(PrismaWorkSiteRepository).singleton(),
      listWorkSites: asClass(ListWorkSitesUseCase).singleton(),
      createWorkSite: asClass(CreateWorkSiteUseCase).singleton(),
      updateWorkSite: asClass(UpdateWorkSiteUseCase).singleton(),
      getCompanySettings: asClass(GetCompanySettingsUseCase).singleton(),
      updateCompanySettings: asClass(UpdateCompanySettingsUseCase).singleton(),
      createEmployee: asClass(CreateEmployeeUseCase).singleton(),
      listEmployees: asClass(ListEmployeesUseCase).singleton(),
      getEmployee: asClass(GetEmployeeUseCase).singleton(),
      updateEmployee: asClass(UpdateEmployeeUseCase).singleton(),
      changeEmployeeStatus: asClass(ChangeEmployeeStatusUseCase).singleton(),
      resetEmployeePassword: asClass(ResetEmployeePasswordUseCase).singleton(),
      revokeEmployeeSessions: asClass(RevokeEmployeeSessionsUseCase).singleton(),
      deleteEmployee: asClass(DeleteEmployeeUseCase).singleton(),
      payRateRepository: asClass(PrismaPayRateRepository).singleton(),
      inactiveSpanRepository: asClass(PrismaInactiveSpanRepository).singleton(),
      listEmployeePayRates: asClass(ListEmployeePayRatesUseCase).singleton(),
      setEmployeePayRate: asClass(SetEmployeePayRateUseCase).singleton(),
      removeEmployeePayRate: asClass(RemoveEmployeePayRateUseCase).singleton(),
      portfolioEmployeeReader: asClass(PrismaPortfolioEmployeeReader).singleton(),
      listPortfolioEmployees: asClass(ListPortfolioEmployeesUseCase).singleton(),
    });
  },

  routes: (container) => [
    ...workforceRoutes(container.cradle),
    ...portfolioEmployeeRoutes(container.cradle),
  ],
};
