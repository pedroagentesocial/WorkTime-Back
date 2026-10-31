// Una baja: dias en que el empleado no cobra sueldo fijo. toDay null mientras sigue inactivo
export interface InactiveSpanView {
  readonly fromDay: string;
  readonly toDay: string | null;
}

export interface InactiveSpanRepository {
  // De la mas vieja a la mas nueva
  list(companyId: string, employeeId: string): Promise<InactiveSpanView[]>;
  start(companyId: string, employeeId: string, fromDay: string): Promise<void>;
  end(companyId: string, employeeId: string, fromDay: string, toDay: string): Promise<void>;
  remove(companyId: string, employeeId: string, fromDay: string): Promise<void>;
}
