import { sendTelegramMessage } from "../../alerts/telegram.alerts";
import { getConfig } from "../../config/env";
import { createModuleLogger } from "../../core/logger";
import { adminCommandsEnabled } from "../control/authorization";
import {
  allCircuits,
  type CircuitSnapshot,
} from "../resilience/circuit-breaker";
import { getSaturationAnalysis } from "../alerting/saturation";
import {
  appendVerdict,
  determineVerdict,
  type OperationalVerdict,
} from "../alerting/verdict";
import {
  createPendingWatchdogHealthAlert,
  getRecentWatchdogHealthAlerts,
  markWatchdogHealthAlertFailed,
  markWatchdogHealthAlertSent,
  type WatchdogHealthAlertRow,
} from "./repository";
import type {
  WatchdogFailureCause,
  WatchdogHealthSeverity,
  WatchdogHealthState,
} from "./types";

const log = createModuleLogger("licitacion-watchdog:health");
const SEVERITY_COOLDOWN_MS = 30 * 60 * 1000;

export const EMPTY_WATCHDOG_HEALTH: WatchdogHealthState = {
  consecutiveFailures: 0,
  cause: null,
  severity: null,
  incidentStartedAt: null,
  lastFailureAt: null,
  lastSuccessAt: null,
  lastFailureStage: null,
  lastFailureType: null,
  lastFailureMessage: null,
};

const FAILURE_MESSAGE_MAX_LENGTH = 220;

export function sanitizeFailureMessage(message: string | null | undefined): string | null {
  if (!message) return null;
  // Sin query strings (pueden llevar tokens/firmas) y sin saltos de línea.
  const clean = message
    .replace(/\?[^\s"']*/g, "?…")
    .replace(/\b(Bearer)\s+\S+/gi, "$1 […]")
    .replace(/\b(token|secret|password|authorization|api[_-]?key)\s*[=:]\s*[^\s,;]+/gi, "$1=[…]")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return null;
  return clean.length > FAILURE_MESSAGE_MAX_LENGTH
    ? `${clean.slice(0, FAILURE_MESSAGE_MAX_LENGTH)}…`
    : clean;
}

function sanitizeFailureType(errorType: string | null | undefined): string | null {
  if (!errorType) return null;
  const clean = errorType.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 80);
  return clean || null;
}

export interface WatchdogHealthAlertHistory {
  severity: WatchdogHealthSeverity;
  cause: WatchdogFailureCause;
  stage: string;
  consecutiveFailures: number;
  sentAt: string;
}

export interface WatchdogHealthDecision {
  health: WatchdogHealthState;
  verdict: OperationalVerdict;
  circuit: CircuitSnapshot | null;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function parseSeverity(alertType: string): WatchdogHealthSeverity | null {
  if (alertType.includes("_critical_")) return "CRITICAL";
  // Compatibilidad con alertas DEGRADED persistidas antes de este cambio.
  if (alertType.includes("_warn_") || alertType.includes("_degraded_")) {
    return "WARN";
  }
  return null;
}

function parseCause(alertType: string): WatchdogFailureCause | null {
  if (alertType.includes("_network_infra")) return "NETWORK_INFRA";
  if (alertType.includes("_site_structure")) return "SITE_STRUCTURE";
  if (
    alertType.includes("_application_error") ||
    alertType.includes("_unknown")
  ) {
    return "APPLICATION_ERROR";
  }
  return null;
}

function parseStage(row: WatchdogHealthAlertRow): string {
  const fromMessage = row.telegram_message.match(
    /Etapa:\s*<code>([^<]+)<\/code>/i,
  )?.[1];
  if (fromMessage) return fromMessage;
  const fromType = row.alert_type.match(
    /_(?:network_infra|site_structure|application_error|unknown)_(.+)$/i,
  )?.[1];
  return fromType || "N/D";
}

function parseHistory(
  rows: WatchdogHealthAlertRow[],
): WatchdogHealthAlertHistory[] {
  return rows.flatMap((row) => {
    const severity = parseSeverity(row.alert_type);
    const cause = parseCause(row.alert_type);
    const count = row.telegram_message.match(/Fallos consecutivos:\s*(\d+)/i)?.[1];
    const sentAt = row.sent_at ?? row.created_at;
    if (!severity || !cause || !count || !Number.isFinite(Date.parse(sentAt))) {
      return [];
    }
    return [{
      severity,
      cause,
      stage: parseStage(row),
      consecutiveFailures: Number(count),
      sentAt,
    }];
  });
}

export function transitionWatchdogHealth(
  previous: WatchdogHealthState | null | undefined,
  outcome:
    | { success: true }
    | {
        success: false;
        cause: WatchdogFailureCause;
        stage?: string | null;
        errorType?: string | null;
        message?: string | null;
      },
  now = new Date(),
): WatchdogHealthState {
  const prior = { ...EMPTY_WATCHDOG_HEALTH, ...(previous ?? {}) };
  const nowIso = now.toISOString();
  if (outcome.success) {
    return {
      ...prior,
      consecutiveFailures: 0,
      cause: null,
      severity: null,
      incidentStartedAt: null,
      lastSuccessAt: nowIso,
      lastFailureStage: null,
      lastFailureType: null,
      lastFailureMessage: null,
    };
  }

  const sameIncident = prior.cause === outcome.cause && prior.consecutiveFailures > 0;
  const consecutiveFailures = sameIncident ? prior.consecutiveFailures + 1 : 1;
  return {
    ...prior,
    consecutiveFailures,
    cause: outcome.cause,
    // WARN es el valor provisional. La severidad definitiva se deriva del
    // veredicto con resolveWatchdogHealthDecision() antes de persistir o alertar.
    severity: "WARN",
    incidentStartedAt: sameIncident && prior.incidentStartedAt ? prior.incidentStartedAt : nowIso,
    lastFailureAt: nowIso,
    lastFailureStage: outcome.stage ?? null,
    lastFailureType: sanitizeFailureType(outcome.errorType),
    lastFailureMessage: sanitizeFailureMessage(outcome.message),
  };
}

export function shouldSendWatchdogHealthAlert(input: {
  health: WatchdogHealthState;
  history: WatchdogHealthAlertHistory[];
  now?: Date;
}): boolean {
  const { health, history } = input;
  if (!health.severity || !health.cause || !health.incidentStartedAt) return false;
  const nowMs = (input.now ?? new Date()).getTime();
  const stage = health.lastFailureStage ?? "N/D";
  const recentSameCauseAndStage = history
    .filter((item) =>
      item.cause === health.cause &&
      item.stage === stage &&
      nowMs - Date.parse(item.sentAt) < SEVERITY_COOLDOWN_MS
    )
    .sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt));
  if (recentSameCauseAndStage.length === 0) return true;

  const exactTupleAlreadySent = recentSameCauseAndStage.some(
    (item) => item.severity === health.severity,
  );
  if (exactTupleAlreadySent) return false;

  // Dentro del cooldown sólo una subida WARN → CRITICAL amerita otra alerta.
  // Una recuperación CRITICAL → WARN no debe crear ruido por ser una tupla nueva.
  return health.severity === "CRITICAL" &&
    recentSameCauseAndStage.every((item) => item.severity === "WARN");
}

