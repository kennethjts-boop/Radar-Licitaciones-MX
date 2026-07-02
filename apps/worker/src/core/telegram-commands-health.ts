import type { AppConfig } from "../config/env";
import { healthTracker } from "./healthcheck";
import { createModuleLogger } from "./logger";
import { getState, setState, STATE_KEYS } from "./system-state";

const log = createModuleLogger("telegram-commands-health");

export type TelegramPollingErrorKind =
  | "transient_network"
  | "telegram_conflict"
  | "telegram_auth"
  | "unknown";

export interface TelegramPollingDiagnosis {
  origin: "TELEGRAM" | "OUR_INFRA" | "UNKNOWN";
  kind: TelegramPollingErrorKind;
  severity: "WARN" | "DEGRADED";
  userDiagnosis: string;
  recommendedAction: string;
  statusCode?: number;
  code?: string;
  technicalReason: string;
}

export interface TelegramPollingFailureEvent {
  at: string;
  kind: TelegramPollingErrorKind;
  technicalReason: string;
  statusCode?: number;
  code?: string;
}

export interface TelegramCommandsState {
  telegram_commands_consecutive_failures: number;
  last_telegram_commands_error_at: string | null;
  last_telegram_commands_error_reason: string | null;
  last_telegram_commands_success_at: string | null;
  last_telegram_commands_recovery_at: string | null;
  recent_telegram_polling_failures: TelegramPollingFailureEvent[];
  telegram_send_message_ok: boolean;
  telegram_polling_ok: boolean;
  telegram_send_consecutive_failures: number;
  last_telegram_send_error_at: string | null;
  last_alert_at: string | null;
  last_alert_kind: TelegramPollingErrorKind | null;
  incident_alerted_at: string | null;
  service_name: string | null;
  instance_id: string | null;
  deployment_id: string | null;
  process_pid: number;
  telegram_mode: "polling" | "webhook" | "disabled";
}

type SendOperationalMessage = (text: string) => Promise<unknown>;

const EMPTY_STATE: TelegramCommandsState = {
  telegram_commands_consecutive_failures: 0,
  last_telegram_commands_error_at: null,
  last_telegram_commands_error_reason: null,
  last_telegram_commands_success_at: null,
  last_telegram_commands_recovery_at: null,
  recent_telegram_polling_failures: [],
  telegram_send_message_ok: true,
  telegram_polling_ok: false,
  telegram_send_consecutive_failures: 0,
  last_telegram_send_error_at: null,
  last_alert_at: null,
  last_alert_kind: null,
  incident_alerted_at: null,
  service_name: null,
  instance_id: null,
  deployment_id: null,
  process_pid: process.pid,
  telegram_mode: "disabled",
};

let pendingPollingFailures = 0;
let pollingFailureWindowStartedAt = 0;
let sendFailureCount = 0;
let sendHealthRecorded = false;
const recentAlerts = new Map<TelegramPollingErrorKind, number>();
let recoveryInFlight = false;

function envNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getTelegramPollingTuning(): {
  failureWindowMs: number;
  alertMinFailures: number;
  alertThrottleMs: number;
  retryInitialDelayMs: number;
  retryBackoffMultiplier: number;
  retryMaxDelayMs: number;
  retryJitterRatio: number;
} {
  return {
    failureWindowMs: envNumber("TELEGRAM_POLLING_FAILURE_WINDOW_MS", 10 * 60 * 1000),
    alertMinFailures: envNumber("TELEGRAM_POLLING_ALERT_MIN_FAILURES", 3),
    alertThrottleMs: envNumber("TELEGRAM_POLLING_ALERT_THROTTLE_MS", 30 * 60 * 1000),
    retryInitialDelayMs: envNumber("TELEGRAM_POLLING_RETRY_INITIAL_DELAY_MS", 1_500),
    retryBackoffMultiplier: envNumber("TELEGRAM_POLLING_RETRY_BACKOFF_MULTIPLIER", 2),
    retryMaxDelayMs: envNumber("TELEGRAM_POLLING_RETRY_MAX_DELAY_MS", 60_000),
    retryJitterRatio: Math.min(envNumber("TELEGRAM_POLLING_RETRY_JITTER_RATIO", 0.25), 1),
  };
}

