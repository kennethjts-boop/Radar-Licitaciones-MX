/**
 * SCHEDULER — Orquestador de ciclos con cron.
 *
 * MODO 1 — Periodic Incremental Listing Scan
 *   Corre cada ~COLLECT_INTERVAL_MINUTES minutos con ±3 min de jitter aleatorio
 *   usando setTimeout recursivo (en lugar de setInterval/cron) para evitar
 *   patrones predecibles detectables por el portal.
 *
 * MODO 2 — Daily Direct Recheck
 *   Corre una vez al día a COMPRASMX_DAILY_RECHECK_HOUR (America/Mexico_City).
 *   Toma expedientes activos/en_proceso desde DB y entra directo a source_url
 *   sin cargar el índice general.
 *
 * RESUMEN DIARIO
 *   Corre una vez al día a DAILY_SUMMARY_HOUR.
 *   Genera y envía el resumen operativo por Telegram.
 *
 * CATCH-UP DE RESUMEN
 *   Si el worker reinicia después de DAILY_SUMMARY_HOUR en un día hábil y el
 *   resumen no fue enviado ese día, lo dispara automáticamente al arrancar.
 */
import cron from "node-cron";
import { createModuleLogger } from "../core/logger";
import { getConfig } from "../config/env";
import { recordSchedulerStarted, getState, STATE_KEYS } from "../core/system-state";
import { runCollectJob, runRecheckJob, type CollectJobResult } from "./collect.job";
import { runDailySummaryJob } from "./daily-summary.job";
import { comprasMxCB } from "../core/circuit-breaker";
import { sendTelegramMessage } from "../alerts/telegram.alerts";
import { healthTracker } from "../core/healthcheck";
import { runExternalLeadsOsintJob } from "../modules/external-opportunity-discovery";
import { nowInMexico, todayMexicoStr } from "../core/time";

const log = createModuleLogger("scheduler");

const JITTER_MS = 3 * 60 * 1000; // ±3 min

function jitter(): number {
  return (Math.random() * 2 - 1) * JITTER_MS;
}

const CRITICAL_COLLECT_FAILURE_PATTERNS = [
  /timeout/i,
  /critical/i,
  /BrowserManager/i,
  /listing_unavailable/i,
  /no rows extracted/i,
  /No source_id/i,
  /comprasmx-collection/i,
];

export function isCriticalCollectFailure(result: CollectJobResult): boolean {
  if (result.status !== "error") return false;
  if (result.itemsSeen === 0 && result.pagesScanned === 0) return true;

  const failureText = `${result.errorMessage ?? ""} ${result.stopReason ?? ""}`;
  return CRITICAL_COLLECT_FAILURE_PATTERNS.some((pattern) =>
    pattern.test(failureText),
  );
}

export function resetComprasMxIncidentStateForTests(): void {
  // La deduplicación ahora se persiste en system_state desde collect.job.
}

export function recordCollectResultForCircuitBreaker(result: CollectJobResult): string | null {
  if (result.status === "skipped") return null;

  if (
    result.status === "degraded" ||
    result.status === "source_unavailable" ||
    result.status === "site_accessible_extraction_failed"
  ) {
    log.warn(
      {
        status: result.status,
        stopReason: result.stopReason,
        itemsSeen: result.itemsSeen,
        pagesScanned: result.pagesScanned,
      },
      "Falla parcial de ComprasMX; se mantiene scheduler vivo sin activar circuit breaker",
    );
    comprasMxCB.recordSuccess();
    return null;
  }

  if (isCriticalCollectFailure(result)) {
    return comprasMxCB.recordFailure();
  }

  if (result.status === "error") {
    log.warn(
      {
        status: result.status,
        errorMessage: result.errorMessage,
        stopReason: result.stopReason,
        itemsSeen: result.itemsSeen,
        pagesScanned: result.pagesScanned,
      },
      "Ciclo de colección terminó con error parcial; no se activa circuit breaker",
    );
  }

  comprasMxCB.recordSuccess();
  return null;
}

