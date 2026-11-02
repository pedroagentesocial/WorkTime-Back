import type { EmailMessage, EmailSender } from '#shared/application/ports/email-sender.js';

export class FakeEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];
  // Simula que el proveedor rechaza el siguiente envio
  failNext = false;

  send(message: EmailMessage): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('Resend rechazó el envío (500)'));
    }
    this.sent.push(message);
    return Promise.resolve();
  }

  // Token del ultimo enlace de recuperacion enviado a ese correo
  resetTokenFor(email: string): string {
    const message = this.sent.filter((item) => item.to === email).at(-1);
    const match = /token=([^\s"&]+)/.exec(message?.text ?? '');
    if (!match?.[1]) throw new Error(`No se envió un enlace a ${email}`);
    return decodeURIComponent(match[1]);
  }
}
