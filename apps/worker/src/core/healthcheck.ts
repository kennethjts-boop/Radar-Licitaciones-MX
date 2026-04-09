/**
 * HEALTHCHECK — Estado del sistema para /prueba y monitoreo.
 */
import { createModuleLogger } from './logger';
import { nowISO } from './time';

const log = createModuleLogger('healthcheck');

export type ServiceHealth = 'ok' | 'degraded' | 'down';

export interface HealthStatus {
  overall: ServiceHealth;
  checkedAt: string;
  services: {
    database: ServiceHealth;
    telegram: ServiceHealth;
    playwright: ServiceHealth;
  };
  lastCycleAt: string | null;
  lastCycleDurationMs: number | null;
  lastCycleMatches: number | null;
  uptimeMs: number;
}

// Estado global del sistema — actualizado por el scheduler
class HealthTracker {
  private startedAt = Date.now();
  private lastCycleAt: string | null = null;
  private lastCycleDurationMs: number | null = null;
  private lastCycleMatches: number | null = null;

  // Checks externos — seteados por el healthcheck activo
  private dbHealth: ServiceHealth = 'down';
  private telegramHealth: ServiceHealth = 'down';
  private playwrightHealth: ServiceHealth = 'down';

  setDbHealth(status: ServiceHealth): void {
    this.dbHealth = status;
  }

  setTelegramHealth(status: ServiceHealth): void {
    this.telegramHealth = status;
  }

  setPlaywrightHealth(status: ServiceHealth): void {
    this.playwrightHealth = status;
  }

  recordCycle(durationMs: number, matches: number): void {
    this.lastCycleAt = nowISO();
    this.lastCycleDurationMs = durationMs;
    this.lastCycleMatches = matches;
    log.info({ durationMs, matches }, 'Ciclo completado');
  }

  getStatus(): HealthStatus {
    const services = {
      database: this.dbHealth,
      telegram: this.telegramHealth,
      playwright: this.playwrightHealth,
    };

    const anyDown = Object.values(services).some((s) => s === 'down');
    const anyDegraded = Object.values(services).some((s) => s === 'degraded');

    const overall: ServiceHealth = anyDown ? 'down' : anyDegraded ? 'degraded' : 'ok';

    return {
      overall,
      checkedAt: nowISO(),
      services,
      lastCycleAt: this.lastCycleAt,
      lastCycleDurationMs: this.lastCycleDurationMs,
      lastCycleMatches: this.lastCycleMatches,
      uptimeMs: Date.now() - this.startedAt,
    };
  }
}

export const healthTracker = new HealthTracker();
