import type { EmailMessage } from './ports/email-sender.js';

// Lo escribe la persona o un admin: se escapa para que no meta HTML en el correo
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export interface AccountEmail {
  readonly to: string;
  readonly firstName: string;
  readonly subject: string;
  readonly intro: string;
  readonly action: string;
  readonly link: string;
  readonly validity: string;
  readonly closing: string;
}

// Correo de cuenta con un enlace: crear o restablecer la contraseña
export function accountEmail(email: AccountEmail): EmailMessage {
  const name = email.firstName.trim();
  const greeting = name ? `Hola, ${name}:` : 'Hola:';
  const text = [
    greeting,
    '',
    email.intro,
    `${email.validity}:`,
    '',
    email.link,
    '',
    email.closing,
  ].join('\n');

  const html = `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:24px;background:#eeeef1;font-family:Arial,Helvetica,sans-serif;color:#18181d">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;padding:32px">
            <tr><td style="font-size:20px;font-weight:bold;color:#155eef;padding-bottom:24px">WorkTime</td></tr>
            <tr><td style="font-size:16px;padding-bottom:12px">${escapeHtml(greeting)}</td></tr>
            <tr><td style="font-size:15px;line-height:1.5;padding-bottom:8px">${escapeHtml(email.intro)}</td></tr>
            <tr><td style="font-size:14px;line-height:1.5;color:#67676f;padding-bottom:24px">${escapeHtml(email.validity)}.</td></tr>
            <tr>
              <td style="padding-bottom:24px">
                <a href="${escapeHtml(email.link)}" style="display:inline-block;background:#155eef;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:999px">${escapeHtml(email.action)}</a>
              </td>
            </tr>
            <tr><td style="font-size:13px;line-height:1.5;color:#67676f">${escapeHtml(email.closing)}</td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { to: email.to, subject: email.subject, text, html };
}
