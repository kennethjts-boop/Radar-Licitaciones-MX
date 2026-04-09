/**
 * SCHEDULER — Ciclo principal de 30 minutos con cron.
 * También programa el resumen diario.
 */
import cron from 'node-cron';
import { createModuleLogger } from '../core/logger';
import { getConfig } from '../config/env';
import { runCollectJob } from './collect.job';
import { runDailySummaryJob } from './daily-summary.job';

const log = createModuleLogger('scheduler');

export function startScheduler(): void {
  const config = getConfig();
  const interval = config.COLLECT_INTERVAL_MINUTES;
  const summaryHour = config.DAILY_SUMMARY_HOUR;

  log.info({ interval, summaryHour }, 'Iniciando scheduler');

  // ── Ciclo de colección cada N minutos ─────────────────────────────────────
  // Expresión cron: cada N minutos desde el inicio
  const collectCron = `*/${interval} * * * *`;

  cron.schedule(collectCron, async () => {
    log.info({ cron: collectCron }, 'Disparando ciclo de colección');
    try {
      await runCollectJob();
    } catch (err) {
      log.error({ err }, 'Error no manejado en collect job');
    }
  }, {
    timezone: 'America/Mexico_City',
  });

  // ── Resumen diario a la hora configurada ──────────────────────────────────
  const summaryCron = `0 ${summaryHour} * * *`;

  cron.schedule(summaryCron, async () => {
    log.info('Disparando resumen diario');
    try {
      await runDailySummaryJob();
    } catch (err) {
      log.error({ err }, 'Error no manejado en daily summary job');
    }
  }, {
    timezone: 'America/Mexico_City',
  });

  log.info(
    { collectCron, summaryCron },
    `Scheduler activo — colección cada ${interval} min, resumen a las ${summaryHour}:00 MX`
  );
}
