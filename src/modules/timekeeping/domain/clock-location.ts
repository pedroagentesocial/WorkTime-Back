import { ValidationError } from '#shared/domain/errors.js';

// Donde estaba la persona al marcar la entrada. Llega del dispositivo, asi que es un indicio y no una prueba
export interface ClockLocation {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyMeters: number;
}

export const MAX_ACCURACY_METERS = 100_000;

export const ClockLocationRules = {
  // Devuelve la ubicacion tal cual si es valida; la precision baja no se rechaza, solo se guarda
  assertValid(location: ClockLocation): ClockLocation {
    const { latitude, longitude, accuracyMeters } = location;
    const finite = [latitude, longitude, accuracyMeters].every(Number.isFinite);
    if (
      !finite ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180 ||
      accuracyMeters < 0 ||
      accuracyMeters > MAX_ACCURACY_METERS
    ) {
      throw new ValidationError('INVALID_LOCATION', 'La ubicación enviada no es válida');
    }
    return { latitude, longitude, accuracyMeters };
  },
};
