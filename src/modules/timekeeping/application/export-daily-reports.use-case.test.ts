import { describe, expect, it, vi } from 'vitest';
import type { Actor } from '#shared/application/actor.js';
import { Role } from '#shared/domain/permissions.js';
import { dailyReportsCsv } from '../presentation/daily-reports-csv.js';
import {
  ExportCompanyDailyReportsUseCase,
  MAX_REPORT_EXPORT_ROWS,
} from './daily-report.use-cases.js';
import type { DailyReportRepository, DailyReportView } from './ports/daily-report.repository.js';
import type { EmployeeDirectory } from './ports/employee-directory.js';

const admin: Actor = {
  userId: 'admin-1',
  role: Role.COMPANY_ADMIN,
  companyId: 'c1',
  mustChangePassword: false,
};

function view(index: number, content = 'Reporte de prueba del día'): DailyReportView {
  return {
    id: `r${index}`,
    employeeId: 'emp1',
    workDate: '2026-10-05',
    content,
    createdAt: new Date('2026-10-05T20:00:00Z'),
    updatedAt: new Date('2026-10-05T21:30:00Z'),
    employee: { id: 'emp1', firstName: 'Ana', lastName: 'López', employeeCode: 'KCS-0001' },
    revisions: 2,
  };
}

function build(total: number) {
  const list = vi.fn(
    async (_company: string, _filter: unknown, page: { page: number; limit: number }) => {
      const start = (page.page - 1) * page.limit;
      const items = Array.from(
        { length: Math.max(0, Math.min(page.limit, total - start)) },
        (_, i) => view(start + i),
      );
      return { items, page: page.page, limit: page.limit, total };
    },
  );
  const useCase = new ExportCompanyDailyReportsUseCase({
    dailyReportRepository: { list } as unknown as DailyReportRepository,
    employeeDirectory: { exists: async () => true } as unknown as EmployeeDirectory,
  });
  return { useCase, list };
}

describe('ExportCompanyDailyReportsUseCase', () => {
  it('recorre todas las páginas', async () => {
    const { useCase, list } = build(250);
    const reports = await useCase.execute({ actor: admin, filter: {} });
    expect(reports).toHaveLength(250);
    expect(list).toHaveBeenCalledTimes(3);
  });

  it('sin reportes devuelve una lista vacía', async () => {
    const { useCase } = build(0);
    expect(await useCase.execute({ actor: admin, filter: {} })).toEqual([]);
  });

  it('rechaza exportar más del máximo', async () => {
    const { useCase } = build(MAX_REPORT_EXPORT_ROWS + 1);
    await expect(useCase.execute({ actor: admin, filter: {} })).rejects.toMatchObject({
      code: 'EXPORT_TOO_LARGE',
    });
  });

  it('rechaza un rango invertido', async () => {
    const { useCase } = build(1);
    await expect(
      useCase.execute({ actor: admin, filter: { from: '2026-10-06', to: '2026-10-01' } }),
    ).rejects.toMatchObject({ code: 'INVALID_DATE_RANGE' });
  });
});

describe('dailyReportsCsv', () => {
  const body = (csv: string) => csv.replace('﻿', '').split('\r\n');

  it('lleva el encabezado y una fila por reporte', () => {
    const lines = body(dailyReportsCsv([view(1)]));
    expect(lines[0]).toBe('Código,Empleado,Fecha,Reporte,Creado (UTC),Última edición (UTC)');
    expect(lines[1]).toBe(
      'KCS-0001,Ana López,2026-10-05,Reporte de prueba del día,2026-10-05T20:00:00.000Z,2026-10-05T21:30:00.000Z',
    );
  });

  it('entrecomilla comas, comillas y saltos de línea', () => {
    const csv = dailyReportsCsv([view(1, 'Primero, "segundo"\ntercero')]);
    expect(csv).toContain('"Primero, ""segundo""\ntercero"');
  });

  it('neutraliza formulas de Excel', () => {
    const csv = dailyReportsCsv([view(1, '=HYPERLINK("http://x")'), view(2, '+cmd|calc')]);
    expect(csv).toContain(`'=HYPERLINK`);
    expect(csv).toContain(`'+cmd|calc`);
  });

  it('entrega el reporte como texto plano sin marcas de Markdown', () => {
    const csv = dailyReportsCsv([
      view(
        1,
        '## Tarde\n\n**Cerré** la caja y _revisé_ [el tablero](https://ejemplo.com/t)\n\n- uno\n- dos',
      ),
    ]);
    expect(csv).toContain(
      '"Tarde\n\nCerré la caja y revisé el tablero (https://ejemplo.com/t)\n\n• uno\n• dos"',
    );
    expect(csv).not.toContain('**');
    expect(csv).not.toContain('##');
  });

  it('no incluye las versiones anteriores', () => {
    expect(dailyReportsCsv([view(1)])).not.toContain('Versiones');
  });

  it('empieza con BOM UTF-8', () => {
    expect(dailyReportsCsv([]).charCodeAt(0)).toBe(0xfeff);
  });
});
