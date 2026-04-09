/**
 * SCHEDULER — Ciclo principal de 30 minutos con cron.
 *
 * FASE 1: usa heartbeat job (sin scraping).
 * FASE 2: descomentar la línea del collect job real.
 */
import cron from 'node-cron';
import { createModuleLogger } from '../core/logger';
import { getConfig } from '../config/env';
import { recordSchedulerStarted } from '../core/system-state';
import { runHeartbeatJob } from './heartbeat.job';
// FASE 2: importar aquí → import { runCollectJob } from './collect.job';
import { runDailySummaryJob } from './daily-summary.job';

const log = createModuleLogger('scheduler');

export function startScheduler(): void {
  const config = getConfig();
  const interval = config.COLLECT_INTERVAL_MINUTES;
  const summaryHour = config.DAILY_SUMMARY_HOUR;

  // ── Ciclo principal cada N minutos ────────────────────────────────────────
  const collectCron = `*/${interval} * * * *`;

  cron.schedule(collectCron, async () => {
    log.info({ cron: collectCron }, '⏰ Disparando ciclo');
    try {
      // FASE 1: heartbeat sin scraping
      await runHeartbeatJob();
      // FASE 2: reemplazar por → await runCollectJob();
    } catch (err) {
      log.error({ err }, '❌ Error no manejado en ciclo principal');
    }
  }, { timezone: 'America/Mexico_City' });

  // ── Resumen diario ────────────────────────────────────────────────────────
  const summaryCron = `0 ${summaryHour} * * *`;

  cron.schedule(summaryCron, async () => {
    log.info('📊 Disparando resumen diario');
    try {
      await runDailySummaryJob();
    } catch (err) {
      log.error({ err }, '❌ Error en daily summary job');
    }
  }, { timezone: 'America/Mexico_City' });

  // Registrar en system_state (no crashea si falla)
  recordSchedulerStarted(collectCron, summaryCron).catch((err) =>
    log.warn({ err }, 'No se pudo registrar scheduler en system_state')
  );

  log.info(
    { collectCron, summaryCron },
    `✅ Scheduler activo — ciclo cada ${interval} min, resumen a las ${summaryHour}:00 MX`
  );
}
