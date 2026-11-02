import type { Actor } from '#shared/application/actor.js';
import type { ClientInfo } from '#shared/application/client-info.js';
import type { IdGenerator } from '#shared/application/ports/id-generator.js';
import type { SecureRandom } from '#shared/application/ports/secure-random.js';
import {
  SecurityEventType,
  type SecurityEventRecorder,
} from '#shared/application/ports/security-event-recorder.js';
import type {
  AccessDelivery,
  AccessResult,
  AccountAccess,
  PreparedAccess,
} from '#shared/application/account-access.js';
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
  // Dentro de una transaccion un choque de codigo la aborta: quien llama reintenta con intentos en 1
  readonly identifierAttempts?: number | undefined;
  readonly admin: { readonly email: string; readonly firstName: string; readonly lastName: string };
  readonly delivery?: AccessDelivery | undefined;
}

export interface CreateCompanyOutput {
  readonly company: CompanyView;
  readonly access: AccessResult;
}

// Empresa creada cuyo acceso aun no se entrega: el correo sale despues de la transaccion
export interface CreatedCompany {
  readonly company: CompanyView;
  readonly admin: { readonly email: string; readonly firstName: string };
  readonly access: PreparedAccess;
}

interface Deps {
  companyRepository: CompanyRepository;
  accountAccess: AccountAccess;
  idGenerator: IdGenerator;
  secureRandom: SecureRandom;
  securityEvents: SecurityEventRecorder;
}

// Con pocos prefijos posibles una colision es rara pero posible, se reintenta con otros
const MAX_IDENTIFIER_ATTEMPTS = 5;

export class CreateCompanyUseCase implements UseCase<CreateCompanyInput, CreateCompanyOutput> {
  constructor(private readonly deps: Deps) {}

  async execute(input: CreateCompanyInput): Promise<CreateCompanyOutput> {
    const created = await this.create(input);
    return {
      company: created.company,
      access: await this.deps.accountAccess.deliver(created.admin, created.access, 'welcome'),
    };
  }

  async create(input: CreateCompanyInput): Promise<CreatedCompany> {
    const { companyRepository: companies, idGenerator } = this.deps;

    const name = CompanyRules.normalizeName(input.name);
    const timezone = input.timezone ?? COMPANY_DEFAULTS.timezone;
    CompanyRules.assertTimezone(timezone);
    CompanyRules.assertMaxEmployees(input.maxEmployees);
    const email = input.admin.email.trim().toLowerCase();

    if (await companies.emailExists(email)) throw PlatformErrors.emailTaken();

    const access = await this.deps.accountAccess.prepare(email, input.delivery);
    const companyId = idGenerator.generate();
    const adminId = idGenerator.generate();

    const maxAttempts = input.identifierAttempts ?? MAX_IDENTIFIER_ATTEMPTS;
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
            passwordHash: access.passwordHash,
            temporaryPasswordExpiresAt: access.expiresAt,
          },
        });
        break;
      } catch (error) {
        const taken = error instanceof AppError && error.code === 'COMPANY_IDENTIFIER_TAKEN';
        if (!taken || attempt >= maxAttempts) throw error;
      }
    }
    await this.deps.accountAccess.saveLink(adminId, access);

    await this.deps.securityEvents.record({
      type: SecurityEventType.COMPANY_CREATED,
      userId: input.actor.userId,
      companyId,
      client: input.client,
      metadata: { adminId, delivery: access.delivery },
    });

    const company = await companies.findById(companyId);
    if (!company) throw PlatformErrors.companyNotFound();

    return { company, admin: { email, firstName: input.admin.firstName.trim() }, access };
  }
}
