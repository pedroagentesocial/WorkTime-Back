import { companyIdOf, type Actor } from '#shared/application/actor.js';
import type { ClientInfo } from '#shared/application/client-info.js';
import {
  SecurityEventType,
  type SecurityEventRecorder,
} from '#shared/application/ports/security-event-recorder.js';
import type { Clock } from '#shared/application/ports/clock.js';
import type { UseCase } from '#shared/application/use-case.js';
import { CompanyRules } from '#shared/domain/company-rules.js';
import { DailyLimit } from '#shared/domain/daily-limit.js';
import { PayRules } from '#shared/domain/pay-rules.js';
import { localDateOf } from '#shared/domain/timezone.js';
import type {
  CompanySettingsPatch,
  CompanySettingsRepository,
  CompanySettingsView,
} from './ports/company-settings.repository.js';
import type { WorkSiteRepository } from './ports/work-site.repository.js';
import type { TransactionRunner } from '#shared/application/ports/transaction-runner.js';
import { WorkforceErrors } from './workforce-errors.js';

// Cambian lo que se paga o quien puede tocar sus horas: se guarda el valor anterior y el nuevo
const PAY_FIELDS = ['currency', 'dailyLimitMinutes', 'selfEditDays'] as const;

function payChangesOf(current: CompanySettingsView, changes: CompanySettingsPatch) {
  return Object.fromEntries(
    PAY_FIELDS.filter((field) => changes[field] !== undefined).map((field) => [
      field,
      { from: current[field], to: changes[field] },
    ]),
  );
}

interface Deps {
  companySettingsRepository: CompanySettingsRepository;
  securityEvents: SecurityEventRecorder;
  workSiteRepository: WorkSiteRepository;
  transactions: TransactionRunner;
  clock: Clock;
}

export class GetCompanySettingsUseCase implements UseCase<Actor, CompanySettingsView> {
  constructor(private readonly deps: Pick<Deps, 'companySettingsRepository'>) {}

  async execute(actor: Actor): Promise<CompanySettingsView> {
    const company = await this.deps.companySettingsRepository.findById(companyIdOf(actor));
    if (!company) throw WorkforceErrors.companyNotFound();
    return company;
  }
}

export interface UpdateCompanySettingsInput {
  readonly actor: Actor;
  readonly client: ClientInfo;
  readonly patch: CompanySettingsPatch;
}

export class UpdateCompanySettingsUseCase implements UseCase<
  UpdateCompanySettingsInput,
  CompanySettingsView
> {
  constructor(private readonly deps: Deps) {}

  async execute({
    actor,
    client,
    patch,
  }: UpdateCompanySettingsInput): Promise<CompanySettingsView> {
    const companyId = companyIdOf(actor);
    const changes: CompanySettingsPatch = {
      ...(patch.name !== undefined && { name: CompanyRules.normalizeName(patch.name) }),
      ...(patch.timezone !== undefined && { timezone: patch.timezone }),
      ...(patch.requireDailyReport !== undefined && {
        requireDailyReport: patch.requireDailyReport,
      }),
      ...(patch.enforceWorkSites !== undefined && { enforceWorkSites: patch.enforceWorkSites }),
      ...(patch.allowCheckIns !== undefined && { allowCheckIns: patch.allowCheckIns }),
      ...(patch.currency !== undefined && { currency: patch.currency.toUpperCase() }),
      ...(patch.selfEditDays !== undefined && { selfEditDays: patch.selfEditDays }),
      ...(patch.dailyLimitMinutes !== undefined && {
        dailyLimitMinutes: patch.dailyLimitMinutes,
      }),
    };
    if (changes.timezone !== undefined) CompanyRules.assertTimezone(changes.timezone);
    if (changes.currency !== undefined) PayRules.assertCurrency(changes.currency);
    if (changes.dailyLimitMinutes !== undefined) DailyLimit.assertValid(changes.dailyLimitMinutes);

    // Al encender el reporte obligatorio solo cuentan los dias nuevos: el historial no bloquea a nadie
    const current = await this.deps.companySettingsRepository.findById(companyId);
    if (!current) throw WorkforceErrors.companyNotFound();
    const patched: CompanySettingsPatch =
      changes.requireDailyReport === true && !current.requireDailyReport
        ? {
            ...changes,
            dailyReportRequiredSince: localDateOf(
              this.deps.clock.now(),
              changes.timezone ?? current.timezone,
            ),
          }
        : changes;

    await this.deps.transactions.run(async () => {
      // Exigir zonas sin ninguna activa bloquearia a todos; se decide con la empresa bloqueada
      if (patched.enforceWorkSites === true) {
        const counts = await this.deps.workSiteRepository.lockAndCount(companyId);
        if (!counts || counts.active === 0) throw WorkforceErrors.workSitesRequired();
      }
      await this.deps.companySettingsRepository.update(companyId, patched);
      await this.deps.securityEvents.recordOrThrow({
        type: SecurityEventType.COMPANY_SETTINGS_UPDATED,
        userId: actor.userId,
        companyId,
        client,
        metadata: { fields: Object.keys(changes), payChanges: payChangesOf(current, changes) },
      });
    });

    const updated = await this.deps.companySettingsRepository.findById(companyId);
    if (!updated) throw WorkforceErrors.companyNotFound();
    return updated;
  }
}
