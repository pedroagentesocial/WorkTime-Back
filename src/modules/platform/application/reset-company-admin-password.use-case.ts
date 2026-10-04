import type { Actor } from '#shared/application/actor.js';
import type { ClientInfo } from '#shared/application/client-info.js';
import {
  SecurityEventType,
  type SecurityEventRecorder,
} from '#shared/application/ports/security-event-recorder.js';
import type { TemporaryPasswordIssuer } from '#shared/application/temporary-password-issuer.js';
import type { UseCase } from '#shared/application/use-case.js';
import { PlatformErrors } from './platform-errors.js';
import type { CompanyAdminSummary, CompanyRepository } from './ports/company.repository.js';

export interface ResetCompanyAdminPasswordInput {
  readonly actor: Actor;
  readonly client: ClientInfo;
  readonly companyId: string;
}

export interface ResetCompanyAdminPasswordOutput {
  readonly admin: CompanyAdminSummary;
  readonly temporaryPassword: string;
  readonly temporaryPasswordExpiresAt: Date;
}

interface Deps {
  companyRepository: CompanyRepository;
  temporaryPasswords: TemporaryPasswordIssuer;
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
  }: ResetCompanyAdminPasswordInput): Promise<ResetCompanyAdminPasswordOutput> {
    const { companyRepository: companies } = this.deps;

    if (!(await companies.findById(companyId))) throw PlatformErrors.companyNotFound();

    const temporary = await this.deps.temporaryPasswords.issue();
    const admin = await companies.resetAdminPassword(companyId, {
      passwordHash: temporary.passwordHash,
      expiresAt: temporary.expiresAt,
    });
    if (!admin) throw PlatformErrors.companyAdminNotFound();

    await this.deps.securityEvents.record({
      type: SecurityEventType.TEMPORARY_PASSWORD_ISSUED,
      userId: actor.userId,
      companyId,
      client,
      metadata: { targetUserId: admin.id },
    });

    return {
      admin,
      temporaryPassword: temporary.password,
      temporaryPasswordExpiresAt: temporary.expiresAt,
    };
  }
}
