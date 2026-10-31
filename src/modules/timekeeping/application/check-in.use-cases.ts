import { companyIdOf, type Actor } from '#shared/application/actor.js';
import type { ClientInfo } from '#shared/application/client-info.js';
import type { Page, PageRequest } from '#shared/application/pagination.js';
import type { Clock } from '#shared/application/ports/clock.js';
import type { IdGenerator } from '#shared/application/ports/id-generator.js';
import {
  SecurityEventType,
  type SecurityEventRecorder,
} from '#shared/application/ports/security-event-recorder.js';
import type { TransactionRunner } from '#shared/application/ports/transaction-runner.js';
import type { UseCase } from '#shared/application/use-case.js';
import { localDateOf } from '#shared/domain/timezone.js';
import { CHECK_IN_LIMITS, CheckInRules } from '../domain/check-in.js';
import { ClockLocationRules, type ClockLocation } from '../domain/clock-location.js';
import { assertValidWorkDateRange, type WorkDateRange } from '../domain/work-date-range.js';
import { evaluateZone } from '../domain/work-zone.js';
import { normalizeReason } from './correct-time-entry.use-case.js';
import type { CheckInFilter, CheckInRepository, CheckInView } from './ports/check-in.repository.js';
import type { EmployeeDirectory, EmployeeProfile } from './ports/employee-directory.js';
import type { TimeEntryRepository } from './ports/time-entry.repository.js';
import type { WorkSiteReader } from './ports/work-site.reader.js';
import { TimekeepingErrors } from './timekeeping-errors.js';

interface Deps {
  checkInRepository: CheckInRepository;
  employeeDirectory: EmployeeDirectory;
  workSiteReader: WorkSiteReader;
  timeEntryRepository: TimeEntryRepository;
  transactions: TransactionRunner;
  securityEvents: SecurityEventRecorder;
  idGenerator: IdGenerator;
  clock: Clock;
}

async function profileOf(directory: EmployeeDirectory, actor: Actor): Promise<EmployeeProfile> {
  const profile = await directory.findByUser(companyIdOf(actor), actor.userId);
  if (!profile) throw TimekeepingErrors.employeeProfileNotFound();
  return profile;
}

async function viewOf(repository: CheckInRepository, companyId: string, id: string) {
  const view = await repository.findViewById(companyId, id);
  if (!view) throw TimekeepingErrors.checkInNotFound();
  return view;
}

export interface CreateCheckInInput {
  readonly actor: Actor;
  readonly location?: ClockLocation | undefined;
  readonly note?: string | undefined;
}

// Registra que el empleado llego a un lugar. No abre ni cierra jornada y no cuenta horas,
// asi que no lo frenan el limite diario, los reportes pendientes ni un periodo cerrado
export class CreateCheckInUseCase implements UseCase<CreateCheckInInput, CheckInView> {
  constructor(private readonly deps: Deps) {}

  async execute({ actor, location, note }: CreateCheckInInput): Promise<CheckInView> {
    const profile = await profileOf(this.deps.employeeDirectory, actor);
    if (!profile.allowCheckIns) throw TimekeepingErrors.checkInsDisabled();
    if (!location) throw TimekeepingErrors.locationRequired();
    const validLocation = ClockLocationRules.assertValid(location);
    const validNote = CheckInRules.normalizeNote(note);

    // La zona queda como foto: sirve para saber si estuvo donde dijo, pero nunca bloquea
    const zone = evaluateZone(
      validLocation,
      await this.deps.workSiteReader.listActive(profile.companyId),
    );
    const now = this.deps.clock.now();
    const workDate = localDateOf(now, profile.effectiveTimezone);
    const id = this.deps.idGenerator.generate();

    await this.deps.transactions.run(async () => {
      // Con el empleado bloqueado dos registros a la vez no pasan del tope del dia
      await this.deps.timeEntryRepository.lockEmployee(profile.companyId, profile.employeeId);
      const count = await this.deps.checkInRepository.countOn(profile.employeeId, workDate);
      if (count >= CHECK_IN_LIMITS.perDay) {
        throw TimekeepingErrors.checkInLimitReached(CHECK_IN_LIMITS.perDay);
      }
      await this.deps.checkInRepository.insert({
        id,
        companyId: profile.companyId,
        employeeId: profile.employeeId,
        checkedInAt: now,
        timezone: profile.effectiveTimezone,
        workDate,
        location: validLocation,
        zone,
        note: validNote,
      });
    });
    return viewOf(this.deps.checkInRepository, profile.companyId, id);
  }
}

export interface ListMyCheckInsInput {
  readonly actor: Actor;
  readonly filter: WorkDateRange;
  readonly page: PageRequest;
}

// El empleado ve los suyos, sin los anulados
export class ListMyCheckInsUseCase implements UseCase<ListMyCheckInsInput, Page<CheckInView>> {
  constructor(private readonly deps: Pick<Deps, 'checkInRepository' | 'employeeDirectory'>) {}

  async execute({ actor, filter, page }: ListMyCheckInsInput): Promise<Page<CheckInView>> {
    assertValidWorkDateRange(filter);
    const profile = await profileOf(this.deps.employeeDirectory, actor);
    return this.deps.checkInRepository.list(
      profile.companyId,
      { from: filter.from, to: filter.to, employeeId: profile.employeeId },
      page,
    );
  }
}

export interface ListCompanyCheckInsInput {
  readonly actor: Actor;
  readonly filter: CheckInFilter;
  readonly page: PageRequest;
}

export class ListCompanyCheckInsUseCase implements UseCase<
  ListCompanyCheckInsInput,
  Page<CheckInView>
> {
  constructor(private readonly deps: Pick<Deps, 'checkInRepository' | 'employeeDirectory'>) {}

  async execute({ actor, filter, page }: ListCompanyCheckInsInput): Promise<Page<CheckInView>> {
    assertValidWorkDateRange(filter);
    const companyId = companyIdOf(actor);
    if (
      filter.employeeId &&
      !(await this.deps.employeeDirectory.exists(companyId, filter.employeeId))
    ) {
      throw TimekeepingErrors.employeeNotFound();
    }
    return this.deps.checkInRepository.list(companyId, filter, page);
  }
}

export interface VoidCheckInInput {
  readonly actor: Actor;
  readonly client: ClientInfo;
  readonly checkInId: string;
  readonly reason: string;
}

// No se borra: queda con quien lo anulo, cuando y por que, y deja de verse en listas y mapas
export class VoidCheckInUseCase implements UseCase<VoidCheckInInput, CheckInView> {
  constructor(private readonly deps: Deps) {}

  async execute(input: VoidCheckInInput): Promise<CheckInView> {
    const companyId = companyIdOf(input.actor);
    const reason = normalizeReason(input.reason);
    const current = await viewOf(this.deps.checkInRepository, companyId, input.checkInId);
    if (current.voided) throw TimekeepingErrors.checkInVoided();

    await this.deps.transactions.run(async () => {
      const done = await this.deps.checkInRepository.voidIfActive(companyId, current.id, {
        at: this.deps.clock.now(),
        byId: input.actor.userId,
        reason,
      });
      if (!done) throw TimekeepingErrors.checkInVoided();
      await this.deps.securityEvents.recordOrThrow({
        type: SecurityEventType.CHECK_IN_VOIDED_BY_ADMIN,
        userId: input.actor.userId,
        companyId,
        client: input.client,
        metadata: {
          employeeId: current.employee.id,
          checkInId: current.id,
          checkedInAt: current.checkedInAt.toISOString(),
          reason,
        },
      });
    });
    return viewOf(this.deps.checkInRepository, companyId, current.id);
  }
}
