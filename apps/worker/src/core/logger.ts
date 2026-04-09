/**
 * LOGGER — pino con pretty-print en dev, JSON en prod.
 * El logger es singleton y debe importarse desde aquí en todo el sistema.
 */
import pino from 'pino';
import { getConfig } from '../config/env';

// Logger raíz — lazy initialized para no requerir config al importar tipos
let _logger: pino.Logger | null = null;

export function getLogger(): pino.Logger {
  if (_logger) return _logger;

  const config = getConfig();
  const isDev = config.NODE_ENV === 'development';

  _logger = pino({
    level: config.LOG_LEVEL,
    transport: isDev
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
    base: {
      app: 'radar-licitaciones',
      env: config.NODE_ENV,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });

  return _logger;
}

export function resetLogger(): void {
  _logger = null;
}

// Helper con módulo — usar en cada módulo:
// const log = createModuleLogger('comprasmx-collector');
export function createModuleLogger(module: string): pino.Logger {
  return getLogger().child({ module });
}
