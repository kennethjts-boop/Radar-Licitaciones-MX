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
const CRITICAL_AFTER_FAILURES = 4;
const SEVERITY_COOLDOWN_MS = 30 * 60 * 1000;
const CRITICAL_REPEAT_AFTER_MS = 2 * 60 * 60 * 1000;

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
  consecutiveFailures: number;
  sentAt: string;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function parseCause(alertType: string): WatchdogFailureCause | null {
  if (alertType.endsWith("_network_infra")) return "NETWORK_INFRA";
  if (alertType.endsWith("_site_structure")) return "SITE_STRUCTURE";
  // Compatibilidad con alertas previas; las nuevas nunca persisten UNKNOWN.
  if (alertType.endsWith("_unknown")) return "APPLICATION_ERROR";
  return null;
}

function parseHistory(
  rows: WatchdogHealthAlertRow[],
  severity: WatchdogHealthSeverity,
): WatchdogHealthAlertHistory[] {
  return rows.flatMap((row) => {
    const cause = parseCause(row.alert_type);
    const count = row.telegram_message.match(/Fallos consecutivos:\s*(\d+)/i)?.[1];
    const sentAt = row.sent_at ?? row.created_at;
    if (!cause || !count || !Number.isFinite(Date.parse(sentAt))) return [];
    return [{ severity, cause, consecutiveFailures: Number(count), sentAt }];
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
    severity: consecutiveFailures >= CRITICAL_AFTER_FAILURES ? "CRITICAL" : "DEGRADED",
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
  const sameSeverity = history
    .filter((item) => item.severity === health.severity)
    .sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt));
  const latestSeverity = sameSeverity[0];
  if (latestSeverity && nowMs - Date.parse(latestSeverity.sentAt) < SEVERITY_COOLDOWN_MS) {
    return false;
  }

  const sameCause = sameSeverity.find((item) => item.cause === health.cause);
  if (!sameCause || Date.parse(sameCause.sentAt) < Date.parse(health.incidentStartedAt)) {
    return true;
  }
  if (health.severity === "DEGRADED") {
    // Un solo aviso degradado por causa dentro del mismo incidente.
    return false;
  }
  const criticalAgeMs = nowMs - Date.parse(sameCause.sentAt);
  return sameCause.consecutiveFailures !== health.consecutiveFailures ||
    criticalAgeMs > CRITICAL_REPEAT_AFTER_MS;
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

function relevantCircuit(circuits: CircuitSnapshot[]): CircuitSnapshot | null {
  return circuits.find((circuit) => circuit.reopenedFromHalfOpen) ??
    circuits.find((circuit) => circuit.state === "OPEN") ??
    null;
}

export async function formatActionableWatchdogHealthAlert(
  health: WatchdogHealthState,
): Promise<string> {
  const config = getConfig();
  const saturation = health.cause === "NETWORK_INFRA"
    ? await getSaturationAnalysis(
        health.lastFailureAt ? new Date(health.lastFailureAt) : new Date(),
      )
    : null;
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
  const base = formatWatchdogHealthAlert(health);
  return appendVerdict(
    base,
    verdict,
    adminCommandsEnabled(config.TELEGRAM_ADMIN_CHAT_IDS),
  );
}

export async function notifyWatchdogHealthIfNeeded(health: WatchdogHealthState): Promise<boolean> {
  if (!health.severity || !health.cause) return false;
  try {
    const rows = await getRecentWatchdogHealthAlerts(health.severity);
    const history = parseHistory(rows, health.severity);
    if (!shouldSendWatchdogHealthAlert({ health, history })) return false;

    const message = await formatActionableWatchdogHealthAlert(health);
    const alertId = await createPendingWatchdogHealthAlert({
      severity: health.severity,
      cause: health.cause,
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
