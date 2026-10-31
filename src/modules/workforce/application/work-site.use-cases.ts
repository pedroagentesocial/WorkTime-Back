import { companyIdOf, type Actor } from '#shared/application/actor.js';
import type { ClientInfo } from '#shared/application/client-info.js';
import type { IdGenerator } from '#shared/application/ports/id-generator.js';
import {
  SecurityEventType,
  type SecurityEventRecorder,
} from '#shared/application/ports/security-event-recorder.js';
import type { TransactionRunner } from '#shared/application/ports/transaction-runner.js';
import type { UseCase } from '#shared/application/use-case.js';
import { WORK_SITE_LIMITS } from '../domain/work-site-rules.js';
import type { CompanySettingsRepository } from './ports/company-settings.repository.js';
import type {
  WorkSitePatch,
  WorkSiteRepository,
  WorkSiteView,
} from './ports/work-site.repository.js';
import { WorkforceErrors } from './workforce-errors.js';

interface Deps {
  workSiteRepository: WorkSiteRepository;
  companySettingsRepository: CompanySettingsRepository;
  transactions: TransactionRunner;
  securityEvents: SecurityEventRecorder;
  idGenerator: IdGenerator;
}

export class ListWorkSitesUseCase implements UseCase<Actor, WorkSiteView[]> {
  constructor(private readonly deps: Pick<Deps, 'workSiteRepository'>) {}

  execute(actor: Actor): Promise<WorkSiteView[]> {
    return this.deps.workSiteRepository.list(companyIdOf(actor));
  }
}

export interface CreateWorkSiteInput {
  readonly actor: Actor;
  readonly client: ClientInfo;
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly radiusMeters: number;
}

export class CreateWorkSiteUseCase implements UseCase<CreateWorkSiteInput, WorkSiteView> {
  constructor(private readonly deps: Deps) {}

  async execute({ actor, client, ...data }: CreateWorkSiteInput): Promise<WorkSiteView> {
    const companyId = companyIdOf(actor);
    const { workSiteRepository: sites } = this.deps;

    return this.deps.transactions.run(async () => {
      const counts = await sites.lockAndCount(companyId);
      if (!counts) throw WorkforceErrors.companyNotFound();
      if (counts.total >= WORK_SITE_LIMITS.maxSitesPerCompany) {
        throw WorkforceErrors.workSiteLimit(WORK_SITE_LIMITS.maxSitesPerCompany);
      }
      const site = await sites.insert(companyId, {
        id: this.deps.idGenerator.generate(),
        name: data.name,
        latitude: data.latitude,
        longitude: data.longitude,
        radiusMeters: data.radiusMeters,
      });
      await this.deps.securityEvents.recordOrThrow({
        type: SecurityEventType.WORK_SITE_CREATED,
        userId: actor.userId,
        companyId,
        client,
        metadata: { workSiteId: site.id },
      });
      return site;
    });
  }
}

export interface UpdateWorkSiteInput {
  readonly actor: Actor;
  readonly client: ClientInfo;
  readonly workSiteId: string;
  readonly patch: WorkSitePatch;
}

export class UpdateWorkSiteUseCase implements UseCase<UpdateWorkSiteInput, WorkSiteView> {
  constructor(private readonly deps: Deps) {}

  async execute({ actor, client, workSiteId, patch }: UpdateWorkSiteInput): Promise<WorkSiteView> {
    const companyId = companyIdOf(actor);
    const { workSiteRepository: sites } = this.deps;

    return this.deps.transactions.run(async () => {
      const counts = await sites.lockAndCount(companyId);
      if (!counts) throw WorkforceErrors.companyNotFound();
      const current = await sites.findById(companyId, workSiteId);
      if (!current) throw WorkforceErrors.workSiteNotFound();

      // Con la exigencia encendida no se puede dejar a la empresa sin zonas activas
      if (patch.active === false && current.active && counts.active <= 1) {
        const settings = await this.deps.companySettingsRepository.findById(companyId);
        if (settings?.enforceWorkSites) throw WorkforceErrors.workSitesRequired();
      }

      await sites.update(companyId, workSiteId, patch);
      await this.deps.securityEvents.recordOrThrow({
        type: SecurityEventType.WORK_SITE_UPDATED,
        userId: actor.userId,
        companyId,
        client,
        metadata: { workSiteId, fields: Object.keys(patch) },
      });
      const updated = await sites.findById(companyId, workSiteId);
      if (!updated) throw WorkforceErrors.workSiteNotFound();
      return updated;
    });
  }
}