export function getTelegramPollingRetryDelayMs(
  attempt: number,
  random = Math.random,
): number {
  const tuning = getTelegramPollingTuning();
  const baseDelay = Math.min(
    Math.floor(
      tuning.retryInitialDelayMs *
        Math.pow(tuning.retryBackoffMultiplier, Math.max(0, attempt - 1)),
    ),
    tuning.retryMaxDelayMs,
  );
  const jitterRange = baseDelay * tuning.retryJitterRatio;
  const jitter = Math.floor((random() * 2 - 1) * jitterRange);
  return Math.max(250, baseDelay + jitter);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getTelegramErrorDetails(error: unknown): {
  statusCode?: number;
  code?: string;
  message: string;
} {
  const fallback = error instanceof Error ? error.message : String(error);
  if (typeof error !== "object" || error === null) {
    return { message: fallback };
  }

  const errorLike = error as {
    code?: unknown;
    cause?: unknown;
    errors?: unknown[];
    response?: {
      statusCode?: unknown;
      body?: {
        description?: unknown;
        error_code?: unknown;
      };
    };
  };

  const body = errorLike.response?.body;
  const statusCode =
    typeof errorLike.response?.statusCode === "number"
      ? errorLike.response.statusCode
      : typeof body?.error_code === "number"
        ? body.error_code
        : undefined;

  const nestedDetails = [
    ...(Array.isArray(errorLike.errors) ? errorLike.errors : []),
    errorLike.cause,
  ]
    .filter(Boolean)
    .map((nested) => getTelegramErrorDetails(nested));
  const nestedMessage = nestedDetails.map((nested) => nested.message).join("; ");
  const nestedCode = nestedDetails.find((nested) => nested.code)?.code;
  const nestedStatusCode = nestedDetails.find((nested) => nested.statusCode)?.statusCode;

  return {
    statusCode: statusCode ?? nestedStatusCode,
    code: typeof errorLike.code === "string" ? errorLike.code : nestedCode,
    message: [
      typeof body?.description === "string" ? body.description : fallback,
      nestedMessage,
    ].filter(Boolean).join("; "),
  };
}

export function classifyTelegramPollingError(
  error: unknown,
): TelegramPollingDiagnosis {
  const details = getTelegramErrorDetails(error);
  const message = details.message.toLowerCase();
  const technicalReason = [
    details.statusCode ? `status=${details.statusCode}` : null,
    details.code ? `code=${details.code}` : null,
    `error=${details.message}`,
  ].filter(Boolean).join("; ");

  if (
    details.statusCode === 409 ||
    message.includes("terminated by other getupdates request") ||
    message.includes("another bot instance") ||
    message.includes("duplicate polling") ||
    message.includes("conflict")
  ) {
    return {
      origin: "OUR_INFRA",
      kind: "telegram_conflict",
      severity: "DEGRADED",
      userDiagnosis: "Diagnóstico probable: hay dos instancias del bot intentando hacer polling.",
      recommendedAction: "Revisar réplicas o servicios duplicados en Railway y mantener una sola instancia con polling activo.",
      statusCode: details.statusCode,
      code: details.code,
      technicalReason,
    };
  }

  if (details.statusCode === 401 || details.statusCode === 403) {
    return {
      origin: "TELEGRAM",
      kind: "telegram_auth",
      severity: "DEGRADED",
      userDiagnosis: "Diagnóstico probable: Telegram rechazó el token o permisos del bot.",
      recommendedAction: "Revisar TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID y permisos del bot antes de reiniciar.",
      statusCode: details.statusCode,
      code: details.code,
      technicalReason,
    };
  }

  const networkCodes = new Set([
    "ETIMEDOUT",
    "ECONNRESET",
    "EAI_AGAIN",
  ]);
  if (
    (details.code && networkCodes.has(details.code)) ||
    /timeout|timed out|network|socket hang up|fetch failed|econnreset|etimedout|eai_again/.test(message)
  ) {
    return {
      origin: "TELEGRAM",
      kind: "transient_network",
      severity: "WARN",
      userDiagnosis: "Diagnóstico probable: fallo temporal de red durante Telegram polling.",
      recommendedAction: "Mantener el polling activo y reintentar; revisar red solo si persiste.",
      statusCode: details.statusCode,
      code: details.code,
      technicalReason,
    };
  }

  if (
    details.code === "EFATAL" ||
    details.statusCode === 502 ||
    details.statusCode === 503 ||
    details.statusCode === 504
  ) {
    return {
      origin: "TELEGRAM",
      kind: "transient_network",
      severity: "WARN",
      userDiagnosis: "Diagnóstico probable: fallo temporal del servicio de Telegram polling.",
      recommendedAction: "Continuar reintentando la escucha de comandos.",
      statusCode: details.statusCode,
      code: details.code,
      technicalReason,
    };
  }

  return {
    origin: "UNKNOWN",
    kind: "unknown",
    severity: "WARN",
    userDiagnosis: "Diagnóstico probable: error aislado del módulo Telegram commands.",
    recommendedAction: "Revisar el error del módulo si se repite dentro de 10 minutos.",
    statusCode: details.statusCode,
    code: details.code,
    technicalReason,
  };
}

export function isTelegramCommandsPollingEnabled(
  config: Pick<
    AppConfig,
    | "TELEGRAM_COMMAND_BOT_ENABLED"
    | "TELEGRAM_COMMANDS_ENABLED"
    | "TELEGRAM_POLLING_ENABLED"
  >,
): boolean {
  return config.TELEGRAM_COMMAND_BOT_ENABLED &&
    config.TELEGRAM_COMMANDS_ENABLED &&
    config.TELEGRAM_POLLING_ENABLED;
}

function alertMessage(
  diagnosis: TelegramPollingDiagnosis,
  failures: number,
): string {
  const windowMinutes = Math.round(getTelegramPollingTuning().failureWindowMs / 60_000);
  return [
    "🟡 <b>[DEGRADADO] Telegram commands</b>",
    "",
    "📌 El módulo de comandos tuvo errores de polling.",
    `🧭 ${escapeHtml(diagnosis.userDiagnosis)}`,
    "🛠 ¿Afecta el radar?: No afecta ComprasMX ni matches.",
    "📨 Alertas salientes: siguen funcionando si sendMessage está OK.",
    "🔁 Acción: el sistema seguirá intentando escuchar comandos.",
    `📊 Fallos en ventana de ${windowMinutes} min: ${failures}`,
    `📌 Acción sugerida: ${escapeHtml(diagnosis.recommendedAction)}`,
  ].join("\n");
}

function recoveryMessage(): string {
  return [
    "🟢 <b>Telegram commands recuperado</b>",
    "",
    "📌 El módulo de comandos vuelve a responder correctamente.",
    "🧭 La falla anterior fue temporal.",
  ].join("\n");
}

async function readState(): Promise<TelegramCommandsState> {
  const state = await getState<Partial<TelegramCommandsState>>(
    STATE_KEYS.TELEGRAM_COMMANDS_TELEMETRY,
  );
  return { ...EMPTY_STATE, ...(state ?? {}) };
}

async function writeState(state: TelegramCommandsState): Promise<void> {
  await setState(STATE_KEYS.TELEGRAM_COMMANDS_TELEMETRY, { ...state });
}

export async function recordTelegramCommandsStartup(
  mode: TelegramCommandsState["telegram_mode"],
): Promise<void> {
  const previous = await readState();
  const state: TelegramCommandsState = {
    ...previous,
    service_name: process.env.RAILWAY_SERVICE_NAME ?? null,
    instance_id:
      process.env.RAILWAY_REPLICA_ID ??
      process.env.HOSTNAME ??
      null,
    deployment_id: process.env.RAILWAY_DEPLOYMENT_ID ?? null,
    process_pid: process.pid,
    telegram_mode: mode,
  };
  await writeState(state);
  log.info(
    {
      serviceName: state.service_name,
      instanceId: state.instance_id,
      deploymentId: state.deployment_id,
      pid: state.process_pid,
      mode,
    },
    "Telegram commands runtime configurado",
  );
}

export async function recordTelegramPollingFailure(
  error: unknown,
  sendOperationalMessage: SendOperationalMessage,
  now = new Date(),
): Promise<{ diagnosis: TelegramPollingDiagnosis; alerted: boolean; failures: number }> {
  const diagnosis = classifyTelegramPollingError(error);
  const tuning = getTelegramPollingTuning();
  const nowMs = now.getTime();

  if (
    pollingFailureWindowStartedAt === 0 ||
    nowMs - pollingFailureWindowStartedAt > tuning.failureWindowMs
  ) {
    pollingFailureWindowStartedAt = nowMs;
    pendingPollingFailures = 0;
  }
  pendingPollingFailures++;

  const persistent =
    diagnosis.kind === "telegram_conflict" ||
    diagnosis.kind === "telegram_auth" ||
    pendingPollingFailures >= tuning.alertMinFailures;

  log.warn(
    {
      diagnosis,
      failures: pendingPollingFailures,
      persistent,
    },
    persistent
      ? "Telegram commands polling degradado"
      : "Telegram polling_error aislado",
  );

  const failureEvent: TelegramPollingFailureEvent = {
    at: now.toISOString(),
    kind: diagnosis.kind,
    technicalReason: diagnosis.technicalReason,
    statusCode: diagnosis.statusCode,
    code: diagnosis.code,
  };

  if (!persistent) {
    const previous = await readState();
    await writeState({
      ...previous,
      telegram_commands_consecutive_failures: pendingPollingFailures,
      last_telegram_commands_error_at: now.toISOString(),
      last_telegram_commands_error_reason: diagnosis.kind,
      recent_telegram_polling_failures: [
        failureEvent,
        ...previous.recent_telegram_polling_failures,
      ].slice(0, 5),
      telegram_polling_ok: false,
    });
    return {
      diagnosis,
      alerted: false,
      failures: pendingPollingFailures,
    };
  }

  const previous = await readState();
  const lastAlertAt = previous.last_alert_at
    ? Date.parse(previous.last_alert_at)
    : 0;
  const throttled =
    nowMs - (recentAlerts.get(diagnosis.kind) ?? 0) < tuning.alertThrottleMs ||
    previous.last_alert_kind === diagnosis.kind &&
    nowMs - lastAlertAt < tuning.alertThrottleMs;

  let alerted = false;
  let sendOk = previous.telegram_send_message_ok;
  if (!throttled) {
    recentAlerts.set(diagnosis.kind, nowMs);
    try {
      await sendOperationalMessage(
        alertMessage(diagnosis, pendingPollingFailures),
      );
      alerted = true;
      sendOk = true;
      healthTracker.setTelegramHealth("ok");
    } catch (sendError) {
      sendOk = false;
      healthTracker.setTelegramHealth("degraded");
      log.warn(
        { err: sendError },
        "No se pudo enviar alerta degradada de Telegram commands",
      );
    }
  }

  await writeState({
    ...previous,
    telegram_commands_consecutive_failures: pendingPollingFailures,
    last_telegram_commands_error_at: now.toISOString(),
    last_telegram_commands_error_reason: diagnosis.kind,
    recent_telegram_polling_failures: [
      failureEvent,
      ...previous.recent_telegram_polling_failures,
    ].slice(0, 5),
    telegram_send_message_ok: sendOk,
    telegram_polling_ok: false,
    last_alert_at: alerted ? now.toISOString() : previous.last_alert_at,
    last_alert_kind: alerted
      ? diagnosis.kind
      : previous.last_alert_kind,
    incident_alerted_at: alerted
      ? now.toISOString()
      : previous.incident_alerted_at,
  });

  return { diagnosis, alerted, failures: pendingPollingFailures };
}

export async function recordTelegramPollingSuccess(
  sendOperationalMessage: SendOperationalMessage,
  now = new Date(),
): Promise<void> {
  pendingPollingFailures = 0;
  pollingFailureWindowStartedAt = 0;

  const previous = await readState();
  if (
    previous.telegram_commands_consecutive_failures === 0 &&
    previous.telegram_polling_ok
  ) {
    return;
  }

  const shouldNotifyRecovery = Boolean(previous.incident_alerted_at);
  let recoveryAt = previous.last_telegram_commands_recovery_at;
  if (shouldNotifyRecovery && !recoveryInFlight) {
    recoveryInFlight = true;
    try {
      await sendOperationalMessage(recoveryMessage());
      recoveryAt = now.toISOString();
    } catch (error) {
      log.warn(
        { err: error },
        "No se pudo enviar recuperación Telegram commands",
      );
    } finally {
      recoveryInFlight = false;
    }
  }

  await writeState({
    ...previous,
    telegram_commands_consecutive_failures: 0,
    last_telegram_commands_success_at: now.toISOString(),
    last_telegram_commands_recovery_at: recoveryAt,
    telegram_polling_ok: true,
    incident_alerted_at: null,
    last_telegram_commands_error_reason: null,
  });
}

export async function recordTelegramSendSuccess(
  now = new Date(),
): Promise<void> {
  sendFailureCount = 0;
  healthTracker.setTelegramHealth("ok");
  if (sendHealthRecorded) return;

  const previous = await readState();
  await writeState({
    ...previous,
    telegram_send_message_ok: true,
    telegram_send_consecutive_failures: 0,
    last_telegram_commands_success_at:
      previous.last_telegram_commands_success_at ?? now.toISOString(),
  });
  sendHealthRecorded = true;
}

export async function recordTelegramSendFailure(
  error: unknown,
  now = new Date(),
): Promise<void> {
  sendFailureCount++;
  sendHealthRecorded = false;
  healthTracker.setTelegramHealth(
    sendFailureCount >= 3 ? "down" : "degraded",
  );

  const previous = await readState();
  await writeState({
    ...previous,
    telegram_send_message_ok: false,
    telegram_send_consecutive_failures: sendFailureCount,
    last_telegram_send_error_at: now.toISOString(),
  });
  log.warn(
    {
      error: error instanceof Error ? error.message : String(error),
      failures: sendFailureCount,
    },
    "Telegram sendMessage degradado",
  );
}

export function resetTelegramCommandsHealthForTests(): void {
  pendingPollingFailures = 0;
  pollingFailureWindowStartedAt = 0;
  sendFailureCount = 0;
  sendHealthRecorded = false;
  recentAlerts.clear();
  recoveryInFlight = false;
}
