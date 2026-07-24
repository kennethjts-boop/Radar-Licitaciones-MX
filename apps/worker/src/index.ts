/**
 * ENTRY POINT — Flujo de arranque del worker Radar Licitaciones MX.
 *
 * Secuencia:
 * 1. Inicializar logger
 * 2. Cargar y validar config (Zod → crash si falta variable)
 * 3. Registrar signal handlers
 * 4. Exponer /health antes de cualquier operación remota
 * 5. Bootstrap: verificar Supabase + Telegram + system_state
 * 6. Registrar notificador de errores a Telegram
 * 7. Inicializar bot de comandos Telegram en background
 * 8. Lanzar FORCE_COLLECT en background cuando corresponda
 * 9. Iniciar scheduler (30 min + daily summary)
 */
import { getConfig } from "./config/env";
import { getLogger } from "./core/logger";
import { bootstrap } from "./bootstrap";
import { SchemaValidationError } from "./storage/schema-validator";
import { startScheduler } from "./jobs/scheduler";
import {
  initCommandBot,
  shutdownCommandBot,
} from "./agent/telegram.commands";
import { setComprasMxSourceId } from "./jobs/collect.job";
import { runMaestrosScraper } from "./scripts/maestros-morelos";
import { startHttpServer } from "./core/http-server";
import { registerErrorNotifier } from "./core/error-notifier";
import { sendTelegramMessage } from "./alerts/telegram.alerts";
import {
  isTelegramCommandsPollingEnabled,
  recordTelegramCommandsStartup,
} from "./core/telegram-commands-health";
import { getEffectivePause } from "./modules/control/pause-state";
import {
  setBootstrapRuntimeStatus,
  setDatabaseRuntimeStatus,
  setTelegramPollingRuntimeStatus,
} from "./core/runtime-health";

