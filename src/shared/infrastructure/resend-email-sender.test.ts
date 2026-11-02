import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '#shared/application/ports/logger.js';
import { GuardedEmailSender, ResendEmailSender } from './resend-email-sender.js';

const message = { to: 'ana@gmail.com', subject: 'Hola', text: 'Texto', html: '<p>Texto</p>' };
const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Logger;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ResendEmailSender', () => {
  it('manda el correo a la API de Resend con la llave y el remitente', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await new ResendEmailSender('re_llave', 'WorkTime <no-responder@dashclass.studio>').send(
      message,
    );

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer re_llave' });
    expect(JSON.parse(init.body as string)).toMatchObject({
      from: 'WorkTime <no-responder@dashclass.studio>',
      to: ['ana@gmail.com'],
      subject: 'Hola',
    });
  });

  it('lanza si Resend rechaza el envío, sin repetir su respuesta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('detalle', { status: 422 })),
    );
    await expect(new ResendEmailSender('k', 'f').send(message)).rejects.toThrow(
      'Resend rechazó el envío (422)',
    );
  });
});

describe('GuardedEmailSender', () => {
  it('no envía a dominios reservados para pruebas', async () => {
    const inner = { send: vi.fn(async () => undefined) };
    const sender = new GuardedEmailSender(inner, logger);

    await sender.send({ ...message, to: 'ana@acme.test' });
    expect(inner.send).not.toHaveBeenCalled();
    await sender.send(message);
    expect(inner.send).toHaveBeenCalledTimes(1);
  });
});
