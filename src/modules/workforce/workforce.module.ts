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
import { RevokeEmployeeSessionsUseCase } from './application/revoke-employee-sessions.use-case.js';
import { ResetEmployeePasswordUseCase } from './application/reset-employee-password.use-case.js';
import { UpdateEmployeeUseCase } from './application/update-employee.use-case.js';
import { PrismaCompanySettingsRepository } from './infrastructure/prisma-company-settings.repository.js';
import { PrismaEmployeeRepository } from './infrastructure/prisma-employee.repository.js';
import { workforceRoutes } from './presentation/workforce.routes.js';

declare module '#shared/composition/container.js' {
  interface Cradle {
    employeeRepository: EmployeeRepository;
    companySettingsRepository: CompanySettingsRepository;
    getCompanySettings: GetCompanySettingsUseCase;
    updateCompanySettings: UpdateCompanySettingsUseCase;
    createEmployee: CreateEmployeeUseCase;
    listEmployees: ListEmployeesUseCase;
    getEmployee: GetEmployeeUseCase;
    updateEmployee: UpdateEmployeeUseCase;
    changeEmployeeStatus: ChangeEmployeeStatusUseCase;
    resetEmployeePassword: ResetEmployeePasswordUseCase;
    revokeEmployeeSessions: RevokeEmployeeSessionsUseCase;
  }
}

export const workforceModule: AppModule = {
  name: 'workforce',

  register(container) {
    container.register({
      employeeRepository: asClass(PrismaEmployeeRepository).singleton(),
      companySettingsRepository: asClass(PrismaCompanySettingsRepository).singleton(),
      getCompanySettings: asClass(GetCompanySettingsUseCase).singleton(),
      updateCompanySettings: asClass(UpdateCompanySettingsUseCase).singleton(),
      createEmployee: asClass(CreateEmployeeUseCase).singleton(),
      listEmployees: asClass(ListEmployeesUseCase).singleton(),
      getEmployee: asClass(GetEmployeeUseCase).singleton(),
      updateEmployee: asClass(UpdateEmployeeUseCase).singleton(),
      changeEmployeeStatus: asClass(ChangeEmployeeStatusUseCase).singleton(),
      resetEmployeePassword: asClass(ResetEmployeePasswordUseCase).singleton(),
      revokeEmployeeSessions: asClass(RevokeEmployeeSessionsUseCase).singleton(),
    });
  },

  routes: (container) => workforceRoutes(container.cradle),
};
