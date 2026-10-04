import { asClass, asFunction } from 'awilix';
import type { AppModule } from '#shared/composition/app-module.js';
import type { Cradle } from '#shared/composition/container.js';
import { GetHealthUseCase } from './application/get-health.use-case.js';
import type { HealthIndicator } from './application/ports/health-indicator.js';
import { PrismaHealthIndicator } from './infrastructure/prisma-health-indicator.js';
import { systemRoutes } from './presentation/system.routes.js';

declare module '#shared/composition/container.js' {
  interface Cradle {
    healthIndicators: HealthIndicator[];
    getHealth: GetHealthUseCase;
  }
}

export const systemModule: AppModule = {
  name: 'system',

  register(container) {
    container.register({
      healthIndicators: asFunction(({ prisma }: Cradle) => [
        new PrismaHealthIndicator({ prisma }),
      ]).singleton(),
      getHealth: asClass(GetHealthUseCase).singleton(),
    });
  },

  routes: (container) => systemRoutes(container.cradle),
};
