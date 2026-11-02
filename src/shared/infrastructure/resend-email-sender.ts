import type { EmailMessage, EmailSender } from '#shared/application/ports/email-sender.js';
import type { Logger } from '#shared/application/ports/logger.js';
import { isReservedEmailDomain } from '#shared/domain/email-rules.js';

const RESEND_URL = 'https://api.resend.com/emails';
const TIMEOUT_MS = 10_000;

// Envio con la API HTTP de Resend; sin SDK, basta un POST
export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const response = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // Solo el estado: la respuesta podria repetir datos del correo
    if (!response.ok) throw new Error(`Resend rechazó el envío (${response.status})`);
  }
}

// Sin Resend configurado no se envia nada: solo queda en el log que se omitio
export class DisabledEmailSender implements EmailSender {
  constructor(private readonly logger: Logger) {}

  send(message: EmailMessage): Promise<void> {
    this.logger.warn({ subject: message.subject }, 'Correo omitido: Resend no está configurado');
    return Promise.resolve();
  }
}

// Nunca envia a dominios reservados para pruebas: no existen y los rebotes dañan la reputacion del dominio
export class GuardedEmailSender implements EmailSender {
  constructor(
    private readonly inner: EmailSender,
    private readonly logger: Logger,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    if (isReservedEmailDomain(message.to)) {
      this.logger.info(
        { subject: message.subject },
        'Correo omitido: dominio reservado para pruebas',
      );
      return;
    }
    await this.inner.send(message);
  }
}
