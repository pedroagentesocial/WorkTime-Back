// Los limites se comparan en segundos exactos, no en horas decimales

export function limitSeconds(limitMinutes: number): number {
  return limitMinutes * 60;
}

export function remainingSeconds(limitMinutes: number, workedSeconds: number): number {
  return Math.max(0, limitSeconds(limitMinutes) - workedSeconds);
}

export function limitReachedAt(
  clockInAt: Date,
  workedBeforeSeconds: number,
  limitMinutes: number,
): Date {
  return new Date(
    clockInAt.getTime() + remainingSeconds(limitMinutes, workedBeforeSeconds) * 1_000,
  );
}
