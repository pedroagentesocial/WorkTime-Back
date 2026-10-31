import type { PayKind } from '#shared/domain/pay-rules.js';

export interface PayRateView {
  readonly id: string;
  readonly kind: PayKind;
  readonly amountCents: number;
  readonly effectiveFrom: string;
  readonly changedById: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewPayRate {
  readonly id: string;
  readonly kind: PayKind;
  readonly amountCents: number;
  readonly effectiveFrom: string;
  readonly changedById: string;
}

export interface PayRateRepository {
  // Del cambio mas nuevo al mas viejo
  list(companyId: string, employeeId: string): Promise<PayRateView[]>;
  find(companyId: string, employeeId: string, rateId: string): Promise<PayRateView | null>;
  // Uno por dia: si ya hay un cambio con esa fecha, lo reemplaza
  save(companyId: string, employeeId: string, rate: NewPayRate): Promise<void>;
  remove(companyId: string, rateId: string): Promise<void>;
  lastClosedDay(companyId: string): Promise<string | null>;
  // Bloquea la empresa contra un cierre en curso y da el ultimo dia ya cerrado
  lockAndLastClosedDay(companyId: string): Promise<string | null>;
  currencyOf(companyId: string): Promise<string | null>;
}
