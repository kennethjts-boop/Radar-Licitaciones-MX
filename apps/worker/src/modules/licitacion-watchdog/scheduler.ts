import { getConfig } from "../../config/env";
import { createModuleLogger } from "../../core/logger";
import { runLicitacionWatchdog } from "./job";
import { getEffectivePause } from "../control/pause-state";

const log = createModuleLogger("licitacion-watchdog:scheduler");

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
      });
    };
    setTimeout(runSafely, 20_000);
    setInterval(runSafely, intervalMs);
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
