import type { Clock } from '#shared/application/ports/clock.js';
import type { UseCase } from '#shared/application/use-case.js';
import type { HealthIndicator } from './ports/health-indicator.js';

export type ComponentStatus = 'up' | 'down';

export interface HealthReport {
  readonly status: 'ok' | 'degraded';
  readonly checks: Readonly<Record<string, ComponentStatus>>;
  readonly uptimeSeconds: number;
  readonly timestamp: string;
}

interface Deps {
  clock: Clock;
  healthIndicators: readonly HealthIndicator[];
}

const CHECK_TIMEOUT_MS = 2_000;

export class GetHealthUseCase implements UseCase<void, HealthReport> {
  private readonly clock: Clock;
  private readonly indicators: readonly HealthIndicator[];

  constructor({ clock, healthIndicators }: Deps) {
    this.clock = clock;
    this.indicators = healthIndicators;
  }

  async execute(): Promise<HealthReport> {
    const results = await Promise.all(
      this.indicators.map(async (indicator) => {
        const healthy = await withTimeout(indicator.isHealthy(), CHECK_TIMEOUT_MS).catch(
          () => false,
        );
        return [indicator.name, healthy ? 'up' : 'down'] as const;
      }),
    );
    const checks = Object.fromEntries(results) as Record<string, ComponentStatus>;

    return {
      status: results.every(([, status]) => status === 'up') ? 'ok' : 'degraded',
      checks,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: this.clock.now().toISOString(),
    };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('timeout'));
    }, ms);
    promise.then(resolve, reject).finally(() => {
      clearTimeout(timer);
    });
  });
}
