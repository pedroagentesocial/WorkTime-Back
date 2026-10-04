import type { AppModule } from '#shared/composition/app-module.js';
import { identityModule } from './identity/identity.module.js';
import { maintenanceModule } from './maintenance/maintenance.module.js';
import { platformModule } from './platform/platform.module.js';
import { systemModule } from './system/system.module.js';
import { timekeepingModule } from './timekeeping/timekeeping.module.js';
import { workforceModule } from './workforce/workforce.module.js';

export const modules: readonly AppModule[] = [
  systemModule,
  identityModule,
  platformModule,
  workforceModule,
  timekeepingModule,
  maintenanceModule,
];
