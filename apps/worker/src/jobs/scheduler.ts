/**
 * SCHEDULER — Orquestador de ciclos con cron.
 *
 * MODO 1 — Periodic Incremental Listing Scan
 *   Corre cada COLLECT_INTERVAL_MINUTES minutos.
 *   Usa el listado superficial + comparación de fingerprints + stop condition.
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
import { runCollectFondosJob } from "./collect-fondos.job";
import { runDailyAccionesJob, DAILY_ACCIONES_CRON } from "./daily-acciones.job";
import { runDailyApuestasJob, DAILY_APUESTAS_CRON } from "./daily-apuestas.job";
import { runDailyPetroleoJob, DAILY_PETROLEO_CRON } from "./daily-petroleo.job";

const log = createModuleLogger("scheduler");

export function startScheduler(): void {
  const config = getConfig();
  const intervalMinutes = config.COLLECT_INTERVAL_MINUTES;
  const recheckHour = config.COMPRASMX_DAILY_RECHECK_HOUR;
  const summaryHour = config.DAILY_SUMMARY_HOUR;

  // ── MODO 1: Periodic Incremental Listing Scan ─────────────────────────────
  // ... (existing code)
  const collectCron = `*/${intervalMinutes} * * * *`;

  cron.schedule(
    collectCron,
    async () => {
      log.info(
        { cron: collectCron, mode: "listing_scan" },
        "⏰ [MODO 1] Disparando Periodic Incremental Listing Scan",
      );
      try {
        await runCollectJob();
      } catch (err) {
        log.error(
          { err, mode: "listing_scan" },
          "❌ Error no manejado en MODO 1 (Listing Scan)",
        );
      }
    },
    { timezone: "America/Mexico_City" },
  );

  // ── MODO 2: Daily Direct Recheck ──────────────────────────────────────────
  // ... (existing code)
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

  // ── INVERSIÓN: Reportes diarios especializados ────────────────────────────
  // Acciones (L-V 9am)
  cron.schedule(
    DAILY_ACCIONES_CRON,
    async () => {
      log.info({ cron: DAILY_ACCIONES_CRON }, "📈 Disparando reporte diario de acciones");
      await runDailyAccionesJob();
    },
    { timezone: "America/Mexico_City" },
  );

  // Apuestas (Diario 8am)
  cron.schedule(
    DAILY_APUESTAS_CRON,
    async () => {
      log.info({ cron: DAILY_APUESTAS_CRON }, "🎯 Disparando reporte diario de apuestas");
      await runDailyApuestasJob();
    },
    { timezone: "America/Mexico_City" },
  );

  // Petróleo (L,W,F 10am)
  cron.schedule(
    DAILY_PETROLEO_CRON,
    async () => {
      log.info({ cron: DAILY_PETROLEO_CRON }, "🛢️ Disparando reporte diario de petróleo");
      await runDailyPetroleoJob();
    },
    { timezone: "America/Mexico_City" },
  );

  // ── FONDOS: Convocatorias internacionales para donatarias autorizadas ────────
  // ... (existing code)
  const fondosCron = "0 */6 * * *";

  if (config.FONDOS_ENABLED) {
    cron.schedule(
      fondosCron,
      async () => {
        log.info({ cron: fondosCron }, "Disparando colección de fondos internacionales");
        try {
          await runCollectFondosJob();
        } catch (err) {
          log.error({ err }, "Error no manejado en collect-fondos job");
        }
      },
      { timezone: "America/Mexico_City" },
    );
  } else {
    log.warn("⏸️  FONDOS_ENABLED=false — collector de fondos internacionales PAUSADO (los demás scrapers siguen activos)");
  }

  // Registrar estado en system_state
  recordSchedulerStarted(collectCron, summaryCron).catch((err) =>
    log.warn({ err }, "No se pudo registrar scheduler en system_state"),
  );

  // Primer ciclo inmediato post-deploy — no esperar al próximo tick del cron
  setTimeout(async () => {
    log.info("🚀 Ejecutando primer ciclo inmediato post-deploy...");
    try {
      await runCollectJob();
    } catch (err) {
      log.error({ err }, "❌ Error en primer ciclo inmediato");
    }
  }, 10_000); // 10 s para que bootstrap termine antes de lanzar

  log.info(
    {
      mode1: {
        cron: collectCron,
        description: "Periodic Incremental Listing Scan",
      },
      mode2: {
        cron: recheckCron,
        description: "Daily Direct Recheck",
        hour: recheckHour,
      },
      summary: { cron: summaryCron, hour: summaryHour },
      fondos: config.FONDOS_ENABLED
        ? { cron: fondosCron, description: "Fondos internacionales donatarias" }
        : { status: "PAUSED", reason: "FONDOS_ENABLED=false" },
    },
    `✅ Scheduler iniciado — Modo 1 cada ${intervalMinutes} min, Modo 2 a las ${recheckHour}:00, Resumen a las ${summaryHour}:00, Fondos cada 6h`,
  );
}
