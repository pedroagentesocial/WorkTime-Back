import { AsyncLocalStorage } from 'node:async_hooks';
import type { TransactionRunner } from '#shared/application/ports/transaction-runner.js';
import type { Prisma } from '#generated/prisma/client.js';
import type { PrismaClient } from './prisma-client.js';

interface Deps {
  prisma: PrismaClient;
}

const TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

// La transaccion viaja por AsyncLocalStorage: los repositorios la usan sin recibirla
export class PrismaDb implements TransactionRunner {
  private readonly prisma: PrismaClient;
  private readonly storage = new AsyncLocalStorage<Prisma.TransactionClient>();

  constructor({ prisma }: Deps) {
    this.prisma = prisma;
  }

  get client(): Prisma.TransactionClient {
    return this.storage.getStore() ?? this.prisma;
  }

  run<T>(work: () => Promise<T>): Promise<T> {
    if (this.storage.getStore()) return work();
    return this.prisma.$transaction((tx) => this.storage.run(tx, work), TRANSACTION_OPTIONS);
  }
}
