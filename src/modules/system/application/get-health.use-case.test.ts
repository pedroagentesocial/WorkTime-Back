import { describe, expect, it } from 'vitest';
import type { HealthIndicator } from './ports/health-indicator.js';
import { GetHealthUseCase } from './get-health.use-case.js';

const fixedClock = { now: () => new Date('2026-01-01T00:00:00.000Z') };

const indicator = (name: string, result: boolean | Error): HealthIndicator => ({
  name,
  isHealthy: () => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)),
});

describe('GetHealthUseCase', () => {
  it('reporta ok cuando todos los componentes responden', async () => {
    const useCase = new GetHealthUseCase({
      clock: fixedClock,
      healthIndicators: [indicator('database', true)],
    });

    const report = await useCase.execute();

    expect(report.status).toBe('ok');
    expect(report.checks).toEqual({ database: 'up' });
    expect(report.timestamp).toBe('2026-01-01T00:00:00.000Z');
  });

  it('reporta degraded si un componente falla o lanza error', async () => {
    const useCase = new GetHealthUseCase({
      clock: fixedClock,
      healthIndicators: [
        indicator('database', new Error('sin conexión')),
        indicator('cache', true),
      ],
    });

    const report = await useCase.execute();

    expect(report.status).toBe('degraded');
    expect(report.checks).toEqual({ database: 'down', cache: 'up' });
  });

  it('sin indicadores reporta ok', async () => {
    const useCase = new GetHealthUseCase({ clock: fixedClock, healthIndicators: [] });
    expect((await useCase.execute()).status).toBe('ok');
  });
});
