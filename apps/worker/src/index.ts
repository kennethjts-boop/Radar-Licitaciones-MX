/**
 * ENTRY POINT — Flujo de arranque del worker Radar Licitaciones MX.
 *
 * Secuencia:
 * 1. Inicializar logger
 * 2. Cargar y validar config (Zod → crash si falta variable)
 * 3. Registrar signal handlers
 * 4. Bootstrap: verificar Supabase + Telegram + system_state
 * 5. Inicializar bot de comandos Telegram (polling)
 * 6. Iniciar scheduler (30 min + daily summary)
 * 7. Worker en espera activa
 */
import { getConfig } from './config/env';
import { getLogger } from './core/logger';
import { bootstrap } from './bootstrap';
import { startScheduler } from './jobs/scheduler';
import { initCommandBot } from './commands/telegram.commands';
import { setComprasMxSourceId } from './jobs/heartbeat.job';

async function main(): Promise<void> {
  // ── 1. Configuración y logger ─────────────────────────────────────────────
  const config = getConfig();         // crash aquí si falta variable de entorno
  const log = getLogger();

  log.info(
    {
      env: config.NODE_ENV,
      timezone: config.APP_TIMEZONE,
      collectInterval: config.COLLECT_INTERVAL_MINUTES,
      dailySummaryHour: config.DAILY_SUMMARY_HOUR,
      railway: config.RAILWAY_ENVIRONMENT ?? 'local',
    },
    '🚀 Radar Licitaciones MX — worker boot started'
  );

  // ── 2. Signal handlers ────────────────────────────────────────────────────
  process.on('SIGTERM', () => {
    log.info('SIGTERM recibido — cerrando gracefulmente');
    process.exit(0);
  });

  process.on('SIGINT', () => {
    log.info('SIGINT recibido — cerrando');
    process.exit(0);
  });

  process.on('uncaughtException', (err) => {
    log.fatal({ err }, '💥 uncaughtException — el proceso se cerrará');
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    log.error({ reason }, '⚠️ unhandledRejection — revisar promesas');
  });

  // ── 3. Bootstrap: DB + Telegram + system_state ────────────────────────────
  log.info('🔧 Iniciando bootstrap de servicios...');
  const bootResult = await bootstrap();

  // Propagar sourceId al heartbeat job para evitar queries repetidas
  if (bootResult.sourceId) {
    setComprasMxSourceId(bootResult.sourceId);
    log.info({ sourceId: bootResult.sourceId }, '🔑 Source ID comprasmx propagado');
  } else {
    log.warn('⚠️ Source ID comprasmx no disponible — se resolverá en primer ciclo');
  }

  // ── 4. Bot de comandos Telegram ───────────────────────────────────────────
  if (bootResult.telegramOk) {
    try {
      initCommandBot();
      log.info('🤖 Bot Telegram iniciado con polling');
    } catch (err) {
      log.warn({ err }, '⚠️ Error iniciando bot — continuando sin comandos');
    }
  } else {
    log.warn('⚠️ Bot Telegram desactivado — Telegram no disponible');
  }

  // ── 5. Scheduler ──────────────────────────────────────────────────────────
  startScheduler();
  log.info('✅ Scheduler iniciado');

  // ── 6. Resumen de arranque ────────────────────────────────────────────────
  log.info(
    {
      supabase: bootResult.supabaseOk ? 'ok' : 'down',
      telegram: bootResult.telegramOk ? 'ok' : 'down',
      bot: bootResult.botUsername ?? 'N/A',
      sourceId: bootResult.sourceId ?? 'pendiente',
    },
    '✅ Worker activo — esperando ciclos'
  );
}

main().catch((err) => {
  console.error('💥 Error fatal al iniciar worker:', err);
  process.exit(1);
});
