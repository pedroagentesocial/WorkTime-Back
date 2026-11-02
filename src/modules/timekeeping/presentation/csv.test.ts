import { describe, expect, it } from 'vitest';
import { csvCell } from './csv.js';

describe('csvCell', () => {
  it('neutraliza un texto que empieza como fórmula', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('pone entre comillas un texto con punto y coma para que Excel en español no lo parta', () => {
    expect(csvCell('x;=HYPERLINK("http://a");')).toBe('"x;=HYPERLINK(""http://a"");"');
  });

  it('deja tal cual un texto normal y formatea los números', () => {
    expect(csvCell('Ana López')).toBe('Ana López');
    expect(csvCell(8)).toBe('8.00');
  });
});
