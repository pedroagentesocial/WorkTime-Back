import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '#shared/application/ports/logger.js';
import type { DomainEvent } from '#shared/domain/domain-event.js';
import { InMemoryEventBus } from './in-memory-event-bus.js';

function fakeLogger(): Logger {
  const logger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => logger,
  };
  return logger;
}

const event = (name: string): DomainEvent => ({ name, occurredAt: new Date(), payload: {} });

describe('InMemoryEventBus', () => {
  it('entrega el evento solo a los suscriptores de ese nombre, en orden', async () => {
    const bus = new InMemoryEventBus({ logger: fakeLogger() });
    const calls: string[] = [];
    bus.subscribe('A', async () => {
      calls.push('a1');
    });
    bus.subscribe('A', async () => {
      calls.push('a2');
    });
    bus.subscribe('B', async () => {
      calls.push('b');
    });

    await bus.publish(event('A'));

    expect(calls).toEqual(['a1', 'a2']);
  });

  it('si un handler falla, registra el error y sigue con los demás', async () => {
    const logger = fakeLogger();
    const bus = new InMemoryEventBus({ logger });
    const after = vi.fn(async () => {});
    bus.subscribe('A', () => Promise.reject(new Error('boom')));
    bus.subscribe('A', after);

    await expect(bus.publish(event('A'))).resolves.toBeUndefined();

    expect(after).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it('publicar sin suscriptores no hace nada', async () => {
    const bus = new InMemoryEventBus({ logger: fakeLogger() });
    await expect(bus.publish(event('nadie'))).resolves.toBeUndefined();
  });
});
