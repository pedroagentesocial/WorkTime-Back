const UNIT_IN_MS = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
} as const;

type DurationUnit = keyof typeof UNIT_IN_MS;

const DURATION_PATTERN = /^(\d+)([smhd])$/;

export function parseDuration(value: string): number {
  const match = DURATION_PATTERN.exec(value.trim());
  if (!match) {
    throw new Error(
      `Duración inválida: "${value}". Usa un número y una unidad (s, m, h, d), p. ej. 15m.`,
    );
  }
  const [, amount, unit] = match;
  return Number(amount) * UNIT_IN_MS[unit as DurationUnit];
}
