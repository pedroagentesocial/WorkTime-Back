const SECONDS_PER_CENTIHOUR = 36;

export function durationSeconds(clockInAt: Date, clockOutAt: Date): number {
  return Math.floor((clockOutAt.getTime() - clockInAt.getTime()) / 1_000);
}

// Centesimas de hora enteras, redondeadas al mas cercano con aritmetica entera
// El SQL de los totales repite esta misma formula, floor de segundos mas 18 entre 36
export function toCentihours(seconds: number): number {
  return Math.floor((seconds + SECONDS_PER_CENTIHOUR / 2) / SECONDS_PER_CENTIHOUR);
}

export function centihoursToHours(centihours: number): number {
  return centihours / 100;
}

export function toDecimalHours(seconds: number): number {
  return centihoursToHours(toCentihours(seconds));
}
