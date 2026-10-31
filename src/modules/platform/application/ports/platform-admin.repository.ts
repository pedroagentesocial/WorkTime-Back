export interface PlatformAdminSummary {
  readonly id: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
}

export interface PlatformAdminRepository {
  // Deja al unico admin global activo, desbloqueado, con la contrasena nueva y sin sesiones vivas
  recoverAccess(password: {
    passwordHash: string;
    expiresAt: Date;
  }): Promise<PlatformAdminSummary | null>;
}
