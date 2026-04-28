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
 */
import cron from "node-cron";
import { createModuleLogger } from "../core/logger";
import { getConfig } from "../config/env";
import { recordSchedulerStarted } from "../core/system-state";
import { runCollectJob, runRecheckJob } from "./collect.job";
import { runDailySummaryJob } from "./daily-summary.job";
import { comprasMxCB } from "../core/circuit-breaker";
import { sendTelegramMessage } from "../alerts/telegram.alerts";

const log = createModuleLogger("scheduler");

const JITTER_MS = 3 * 60 * 1000; // ±3 min

function jitter(): number {
  return (Math.random() * 2 - 1) * JITTER_MS;
}

async function scheduledCollect(baseIntervalMs: number): Promise<void> {
  if (comprasMxCB.shouldSkip()) {
    // Circuit breaker OPEN — saltar y reagendar sin correr
    const nextDelay = baseIntervalMs + jitter();
    setTimeout(() => scheduledCollect(baseIntervalMs), nextDelay);
    return;
  }

  try {
    await runCollectJob();
    comprasMxCB.recordSuccess();
  } catch (err) {
    log.error({ err, mode: "listing_scan" }, "❌ Error no manejado en MODO 1 (Listing Scan)");
    const alertMsg = comprasMxCB.recordFailure();
    if (alertMsg) {
      sendTelegramMessage(alertMsg, "HTML").catch((e) =>
        log.warn({ err: e }, "No se pudo enviar alerta circuit breaker"),
      );
    }
  }

  const nextDelay = baseIntervalMs + jitter();
  log.info(
    { nextInMin: (nextDelay / 60_000).toFixed(1) },
    "⏱ Próximo ciclo MODO 1 programado",
  );
  setTimeout(() => scheduledCollect(baseIntervalMs), nextDelay);
}

export function startScheduler(): void {
  const config = getConfig();
  const intervalMinutes = config.COLLECT_INTERVAL_MINUTES;
  const baseIntervalMs = intervalMinutes * 60 * 1000;
  const recheckHour = config.COMPRASMX_DAILY_RECHECK_HOUR;
  const summaryHour = config.DAILY_SUMMARY_HOUR;

  // ── MODO 2: Daily Direct Recheck ──────────────────────────────────────────
  const recheckCron = `0 ${recheckHour} * * *`;

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

  // ── RESUMEN DIARIO ────────────────────────────────────────────────────────
  const summaryCron = `0 ${summaryHour} * * *`;

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

  // Primer ciclo inmediato post-deploy — 10 s para que bootstrap termine
  setTimeout(async () => {
    log.info("🚀 Ejecutando primer ciclo inmediato post-deploy...");
    try {
      await runCollectJob();
      comprasMxCB.recordSuccess();
    } catch (err) {
      log.error({ err }, "❌ Error en primer ciclo inmediato");
      const alertMsg = comprasMxCB.recordFailure();
      if (alertMsg) {
        sendTelegramMessage(alertMsg, "HTML").catch(() => {});
      }
    }
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
    },
    `✅ Scheduler iniciado — Modo 1 ~${intervalMinutes} min ±3 min, Modo 2 a las ${recheckHour}:00, Resumen a las ${summaryHour}:00`,
  );
}
