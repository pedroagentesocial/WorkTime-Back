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
import type {
  MultiAdminPatch,
  MultiAdminRepository,
  MultiAdminView,
} from './ports/multi-admin.repository.js';

export interface UpdateMultiAdminInput {
  readonly actor: Actor;
  readonly client: ClientInfo;
  readonly multiAdminId: string;
  readonly patch: MultiAdminPatch;
}

interface Deps {
  multiAdminRepository: MultiAdminRepository;
  transactions: TransactionRunner;
  securityEvents: SecurityEventRecorder;
}

// Cambia nombre y limites; solo el admin global puede subir o bajar el paquete de una persona
export class UpdateMultiAdminUseCase implements UseCase<UpdateMultiAdminInput, MultiAdminView> {
  constructor(private readonly deps: Deps) {}

  async execute({
    actor,
    client,
    multiAdminId,
    patch,
  }: UpdateMultiAdminInput): Promise<MultiAdminView> {
    const { multiAdminRepository: multiAdmins } = this.deps;

    if (patch.maxCompanies !== undefined) MultiAdminRules.assertMaxCompanies(patch.maxCompanies);
    if (patch.maxEmployeesPerCompany !== undefined) {
      MultiAdminRules.assertMaxEmployeesPerCompany(patch.maxEmployeesPerCompany);
    }
    const clean: MultiAdminPatch = {
      ...patch,
      ...(patch.firstName !== undefined && { firstName: patch.firstName.trim() }),
      ...(patch.lastName !== undefined && { lastName: patch.lastName.trim() }),
    };

    await this.deps.transactions.run(async () => {
      const limits = await multiAdmins.lockLimits(multiAdminId);
      if (!limits) throw PlatformErrors.multiAdminNotFound();
      if (clean.maxCompanies !== undefined) {
        MultiAdminRules.assertLimitCoversCompanies(clean.maxCompanies, limits.companyCount);
      }

      await multiAdmins.update(multiAdminId, clean);
      await this.deps.securityEvents.recordOrThrow({
        type: SecurityEventType.MULTI_ADMIN_UPDATED,
        userId: actor.userId,
        client,
        metadata: {
          targetUserId: multiAdminId,
          changed: Object.keys(clean),
          previousMaxCompanies: limits.maxCompanies,
          previousMaxEmployeesPerCompany: limits.maxEmployeesPerCompany,
        },
      });
    });

    const updated = await multiAdmins.findById(multiAdminId);
    if (!updated) throw PlatformErrors.multiAdminNotFound();
    return updated;
  }
}