async function main(): Promise<void> {
  // ── 1. Configuración y logger ─────────────────────────────────────────────
  const config = getConfig(); // crash aquí si falta variable de entorno
  const log = getLogger();

  log.info("Worker booting...");
  log.info("worker_started");

  log.info(
    {
      env: config.NODE_ENV,
      timezone: config.APP_TIMEZONE,
      collectInterval: config.COLLECT_INTERVAL_MINUTES,
      dailySummaryHour: config.DAILY_SUMMARY_HOUR,
      railway: config.RAILWAY_ENVIRONMENT ?? "local",
    },
    "🚀 Radar Licitaciones MX — worker boot started",
  );

  // ── 2. Signal handlers ────────────────────────────────────────────────────
  let gracefulShutdownPromise: Promise<void> | null = null;
  const gracefulShutdown = (signal: "SIGTERM" | "SIGINT"): Promise<void> => {
    if (gracefulShutdownPromise) return gracefulShutdownPromise;
    gracefulShutdownPromise = (async () => {
      log.info({ signal }, `${signal} recibido — cerrando gracefulmente`);
      let timeoutHandle: NodeJS.Timeout | null = null;
      try {
        await Promise.race([
          shutdownCommandBot(),
          new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(
              () => reject(new Error("Timeout de 8s deteniendo Telegram polling")),
              8_000,
            );
          }),
        ]);
        log.info({ signal }, "Telegram polling detenido antes del shutdown");
      } catch (err) {
        log.warn(
          { err, signal },
          "Shutdown de Telegram agotó el tiempo; el proceso continuará cerrando",
        );
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        process.exit(0);
      }
    })();
    return gracefulShutdownPromise;
  };

  process.on("SIGTERM", () => {
    void gracefulShutdown("SIGTERM");
  });

  process.on("SIGINT", () => {
    void gracefulShutdown("SIGINT");
  });

  process.on("uncaughtException", (err) => {
    log.fatal({ err }, "💥 uncaughtException — el proceso se cerrará");
    // Intentar notificar a Telegram antes de salir; withTimeout en sendTelegramMessage
    // garantiza que no se cuelgue — el proceso sale de todas formas al finalizar.
    const msg = [
      "💥 <b>[FATAL] uncaughtException</b>",
      "",
      `📌 ${escapeHtml(err.message)}`,
      err.stack ? `<pre>${escapeHtml(err.stack.split("\n").slice(0, 4).join("\n"))}</pre>` : "",
    ].join("\n");
    sendTelegramMessage(msg, "HTML")
      .catch(() => {})
      .finally(() => process.exit(1));
  });

  process.on("unhandledRejection", (reason) => {
    log.error({ reason }, "⚠️ unhandledRejection — revisar promesas");
    // log.error dispara el stream → el error-notifier lo enviará a Telegram
    // automáticamente si el notificador ya está registrado (post-bootstrap).
  });

  // ── 3. HTTP liveness: antes de cualquier operación remota ────────────────
  setTelegramPollingRuntimeStatus(
    isTelegramCommandsPollingEnabled(config) ? "starting" : "disabled",
  );
  await startHttpServer();

  // Modo explícito de tarea única: aun aquí /health ya está escuchando.
  if (
    process.env.RUN_MAESTROS === "true" &&
    (config.NODE_ENV === "development" ||
      process.env.MAESTROS_ONLY === "true")
  ) {
    log.info("RUN_MAESTROS=true detectado: ejecutando scraper de maestros");
    await runMaestrosScraper();
    log.info("Scraper de maestros finalizado (modo tarea única) — saliendo");
    process.exit(0);
  }

  // ── 4. Bootstrap: DB + Telegram + system_state ────────────────────────────
  log.info("🔧 Iniciando bootstrap de servicios...");
  let bootResult: Awaited<ReturnType<typeof bootstrap>>;
  try {
    bootResult = await bootstrap();
    setDatabaseRuntimeStatus("ok");
    setBootstrapRuntimeStatus("ok");
  } catch (err) {
    setDatabaseRuntimeStatus("error");
    setBootstrapRuntimeStatus("failed");
    throw err;
  }

  // ── 5. Registrar notificador de errores a Telegram ────────────────────────
  // A partir de aquí, cualquier log.error() o log.fatal() en cualquier módulo
  // enviará automáticamente un mensaje a Telegram con el error exacto.
  if (bootResult.telegramOk) {
    registerErrorNotifier((text) => {
      sendTelegramMessage(text, "HTML").catch(() => {
        // silencioso: no queremos un bucle de errores si Telegram falla
      });
    });
    log.info("🔔 Notificador de errores Telegram registrado");
  } else {
    log.warn("⚠️ Notificador de errores no registrado — Telegram no disponible");
  }

  // Propagar sourceId al heartbeat job para evitar queries repetidas
  if (bootResult.sourceId) {
    setComprasMxSourceId(bootResult.sourceId);
    log.info(
      { sourceId: bootResult.sourceId },
      "🔑 Source ID comprasmx propagado",
    );
  } else {
    log.warn(
      "⚠️ Source ID comprasmx no disponible — se resolverá en primer ciclo",
    );
  }

  // ── 6. Bot de comandos Telegram (background, nunca bloquea /health) ───────
  if (bootResult.telegramOk && isTelegramCommandsPollingEnabled(config)) {
    void initCommandBot()
      .then(() => {
        log.info(
          "🤖 Inicialización Telegram commands despachada; estado disponible en /health",
        );
      })
      .catch((err) => {
        setTelegramPollingRuntimeStatus("degraded");
        log.warn({ err }, "⚠️ Error iniciando bot — continuando sin comandos");
      });
  } else if (bootResult.telegramOk) {
    setTelegramPollingRuntimeStatus("disabled");
    void recordTelegramCommandsStartup("disabled").catch((err) => {
      log.warn({ err }, "No se pudo registrar Telegram commands disabled");
    });
    log.warn(
      {
        TELEGRAM_COMMAND_BOT_ENABLED: config.TELEGRAM_COMMAND_BOT_ENABLED,
        TELEGRAM_COMMANDS_ENABLED: config.TELEGRAM_COMMANDS_ENABLED,
        TELEGRAM_POLLING_ENABLED: config.TELEGRAM_POLLING_ENABLED,
      },
      "⚠️ Bot Telegram de comandos desactivado por configuración",
    );
  } else {
    setTelegramPollingRuntimeStatus("disabled");
    log.warn("⚠️ Bot Telegram desactivado — Telegram no disponible");
  }

  // ── 7. FORCE_COLLECT: background, nunca bloquea /health ni scheduler ─────
  if (process.env.FORCE_COLLECT === "true") {
    void (async () => {
      let forceCollectAllowed = false;
      try {
        const pause = await getEffectivePause("collector");
        if (pause.paused) {
          log.info(
            {
              effectiveScope: pause.effectiveScope,
              resumeAt: pause.entry?.resumeAt ?? null,
            },
            "[PAUSA] FORCE_COLLECT omitido por pausa manual",
          );
        } else {
          forceCollectAllowed = true;
        }
      } catch (err) {
        log.error(
          { err },
          "[PAUSA] No se pudo verificar la pausa; FORCE_COLLECT omitido por seguridad",
        );
      }

      if (forceCollectAllowed) {
        log.info("⚡ FORCE_COLLECT=true — ejecutando ciclo de colección inmediato...");
        try {
          const { runCollectJob } = await import("./jobs/collect.job");
          await runCollectJob();
          log.info("✅ FORCE_COLLECT ciclo completado");
        } catch (err) {
          log.error({ err }, "❌ Error en FORCE_COLLECT ciclo");
        }
      }
    })().catch((err) => {
      log.error({ err }, "❌ Error no manejado en FORCE_COLLECT background");
    });
  }

  // ── 8. Scheduler ──────────────────────────────────────────────────────────
  startScheduler();
  log.info("✅ Scheduler iniciado");

  if (process.env.RUN_MAESTROS === "true") {
    log.info(
      "RUN_MAESTROS=true detectado: ejecutando scraper de maestros en background",
    );
    void runMaestrosScraper()
      .then(() => log.info("Scraper de maestros finalizado (background)"))
      .catch((err) => {
        log.error({ err }, "Error en scraper de maestros (background)");
      });
  }

  // ── 9. Resumen de arranque ────────────────────────────────────────────────
  log.info(
    {
      supabase: bootResult.supabaseOk ? "ok" : "down",
      telegram: bootResult.telegramOk ? "ok" : "down",
      bot: bootResult.botUsername ?? "N/A",
      sourceId: bootResult.sourceId ?? "pendiente",
      errorNotifier: bootResult.telegramOk ? "active" : "disabled",
    },
    "✅ Worker activo — esperando ciclos",
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

main().catch((err) => {
  const log = getLogger();
  if (err instanceof SchemaValidationError) {
    log.fatal(
      {
        missing: err.missing,
        columnsMissing: err.columnsMissing,
        found: err.found,
        total: err.total,
      },
      [
        "💥 FATAL: DATABASE SCHEMA NOT INITIALIZED",
        `  Tables found: ${err.found} / ${err.total}`,
        `  Missing: [${err.missing.join(", ")}]`,
        `  Missing columns: ${JSON.stringify(err.columnsMissing)}`,
        "  Fix: Execute docs/supabase-schema.sql in Supabase SQL Editor",
      ].join("\n"),
    );
  } else {
    log.fatal({ err }, "💥 Fatal error starting worker");
  }
  process.exit(1);
});
