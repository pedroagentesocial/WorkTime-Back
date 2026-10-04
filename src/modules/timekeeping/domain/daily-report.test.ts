import { describe, expect, it } from 'vitest';
import { DailyReportRules, pendingReportRange } from './daily-report.js';

const base = {
  workDate: '2026-06-10',
  todayLocal: '2026-06-10',
  reportExists: false,
  hasOpenEntryOnDate: false,
  hasEntriesOnDate: true,
};

describe('DailyReportRules.normalize', () => {
  it('recorta espacios y exige entre 10 y 2000 caracteres', () => {
    expect(DailyReportRules.normalize('  Atendí a los clientes  ')).toBe('Atendí a los clientes');
    expect(() => DailyReportRules.normalize('ok')).toThrow(
      expect.objectContaining({ code: 'INVALID_DAILY_REPORT' }),
    );
    expect(() => DailyReportRules.normalize('   corto   ')).toThrow(
      expect.objectContaining({ code: 'INVALID_DAILY_REPORT' }),
    );
    expect(() => DailyReportRules.normalize('x'.repeat(2001))).toThrow(
      expect.objectContaining({ code: 'INVALID_DAILY_REPORT' }),
    );
    expect(DailyReportRules.normalize('x'.repeat(2000))).toHaveLength(2000);
  });
});

describe('DailyReportRules.assertCanWrite', () => {
  it('permite escribir el de hoy y editarlo el mismo dia', () => {
    expect(() => {
      DailyReportRules.assertCanWrite(base);
    }).not.toThrow();
    expect(() => {
      DailyReportRules.assertCanWrite({ ...base, reportExists: true });
    }).not.toThrow();
  });

  it('un reporte existente de un dia anterior ya no se edita, salvo turno nocturno abierto', () => {
    const yesterday = { ...base, workDate: '2026-06-09', reportExists: true };
    expect(() => {
      DailyReportRules.assertCanWrite(yesterday);
    }).toThrow(expect.objectContaining({ code: 'DAILY_REPORT_LOCKED' }));
    expect(() => {
      DailyReportRules.assertCanWrite({ ...yesterday, hasOpenEntryOnDate: true });
    }).not.toThrow();
  });

  it('un reporte pendiente de un dia pasado se puede escribir si hubo trabajo y es reciente', () => {
    expect(() => {
      DailyReportRules.assertCanWrite({ ...base, workDate: '2026-06-02' });
    }).not.toThrow();
    expect(() => {
      DailyReportRules.assertCanWrite({ ...base, workDate: '2026-05-20' });
    }).toThrow(expect.objectContaining({ code: 'REPORT_DATE_TOO_OLD' }));
    expect(() => {
      DailyReportRules.assertCanWrite({ ...base, workDate: '2026-06-02', hasEntriesOnDate: false });
    }).toThrow(expect.objectContaining({ code: 'NO_WORK_ON_DATE' }));
  });

  it('no permite fechas futuras', () => {
    expect(() => {
      DailyReportRules.assertCanWrite({ ...base, workDate: '2026-06-11' });
    }).toThrow(expect.objectContaining({ code: 'INVALID_REPORT_DATE' }));
  });
});

describe('pendingReportRange', () => {
  it('va de los 14 días atrás hasta ayer, sin contar hoy', () => {
    expect(pendingReportRange('2026-10-07', '2000-01-01')).toEqual({
      from: '2026-09-23',
      to: '2026-10-06',
    });
  });

  it('no incluye días anteriores a que se exigiera el reporte', () => {
    expect(pendingReportRange('2026-10-07', '2026-10-05')).toEqual({
      from: '2026-10-05',
      to: '2026-10-06',
    });
  });

  it('si se exige desde hoy todavía no hay días que revisar', () => {
    expect(pendingReportRange('2026-10-07', '2026-10-07')).toBeNull();
  });
});

describe('DailyReportRules.assertCanWrite con una entrada abierta', () => {
  it('una entrada abierta se puede cerrar con su reporte aunque lleve más de 14 días', () => {
    expect(() => {
      DailyReportRules.assertCanWrite({
        ...base,
        workDate: '2026-05-01',
        todayLocal: '2026-06-10',
        hasOpenEntryOnDate: true,
      });
    }).not.toThrow();
  });

  it('sin entrada abierta, un día de hace más de 14 días sigue sin poder escribirse', () => {
    expect(() => {
      DailyReportRules.assertCanWrite({
        ...base,
        workDate: '2026-05-01',
        todayLocal: '2026-06-10',
      });
    }).toThrow(expect.objectContaining({ code: 'REPORT_DATE_TOO_OLD' }));
  });
});
