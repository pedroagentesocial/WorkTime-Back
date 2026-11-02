import {
  asClass,
  asFunction,
  asValue,
  createContainer,
  InjectionMode,
  type AwilixContainer,
} from 'awilix';
import type { Logger as PinoLogger } from 'pino';
import type { Env } from '#config/env.js';
import { SECURITY } from '#config/security.js';
import type { Authenticator } from '#shared/application/ports/authenticator.js';
import type { Clock } from '#shared/application/ports/clock.js';
import type { EmailSender } from '#shared/application/ports/email-sender.js';
import type { AccessLinkStore } from '#shared/application/ports/access-link-store.js';
import { AccountAccess, type AccountAccessSettings } from '#shared/application/account-access.js';
import type { EventBus } from '#shared/application/ports/event-bus.js';
import type { IdGenerator } from '#shared/application/ports/id-generator.js';
import type { PasswordHasher } from '#shared/application/ports/password-hasher.js';
import type { SecurityEventRecorder } from '#shared/application/ports/security-event-recorder.js';
import {
  TemporaryPasswordIssuer,
  type TemporaryPasswordSettings,
} from '#shared/application/temporary-password-issuer.js';
import type { SecureRandom } from '#shared/application/ports/secure-random.js';
import type { TransactionRunner } from '#shared/application/ports/transaction-runner.js';
import type { TokenService } from '#shared/application/ports/token-service.js';
import { DEFAULT_RATE_LIMITS, type RateLimitPolicy } from '#shared/http/middlewares/rate-limit.js';
import { Argon2PasswordHasher } from '#shared/infrastructure/argon2-password-hasher.js';
import { InMemoryEventBus } from '#shared/infrastructure/in-memory-event-bus.js';
import { JoseTokenService } from '#shared/infrastructure/jose-token-service.js';
import {
  createPrismaClient,
  type PrismaClient,
} from '#shared/infrastructure/prisma/prisma-client.js';
import { PrismaAccessLinkStore } from '#shared/infrastructure/prisma/prisma-access-link-store.js';
import { PrismaDb } from '#shared/infrastructure/prisma/prisma-db.js';
import { PrismaSecurityEventRecorder } from '#shared/infrastructure/prisma/prisma-security-event-recorder.js';
import { NodeSecureRandom } from '#shared/infrastructure/node-secure-random.js';
import {
  DisabledEmailSender,
  GuardedEmailSender,
  ResendEmailSender,
} from '#shared/infrastructure/resend-email-sender.js';
import { SystemClock } from '#shared/infrastructure/system-clock.js';
import { UuidV7IdGenerator } from '#shared/infrastructure/uuid-v7-id-generator.js';

export interface Cradle {
  env: Env;
  logger: PinoLogger;
  clock: Clock;
  idGenerator: IdGenerator;
  eventBus: EventBus;
  passwordHasher: PasswordHasher;
  tokenService: TokenService;
  secureRandom: SecureRandom;
  prisma: PrismaClient;
  db: PrismaDb;
  transactions: TransactionRunner;
  rateLimits: RateLimitPolicy;
  securityEvents: SecurityEventRecorder;
  temporaryPasswordSettings: TemporaryPasswordSettings;
  temporaryPasswords: TemporaryPasswordIssuer;
  authenticator: Authenticator;
  emailSender: EmailSender;
  accessLinks: AccessLinkStore;
  accountAccessSettings: AccountAccessSettings;
  accountAccess: AccountAccess;
}

export type AppContainer = AwilixContainer<Cradle>;

export function createAppContainer(env: Env, logger: PinoLogger): AppContainer {
  const container = createContainer<Cradle>({ injectionMode: InjectionMode.PROXY, strict: true });

  container.register({
    env: asValue(env),
    logger: asValue(logger),
    rateLimits: asValue(DEFAULT_RATE_LIMITS),
    clock: asClass(SystemClock).singleton(),
    idGenerator: asClass(UuidV7IdGenerator).singleton(),
    eventBus: asClass(InMemoryEventBus).singleton(),
    passwordHasher: asClass(Argon2PasswordHasher).singleton(),
    tokenService: asClass(JoseTokenService).singleton(),
    secureRandom: asClass(NodeSecureRandom).singleton(),
    prisma: asFunction(() => createPrismaClient(env, logger))
      .singleton()
      .disposer((prisma) => prisma.$disconnect()),
    db: asClass(PrismaDb).singleton(),
    transactions: asFunction(({ db }: Cradle) => db).singleton(),
    securityEvents: asClass(PrismaSecurityEventRecorder).singleton(),
    temporaryPasswordSettings: asValue({
      length: SECURITY.password.temporaryLength,
      ttlHours: SECURITY.password.temporaryTtlHours,
    }),
    temporaryPasswords: asClass(TemporaryPasswordIssuer).singleton(),
    accessLinks: asClass(PrismaAccessLinkStore).singleton(),
    accountAccessSettings: asValue({ appUrl: env.email?.appUrl ?? null }),
    accountAccess: asClass(AccountAccess).singleton(),
    emailSender: asFunction(
      (): EmailSender =>
        new GuardedEmailSender(
          env.email
            ? new ResendEmailSender(env.email.resendApiKey, env.email.from)
            : new DisabledEmailSender(logger),
          logger,
        ),
    ).singleton(),
  });

  return container;
}
