import type { WorkSiteRef } from '../../domain/work-zone.js';

// Zonas de trabajo activas de una empresa; las administra el modulo de empresa y aqui solo se leen
export interface WorkSiteReader {
  listActive(companyId: string): Promise<WorkSiteRef[]>;
}
