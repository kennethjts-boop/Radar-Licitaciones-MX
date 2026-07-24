import { getConfig } from "../../config/env";
import { createModuleLogger } from "../../core/logger";
import { runLicitacionWatchdog } from "./job";
import { getEffectivePause } from "../control/pause-state";
import { getState, STATE_KEYS } from "../../core/system-state";
import type { WatchdogTelemetry } from "./types";

const log = createModuleLogger("licitacion-watchdog:scheduler");
const MAX_WATCHDOG_BACKOFF_MS = 120 * 60_000;

function configuredExpedientes(): string[] {
  return getConfig().WATCHDOG_EXPEDIENTES.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function startLicitacionWatchdogScheduler(): void {
  try {
    const config = getConfig();
    const expedientes = configuredExpedientes();
    if (expedientes.length === 0) {
      log.info("Watchdog deshabilitado: WATCHDOG_EXPEDIENTES está vacío");
      return;
    }
    const intervalMs = config.WATCHDOG_INTERVAL_MINUTES * 60_000;
    const scheduleNext = (delayMs: number): void => {
      setTimeout(runSafely, delayMs);
    };
    const runSafely = (): void => {
      void (async () => {
        const pause = await getEffectivePause("watchdog");
        if (pause.paused) {
          log.info(
            {
              effectiveScope: pause.effectiveScope,
              resumeAt: pause.entry?.resumeAt ?? null,
            },
            "[PAUSA] Ciclo watchdog omitido por pausa manual",
          );
          return;
        }
        await runLicitacionWatchdog(expedientes);
      })().catch((err) => {
        log.error(
          { err, suppressTelegram: true },
          "Fallo contenido en scheduler watchdog; sin propagación a unhandledRejection",
        );
      }).finally(() => {
        const telemetryPromise = getState<WatchdogTelemetry>(
          STATE_KEYS.WATCHDOG_TELEMETRY,
        ).catch(() => null);
        void telemetryPromise.then((telemetry) => {
          const consecutiveFailures =
            telemetry?.health?.consecutiveFailures ?? 0;
          const delayMs = watchdogSchedulerDelayMs(
            intervalMs,
            consecutiveFailures,
          );
          log.info(
            {
              consecutiveFailures,
              nextInMs: delayMs,
              nextInMinutes: Number((delayMs / 60_000).toFixed(1)),
            },
            "Próximo ciclo watchdog programado",
          );
          scheduleNext(delayMs);
        });
      });
    };
    scheduleNext(20_000);
    log.info(
      { expedientes, intervalMinutes: config.WATCHDOG_INTERVAL_MINUTES },
      "Scheduler watchdog independiente iniciado",
    );
  } catch (err) {
    log.error(
      { err, suppressTelegram: true },
      "No se pudo iniciar watchdog; scheduler principal continúa",
    );
  }
}

export function watchdogSchedulerDelayMs(
  baseIntervalMs: number,
  consecutiveFailures: number,
): number {
  if (consecutiveFailures <= 1) return baseIntervalMs;
  const multiplier = Math.pow(
    2,
    Math.min(Math.max(Math.trunc(consecutiveFailures) - 1, 0), 3),
  );
  return Math.min(baseIntervalMs * multiplier, MAX_WATCHDOG_BACKOFF_MS);
}
