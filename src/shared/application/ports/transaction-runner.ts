// Los repositorios se suman solos a la transaccion en curso
export interface TransactionRunner {
  run<T>(work: () => Promise<T>): Promise<T>;
}
