export interface PeriodClosureView {
  readonly id: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly totalCentihours: number;
  // Moneda de los pagos congelados; null si se cerro antes de que hubiera sueldos
  readonly currency: string | null;
  readonly closedAt: Date;
  readonly closedBy: { readonly id: string; readonly firstName: string; readonly lastName: string };
}

export interface NewPeriodClosure {
  readonly id: string;
  readonly companyId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly totalCentihours: number;
  readonly closedById: string;
  readonly currency: string | null;
  readonly pays: readonly { readonly employeeId: string; readonly amountCents: number }[];
}

export interface PeriodClosureRepository {
  find(companyId: string, periodStart: string): Promise<PeriodClosureView | null>;
  findCovering(companyId: string, workDate: string): Promise<PeriodClosureView | null>;
  insert(closure: NewPeriodClosure): Promise<void>;
  // Pago congelado de cada empleado al cerrar
  findPays(companyId: string, closureId: string): Promise<Map<string, number>>;
  // Quien cambia horas toma este bloqueo compartido antes de revisar si el periodo esta cerrado
  lockForChanges(companyId: string): Promise<void>;
  // Quien cierra un periodo espera a que terminen los cambios en curso y frena los nuevos
  lockForClosing(companyId: string): Promise<void>;
}
