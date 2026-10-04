import type { EventBus, EventHandler } from '#shared/application/ports/event-bus.js';
import type { Logger } from '#shared/application/ports/logger.js';
import type { DomainEvent } from '#shared/domain/domain-event.js';

interface Deps {
  logger: Logger;
}

// Si un manejador falla se registra y se sigue: un efecto secundario no revierte la accion
export class InMemoryEventBus implements EventBus {
  private readonly handlers = new Map<string, EventHandler[]>();
  private readonly logger: Logger;

  constructor({ logger }: Deps) {
    this.logger = logger.child({ component: 'event-bus' });
  }

  subscribe<TEvent extends DomainEvent>(
    eventName: TEvent['name'],
    handler: EventHandler<TEvent>,
  ): void {
    const list = this.handlers.get(eventName) ?? [];
    list.push(handler as EventHandler);
    this.handlers.set(eventName, list);
  }

  async publish(...events: DomainEvent[]): Promise<void> {
    for (const event of events) {
      for (const handler of this.handlers.get(event.name) ?? []) {
        try {
          await handler(event);
        } catch (error) {
          this.logger.error({ err: error, event: event.name }, 'Falló un handler de evento');
        }
      }
    }
  }
}
