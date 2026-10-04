import type { Actor } from '#shared/application/actor.js';
import type { ClientInfo } from '#shared/application/client-info.js';
import {
  SecurityEventType,
  type SecurityEventRecorder,
} from '#shared/application/ports/security-event-recorder.js';
import type { TransactionRunner } from '#shared/application/ports/transaction-runner.js';
import type { UseCase } from '#shared/application/use-case.js';
import { CompanyRules } from '#shared/domain/company-rules.js';
import { PlatformErrors } from './platform-errors.js';
import type { CompanyPatch, CompanyRepository, CompanyView } from './ports/company.repository.js';

export interface UpdateCompanyInput {
  readonly actor: Actor;
  readonly client: ClientInfo;
  readonly companyId: string;
  readonly patch: CompanyPatch;
}

interface Deps {
  companyRepository: CompanyRepository;
  securityEvents: SecurityEventRecorder;
  transactions: TransactionRunner;
}

export class UpdateCompanyUseCase implements UseCase<UpdateCompanyInput, CompanyView> {
  constructor(private readonly deps: Deps) {}

  async execute({ actor, client, companyId, patch }: UpdateCompanyInput): Promise<CompanyView> {
    const { companyRepository: companies } = this.deps;

    const current = await companies.findById(companyId);
    if (!current) throw PlatformErrors.companyNotFound();

    const changes: CompanyPatch = {
      ...(patch.name !== undefined && { name: CompanyRules.normalizeName(patch.name) }),
      ...(patch.timezone !== undefined && { timezone: patch.timezone }),
      ...(patch.maxEmployees !== undefined && { maxEmployees: patch.maxEmployees }),
    };
    if (changes.timezone !== undefined) CompanyRules.assertTimezone(changes.timezone);
    const { maxEmployees } = changes;
    if (maxEmployees !== undefined) CompanyRules.assertMaxEmployees(maxEmployees);

    await this.deps.transactions.run(async () => {
      if (maxEmployees !== undefined) {
        const activeEmployees = await companies.lockActiveEmployees(companyId);
        if (activeEmployees === null) throw PlatformErrors.companyNotFound();
        CompanyRules.assertLimitCoversActiveEmployees(maxEmployees, activeEmployees);
      }
      await companies.update(companyId, changes);
    });
    await this.deps.securityEvents.record({
      type: SecurityEventType.COMPANY_UPDATED,
      userId: actor.userId,
      companyId,
      client,
      metadata: { fields: Object.keys(changes) },
    });

    const updated = await companies.findById(companyId);
    if (!updated) throw PlatformErrors.companyNotFound();
    return updated;
  }
}
