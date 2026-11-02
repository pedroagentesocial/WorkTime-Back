import type { Actor } from '#shared/application/actor.js';
import type { ClientInfo } from '#shared/application/client-info.js';
import {
  SecurityEventType,
  type SecurityEventRecorder,
} from '#shared/application/ports/security-event-recorder.js';
import type {
  AccessDelivery,
  AccessResult,
  AccountAccess,
} from '#shared/application/account-access.js';
import type { TransactionRunner } from '#shared/application/ports/transaction-runner.js';
import type { UseCase } from '#shared/application/use-case.js';
import { PlatformErrors } from './platform-errors.js';
import type { CompanyAdminSummary, CompanyRepository } from './ports/company.repository.js';

export interface ResetCompanyAdminPasswordInput {
  readonly actor: Actor;
  readonly client: ClientInfo;
  readonly companyId: string;
  readonly delivery?: AccessDelivery | undefined;
}

export interface ResetCompanyAdminPasswordOutput {
  readonly admin: CompanyAdminSummary;
  readonly access: AccessResult;
}

interface Deps {
  companyRepository: CompanyRepository;
  accountAccess: AccountAccess;
  transactions: TransactionRunner;
  securityEvents: SecurityEventRecorder;
}

export class ResetCompanyAdminPasswordUseCase implements UseCase<
  ResetCompanyAdminPasswordInput,
  ResetCompanyAdminPasswordOutput
> {
  constructor(private readonly deps: Deps) {}

  async execute({
    actor,
    client,
    companyId,
    delivery,
  }: ResetCompanyAdminPasswordInput): Promise<ResetCompanyAdminPasswordOutput> {
    const { companyRepository: companies } = this.deps;

    const company = await companies.findById(companyId);
    if (!company) throw PlatformErrors.companyNotFound();
    if (!company.admin) throw PlatformErrors.companyAdminNotFound();

    const access = await this.deps.accountAccess.prepare(company.admin.email, delivery);
    const admin = await this.deps.transactions.run(async () => {
      const reset = await companies.resetAdminPassword(companyId, {
        passwordHash: access.passwordHash,
        expiresAt: access.expiresAt,
      });
      if (!reset) throw PlatformErrors.companyAdminNotFound();
      await this.deps.accountAccess.saveLink(reset.id, access);
      return reset;
    });

    await this.deps.securityEvents.record({
      type: SecurityEventType.TEMPORARY_PASSWORD_ISSUED,
      userId: actor.userId,
      companyId,
      client,
      metadata: { targetUserId: admin.id, delivery: access.delivery },
    });

    return { admin, access: await this.deps.accountAccess.deliver(admin, access, 'reset') };
  }
}
