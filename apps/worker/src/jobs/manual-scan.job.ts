import { createModuleLogger } from "../core/logger";
import { runCollectJob } from "./collect.job";
import { runDailyAccionesJob } from "./daily-acciones.job";
import { runDailyApuestasJob } from "./daily-apuestas.job";
import { runDailyPetroleoJob } from "./daily-petroleo.job";
import { runDailySubastasJob } from "./daily-subastas.job";
import { sendTelegramMessage } from "../alerts/telegram.alerts";

const log = createModuleLogger("manual-scan-job");

export async function runFullManualScan(): Promise<void> {
  log.info("🚀 Iniciando ESCANEO MANUAL completo...");
  
  await sendTelegramMessage("🚀 <b>Iniciando Escaneo Manual Completo...</b>\n(Licitaciones + Inversión)", "HTML");

  try {
    // 1. Licitaciones
    log.info("🔍 Escaneando Licitaciones (ComprasMX)...");
    await runCollectJob();
    
    // 2. Especializados
    log.info("📊 Ejecutando radares especializados...");
    
    await Promise.allSettled([
      runDailyAccionesJob(),
      runDailyApuestasJob(),
      runDailyPetroleoJob(),
      runDailySubastasJob(),
    ]);

    log.info("✅ Escaneo manual completado");
    await sendTelegramMessage("✅ <b>Escaneo Manual Completado</b>\nLos resultados han sido enviados si se encontraron matches.", "HTML");
  } catch (err) {
    log.error({ err }, "Error en escaneo manual");
    await sendTelegramMessage("❌ <b>Error en Escaneo Manual</b>\nRevisar logs del sistema.", "HTML");
    throw err;
  }
}
