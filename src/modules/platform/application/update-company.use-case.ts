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
      // El limite puede quedar por debajo de los activos, por ejemplo al bajar de plan: nadie pierde
      // el acceso ni sus horas, pero la empresa no da de alta ni reactiva hasta quedar dentro
      const activeEmployees =
        maxEmployees === undefined ? null : await companies.lockActiveEmployees(companyId);
      if (maxEmployees !== undefined && activeEmployees === null) {
        throw PlatformErrors.companyNotFound();
      }
      await companies.update(companyId, changes);
      await this.deps.securityEvents.recordOrThrow({
        type: SecurityEventType.COMPANY_UPDATED,
        userId: actor.userId,
        companyId,
        client,
        metadata: {
          fields: Object.keys(changes),
          ...(maxEmployees !== undefined && {
            maxEmployees: { from: current.maxEmployees, to: maxEmployees },
            activeEmployees,
          }),
        },
      });
    });

    const updated = await companies.findById(companyId);
    if (!updated) throw PlatformErrors.companyNotFound();
    return updated;
  }
}
