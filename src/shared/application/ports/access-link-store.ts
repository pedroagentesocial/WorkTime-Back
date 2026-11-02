// Enlaces de un solo uso para crear o restablecer la contrasena; los usa POST /auth/password-reset/confirm
export interface AccessLinkStore {
  // Cada persona tiene a lo sumo un enlace: el nuevo reemplaza a los anteriores
  replaceForUser(link: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    createdAt: Date;
    ip: string | null;
  }): Promise<void>;
}
