import type { Actor } from '#shared/application/actor.js';
import type { AccessDelivery, AccountAccess } from '#shared/application/account-access.js';
import type { ClientInfo } from '#shared/application/client-info.js';
import {
  SecurityEventType,
  type SecurityEventRecorder,
} from '#shared/application/ports/security-event-recorder.js';
import type { TransactionRunner } from '#shared/application/ports/transaction-runner.js';
import type { UseCase } from '#shared/application/use-case.js';
import { AppError } from '#shared/domain/errors.js';
import { MultiAdminRules } from '../domain/multi-admin-rules.js';
import type {
  CreateCompanyOutput,
  CreateCompanyUseCase,
  CreatedCompany,
} from './create-company.use-case.js';
import { PlatformErrors } from './platform-errors.js';
import type { MultiAdminRepository } from './ports/multi-admin.repository.js';

export interface CreateOwnCompanyInput {
  readonly actor: Actor;
  readonly client: ClientInfo;
  readonly name: string;
  readonly timezone?: string | undefined;
  readonly admin: { readonly email: string; readonly firstName: string; readonly lastName: string };
  readonly delivery?: AccessDelivery | undefined;
}

interface Deps {
  multiAdminRepository: MultiAdminRepository;
  createCompany: CreateCompanyUseCase;
  accountAccess: AccountAccess;
  transactions: TransactionRunner;
  securityEvents: SecurityEventRecorder;
}

// Una colision de codigo aborta la transaccion de Postgres: se repite todo en una transaccion nueva
const MAX_ATTEMPTS = 5;

// El admin multiempresa crea una empresa con su admin dentro de su paquete: el maximo de empresas
// y el de empleados por empresa los fijo el admin global y no se pueden pasar
export class CreateOwnCompanyUseCase implements UseCase<
  CreateOwnCompanyInput,
  CreateCompanyOutput
> {
  constructor(private readonly deps: Deps) {}

  async execute(input: CreateOwnCompanyInput): Promise<CreateCompanyOutput> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const created = await this.deps.transactions.run(() => this.createOnce(input));
        // El correo sale ya confirmada la empresa, nunca desde dentro de la transaccion
        return {
          company: created.company,
          access: await this.deps.accountAccess.deliver(created.admin, created.access, 'welcome'),
        };
      } catch (error) {
        const taken = error instanceof AppError && error.code === 'COMPANY_IDENTIFIER_TAKEN';
        if (!taken || attempt >= MAX_ATTEMPTS) throw error;
      }
    }
  }

  private async createOnce(input: CreateOwnCompanyInput): Promise<CreatedCompany> {
    const { multiAdminRepository: multiAdmins } = this.deps;
    const { actor } = input;

    // Bloquea sus limites: dos altas a la vez no pueden pasar del maximo
    const limits = await multiAdmins.lockLimits(actor.userId);
    if (!limits) throw PlatformErrors.multiAdminNotFound();
    MultiAdminRules.assertCanAddCompany(limits.companyCount, limits.maxCompanies);

    const created = await this.deps.createCompany.create({
      actor,
      client: input.client,
      name: input.name,
      timezone: input.timezone,
      maxEmployees: limits.maxEmployeesPerCompany,
      admin: input.admin,
      delivery: input.delivery,
      identifierAttempts: 1,
    });

    await multiAdmins.addMembership(actor.userId, created.company.id);
    await this.deps.securityEvents.recordOrThrow({
      type: SecurityEventType.MULTI_ADMIN_COMPANY_ASSIGNED,
      userId: actor.userId,
      companyId: created.company.id,
      client: input.client,
      metadata: { targetUserId: actor.userId, createdByOwner: true },
    });
    return created;
  }
}
