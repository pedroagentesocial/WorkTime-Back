import type { Actor } from '#shared/application/actor.js';
import type { ClientInfo } from '#shared/application/client-info.js';
import type { IdGenerator } from '#shared/application/ports/id-generator.js';
import type { SecureRandom } from '#shared/application/ports/secure-random.js';
import {
  SecurityEventType,
  type SecurityEventRecorder,
} from '#shared/application/ports/security-event-recorder.js';
import type { TemporaryPasswordIssuer } from '#shared/application/temporary-password-issuer.js';
import type { UseCase } from '#shared/application/use-case.js';
import { COMPANY_DEFAULTS, CompanyRules } from '#shared/domain/company-rules.js';
import { AppError } from '#shared/domain/errors.js';
import { Identifiers } from '#shared/domain/identifiers.js';
import { PlatformErrors } from './platform-errors.js';
import type { CompanyRepository, CompanyView } from './ports/company.repository.js';

export interface CreateCompanyInput {
  readonly actor: Actor;
  readonly client: ClientInfo;
  readonly name: string;
  readonly timezone?: string | undefined;
  readonly maxEmployees: number;
  readonly admin: { readonly email: string; readonly firstName: string; readonly lastName: string };
}

export interface CreateCompanyOutput {
  readonly company: CompanyView;
  readonly temporaryPassword: string;
  readonly temporaryPasswordExpiresAt: Date;
}

interface Deps {
  companyRepository: CompanyRepository;
  temporaryPasswords: TemporaryPasswordIssuer;
  idGenerator: IdGenerator;
  secureRandom: SecureRandom;
  securityEvents: SecurityEventRecorder;
}

// Con pocos prefijos posibles una colision es rara pero posible, se reintenta con otros
const MAX_IDENTIFIER_ATTEMPTS = 5;

export class CreateCompanyUseCase implements UseCase<CreateCompanyInput, CreateCompanyOutput> {
  constructor(private readonly deps: Deps) {}

  async execute(input: CreateCompanyInput): Promise<CreateCompanyOutput> {
    const { companyRepository: companies, idGenerator } = this.deps;

    const name = CompanyRules.normalizeName(input.name);
    const timezone = input.timezone ?? COMPANY_DEFAULTS.timezone;
    CompanyRules.assertTimezone(timezone);
    CompanyRules.assertMaxEmployees(input.maxEmployees);
    const email = input.admin.email.trim().toLowerCase();

    if (await companies.emailExists(email)) throw PlatformErrors.emailTaken();

    const temporary = await this.deps.temporaryPasswords.issue();
    const companyId = idGenerator.generate();
    const adminId = idGenerator.generate();

    for (let attempt = 1; ; attempt += 1) {
      const randomInt = (max: number) => this.deps.secureRandom.int(max);
      try {
        await companies.createWithAdmin({
          company: {
            id: companyId,
            code: Identifiers.companyCode(randomInt),
            employeeCodePrefix: Identifiers.employeePrefix(randomInt),
            name,
            timezone,
            maxEmployees: input.maxEmployees,
          },
          admin: {
            id: adminId,
            email,
            firstName: input.admin.firstName.trim(),
            lastName: input.admin.lastName.trim(),
            passwordHash: temporary.passwordHash,
            temporaryPasswordExpiresAt: temporary.expiresAt,
          },
        });
        break;
      } catch (error) {
        const taken = error instanceof AppError && error.code === 'COMPANY_IDENTIFIER_TAKEN';
        if (!taken || attempt >= MAX_IDENTIFIER_ATTEMPTS) throw error;
      }
    }

    await this.deps.securityEvents.record({
      type: SecurityEventType.COMPANY_CREATED,
      userId: input.actor.userId,
      companyId,
      client: input.client,
      metadata: { adminId },
    });

    const company = await companies.findById(companyId);
    if (!company) throw PlatformErrors.companyNotFound();

    return {
      company,
      temporaryPassword: temporary.password,
      temporaryPasswordExpiresAt: temporary.expiresAt,
    };
  }
}
