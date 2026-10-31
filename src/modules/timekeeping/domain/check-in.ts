import { ValidationError } from '#shared/domain/errors.js';

// Registro de llegada a un lugar: hora y ubicacion sin marcar entrada. No cuenta horas
export const CHECK_IN_LIMITS = {
  noteMax: 200,
  // Tope por empleado y dia laboral, para frenar abusos sin estorbar a quien hace rutas largas
  perDay: 50,
} as const;

export const CheckInRules = {
  // Nota opcional: vacia o solo espacios cuenta como sin nota
  normalizeNote(raw: string | null | undefined): string | null {
    const note = raw?.trim() ?? '';
    if (note === '') return null;
    if (note.length > CHECK_IN_LIMITS.noteMax) {
      throw new ValidationError(
        'INVALID_CHECK_IN_NOTE',
        `La nota puede tener hasta ${CHECK_IN_LIMITS.noteMax} caracteres`,
      );
    }
    return note;
  },
};
