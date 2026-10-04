import type { Actor } from '#shared/application/actor.js';
import type { ClientInfo } from '#shared/application/client-info.js';
import {
  SecurityEventType,
  type SecurityEventRecorder,
} from '#shared/application/ports/security-event-recorder.js';
import type { UseCase } from '#shared/application/use-case.js';
import type { CompanyStatus } from '#shared/domain/company-rules.js';
import { PlatformErrors } from './platform-errors.js';
import type { CompanyRepository, CompanyView } from './ports/company.repository.js';

export interface ChangeCompanyStatusInput {
  readonly actor: Actor;
  readonly client: ClientInfo;
  readonly companyId: string;
  readonly status: CompanyStatus;
}

interface Deps {
  companyRepository: CompanyRepository;
  securityEvents: SecurityEventRecorder;
}

export class ChangeCompanyStatusUseCase implements UseCase<ChangeCompanyStatusInput, CompanyView> {
  constructor(private readonly deps: Deps) {}

  async execute({
    actor,
    client,
    companyId,
    status,
  }: ChangeCompanyStatusInput): Promise<CompanyView> {
    const { companyRepository: companies } = this.deps;

    const current = await companies.findById(companyId);
    if (!current) throw PlatformErrors.companyNotFound();
    if (current.status === status) return current;

    await companies.setStatus(companyId, status);
    await this.deps.securityEvents.record({
      type:
        status === 'suspended'
          ? SecurityEventType.COMPANY_SUSPENDED
          : SecurityEventType.COMPANY_REACTIVATED,
      userId: actor.userId,
      companyId,
      client,
    });

    return { ...current, status };
  }
}
