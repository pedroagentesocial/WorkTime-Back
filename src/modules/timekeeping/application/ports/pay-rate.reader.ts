import type { CompanyPaySetup } from '../../domain/pay.js';

export interface PayRateReader {
  // Moneda, cambios de sueldo con fecha hasta "until" y fechas de baja; null si la empresa no existe
  setupOf(companyId: string, until: string): Promise<CompanyPaySetup | null>;
}
