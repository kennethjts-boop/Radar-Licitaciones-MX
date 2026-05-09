/**
 * HEALTHCHECK — Estado del sistema para /prueba y monitoreo.
 *
 * Contiene solo estado en memoria — actualizado por bootstrap y scheduler.
 * No hace llamadas externas directamente.
 */
import { createModuleLogger } from "./logger";
import { nowISO } from "./time";

const log = createModuleLogger("healthcheck");

/** Sin ciclos durante este tiempo → sistema estancado (3 ciclos de 30 min). */
const STALL_THRESHOLD_MS = 90 * 60 * 1000;
/** No reportar stalled hasta que el worker lleve este tiempo corriendo. */
const STALL_GRACE_PERIOD_MS = 15 * 60 * 1000;

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
  lastCycleStatus: "success" | "error" | "none";
  lastCycleDurationMs: number | null;
  lastCycleMatches: number | null;
  schedulerStatus: "active" | "starting" | "stopped";
  uptimeMs: number;
  runtimeDbMode: "supabase-rest";
  stalled: boolean;
  stalledForMs: number | null;
}

// ─── Tracker singleton ────────────────────────────────────────────────────────

class HealthTracker {
  private startedAt = Date.now();

  // Ciclo
  private lastCycleAt: string | null = null;
  private lastCycleStatus: "success" | "error" | "none" = "none";
  private lastCycleDurationMs: number | null = null;
  private lastCycleMatches: number | null = null;

  // Scheduler
  private schedulerStatus: "active" | "starting" | "stopped" = "starting";

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

  setSchedulerStatus(status: "active" | "starting" | "stopped"): void {
    this.schedulerStatus = status;
  }

  recordCycle(durationMs: number, matches: number, success = true): void {
    this.lastCycleAt = nowISO();
    this.lastCycleStatus = success ? "success" : "error";
    this.lastCycleDurationMs = durationMs;
    this.lastCycleMatches = matches;
    log.info({ durationMs, matches, success }, "Ciclo completado");
  }

  // ── Estado completo ─────────────────────────────────────────────────────────

  getStatus(): HealthStatus {
    const now = Date.now();
    const uptimeMs = now - this.startedAt;

    const services = {
      database: this.dbHealth,
      telegram: this.telegramHealth,
      playwright: this.playwrightHealth,
    };

    // Stalled: uptime superó el período de gracia y no hay ciclos recientes
    const pastGrace = uptimeMs > STALL_GRACE_PERIOD_MS;
    const msSinceLastCycle = this.lastCycleAt
      ? now - new Date(this.lastCycleAt).getTime()
      : uptimeMs;
    const stalled = pastGrace && msSinceLastCycle > STALL_THRESHOLD_MS;
    const stalledForMs = stalled ? msSinceLastCycle : null;

    // Overall: down si DB no conectada o schema inválido o telegram caído
    const criticalDown =
      this.dbHealth === "down" ||
      !this.dbSchemaValid ||
      this.telegramHealth === "down";

    const anyDegraded =
      stalled ||
      this.schedulerStatus === "stopped" ||
      this.lastCycleStatus === "error" ||
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
      lastCycleStatus: this.lastCycleStatus,
      lastCycleDurationMs: this.lastCycleDurationMs,
      lastCycleMatches: this.lastCycleMatches,
      schedulerStatus: this.schedulerStatus,
      uptimeMs,
      runtimeDbMode: "supabase-rest",
      stalled,
      stalledForMs,
    };
  }
}

export const healthTracker = new HealthTracker();
