/**
 * ENTRY POINT — Main del worker.
 * Inicia logger, valida config, conecta servicios y arranca scheduler + bot.
 */
import { getConfig } from './config/env';
import { getLogger } from './core/logger';
import { startScheduler } from './jobs/scheduler';
import { initCommandBot } from './commands/telegram.commands';

async function main(): Promise<void> {
  // 1. Validar config — falla fast si falta alguna variable
  const config = getConfig();
  const log = getLogger();

  log.info(
    {
      env: config.NODE_ENV,
      timezone: config.APP_TIMEZONE,
      collectInterval: config.COLLECT_INTERVAL_MINUTES,
      railway: config.RAILWAY_ENVIRONMENT ?? 'local',
    },
    '🚀 Radar Licitaciones MX — Iniciando worker'
  );

  // 2. Registrar handlers de señales de proceso
  process.on('SIGTERM', () => {
    log.info('SIGTERM recibido — cerrando gracefulmente');
    process.exit(0);
  });

  process.on('SIGINT', () => {
    log.info('SIGINT recibido — cerrando');
    process.exit(0);
  });

  process.on('uncaughtException', (err) => {
    log.fatal({ err }, 'Error no capturado — el proceso se cerrará');
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    log.error({ reason }, 'Promesa rechazada no manejada');
  });

  // 3. Inicializar bot de Telegram (polling)
  try {
    initCommandBot();
    log.info('Bot Telegram iniciado');
  } catch (err) {
    log.warn({ err }, 'Error iniciando bot Telegram — continuando sin comandos');
  }

  // 4. Iniciar scheduler
  startScheduler();

  log.info('Worker activo — esperando ciclos');
}

main().catch((err) => {
  console.error('Error fatal al iniciar worker:', err);
  process.exit(1);
});
