import { asClass, asValue } from 'awilix';
import { JOBS } from '#config/jobs.js';
import { RETENTION } from '#config/retention.js';
import { SECURITY } from '#config/security.js';
import type { AppModule } from '#shared/composition/app-module.js';
import type { DataRetentionRepository } from './application/ports/data-retention.repository.js';
import {
  PurgeOldDataUseCase,
  type RetentionPolicy,
} from './application/purge-old-data.use-case.js';
import { PrismaDataRetentionRepository } from './infrastructure/prisma-data-retention.repository.js';

declare module '#shared/composition/container.js' {
  interface Cradle {
    retentionPolicy: RetentionPolicy;
    dataRetentionRepository: DataRetentionRepository;
    purgeOldData: PurgeOldDataUseCase;
  }
}

export const maintenanceModule: AppModule = {
  name: 'maintenance',

  register(container) {
    container.register({
      retentionPolicy: asValue({
        sessionMaxAgeDays: SECURITY.session.maxAgeDays,
        refreshTokenGraceDays: RETENTION.refreshTokenGraceDays,
        securityEventDays: RETENTION.securityEventDays,
        batchSize: RETENTION.deleteBatchSize,
        maxBatchesPerRun: RETENTION.maxBatchesPerRun,
      } satisfies RetentionPolicy),
      dataRetentionRepository: asClass(PrismaDataRetentionRepository).singleton(),
      purgeOldData: asClass(PurgeOldDataUseCase).singleton(),
    });
  },

  jobs: (container) => [
    {
      name: 'purge-old-data',
      intervalMs: JOBS.purgeOldDataMs,
      run: () => container.cradle.purgeOldData.execute(),
    },
  ],
};
