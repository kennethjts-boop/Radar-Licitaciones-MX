import type { ComprasMxFailureDiagnosis } from "./comprasmx.failure";
import { classifyComprasMxFailure } from "./comprasmx.failure";

const ALERT_AFTER_FAILURES = 3;
const CRITICAL_AFTER_MS = 2 * 60 * 60 * 1000;

export interface ComprasMxTelemetryState {
  comprasmx_consecutive_failures: number;
  last_comprasmx_success_at: string | null;
  last_comprasmx_error_at: string | null;
  last_comprasmx_error_reason: string | null;
  last_comprasmx_error_origin: ComprasMxFailureDiagnosis["origin"] | null;
  last_comprasmx_error_confidence: ComprasMxFailureDiagnosis["confidence"] | null;
  last_comprasmx_recovery_at: string | null;
  incident_started_at: string | null;
  incident_alerted_at: string | null;
  critical_alerted_at: string | null;
}

export interface ComprasMxTelemetryOutcome {
  success: boolean;
  error?: unknown;
  diagnosis?: ComprasMxFailureDiagnosis;
  recoveredFromTransient401?: boolean;
}

export interface ComprasMxTelemetryTransition {
  state: ComprasMxTelemetryState;
  diagnosis?: ComprasMxFailureDiagnosis;
  alertMessage: string | null;
}

export const EMPTY_COMPRASMX_TELEMETRY: ComprasMxTelemetryState = {
  comprasmx_consecutive_failures: 0,
  last_comprasmx_success_at: null,
  last_comprasmx_error_at: null,
  last_comprasmx_error_reason: null,
  last_comprasmx_error_origin: null,
  last_comprasmx_error_confidence: null,
  last_comprasmx_recovery_at: null,
  incident_started_at: null,
  incident_alerted_at: null,
  critical_alerted_at: null,
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatTimestamp(value: string | null): string {
  if (!value) return "sin extracción exitosa registrada";
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "America/Mexico_City",
  }).format(new Date(value));
}

function formatRecovery(nowIso: string): string {
  return [
    "🟢 <b>ComprasMX volvió a extraer información correctamente.</b>",
    "",
    "📌 Estado: recuperado.",
    "🧭 Diagnóstico: la falla anterior fue probablemente transitoria.",
    `⏱ Última extracción correcta: ${escapeHtml(formatTimestamp(nowIso))}`,
  ].join("\n");
}

function formatPersistent401(
  diagnosis: ComprasMxFailureDiagnosis,
  consecutiveFailures: number,
  lastSuccessAt: string | null,
): string {
  return [
    "🟡 <b>[DEGRADADO] ComprasMX</b>",
    "",
    "📌 El portal está rechazando temporalmente la consulta API.",
    `🧭 ${escapeHtml(diagnosis.userDiagnosis)}`,
    "🛠 ¿Es error nuestro?: No parece. El radar sigue vivo, pero ComprasMX respondió 401 Unauthorized.",
    "🔁 Acción automática: se recreó sesión navegador y se reintentó.",
    `📊 Fallos consecutivos: ${consecutiveFailures}`,
    `⏱ Última extracción correcta: ${escapeHtml(formatTimestamp(lastSuccessAt))}`,
    "📌 Estado: se intentará de nuevo en el siguiente ciclo.",
  ].join("\n");
}

function formatTechnicalFailure(
  diagnosis: ComprasMxFailureDiagnosis,
  error: unknown,
): string {
  const message = error instanceof Error ? error.message : String(error);
  return [
    "🔴 <b>[ERROR TÉCNICO] ComprasMX Scraper</b>",
    "",
    "📌 El flujo de navegación no encontró elementos esperados o no pudo interpretar la respuesta.",
    `🧭 ${escapeHtml(diagnosis.userDiagnosis)}`,
    "🛠 ¿Es error nuestro?: Probablemente sí requiere ajuste técnico.",
    "📍 Archivo / función: comprasmx.navigator.ts / scanListing",
    `💬 Error: <code>${escapeHtml(message.slice(0, 300))}</code>`,
    `📌 Acción sugerida: ${escapeHtml(diagnosis.recommendedAction)}`,
  ].join("\n");
}

function formatInfrastructureFailure(
  diagnosis: ComprasMxFailureDiagnosis,
  consecutiveFailures: number,
  lastSuccessAt: string | null,
): string {
  return [
    "🟡 <b>[DEGRADADO] ComprasMX Infraestructura</b>",
    "",
    `📌 ${escapeHtml(diagnosis.userDiagnosis)}`,
    "🛠 ¿Es error nuestro?: Parece un problema de red, navegador o infraestructura del servidor.",
    `📊 Fallos consecutivos: ${consecutiveFailures}`,
    `⏱ Última extracción correcta: ${escapeHtml(formatTimestamp(lastSuccessAt))}`,
    `📌 Acción sugerida: ${escapeHtml(diagnosis.recommendedAction)}`,
  ].join("\n");
}

function formatCriticalOutage(
  diagnosis: ComprasMxFailureDiagnosis,
  consecutiveFailures: number,
  lastSuccessAt: string | null,
): string {
  return [
    "🔴 <b>[CRÍTICO] ComprasMX sin extracción por más de 2 horas</b>",
    "",
    `🧭 ${escapeHtml(diagnosis.userDiagnosis)}`,
    `🛠 Origen probable: ${escapeHtml(diagnosis.origin)}`,
    `📊 Fallos consecutivos: ${consecutiveFailures}`,
    `⏱ Última extracción correcta: ${escapeHtml(formatTimestamp(lastSuccessAt))}`,
    `📌 Acción sugerida: ${escapeHtml(diagnosis.recommendedAction)}`,
  ].join("\n");
}

