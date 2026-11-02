// Un texto que empieza con estos caracteres se interpreta como formula en Excel
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

const BOM = String.fromCharCode(0xfeff);

export function csvCell(value: string | number): string {
  const text = typeof value === 'number' ? value.toFixed(2) : value;
  const safe = typeof value === 'string' && FORMULA_PREFIX.test(text) ? `'${text}` : text;
  // El punto y coma tambien va entre comillas: Excel en espanol lo usa como separador y partiria la
  // celda, dejando lo que sigue como una celda nueva que podria ser una formula
  return /[",;\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function toCsv(lines: readonly (readonly (string | number)[])[]): string {
  return `${BOM}${lines.map((line) => line.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
