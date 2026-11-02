import { accountEmail } from '#shared/application/account-emails.js';
import type { EmailMessage } from '#shared/application/ports/email-sender.js';

export function passwordResetEmail({
  to,
  firstName,
  link,
  ttlMinutes,
}: {
  to: string;
  firstName: string;
  link: string;
  ttlMinutes: number;
}): EmailMessage {
  return accountEmail({
    to,
    firstName,
    subject: 'Restablece tu contraseña de WorkTime',
    intro: 'Recibimos una solicitud para restablecer la contraseña de tu cuenta de WorkTime.',
    action: 'Crear una contraseña nueva',
    link,
    validity: `El enlace vence en ${ttlMinutes} minutos y solo sirve una vez`,
    closing: 'Si no lo pediste tú, ignora este correo: tu contraseña no cambia.',
  });
}
