// Un texto que empieza con estos caracteres se interpreta como formula en Excel
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

const BOM = String.fromCharCode(0xfeff);

export function csvCell(value: string | number): string {
  const text = typeof value === 'number' ? value.toFixed(2) : value;
  const safe = typeof value === 'string' && FORMULA_PREFIX.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function toCsv(lines: readonly (readonly (string | number)[])[]): string {
  return `${BOM}${lines.map((line) => line.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
