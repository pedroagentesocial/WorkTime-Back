// Todo instante se guarda en UTC; se usan zonas IANA, nunca desfases fijos
export function isValidTimezone(value: string): boolean {
  if (value.length === 0 || value.length > 64 || !/^[A-Za-z0-9_+/-]+$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function resolveTimezone(own: string | null | undefined, inherited: string): string {
  return own ?? inherited;
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timezone, formatter);
  }
  return formatter;
}

function localParts(instant: Date, timezone: string): LocalParts {
  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
  for (const part of formatterFor(timezone).formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year ?? 0,
    month: parts.month ?? 0,
    day: parts.day ?? 0,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
}

const pad = (value: number, length = 2): string => String(Math.abs(value)).padStart(length, '0');

export function localDateOf(instant: Date, timezone: string): string {
  const { year, month, day } = localParts(instant, timezone);
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

export function utcOffsetMinutes(instant: Date, timezone: string): number {
  const p = localParts(instant, timezone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const truncated = Math.floor(instant.getTime() / 1000) * 1000;
  return Math.round((asIfUtc - truncated) / 60_000);
}

export function toLocalIsoString(instant: Date, timezone: string): string {
  const p = localParts(instant, timezone);
  const offset = utcOffsetMinutes(instant, timezone);
  const sign = offset < 0 ? '-' : '+';
  const offsetText = `${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
  return (
    `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}` +
    `T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${offsetText}`
  );
}
