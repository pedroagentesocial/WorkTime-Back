import { isReservedEmailDomain } from '#shared/domain/email-rules.js';
import { accountEmail } from './account-emails.js';
import type { AccessLinkStore } from './ports/access-link-store.js';
import type { Clock } from './ports/clock.js';
import type { EmailSender } from './ports/email-sender.js';
import type { IdGenerator } from './ports/id-generator.js';
import type { Logger } from './ports/logger.js';
import type { SecureRandom } from './ports/secure-random.js';
import type { TemporaryPasswordIssuer } from './temporary-password-issuer.js';

// Como recibe su acceso una cuenta nueva o restablecida: un enlace por correo para crear su
// contrasena, o una contrasena temporal que el admin le entrega
export type AccessDelivery = 'email' | 'temporary_password';
export const ACCESS_DELIVERIES = ['email', 'temporary_password'] as const;

export interface AccountAccessSettings {
  // Direccion del front para el enlace; null si no hay correos configurados
  readonly appUrl: string | null;
}

export interface PreparedAccess {
  readonly delivery: AccessDelivery;
  // El hash que se guarda: el de la temporal, o uno al azar que nadie conoce si va por correo
  readonly passwordHash: string;
  readonly expiresAt: Date;
  readonly temporaryPassword: string | null;
  readonly token: string | null;
}

export interface AccessResult {
  readonly delivery: AccessDelivery;
  // false si el correo no se pudo enviar: el admin puede reenviarlo o darle una temporal
  readonly emailSent: boolean;
  readonly temporaryPassword: string | null;
  readonly expiresAt: Date;
}

interface Deps {
  temporaryPasswords: TemporaryPasswordIssuer;
  accessLinks: AccessLinkStore;
  accountAccessSettings: AccountAccessSettings;
  emailSender: EmailSender;
  secureRandom: SecureRandom;
  idGenerator: IdGenerator;
  clock: Clock;
  logger: Logger;
}

export class AccountAccess {
  constructor(private readonly deps: Deps) {}

  // Antes de guardar la cuenta. Va por correo salvo que el admin pida temporal, no haya correos
  // configurados o el correo sea de un dominio reservado para pruebas, que nunca llegaria
  async prepare(email: string, preferred: AccessDelivery = 'email'): Promise<PreparedAccess> {
    const byEmail =
      preferred === 'email' &&
      this.deps.accountAccessSettings.appUrl !== null &&
      !isReservedEmailDomain(email);
    const temporary = await this.deps.temporaryPasswords.issue();
    return {
      delivery: byEmail ? 'email' : 'temporary_password',
      passwordHash: temporary.passwordHash,
      expiresAt: temporary.expiresAt,
      temporaryPassword: byEmail ? null : temporary.password,
      token: byEmail ? this.deps.secureRandom.token() : null,
    };
  }

  // Dentro de la transaccion que crea o restablece la cuenta: guarda el enlace del correo
  async saveLink(userId: string, access: PreparedAccess): Promise<void> {
    if (!access.token) return;
    await this.deps.accessLinks.replaceForUser({
      id: this.deps.idGenerator.generate(),
      userId,
      tokenHash: this.deps.secureRandom.sha256(access.token),
      expiresAt: access.expiresAt,
      createdAt: this.deps.clock.now(),
      ip: null,
    });
  }

  // Despues de la transaccion: manda el correo y dice si salio
  async deliver(
    person: { email: string; firstName: string },
    access: PreparedAccess,
    kind: 'welcome' | 'reset',
  ): Promise<AccessResult> {
    const result = {
      delivery: access.delivery,
      temporaryPassword: access.temporaryPassword,
      expiresAt: access.expiresAt,
    };
    const appUrl = this.deps.accountAccessSettings.appUrl;
    if (!access.token || appUrl === null) return { ...result, emailSent: false };

    const page = kind === 'welcome' ? 'crear-contrasena' : 'restablecer-contrasena';
    const link = `${appUrl}/${page}?token=${encodeURIComponent(access.token)}`;
    const hours = Math.round(
      (access.expiresAt.getTime() - this.deps.clock.now().getTime()) / 3_600_000,
    );
    const message = accountEmail({
      to: person.email,
      firstName: person.firstName,
      link,
      validity: `El enlace vence en ${hours} horas y solo sirve una vez`,
      ...(kind === 'welcome'
        ? {
            subject: 'Te damos la bienvenida a WorkTime',
            intro: 'Te crearon una cuenta en WorkTime. Crea tu contraseña para empezar a usarla.',
            action: 'Crear mi contraseña',
            closing: 'Si no esperabas este correo, ignóralo: nadie podrá entrar sin el enlace.',
          }
        : {
            subject: 'Tu administrador restableció tu contraseña de WorkTime',
            intro:
              'Tu administrador restableció tu contraseña y cerró tus sesiones abiertas. Crea una nueva para volver a entrar.',
            action: 'Crear una contraseña nueva',
            closing: 'Si no lo pediste, avísale a tu administrador.',
          }),
    });
    try {
      await this.deps.emailSender.send(message);
      return { ...result, emailSent: true };
    } catch (error) {
      this.deps.logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'No se pudo enviar el correo de acceso',
      );
      return { ...result, emailSent: false };
    }
  }
}
