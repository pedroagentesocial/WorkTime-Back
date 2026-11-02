import type { Actor } from '#shared/application/actor.js';
import type { ClientInfo } from '#shared/application/client-info.js';
import type { IdGenerator } from '#shared/application/ports/id-generator.js';
import {
  SecurityEventType,
  type SecurityEventRecorder,
} from '#shared/application/ports/security-event-recorder.js';
import type { TransactionRunner } from '#shared/application/ports/transaction-runner.js';
import type {
  AccessDelivery,
  AccessResult,
  AccountAccess,
} from '#shared/application/account-access.js';
import type { UseCase } from '#shared/application/use-case.js';
import { MultiAdminRules } from '../domain/multi-admin-rules.js';
import { PlatformErrors } from './platform-errors.js';
import type { CompanyRepository } from './ports/company.repository.js';
import type { MultiAdminRepository, MultiAdminView } from './ports/multi-admin.repository.js';

export interface CreateMultiAdminInput {
  readonly actor: Actor;
  readonly client: ClientInfo;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly maxCompanies: number;
  readonly maxEmployeesPerCompany: number;
  readonly delivery?: AccessDelivery | undefined;
}

export interface CreateMultiAdminOutput {
  readonly multiAdmin: MultiAdminView;
  readonly access: AccessResult;
}

interface Deps {
  multiAdminRepository: MultiAdminRepository;
  companyRepository: CompanyRepository;
  accountAccess: AccountAccess;
  transactions: TransactionRunner;
  idGenerator: IdGenerator;
  securityEvents: SecurityEventRecorder;
}

// Crea al admin multiempresa sin empresas: se le asignan o crea las suyas hasta su maximo
export class CreateMultiAdminUseCase implements UseCase<
  CreateMultiAdminInput,
  CreateMultiAdminOutput
> {
  constructor(private readonly deps: Deps) {}

  async execute(input: CreateMultiAdminInput): Promise<CreateMultiAdminOutput> {
    const { multiAdminRepository: multiAdmins } = this.deps;

    MultiAdminRules.assertMaxCompanies(input.maxCompanies);
    MultiAdminRules.assertMaxEmployeesPerCompany(input.maxEmployeesPerCompany);
    const email = input.email.trim().toLowerCase();
    if (await this.deps.companyRepository.emailExists(email)) throw PlatformErrors.emailTaken();

    const access = await this.deps.accountAccess.prepare(email, input.delivery);
    const id = this.deps.idGenerator.generate();

    await this.deps.transactions.run(async () => {
      await multiAdmins.createWithLimits({
        id,
        email,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        passwordHash: access.passwordHash,
        temporaryPasswordExpiresAt: access.expiresAt,
        maxCompanies: input.maxCompanies,
        maxEmployeesPerCompany: input.maxEmployeesPerCompany,
      });
      await this.deps.accountAccess.saveLink(id, access);
      await this.deps.securityEvents.recordOrThrow({
        type: SecurityEventType.MULTI_ADMIN_CREATED,
        userId: input.actor.userId,
        client: input.client,
        metadata: {
          targetUserId: id,
          maxCompanies: input.maxCompanies,
          maxEmployeesPerCompany: input.maxEmployeesPerCompany,
          delivery: access.delivery,
        },
      });
    });

    const multiAdmin = await multiAdmins.findById(id);
    if (!multiAdmin) throw PlatformErrors.multiAdminNotFound();
    return {
      multiAdmin,
      access: await this.deps.accountAccess.deliver(
        { email, firstName: multiAdmin.firstName },
        access,
        'welcome',
      ),
    };
  }
}
