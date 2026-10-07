import type { Actor } from '#shared/application/actor.js';
import type { ClientInfo } from '#shared/application/client-info.js';
import {
  SecurityEventType,
  type SecurityEventRecorder,
} from '#shared/application/ports/security-event-recorder.js';
import type { TransactionRunner } from '#shared/application/ports/transaction-runner.js';
import type { UseCase } from '#shared/application/use-case.js';
import { MultiAdminRules } from '../domain/multi-admin-rules.js';
import { PlatformErrors } from './platform-errors.js';
import type { CompanyRepository } from './ports/company.repository.js';
import type { MultiAdminRepository, MultiAdminView } from './ports/multi-admin.repository.js';

export interface AssignCompanyInput {
  readonly actor: Actor;
  readonly client: ClientInfo;
  readonly multiAdminId: string;
  readonly companyId: string;
}

interface Deps {
  multiAdminRepository: MultiAdminRepository;
  companyRepository: CompanyRepository;
  transactions: TransactionRunner;
  securityEvents: SecurityEventRecorder;
}

// Da acceso a una empresa que ya existe, sin pasar su maximo de empresas
export class AssignCompanyToMultiAdminUseCase implements UseCase<
  AssignCompanyInput,
  MultiAdminView
> {
  constructor(private readonly deps: Deps) {}

  async execute({
    actor,
    client,
    multiAdminId,
    companyId,
  }: AssignCompanyInput): Promise<MultiAdminView> {
    const { multiAdminRepository: multiAdmins } = this.deps;

    await this.deps.transactions.run(async () => {
      const limits = await multiAdmins.lockLimits(multiAdminId);
      if (!limits) throw PlatformErrors.multiAdminNotFound();
      if (!(await this.deps.companyRepository.findById(companyId))) {
        throw PlatformErrors.companyNotFound();
      }
      if (await multiAdmins.hasMembership(multiAdminId, companyId)) {
        throw PlatformErrors.alreadyAssigned();
      }
      MultiAdminRules.assertCanAddCompany(limits.companyCount, limits.maxCompanies);

      await multiAdmins.addMembership(multiAdminId, companyId);
      await this.deps.securityEvents.recordOrThrow({
        type: SecurityEventType.MULTI_ADMIN_COMPANY_ASSIGNED,
        userId: actor.userId,
        companyId,
        client,
        metadata: { targetUserId: multiAdminId },
      });
    });

    const updated = await multiAdmins.findById(multiAdminId);
    if (!updated) throw PlatformErrors.multiAdminNotFound();
    return updated;
  }
}