export async function runExternalLeadsIfEnabled(
  runner: typeof runExternalLeadsOsintJob = runExternalLeadsOsintJob,
): Promise<void> {
  try {
    const result = await runner();
    log.info(
      {
        status: result.status,
        dryRun: result.dryRun,
        sourcesReviewed: result.sourcesReviewed,
        detected: result.detected,
        saved: result.saved,
        alerted: result.alerted,
        skippedLowScore: result.skippedLowScore,
        skippedMissingSourceUrl: result.skippedMissingSourceUrl,
        skippedMissingEvidence: result.skippedMissingEvidence,
        skippedDuplicateAlert: result.skippedDuplicateAlert,
        telegramCandidates: result.telegramCandidates,
        errors: result.errors.length,
      },
      "🧭 Ciclo OSINT externo completado",
    );
  } catch (err) {
    log.error({ err }, "❌ Error no manejado en OSINT externo");
  }
}

async function scheduledCollect(baseIntervalMs: number): Promise<void> {
  if (comprasMxCB.shouldSkip()) {
    // Circuit breaker OPEN — saltar y reagendar sin correr
    const nextDelay = baseIntervalMs + jitter();
    setTimeout(() => scheduledCollect(baseIntervalMs), nextDelay);
    return;
  }

  try {
    const result = await runCollectJob();
    const alertMsg = recordCollectResultForCircuitBreaker(result);
    if (alertMsg) {
      sendTelegramMessage(alertMsg, "HTML").catch((e) =>
        log.warn({ err: e }, "No se pudo enviar alerta circuit breaker"),
      );
    }
  } catch (err) {
    log.error({ err, mode: "listing_scan" }, "❌ Error no manejado en MODO 1 (Listing Scan)");
    const alertMsg = comprasMxCB.recordFailure();
    if (alertMsg) {
      sendTelegramMessage(alertMsg, "HTML").catch((e) =>
        log.warn({ err: e }, "No se pudo enviar alerta circuit breaker"),
      );
    }
  }

  await runExternalLeadsIfEnabled();

  const nextDelay = baseIntervalMs + jitter();
  log.info(
    { nextInMin: (nextDelay / 60_000).toFixed(1) },
    "⏱ Próximo ciclo MODO 1 programado",
  );
  setTimeout(() => scheduledCollect(baseIntervalMs), nextDelay);
}

/**
 * Catch-up del resumen diario.
 *
 * Si el worker reinicia después de DAILY_SUMMARY_HOUR en un día hábil
 * (lunes–viernes) y el resumen no fue enviado exitosamente hoy, lo dispara
 * de inmediato en lugar de esperar hasta mañana.
 */
async function catchUpDailySummaryIfMissed(summaryHour: number): Promise<void> {
  try {
    const now = nowInMexico();
    const dayOfWeek = now.getDay(); // 0=Dom, 1=Lun … 5=Vie, 6=Sáb
    const currentHour = now.getHours();

    // Solo en días hábiles y una vez que ya pasó la hora del resumen
    if (dayOfWeek < 1 || dayOfWeek > 5 || currentHour < summaryHour) return;

    const today = todayMexicoStr();
    const last = await getState<{ summaryDate?: string; status?: string }>(
      STATE_KEYS.LAST_DAILY_SUMMARY,
    );

    if (last?.summaryDate === today && last?.status === "success") {
      log.info({ today }, "✅ Catch-up: resumen diario ya enviado hoy — omitiendo");
      return;
    }

    log.info(
      {
        today,
        lastSummaryDate: last?.summaryDate ?? "nunca",
        lastStatus: last?.status ?? "unknown",
        currentHour,
        summaryHour,
      },
      "⚡ Catch-up: resumen diario no enviado hoy — disparando ahora...",
    );

    await runDailySummaryJob();
  } catch (err) {
    log.error({ err }, "❌ Error en catch-up de resumen diario");
  }
}

