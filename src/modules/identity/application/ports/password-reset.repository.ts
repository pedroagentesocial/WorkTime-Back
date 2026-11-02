export interface StoredPasswordReset {
  readonly id: string;
  readonly userId: string;
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
}

export interface PasswordResetRepository {
  // Fecha del ultimo enlace pedido por la persona, para no mandar correos seguidos
  latestCreatedAt(userId: string): Promise<Date | null>;
  // Cada persona tiene a lo sumo un enlace: el nuevo reemplaza a los anteriores
  replaceForUser(reset: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    createdAt: Date;
    ip: string | null;
  }): Promise<void>;
  findByHash(tokenHash: string): Promise<StoredPasswordReset | null>;
  // Solo si no se habia usado: dos usos a la vez no pasan los dos
  markUsed(id: string, at: Date): Promise<boolean>;
}
