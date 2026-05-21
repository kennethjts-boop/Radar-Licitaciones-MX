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
  externalLeads: {
    lastRunAt: string | null;
    status: "success" | "error" | "skipped" | "none";
    enabled: boolean;
    dryRun: boolean;
    discoveryMode: boolean;
    sourcesReviewed: number;
    rawResultsReceived: number;
    normalized: number;
    detected: number;
    saved: number;
    alerted: number;
    discardedByKeyword: number;
    discardedByEvidence: number;
    discardedByDate: number;
    discardedBySanitization: number;
    discardedByScope: number;
    discardedByScore: number;
    discardedByDeduplication: number;
    discardedByMissingSourceUrl: number;
    discardedByMissingEvidence: number;
    topDiscardedCandidates: unknown[];
    errors: string[];
  };
  uptimeMs: number;
  runtimeDbMode: "supabase-rest";
  stalled: boolean;
  stalledForMs: number | null;
  degradationReasons: string[];
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

  // External leads OSINT (en memoria para soportar dry-run sin escribir en DB)
  private externalLeadsStatus = {
    lastRunAt: null as string | null,
    status: "none" as "success" | "error" | "skipped" | "none",
    enabled: false,
    dryRun: true,
    discoveryMode: true,
    sourcesReviewed: 0,
    rawResultsReceived: 0,
    normalized: 0,
    detected: 0,
    saved: 0,
    alerted: 0,
    discardedByKeyword: 0,
    discardedByEvidence: 0,
    discardedByDate: 0,
    discardedBySanitization: 0,
    discardedByScope: 0,
    discardedByScore: 0,
    discardedByDeduplication: 0,
    discardedByMissingSourceUrl: 0,
    discardedByMissingEvidence: 0,
    topDiscardedCandidates: [] as unknown[],
    errors: [] as string[],
  };

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

  recordExternalLeadsCycle(params: {
    status: "success" | "error" | "skipped";
    enabled: boolean;
    dryRun: boolean;
    discoveryMode: boolean;
    sourcesReviewed: number;
    rawResultsReceived: number;
    normalized: number;
    detected: number;
    saved: number;
    alerted: number;
    discardedByKeyword: number;
    discardedByEvidence: number;
    discardedByDate: number;
    discardedBySanitization: number;
    discardedByScope: number;
    discardedByScore: number;
    discardedByDeduplication: number;
    discardedByMissingSourceUrl: number;
    discardedByMissingEvidence: number;
    topDiscardedCandidates: unknown[];
    errors: string[];
  }): void {
    this.externalLeadsStatus = {
      lastRunAt: nowISO(),
      status: params.status,
      enabled: params.enabled,
      dryRun: params.dryRun,
      discoveryMode: params.discoveryMode,
      sourcesReviewed: params.sourcesReviewed,
      rawResultsReceived: params.rawResultsReceived,
      normalized: params.normalized,
      detected: params.detected,
      saved: params.saved,
      alerted: params.alerted,
      discardedByKeyword: params.discardedByKeyword,
      discardedByEvidence: params.discardedByEvidence,
      discardedByDate: params.discardedByDate,
      discardedBySanitization: params.discardedBySanitization,
      discardedByScope: params.discardedByScope,
      discardedByScore: params.discardedByScore,
      discardedByDeduplication: params.discardedByDeduplication,
      discardedByMissingSourceUrl: params.discardedByMissingSourceUrl,
      discardedByMissingEvidence: params.discardedByMissingEvidence,
      topDiscardedCandidates: params.topDiscardedCandidates,
      errors: params.errors.slice(0, 10),
    };
    log.info(
      {
        status: params.status,
        enabled: params.enabled,
        dryRun: params.dryRun,
        discoveryMode: params.discoveryMode,
        sourcesReviewed: params.sourcesReviewed,
        rawResultsReceived: params.rawResultsReceived,
        normalized: params.normalized,
        detected: params.detected,
        saved: params.saved,
        alerted: params.alerted,
        discardedByKeyword: params.discardedByKeyword,
        discardedByEvidence: params.discardedByEvidence,
        discardedByDate: params.discardedByDate,
        discardedBySanitization: params.discardedBySanitization,
        discardedByScope: params.discardedByScope,
        discardedByScore: params.discardedByScore,
        discardedByDeduplication: params.discardedByDeduplication,
        discardedByMissingSourceUrl: params.discardedByMissingSourceUrl,
        discardedByMissingEvidence: params.discardedByMissingEvidence,
        topDiscardedCandidates: params.topDiscardedCandidates.length,
        errors: params.errors.length,
      },
      "Ciclo external leads registrado en memoria",
    );
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

    const degradationReasons: string[] = [];

    if (this.dbHealth === "down") degradationReasons.push("DB down");
    if (!this.dbSchemaValid) degradationReasons.push("schema inválido");
    if (this.telegramHealth === "down") degradationReasons.push("Telegram down");
    if (stalled) {
      degradationReasons.push(
        `sin ciclos recientes por ${Math.floor((stalledForMs ?? 0) / 60_000)} min`,
      );
    }
    if (this.schedulerStatus === "stopped") degradationReasons.push("scheduler detenido");
    if (this.lastCycleStatus === "error") degradationReasons.push("último ciclo con error");
    for (const [name, value] of Object.entries(services)) {
      if (value === "degraded") degradationReasons.push(`${name} degradado`);
      if (value === "unknown") {
        if (name === "playwright") {
          degradationReasons.push("Playwright pendiente de verificación, próximo ciclo");
        } else {
          degradationReasons.push(`${name} sin verificación`);
        }
      }
    }

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
      services.database === "unknown" ||
      services.telegram === "unknown";

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
      externalLeads: this.externalLeadsStatus,
      uptimeMs,
      runtimeDbMode: "supabase-rest",
      stalled,
      stalledForMs,
      degradationReasons,
    };
  }
}

export const healthTracker = new HealthTracker();
