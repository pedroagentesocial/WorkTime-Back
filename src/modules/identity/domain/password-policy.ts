import { ValidationError } from '#shared/domain/errors.js';

// Criterio NIST: se exige longitud, no complejidad artificial
export class PasswordPolicy {
  private static readonly TRIVIAL = new Set([
    '123456789012',
    '1234567890123',
    'qwertyuiop12',
    'password1234',
    'contraseña123',
    'contrasena123',
    'administrador',
  ]);

  constructor(
    private readonly minLength: number,
    private readonly maxLength: number,
  ) {}

  assertAcceptable(password: string, context: { email: string }): void {
    const problems: string[] = [];
    const length = Array.from(password).length;

    if (length < this.minLength) problems.push(`Debe tener al menos ${this.minLength} caracteres`);
    if (length > this.maxLength)
      problems.push(`Debe tener como máximo ${this.maxLength} caracteres`);

    const normalized = password.trim().toLowerCase();
    const emailUser = context.email.split('@')[0] ?? '';
    if (normalized === context.email.toLowerCase() || normalized === emailUser.toLowerCase()) {
      problems.push('No puede ser igual a tu email');
    }
    if (PasswordPolicy.TRIVIAL.has(normalized) || /^(.)\1+$/.test(password)) {
      problems.push('Es demasiado fácil de adivinar');
    }

    if (problems.length > 0) {
      throw new ValidationError(
        'WEAK_PASSWORD',
        'La nueva contraseña no cumple la política de seguridad',
        problems.map((message) => ({ location: 'body', path: 'newPassword', message })),
      );
    }
  }
}
