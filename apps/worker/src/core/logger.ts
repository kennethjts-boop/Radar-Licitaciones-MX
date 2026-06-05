/**
 * LOGGER — pino con pretty-print en dev, JSON en prod.
 * En producción usa pino.multistream para enviar ERROR/FATAL a Telegram
 * a través del error-notifier (patrón deferred para evitar dependencias circulares).
 */
import pino from "pino";
import { Writable } from "stream";
import { getConfig } from "../config/env";
import { handlePinoEntry } from "./error-notifier";

// Logger raíz — lazy initialized para no requerir config al importar tipos
let _logger: pino.Logger | null = null;

/**
 * Stream personalizado que recibe líneas JSON de pino y reenvía las de
 * nivel ERROR/FATAL al error-notifier para notificación por Telegram.
 */
class TelegramErrorStream extends Writable {
  _write(chunk: Buffer, _enc: BufferEncoding, cb: () => void): void {
    const raw = chunk.toString();
    // pino puede acumular varias líneas en un chunk
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed) handlePinoEntry(trimmed);
    }
    cb();
  }
}

export function getLogger(): pino.Logger {
  if (_logger) return _logger;

  const config = getConfig();
  const isDev = config.NODE_ENV === "development";

  const pinoOpts: pino.LoggerOptions = {
    level: config.LOG_LEVEL,
    base: {
      app: "radar-licitaciones",
      env: config.NODE_ENV,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (isDev) {
    // En desarrollo: pino-pretty para legibilidad en consola.
    // El error-notifier no estará registrado en dev, así que el stream
    // de Telegram no enviará nada (comportamiento correcto).
    _logger = pino({
      ...pinoOpts,
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:HH:MM:ss",
          ignore: "pid,hostname",
        },
      },
    });
  } else {
    // En producción: multistream — JSON a stdout + interceptor para Telegram.
    // El nivel 'error' en el stream de Telegram hace que pino solo le envíe
    // entradas de nivel ERROR (50) y FATAL (60), reduciendo el procesamiento.
    _logger = pino(
      pinoOpts,
      pino.multistream([
        { stream: process.stdout },
        { stream: new TelegramErrorStream(), level: "error" },
      ]),
    );
  }

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
