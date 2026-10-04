import { asClass } from 'awilix';
import type { AppModule } from '#shared/composition/app-module.js';
import { ChangeCompanyStatusUseCase } from './application/change-company-status.use-case.js';
import { CreateCompanyUseCase } from './application/create-company.use-case.js';
import { GetCompanyUseCase } from './application/get-company.use-case.js';
import { ListCompaniesUseCase } from './application/list-companies.use-case.js';
import type { CompanyRepository } from './application/ports/company.repository.js';
import { ResetCompanyAdminPasswordUseCase } from './application/reset-company-admin-password.use-case.js';
import { UpdateCompanyUseCase } from './application/update-company.use-case.js';
import { PrismaCompanyRepository } from './infrastructure/prisma-company.repository.js';
import { platformRoutes } from './presentation/platform.routes.js';

declare module '#shared/composition/container.js' {
  interface Cradle {
    companyRepository: CompanyRepository;
    createCompany: CreateCompanyUseCase;
    listCompanies: ListCompaniesUseCase;
    getCompany: GetCompanyUseCase;
    updateCompany: UpdateCompanyUseCase;
    changeCompanyStatus: ChangeCompanyStatusUseCase;
    resetCompanyAdminPassword: ResetCompanyAdminPasswordUseCase;
  }
}

export const platformModule: AppModule = {
  name: 'platform',

  register(container) {
    container.register({
      companyRepository: asClass(PrismaCompanyRepository).singleton(),
      createCompany: asClass(CreateCompanyUseCase).singleton(),
      listCompanies: asClass(ListCompaniesUseCase).singleton(),
      getCompany: asClass(GetCompanyUseCase).singleton(),
      updateCompany: asClass(UpdateCompanyUseCase).singleton(),
      changeCompanyStatus: asClass(ChangeCompanyStatusUseCase).singleton(),
      resetCompanyAdminPassword: asClass(ResetCompanyAdminPasswordUseCase).singleton(),
    });
  },

  routes: (container) => platformRoutes(container.cradle),
};