function formatConfigFailure(
  diagnosis: ComprasMxFailureDiagnosis,
  error: unknown,
): string {
  const message = error instanceof Error ? error.message : String(error);
  return [
    "🔴 <b>[ERROR CRÍTICO] Configuración ComprasMX</b>",
    "",
    `🧭 ${escapeHtml(diagnosis.userDiagnosis)}`,
    "🛠 ¿Es error nuestro?: Sí. Requiere corregir la configuración del sistema.",
    `💬 Error: <code>${escapeHtml(message.slice(0, 300))}</code>`,
    `📌 Acción sugerida: ${escapeHtml(diagnosis.recommendedAction)}`,
  ].join("\n");
}

function shouldAlertImmediately(diagnosis: ComprasMxFailureDiagnosis): boolean {
  return diagnosis.category === "LOCAL_CONFIG_ERROR" ||
    diagnosis.category === "SCRAPER_OR_SITE_STRUCTURE_CHANGED";
}

export function transitionComprasMxTelemetry(
  previous: ComprasMxTelemetryState | null,
  outcome: ComprasMxTelemetryOutcome,
  now = new Date(),
): ComprasMxTelemetryTransition {
  const prior = { ...EMPTY_COMPRASMX_TELEMETRY, ...(previous ?? {}) };
  const nowIso = now.toISOString();

  if (outcome.success) {
    const shouldSendRecovery = Boolean(prior.incident_alerted_at);
    return {
      state: {
        ...prior,
        comprasmx_consecutive_failures: 0,
        last_comprasmx_success_at: nowIso,
        last_comprasmx_recovery_at: prior.comprasmx_consecutive_failures > 0
          ? nowIso
          : prior.last_comprasmx_recovery_at,
        incident_started_at: null,
        incident_alerted_at: null,
        critical_alerted_at: null,
      },
      diagnosis: outcome.diagnosis,
      alertMessage: shouldSendRecovery && !outcome.recoveredFromTransient401
        ? formatRecovery(nowIso)
        : null,
    };
  }

  const consecutiveFailures = prior.comprasmx_consecutive_failures + 1;
  const diagnosis = classifyComprasMxFailure(
    outcome.error ?? outcome.diagnosis?.technicalReason ?? "Unknown ComprasMX failure",
    { consecutiveFailures },
  );
  const effectiveDiagnosis = outcome.diagnosis && consecutiveFailures < ALERT_AFTER_FAILURES
    ? outcome.diagnosis
    : diagnosis;
  const incidentStartedAt = prior.incident_started_at ?? nowIso;
  const noSuccessSince = prior.last_comprasmx_success_at
    ? now.getTime() - Date.parse(prior.last_comprasmx_success_at)
    : now.getTime() - Date.parse(incidentStartedAt);
  const prolongedOutage = noSuccessSince >= CRITICAL_AFTER_MS;

  let alertMessage: string | null = null;
  let incidentAlertedAt = prior.incident_alerted_at;
  let criticalAlertedAt = prior.critical_alerted_at;

  if (effectiveDiagnosis.category === "LOCAL_CONFIG_ERROR" && !incidentAlertedAt) {
    alertMessage = formatConfigFailure(effectiveDiagnosis, outcome.error);
    incidentAlertedAt = nowIso;
    criticalAlertedAt = nowIso;
  } else if (shouldAlertImmediately(effectiveDiagnosis) && !incidentAlertedAt) {
    alertMessage = formatTechnicalFailure(effectiveDiagnosis, outcome.error);
    incidentAlertedAt = nowIso;
  } else if (prolongedOutage && !criticalAlertedAt) {
    alertMessage = formatCriticalOutage(
      effectiveDiagnosis,
      consecutiveFailures,
      prior.last_comprasmx_success_at,
    );
    incidentAlertedAt = incidentAlertedAt ?? nowIso;
    criticalAlertedAt = nowIso;
  } else if (
    consecutiveFailures >= ALERT_AFTER_FAILURES &&
    !incidentAlertedAt
  ) {
    alertMessage = effectiveDiagnosis.category === "PERSISTENT_AUTH_401"
      ? formatPersistent401(
          effectiveDiagnosis,
          consecutiveFailures,
          prior.last_comprasmx_success_at,
        )
      : formatInfrastructureFailure(
          effectiveDiagnosis,
          consecutiveFailures,
          prior.last_comprasmx_success_at,
        );
    incidentAlertedAt = nowIso;
  }

  return {
    state: {
      ...prior,
      comprasmx_consecutive_failures: consecutiveFailures,
      last_comprasmx_error_at: nowIso,
      last_comprasmx_error_reason: effectiveDiagnosis.category,
      last_comprasmx_error_origin: effectiveDiagnosis.origin,
      last_comprasmx_error_confidence: effectiveDiagnosis.confidence,
      incident_started_at: incidentStartedAt,
      incident_alerted_at: incidentAlertedAt,
      critical_alerted_at: criticalAlertedAt,
    },
    diagnosis: effectiveDiagnosis,
    alertMessage,
  };
}
