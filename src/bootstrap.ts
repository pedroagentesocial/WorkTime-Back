import type { Express } from 'express';
import type { Env } from '#config/env.js';
import type { AppModule } from '#shared/composition/app-module.js';
import { createAppContainer, type AppContainer } from '#shared/composition/container.js';
import { createLogger } from '#shared/infrastructure/logger.js';
import { createApp } from './app.js';

export interface Application {
  readonly app: Express;
  readonly container: AppContainer;
}

export interface BootstrapOptions {
  configure?(container: AppContainer): void;
}

export function bootstrap(
  env: Env,
  modules: readonly AppModule[],
  options: BootstrapOptions = {},
): Application {
  const container = createAppContainer(env, createLogger(env));

  for (const module of modules) module.register(container);
  options.configure?.(container);
  for (const module of modules) module.subscribe?.(container);

  return { app: createApp(container, modules), container };
}
