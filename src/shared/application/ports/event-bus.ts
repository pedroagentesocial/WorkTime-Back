import type { DomainEvent } from '#shared/domain/domain-event.js';

export type EventHandler<TEvent extends DomainEvent = DomainEvent> = (
  event: TEvent,
) => Promise<void>;

export interface EventBus {
  publish(...events: DomainEvent[]): Promise<void>;
  subscribe<TEvent extends DomainEvent>(
    eventName: TEvent['name'],
    handler: EventHandler<TEvent>,
  ): void;
}
