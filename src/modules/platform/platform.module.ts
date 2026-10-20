import { asClass } from 'awilix';
import type { PortfolioScope } from '#shared/application/portfolio-scope.js';
import type { AppModule } from '#shared/composition/app-module.js';
import { AssignCompanyToMultiAdminUseCase } from './application/assign-company-to-multi-admin.use-case.js';
import { ChangeCompanyStatusUseCase } from './application/change-company-status.use-case.js';
import { ChangeMultiAdminStatusUseCase } from './application/change-multi-admin-status.use-case.js';
import { CreateCompanyUseCase } from './application/create-company.use-case.js';
import { CreateMultiAdminUseCase } from './application/create-multi-admin.use-case.js';
import { CreateOwnCompanyUseCase } from './application/create-own-company.use-case.js';
import { GetCompanyUseCase } from './application/get-company.use-case.js';
import { GetMultiAdminUseCase } from './application/get-multi-admin.use-case.js';
import { ListCompaniesUseCase } from './application/list-companies.use-case.js';
import { ListMultiAdminsUseCase } from './application/list-multi-admins.use-case.js';
import { ListMyCompaniesUseCase } from './application/list-my-companies.use-case.js';
import type { CompanyRepository } from './application/ports/company.repository.js';
import type { MultiAdminRepository } from './application/ports/multi-admin.repository.js';
import type { PlatformAdminRepository } from './application/ports/platform-admin.repository.js';
import { RecoverPlatformAdminUseCase } from './application/recover-platform-admin.use-case.js';
import { RemoveCompanyFromMultiAdminUseCase } from './application/remove-company-from-multi-admin.use-case.js';
import { ResetCompanyAdminPasswordUseCase } from './application/reset-company-admin-password.use-case.js';
import { ResetMultiAdminPasswordUseCase } from './application/reset-multi-admin-password.use-case.js';
import { UpdateCompanyUseCase } from './application/update-company.use-case.js';
import { UpdateMultiAdminUseCase } from './application/update-multi-admin.use-case.js';
import { PrismaCompanyRepository } from './infrastructure/prisma-company.repository.js';
import { PrismaMultiAdminRepository } from './infrastructure/prisma-multi-admin.repository.js';
import { PrismaPlatformAdminRepository } from './infrastructure/prisma-platform-admin.repository.js';
import { PrismaPortfolioScope } from './infrastructure/prisma-portfolio-scope.js';
import { multiAdminRoutes } from './presentation/multi-admin.routes.js';
import { platformRoutes } from './presentation/platform.routes.js';
import { portfolioRoutes } from './presentation/portfolio.routes.js';

declare module '#shared/composition/container.js' {
  interface Cradle {
    companyRepository: CompanyRepository;
    createCompany: CreateCompanyUseCase;
    listCompanies: ListCompaniesUseCase;
    getCompany: GetCompanyUseCase;
    updateCompany: UpdateCompanyUseCase;
    changeCompanyStatus: ChangeCompanyStatusUseCase;
    resetCompanyAdminPassword: ResetCompanyAdminPasswordUseCase;

    platformAdminRepository: PlatformAdminRepository;
    // Solo lo usa el comando de consola admin:recover
    recoverPlatformAdmin: RecoverPlatformAdminUseCase;

    multiAdminRepository: MultiAdminRepository;
    createMultiAdmin: CreateMultiAdminUseCase;
    listMultiAdmins: ListMultiAdminsUseCase;
    getMultiAdmin: GetMultiAdminUseCase;
    updateMultiAdmin: UpdateMultiAdminUseCase;
    changeMultiAdminStatus: ChangeMultiAdminStatusUseCase;
    resetMultiAdminPassword: ResetMultiAdminPasswordUseCase;
    assignCompanyToMultiAdmin: AssignCompanyToMultiAdminUseCase;
    removeCompanyFromMultiAdmin: RemoveCompanyFromMultiAdminUseCase;

    listMyCompanies: ListMyCompaniesUseCase;
    createOwnCompany: CreateOwnCompanyUseCase;
    // Lo usan las vistas consolidadas de los otros modulos para saber con que empresas trabaja una persona
    portfolioScope: PortfolioScope;
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

      platformAdminRepository: asClass(PrismaPlatformAdminRepository).singleton(),
      recoverPlatformAdmin: asClass(RecoverPlatformAdminUseCase).singleton(),

      multiAdminRepository: asClass(PrismaMultiAdminRepository).singleton(),
      createMultiAdmin: asClass(CreateMultiAdminUseCase).singleton(),
      listMultiAdmins: asClass(ListMultiAdminsUseCase).singleton(),
      getMultiAdmin: asClass(GetMultiAdminUseCase).singleton(),
      updateMultiAdmin: asClass(UpdateMultiAdminUseCase).singleton(),
      changeMultiAdminStatus: asClass(ChangeMultiAdminStatusUseCase).singleton(),
      resetMultiAdminPassword: asClass(ResetMultiAdminPasswordUseCase).singleton(),
      assignCompanyToMultiAdmin: asClass(AssignCompanyToMultiAdminUseCase).singleton(),
      removeCompanyFromMultiAdmin: asClass(RemoveCompanyFromMultiAdminUseCase).singleton(),

      listMyCompanies: asClass(ListMyCompaniesUseCase).singleton(),
      createOwnCompany: asClass(CreateOwnCompanyUseCase).singleton(),
      portfolioScope: asClass(PrismaPortfolioScope).singleton(),
    });
  },

  routes: (container) => [
    ...platformRoutes(container.cradle),
    ...multiAdminRoutes(container.cradle),
    ...portfolioRoutes(container.cradle),
  ],
};