export function formatWatchdogHealthAlert(health: WatchdogHealthState): string {
  const critical = health.severity === "CRITICAL";
  return [
    `${critical ? "🔴" : "🟡"} <b>[${health.severity}] Licitación Watchdog</b>`,
    "",
    `🧭 Causa consolidada: <code>${escapeHtml(health.cause ?? "APPLICATION_ERROR")}</code>`,
    `🧩 Etapa: <code>${escapeHtml(health.lastFailureStage ?? "N/D")}</code>`,
    `🏷 Tipo: <code>${escapeHtml(health.lastFailureType ?? "Error")}</code>`,
    `📝 Detalle: ${escapeHtml(health.lastFailureMessage ?? "N/D")}`,
    `📊 Fallos consecutivos: ${health.consecutiveFailures}`,
    `⏱ Incidente iniciado: ${escapeHtml(health.incidentStartedAt ?? "N/D")}`,
    critical
      ? "📌 El fallo permanece aislado; el colector principal conserva prioridad."
      : "📌 Se reintentará automáticamente sin comparar snapshots parciales.",
  ].join("\n");
}

function statusFromMessage(message: string | null): number | undefined {
  const rawStatus = message?.match(/\bHTTP\s+(\d{3})\b/i)?.[1];
  if (!rawStatus) return undefined;
  const status = Number(rawStatus);
  return Number.isFinite(status) ? status : undefined;
}

export function relevantCircuit(
  circuits: CircuitSnapshot[],
): CircuitSnapshot | null {
  return circuits.find((circuit) => circuit.reopenedFromHalfOpen) ??
    circuits.find((circuit) => circuit.state === "OPEN") ??
    circuits.find((circuit) => circuit.state === "HALF_OPEN") ??
    [...circuits].sort(
      (left, right) =>
        right.consecutiveFailures - left.consecutiveFailures,
    )[0] ??
    null;
}

