import type { AnyRoute } from '#shared/http/route.js';
import type { AppContainer } from './container.js';

// Tarea periodica; debe ser idempotente porque puede correr en varias instancias
export interface Job {
  readonly name: string;
  readonly intervalMs: number;
  run(): Promise<unknown>;
}

export interface AppModule {
  readonly name: string;
  register(container: AppContainer): void;
  routes?(container: AppContainer): readonly AnyRoute[];
  subscribe?(container: AppContainer): void;
  jobs?(container: AppContainer): readonly Job[];
}