export function startScheduler(): void {
  healthTracker.setSchedulerStatus("active");

  const config = getConfig();
  const intervalMinutes = config.COLLECT_INTERVAL_MINUTES;
  const baseIntervalMs = intervalMinutes * 60 * 1000;
  const recheckHour = config.COMPRASMX_DAILY_RECHECK_HOUR;
  const summaryHour = config.DAILY_SUMMARY_HOUR;

  // ── MODO 2: Daily Direct Recheck ──────────────────────────────────────────
  const recheckCron = `0 ${recheckHour} * * 1-5`;

  cron.schedule(
    recheckCron,
    async () => {
      log.info(
        { cron: recheckCron, hour: recheckHour, mode: "daily_recheck" },
        "🔍 [MODO 2] Disparando Daily Direct Recheck de expedientes activos/en_proceso",
      );
      try {
        await runRecheckJob();
      } catch (err) {
        log.error(
          { err, mode: "daily_recheck" },
          "❌ Error no manejado en MODO 2 (Daily Recheck)",
        );
      }
    },
    { timezone: "America/Mexico_City" },
  );

  // ── RESUMEN DIARIO ──────────────────────────────────────────────────────
  const summaryCron = `0 ${summaryHour} * * 1-5`;

  cron.schedule(
    summaryCron,
    async () => {
      log.info({ cron: summaryCron }, "📊 Disparando resumen diario");
      try {
        await runDailySummaryJob();
      } catch (err) {
        log.error({ err }, "❌ Error en daily summary job");
      }
    },
    { timezone: "America/Mexico_City" },
  );

  // Registrar estado en system_state
  recordSchedulerStarted(`~${intervalMinutes}m±3m jitter`, summaryCron).catch((err) =>
    log.warn({ err }, "No se pudo registrar scheduler en system_state"),
  );

  // ── CATCH-UP: Resumen diario perdido por restart ───────────────────────────
  // Espera 15s para asegurar que bootstrap haya terminado y la DB esté lista.
  setTimeout(() => catchUpDailySummaryIfMissed(summaryHour), 15_000);

  // Primer ciclo inmediato post-deploy — 10 s para que bootstrap termine
  setTimeout(async () => {
    log.info("🚀 Ejecutando primer ciclo inmediato post-deploy...");
    try {
      const result = await runCollectJob();
      const alertMsg = recordCollectResultForCircuitBreaker(result);
      if (alertMsg) {
        sendTelegramMessage(alertMsg, "HTML").catch(() => {});
      }
    } catch (err) {
      log.error({ err }, "❌ Error en primer ciclo inmediato");
      const alertMsg = comprasMxCB.recordFailure();
      if (alertMsg) {
        sendTelegramMessage(alertMsg, "HTML").catch(() => {});
      }
    }
    await runExternalLeadsIfEnabled();
    // Arrancar el loop recursivo con jitter después del primer ciclo inmediato
    const firstDelay = baseIntervalMs + jitter();
    log.info(
      { nextInMin: (firstDelay / 60_000).toFixed(1) },
      "⏱ Iniciando loop MODO 1 con jitter",
    );
    setTimeout(() => scheduledCollect(baseIntervalMs), firstDelay);
  }, 10_000);

  log.info(
    {
      mode1: {
        interval: `~${intervalMinutes}min ±3min jitter`,
        description: "Periodic Incremental Listing Scan (setTimeout recursivo)",
      },
      mode2: {
        cron: recheckCron,
        description: "Daily Direct Recheck",
        hour: recheckHour,
      },
      summary: { cron: summaryCron, hour: summaryHour },
      catchUp: "Resumen diario: catch-up automático al arrancar si fue omitido",
    },
    `✅ Scheduler iniciado — Modo 1 ~${intervalMinutes} min ±3 min, Modo 2 a las ${recheckHour}:00, Resumen a las ${summaryHour}:00`,
  );
}