export function enforceWatchdogVerdictSeverity(
  verdict: OperationalVerdict,
  proposedSeverity: WatchdogHealthSeverity,
): WatchdogHealthSeverity {
  if (
    verdict.category === "ESPERAR" &&
    proposedSeverity === "CRITICAL"
  ) {
    log.warn(
      { verdict: verdict.category, proposedSeverity },
      "Guard de severidad: CRITICAL degradado a WARN porque el veredicto es ESPERAR",
    );
    return "WARN";
  }
  return proposedSeverity;
}

export function reconcileWatchdogColdStartHealth(
  health: WatchdogHealthState,
  circuits: CircuitSnapshot[],
): { health: WatchdogHealthState; reset: boolean } {
  const allClosed = circuits.length === 0 ||
    circuits.every((circuit) => circuit.state === "CLOSED");
  if (!allClosed || health.consecutiveFailures <= 0) {
    return { health, reset: false };
  }
  return {
    reset: true,
    health: {
      ...health,
      consecutiveFailures: 0,
      cause: null,
      severity: null,
      incidentStartedAt: null,
    },
  };
}

export async function resolveWatchdogHealthDecision(
  health: WatchdogHealthState,
): Promise<WatchdogHealthDecision> {
  const config = getConfig();
  let saturation = null;
  if (health.cause === "NETWORK_INFRA") {
    try {
      saturation = await getSaturationAnalysis(
        health.lastFailureAt ? new Date(health.lastFailureAt) : new Date(),
      );
    } catch (error) {
      log.warn(
        { err: error },
        "No se pudo calcular saturación; veredicto continuará sin historial",
      );
    }
  }
  const circuit = relevantCircuit(allCircuits());
  const verdict = determineVerdict({
    source: "watchdog",
    consecutiveFailures: health.consecutiveFailures,
    cause: health.cause,
    errorType: health.lastFailureType,
    message: health.lastFailureMessage,
    httpStatus: statusFromMessage(health.lastFailureMessage),
    circuit,
    saturation,
    defaultPauseMinutes: config.PAUSE_DEFAULT_MINUTES,
  });
  const proposedSeverity: WatchdogHealthSeverity =
    verdict.category === "PAUSAR" || verdict.category === "INTERVENIR"
      ? "CRITICAL"
      : "WARN";
  const severity = enforceWatchdogVerdictSeverity(
    verdict,
    proposedSeverity,
  );
  return {
    health: { ...health, severity },
    verdict,
    circuit,
  };
}

export async function formatActionableWatchdogHealthAlert(
  health: WatchdogHealthState,
  decision?: WatchdogHealthDecision,
): Promise<string> {
  const resolved = decision ?? await resolveWatchdogHealthDecision(health);
  const config = getConfig();
  const base = formatWatchdogHealthAlert(resolved.health);
  return appendVerdict(
    base,
    resolved.verdict,
    adminCommandsEnabled(config.TELEGRAM_ADMIN_CHAT_IDS),
  );
}

export async function notifyWatchdogHealthIfNeeded(
  health: WatchdogHealthState,
  decision?: WatchdogHealthDecision,
): Promise<boolean> {
  if (!health.severity || !health.cause) return false;
  try {
    // Recalcular también aquí funciona como frontera defensiva: aun si un caller
    // entrega CRITICAL persistido, ESPERAR jamás puede salir con ese nivel.
    const resolved = decision ?? await resolveWatchdogHealthDecision(health);
    const effectiveHealth = resolved.health;
    const rows = await getRecentWatchdogHealthAlerts();
    const history = parseHistory(rows);
    if (!shouldSendWatchdogHealthAlert({
      health: effectiveHealth,
      history,
    })) {
      return false;
    }

    const message = await formatActionableWatchdogHealthAlert(
      effectiveHealth,
      resolved,
    );
    const alertId = await createPendingWatchdogHealthAlert({
      severity: effectiveHealth.severity!,
      cause: effectiveHealth.cause!,
      stage: effectiveHealth.lastFailureStage ?? "N/D",
      message,
    });
    try {
      const messageId = await sendTelegramMessage(message, "HTML");
      await markWatchdogHealthAlertSent(alertId, messageId);
      return true;
    } catch (error) {
      await markWatchdogHealthAlertFailed(alertId).catch((markError) => {
        log.warn({ err: markError, alertId }, "No se pudo marcar alerta watchdog fallida");
      });
      log.warn({ err: error, alertId }, "No se pudo enviar alerta de salud watchdog");
      return false;
    }
  } catch (error) {
    // No enviar sin persistencia: evita duplicados si no se puede verificar cooldown.
    log.warn({ err: error }, "No se pudo evaluar/persistir cooldown watchdog; alerta contenida");
    return false;
  }
}
