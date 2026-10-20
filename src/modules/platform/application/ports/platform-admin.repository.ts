export interface PlatformAdminView {
  readonly id: string;
  readonly email: string;
}

export interface PlatformAdminRepository {
  // Siempre deberia haber uno; se listan todos para no actuar a ciegas si hubiera mas
  listAll(): Promise<PlatformAdminView[]>;
  // Contrasena temporal, desbloqueo, reactivacion y cierre de todas sus sesiones en un solo paso
  recover(id: string, password: { passwordHash: string; expiresAt: Date }): Promise<void>;
}
