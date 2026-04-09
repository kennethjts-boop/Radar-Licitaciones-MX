/**
 * HEALTHCHECK — Estado del sistema para /prueba y monitoreo.
 *
 * Contiene solo estado en memoria — actualizado por bootstrap y scheduler.
 * No hace llamadas externas directamente.
 */
import { createModuleLogger } from "./logger";
import { nowISO } from "./time";

const log = createModuleLogger("healthcheck");

export type ServiceHealth = "ok" | "degraded" | "down" | "unknown";

export interface SchemaHealth {
  valid: boolean;
  tablesFound: number;
  tablesMissing: number;
  tablesRequired: number;
  missingList: string[];
}

export interface HealthStatus {
  overall: ServiceHealth;
  checkedAt: string;
  services: {
    database: ServiceHealth;
    telegram: ServiceHealth;
    playwright: ServiceHealth;
  };
  dbConnected: boolean;
  dbSchemaValid: boolean;
  schemaDetail: SchemaHealth;
  lastCycleAt: string | null;
  lastCycleDurationMs: number | null;
  lastCycleMatches: number | null;
  uptimeMs: number;
  runtimeDbMode: "supabase-rest";
}

// ─── Tracker singleton ────────────────────────────────────────────────────────

class HealthTracker {
  private startedAt = Date.now();

  // Ciclo
  private lastCycleAt: string | null = null;
  private lastCycleDurationMs: number | null = null;
  private lastCycleMatches: number | null = null;

  // Estado de servicios
  private dbHealth: ServiceHealth = "unknown";
  private telegramHealth: ServiceHealth = "unknown";
  private playwrightHealth: ServiceHealth = "unknown";

  // Conectividad y schema
  private dbConnected = false;
  private dbSchemaValid = false;
  private schemaDetail: SchemaHealth = {
    valid: false,
    tablesFound: 0,
    tablesMissing: 14,
    tablesRequired: 14,
    missingList: [],
  };

  // ── Setters de servicios ────────────────────────────────────────────────────

  setDbHealth(status: ServiceHealth): void {
    this.dbHealth = status;
    this.dbConnected = status === "ok";
  }

  setTelegramHealth(status: ServiceHealth): void {
    this.telegramHealth = status;
  }

  setPlaywrightHealth(status: ServiceHealth): void {
    this.playwrightHealth = status;
  }

  setDbSchemaValid(
    valid: boolean,
    tablesFound: number,
    tablesMissing: string[],
    tablesRequired: number,
  ): void {
    this.dbSchemaValid = valid;
    this.schemaDetail = {
      valid,
      tablesFound,
      tablesMissing: tablesMissing.length,
      tablesRequired,
      missingList: tablesMissing,
    };
    log.info(
      { valid, tablesFound, tablesMissing: tablesMissing.length },
      valid
        ? "✅ DB schema marcado como válido"
        : "❌ DB schema marcado como inválido",
    );
  }

  // ── Registro de ciclos ──────────────────────────────────────────────────────

  recordCycle(durationMs: number, matches: number): void {
    this.lastCycleAt = nowISO();
    this.lastCycleDurationMs = durationMs;
    this.lastCycleMatches = matches;
    log.info({ durationMs, matches }, "Ciclo completado");
  }

  // ── Estado completo ─────────────────────────────────────────────────────────

  getStatus(): HealthStatus {
    const services = {
      database: this.dbHealth,
      telegram: this.telegramHealth,
      playwright: this.playwrightHealth,
    };

    // Overall: down si DB no conectada o schema inválido o telegram caído
    const criticalDown =
      this.dbHealth === "down" ||
      !this.dbSchemaValid ||
      this.telegramHealth === "down";

    const anyDegraded =
      Object.values(services).some((s) => s === "degraded") ||
      Object.values(services).some((s) => s === "unknown");

    const overall: ServiceHealth = criticalDown
      ? "down"
      : anyDegraded
        ? "degraded"
        : "ok";

    return {
      overall,
      checkedAt: nowISO(),
      services,
      dbConnected: this.dbConnected,
      dbSchemaValid: this.dbSchemaValid,
      schemaDetail: this.schemaDetail,
      lastCycleAt: this.lastCycleAt,
      lastCycleDurationMs: this.lastCycleDurationMs,
      lastCycleMatches: this.lastCycleMatches,
      uptimeMs: Date.now() - this.startedAt,
      runtimeDbMode: "supabase-rest",
    };
  }
}

export const healthTracker = new HealthTracker();
